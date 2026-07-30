-- PostgreSQL serializes timestamptz JSON with a +00:00 offset, while the
-- domain-event contract accepts canonical UTC datetimes ending in Z. Replace
-- the atomic resolver without changing its interface or security posture.
create or replace function public.resolve_review_task(
  p_company_id uuid,
  p_review_task_id uuid,
  p_action text,
  p_admin_id uuid,
  p_selected_candidate_index integer,
  p_notes text
) returns table (
  new_status public.review_task_status,
  pipeline_run_id uuid,
  property_id uuid,
  next_attempt integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.review_tasks%rowtype;
  v_pipeline public.pipeline_runs%rowtype;
  v_lead public.leads%rowtype;
  v_address public.property_addresses%rowtype;
  v_candidate jsonb;
  v_candidate_property_id uuid;
  v_expected_status public.review_task_status;
  v_next_attempt integer;
  v_audit_action text;
  v_event_id uuid;
  v_event jsonb;
  v_now timestamptz := now();
begin
  v_expected_status := case p_action
    when 'resolve' then 'resolved'::public.review_task_status
    when 'reject' then 'rejected'::public.review_task_status
    when 'retry' then 'retried'::public.review_task_status
    when 'unsupported' then 'unsupported'::public.review_task_status
    else null
  end;

  if v_expected_status is null then
    raise exception 'Invalid review task action %', p_action;
  end if;

  select task.*
  into v_task
  from public.review_tasks as task
  where task.id = p_review_task_id
    and task.company_id = p_company_id
  for update;

  if not found then
    raise exception 'Review task % not found for company %',
      p_review_task_id, p_company_id;
  end if;

  -- The row lock serializes concurrent submissions. Replaying the action that
  -- already won returns its result without another audit or event.
  if v_task.status = v_expected_status then
    return query
      select
        v_task.status,
        v_task.pipeline_run_id,
        v_task.property_id,
        case
          when p_action = 'retry' then v_task.retry_count + 1
          else null::integer
        end;
    return;
  end if;

  if v_task.status != 'open' then
    raise exception 'Review task % is not open', p_review_task_id;
  end if;

  if p_admin_id is not null and not exists (
    select 1
    from public.admin_profiles as profile
    where profile.id = p_admin_id
      and profile.company_id = p_company_id
  ) then
    raise exception 'Admin % not found for company %', p_admin_id, p_company_id;
  end if;

  select run.*
  into v_pipeline
  from public.pipeline_runs as run
  where run.id = v_task.pipeline_run_id
    and run.company_id = p_company_id
    and run.lead_id = v_task.lead_id
    and run.property_id = v_task.property_id
  for update;
  if not found then
    raise exception 'Review task % has invalid company scope', p_review_task_id;
  end if;

  select lead.*
  into v_lead
  from public.leads as lead
  where lead.id = v_task.lead_id
    and lead.company_id = p_company_id
    and lead.property_id = v_task.property_id
  for update;
  if not found then
    raise exception 'Review task % has invalid company scope', p_review_task_id;
  end if;

  perform 1
  from public.properties as property
  where property.id = v_task.property_id
    and property.company_id = p_company_id
  for update;
  if not found then
    raise exception 'Review task % has invalid company scope', p_review_task_id;
  end if;

  if p_action = 'retry' then
    v_next_attempt := v_task.retry_count + 2;
    v_event_id := gen_random_uuid();

    if v_task.triggering_event_name =
      'property/address.validation_requested'
    then
      v_event := jsonb_build_object(
        'id', v_event_id,
        'name', v_task.triggering_event_name,
        'schemaVersion', 1,
        'correlationId', v_pipeline.correlation_id,
        'leadId', v_task.lead_id,
        'propertyId', v_task.property_id,
        'pipelineRunId', v_task.pipeline_run_id,
        'occurredAt', to_char(
          v_now at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ),
        'idempotencyKey', format(
          '%s:%s:%s',
          v_task.triggering_event_name,
          v_task.pipeline_run_id,
          v_next_attempt
        ),
        'data', jsonb_build_object(
          'leadId', v_task.lead_id,
          'propertyId', v_task.property_id,
          'submittedAddress', v_lead.submitted_address,
          'attempt', v_next_attempt
        )
      );
    else
      select address.*
      into v_address
      from public.property_addresses as address
      where address.property_id = v_task.property_id
        and address.company_id = p_company_id
      order by address.created_at desc, address.id desc
      limit 1;

      if not found or v_address.canonical_address is null then
        raise exception
          'Discovery retry requires a canonical address for review task %',
          p_review_task_id;
      end if;

      v_event := jsonb_build_object(
        'id', v_event_id,
        'name', v_task.triggering_event_name,
        'schemaVersion', 1,
        'correlationId', v_pipeline.correlation_id,
        'leadId', v_task.lead_id,
        'propertyId', v_task.property_id,
        'pipelineRunId', v_task.pipeline_run_id,
        'occurredAt', to_char(
          v_now at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ),
        'idempotencyKey', format(
          '%s:%s:%s',
          v_task.triggering_event_name,
          v_task.pipeline_run_id,
          v_next_attempt
        ),
        'data', jsonb_build_object(
          'leadId', v_task.lead_id,
          'propertyId', v_task.property_id,
          'canonicalAddress', v_address.canonical_address,
          'latitude', v_address.latitude,
          'longitude', v_address.longitude,
          'attempt', v_next_attempt
        )
      );
    end if;
  end if;

  if p_action = 'resolve' then
    if p_selected_candidate_index is not null then
      if p_selected_candidate_index < 0 then
        raise exception 'Candidate index % not found on review task %',
          p_selected_candidate_index, p_review_task_id;
      end if;

      if v_task.reason = 'duplicate_candidates' then
        v_candidate_property_id :=
          (v_task.candidate_data->'candidatePropertyIds'
            ->>p_selected_candidate_index)::uuid;

        if v_candidate_property_id is null or not exists (
          select 1
          from public.properties as candidate_property
          where candidate_property.id = v_candidate_property_id
            and candidate_property.company_id = p_company_id
            and candidate_property.id <> v_task.property_id
        ) then
          raise exception 'Candidate index % not found on review task %',
            p_selected_candidate_index, p_review_task_id;
        end if;

        update public.properties
        set resolution_status = 'duplicate',
            merged_into_property_id = v_candidate_property_id,
            updated_at = v_now
        where id = v_task.property_id
          and company_id = p_company_id;

        update public.leads
        set property_id = v_candidate_property_id,
            updated_at = v_now
        where id = v_task.lead_id
          and company_id = p_company_id;

        update public.pipeline_runs
        set property_id = v_candidate_property_id
        where id = v_task.pipeline_run_id
          and company_id = p_company_id;
      else
        v_candidate :=
          v_task.candidate_data->'candidates'->p_selected_candidate_index;

        if v_candidate is null then
          raise exception 'Candidate index % not found on review task %',
            p_selected_candidate_index, p_review_task_id;
        end if;

        insert into public.parcels (
          company_id, property_id, block, lot, qualifier, pams_pin, gis_pin,
          municipality_code, municipality_name, county, property_class,
          acreage, year_built, land_value_cents, improvement_value_cents,
          net_value_cents, property_location, street_address,
          building_description, land_description, dwelling_units, geometry
        ) values (
          p_company_id,
          v_task.property_id,
          v_candidate->>'block',
          v_candidate->>'lot',
          v_candidate->>'qualifier',
          v_candidate->>'pamsPin',
          v_candidate->>'gisPin',
          v_candidate->>'municipalityCode',
          v_candidate->>'municipalityName',
          v_candidate->>'county',
          v_candidate->>'propertyClass',
          nullif(v_candidate->>'acreage', '')::numeric,
          nullif(v_candidate->>'yearBuilt', '')::integer,
          round(nullif(v_candidate->>'landValue', '')::numeric * 100)::bigint,
          round(nullif(v_candidate->>'improvementValue', '')::numeric * 100)::bigint,
          round(nullif(v_candidate->>'netValue', '')::numeric * 100)::bigint,
          v_candidate->>'propertyLocation',
          v_candidate->>'streetAddress',
          v_candidate->>'buildingDescription',
          v_candidate->>'landDescription',
          nullif(v_candidate->>'dwellingUnits', '')::integer,
          case
            when v_candidate->'geometry' is null
              or v_candidate->'geometry' = 'null'::jsonb
            then null
            else extensions.st_setsrid(
              extensions.st_geomfromgeojson((v_candidate->'geometry')::text),
              4326
            )::extensions.geography
          end
        );

        update public.properties
        set resolution_status = 'resolved',
            updated_at = v_now
        where id = v_task.property_id
          and company_id = p_company_id;
      end if;
    else
      update public.properties
      set resolution_status = 'resolved',
          updated_at = v_now
      where id = v_task.property_id
        and company_id = p_company_id;
    end if;

    update public.pipeline_runs
    set status = 'complete',
        finished_at = v_now
    where id = v_task.pipeline_run_id
      and company_id = p_company_id;

  elsif p_action = 'reject' then
    update public.pipeline_runs
    set status = 'failed',
        finished_at = v_now
    where id = v_task.pipeline_run_id
      and company_id = p_company_id;

  elsif p_action = 'unsupported' then
    update public.properties
    set resolution_status = 'unsupported',
        updated_at = v_now
    where id = v_task.property_id
      and company_id = p_company_id;

    update public.pipeline_runs
    set status = 'partial',
        finished_at = v_now
    where id = v_task.pipeline_run_id
      and company_id = p_company_id;

  else
    update public.properties
    set resolution_status = 'unresolved',
        merged_into_property_id = null,
        updated_at = v_now
    where id = v_task.property_id
      and company_id = p_company_id;

    update public.pipeline_runs
    set status = case
          when v_task.triggering_event_name =
            'property/address.validation_requested'
          then 'received'::public.pipeline_status
          else 'validating'::public.pipeline_status
        end,
        property_id = v_task.property_id,
        finished_at = null
    where id = v_task.pipeline_run_id
      and company_id = p_company_id;
  end if;

  update public.review_tasks
  set status = v_expected_status,
      resolution_notes = p_notes,
      resolved_by = p_admin_id,
      resolved_at = v_now,
      retry_count = case
        when p_action = 'retry' then retry_count + 1
        else retry_count
      end
  where id = p_review_task_id
    and company_id = p_company_id;

  v_audit_action := case p_action
    when 'resolve' then 'review.task_resolved'
    when 'reject' then 'review.task_rejected'
    when 'retry' then 'review.task_retried'
    when 'unsupported' then 'review.task_unsupported'
  end;

  insert into public.audit_log (
    company_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    correlation_id,
    metadata
  ) values (
    p_company_id,
    p_admin_id,
    v_audit_action,
    'review_task',
    p_review_task_id,
    v_pipeline.correlation_id,
    jsonb_build_object('action', p_action)
  );

  if p_action = 'retry' then
    perform public.enqueue_domain_event(p_company_id, v_event);
  end if;

  return query
    select
      v_expected_status,
      v_task.pipeline_run_id,
      v_task.property_id,
      v_next_attempt;
end;
$$;

revoke all on function public.resolve_review_task(
  uuid, uuid, text, uuid, integer, text
) from public, anon, authenticated;

grant execute on function public.resolve_review_task(
  uuid, uuid, text, uuid, integer, text
) to service_role;

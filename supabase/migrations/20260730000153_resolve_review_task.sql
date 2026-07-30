-- Replace the interface-compatible Task 2 stub with the transactional review
-- resolver. This is deliberately SECURITY INVOKER: only the service role has
-- EXECUTE and it already has the table privileges used below.
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
  v_candidate jsonb;
  v_candidate_property_id uuid;
  v_new_status public.review_task_status;
  v_next_attempt integer;
begin
  if p_action not in ('resolve', 'reject', 'retry', 'unsupported') then
    raise exception 'Invalid review task action %', p_action;
  end if;

  select *
  into v_task
  from public.review_tasks
  where id = p_review_task_id
    and company_id = p_company_id
  for update;

  if not found then
    raise exception 'Review task % not found for company %',
      p_review_task_id, p_company_id;
  end if;

  -- A retry can be replayed after a lost response. Return the original next
  -- attempt so the event idempotency key remains stable.
  if v_task.status = 'retried' and p_action = 'retry' then
    return query
      select v_task.status, v_task.pipeline_run_id, v_task.property_id,
        v_task.retry_count + 1;
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

  if not exists (
    select 1
    from public.pipeline_runs as run
    where run.id = v_task.pipeline_run_id
      and run.company_id = p_company_id
      and run.lead_id = v_task.lead_id
      and run.property_id = v_task.property_id
  ) or not exists (
    select 1
    from public.leads as lead
    where lead.id = v_task.lead_id
      and lead.company_id = p_company_id
      and lead.property_id = v_task.property_id
  ) or not exists (
    select 1
    from public.properties as property
    where property.id = v_task.property_id
      and property.company_id = p_company_id
  ) then
    raise exception 'Review task % has invalid company scope', p_review_task_id;
  end if;

  if p_action = 'resolve' then
    v_new_status := 'resolved';

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
            updated_at = now()
        where id = v_task.property_id
          and company_id = p_company_id;

        update public.leads
        set property_id = v_candidate_property_id,
            updated_at = now()
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
            updated_at = now()
        where id = v_task.property_id
          and company_id = p_company_id;
      end if;
    else
      update public.properties
      set resolution_status = 'resolved',
          updated_at = now()
      where id = v_task.property_id
        and company_id = p_company_id;
    end if;

    update public.pipeline_runs
    set status = 'complete',
        finished_at = now()
    where id = v_task.pipeline_run_id
      and company_id = p_company_id;

  elsif p_action = 'reject' then
    v_new_status := 'rejected';

    update public.pipeline_runs
    set status = 'failed',
        finished_at = now()
    where id = v_task.pipeline_run_id
      and company_id = p_company_id;

  elsif p_action = 'unsupported' then
    v_new_status := 'unsupported';

    update public.properties
    set resolution_status = 'unsupported',
        updated_at = now()
    where id = v_task.property_id
      and company_id = p_company_id;

    update public.pipeline_runs
    set status = 'partial',
        finished_at = now()
    where id = v_task.pipeline_run_id
      and company_id = p_company_id;

  else
    v_new_status := 'retried';
    v_next_attempt := v_task.retry_count + 2;

    update public.properties
    set resolution_status = 'unresolved',
        merged_into_property_id = null,
        updated_at = now()
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
  set status = v_new_status,
      resolution_notes = p_notes,
      resolved_by = p_admin_id,
      resolved_at = now(),
      retry_count = case
        when p_action = 'retry' then retry_count + 1
        else retry_count
      end
  where id = p_review_task_id
    and company_id = p_company_id;

  return query
    select v_new_status, v_task.pipeline_run_id, v_task.property_id,
      v_next_attempt;
end;
$$;

revoke all on function public.resolve_review_task(
  uuid, uuid, text, uuid, integer, text
) from public, anon, authenticated;

grant execute on function public.resolve_review_task(
  uuid, uuid, text, uuid, integer, text
) to service_role;

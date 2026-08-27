-- Canonical assessment intake creates the CRM graph directly. Hand the new
-- lead to the existing CRM -> address validation -> Google roof pipeline in
-- the same transaction so the quote and aerial cannot be stranded.

create function public.enqueue_roof_assessment_quote_pipeline_event(
  p_attempt_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.roof_assessment_access_attempts%rowtype;
  v_lead public.leads%rowtype;
  v_estimate public.roof_estimates%rowtype;
  v_pipeline_run_id uuid;
  v_event_id uuid;
  v_event_payload jsonb;
begin
  select attempt.* into v_attempt
  from public.roof_assessment_access_attempts as attempt
  where attempt.id = p_attempt_id
  for update;

  if not found then
    raise exception 'Assessment access attempt not found';
  end if;

  if v_attempt.attempt_kind <> 'new' then
    return null;
  end if;

  select lead.* into strict v_lead
  from public.leads as lead
  where lead.id = v_attempt.lead_id
    and lead.company_id = v_attempt.company_id;

  select estimate.* into strict v_estimate
  from public.roof_estimates as estimate
  where estimate.id = v_attempt.estimate_id
    and estimate.company_id = v_attempt.company_id
    and estimate.lead_id = v_attempt.lead_id
    and estimate.property_id = v_attempt.property_id;

  select run.id into strict v_pipeline_run_id
  from public.pipeline_runs as run
  where run.company_id = v_attempt.company_id
    and run.lead_id = v_attempt.lead_id
    and run.property_id = v_attempt.property_id
  order by run.started_at desc, run.id
  limit 1;

  v_event_id := extensions.gen_random_uuid();
  v_event_payload := pg_catalog.jsonb_strip_nulls(
    pg_catalog.jsonb_build_object(
      'id', v_event_id,
      'name', 'crm/lead.submitted',
      'schemaVersion', 1,
      'correlationId', v_attempt.submission_id,
      'leadId', v_attempt.lead_id,
      'propertyId', v_attempt.property_id,
      'pipelineRunId', v_pipeline_run_id,
      'occurredAt', pg_catalog.to_char(
        v_attempt.created_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'idempotencyKey', 'crm/lead.submitted:' || v_pipeline_run_id::text,
      'data', pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'leadId', v_attempt.lead_id,
          'propertyId', v_attempt.property_id,
          'name', v_lead.name,
          'phone', v_lead.phone_e164,
          'email', v_lead.email_normalized,
          'submittedAddress', v_lead.submitted_address,
          'googlePlaceId', v_estimate.google_place_id,
          'serviceRequested', 'roofing',
          'notes', 'Submitted through the canonical roof assessment intake.'
        )
      )
    )
  );

  insert into public.domain_events (
    id, company_id, pipeline_run_id, event_name, schema_version,
    correlation_id, idempotency_key, payload, occurred_at
  ) values (
    v_event_id, v_attempt.company_id, v_pipeline_run_id,
    'crm/lead.submitted', 1, v_attempt.submission_id,
    'crm/lead.submitted:' || v_pipeline_run_id::text,
    v_event_payload, v_attempt.created_at
  )
  on conflict (idempotency_key) do nothing;

  if not found then
    select event.id into strict v_event_id
    from public.domain_events as event
    where event.idempotency_key = 'crm/lead.submitted:' || v_pipeline_run_id::text
      and event.company_id = v_attempt.company_id
      and event.pipeline_run_id = v_pipeline_run_id
      and event.event_name = 'crm/lead.submitted';
  end if;

  insert into public.event_outbox (event_id)
  values (v_event_id)
  on conflict (event_id) do nothing;

  return v_event_id;
end;
$$;

revoke execute on function public.enqueue_roof_assessment_quote_pipeline_event(uuid)
  from public, anon, authenticated;
grant execute on function public.enqueue_roof_assessment_quote_pipeline_event(uuid)
  to service_role;

create function public.enqueue_new_roof_assessment_quote_pipeline_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.attempt_kind = 'new' then
    perform public.enqueue_roof_assessment_quote_pipeline_event(new.id);
  end if;
  return new;
end;
$$;

revoke execute on function public.enqueue_new_roof_assessment_quote_pipeline_event()
  from public, anon, authenticated;

create trigger enqueue_new_roof_assessment_quote_pipeline_event
after insert on public.roof_assessment_access_attempts
for each row execute function public.enqueue_new_roof_assessment_quote_pipeline_event();

-- Heal canonical assessments created before this bridge. The helper is
-- idempotent and also restores a missing outbox row for an existing event.
select public.enqueue_roof_assessment_quote_pipeline_event(attempt.id)
from public.roof_assessment_access_attempts as attempt
where attempt.attempt_kind = 'new'
  and not exists (
    select 1
    from public.domain_events as event
    join public.pipeline_runs as run on run.id = event.pipeline_run_id
    where event.event_name = 'crm/lead.submitted'
      and event.company_id = attempt.company_id
      and run.lead_id = attempt.lead_id
      and run.property_id = attempt.property_id
  );

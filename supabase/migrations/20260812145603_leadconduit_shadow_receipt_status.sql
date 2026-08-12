create or replace function public.upsert_leadconduit_event_batch(
  p_company_id uuid,
  p_events jsonb,
  p_channel text,
  p_observed_at timestamptz
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event jsonb;
  v_count integer := 0;
begin
  if p_company_id is null
    or p_observed_at is null
    or p_channel not in ('webhook', 'poll')
    or jsonb_typeof(p_events) <> 'array'
  then
    raise exception using errcode = '22023', message = 'invalid_leadconduit_event_batch';
  end if;

  for v_event in select value from jsonb_array_elements(p_events)
  loop
    if jsonb_typeof(v_event) <> 'object'
      or nullif(trim(v_event->>'event_id'), '') is null
      or nullif(trim(v_event->>'flow_id'), '') is null
    then
      raise exception using errcode = '22023', message = 'invalid_leadconduit_event';
    end if;

    insert into public.leadconduit_events (
      company_id, event_id, flow_id, source_id, source_name, lead_id,
      event_type, occurred_at, outcome, external_lead_id, phone_normalized,
      email_normalized, raw_status, step_id, step_name, rule_id, rule_name,
      rule_scope, rule_scope_id, reason_category, lead_name, submitted_phone,
      submitted_email, submitted_address, campaign, consent_reference,
      trustedform_url, attribution, raw_payload, is_test, ingested_at,
      ingestion_channels, first_observed_at, webhook_received_at, poll_observed_at,
      processing_status
    ) values (
      p_company_id,
      trim(v_event->>'event_id'),
      trim(v_event->>'flow_id'),
      nullif(trim(v_event->>'source_id'), ''),
      nullif(trim(v_event->>'source_name'), ''),
      nullif(trim(v_event->>'lead_id'), ''),
      coalesce(nullif(trim(v_event->>'event_type'), ''), 'unknown'),
      coalesce((v_event->>'occurred_at')::timestamptz, p_observed_at),
      nullif(trim(v_event->>'outcome'), ''),
      nullif(trim(v_event->>'external_lead_id'), ''),
      nullif(trim(v_event->>'phone_normalized'), ''),
      nullif(trim(v_event->>'email_normalized'), ''),
      nullif(trim(v_event->>'raw_status'), ''),
      nullif(trim(v_event->>'step_id'), ''),
      nullif(trim(v_event->>'step_name'), ''),
      nullif(trim(v_event->>'rule_id'), ''),
      nullif(trim(v_event->>'rule_name'), ''),
      nullif(trim(v_event->>'rule_scope'), ''),
      nullif(trim(v_event->>'rule_scope_id'), ''),
      nullif(trim(v_event->>'reason_category'), ''),
      nullif(trim(v_event->>'lead_name'), ''),
      nullif(trim(v_event->>'submitted_phone'), ''),
      nullif(trim(v_event->>'submitted_email'), ''),
      nullif(trim(v_event->>'submitted_address'), ''),
      nullif(trim(v_event->>'campaign'), ''),
      nullif(trim(v_event->>'consent_reference'), ''),
      nullif(trim(v_event->>'trustedform_url'), ''),
      coalesce(v_event->'attribution', '{}'::jsonb),
      private.redact_credential_values(coalesce(v_event->'raw_payload', '{}'::jsonb)),
      coalesce((v_event->>'is_test')::boolean, false),
      p_observed_at,
      array[p_channel]::text[],
      p_observed_at,
      case when p_channel = 'webhook' then p_observed_at end,
      case when p_channel = 'poll' then p_observed_at end,
      coalesce(nullif(trim(v_event->>'processing_status'), ''), 'observed')
    )
    on conflict (company_id, event_id) do update
    set source_id = coalesce(public.leadconduit_events.source_id, excluded.source_id),
        source_name = coalesce(public.leadconduit_events.source_name, excluded.source_name),
        outcome = coalesce(public.leadconduit_events.outcome, excluded.outcome),
        external_lead_id = coalesce(public.leadconduit_events.external_lead_id, excluded.external_lead_id),
        phone_normalized = coalesce(public.leadconduit_events.phone_normalized, excluded.phone_normalized),
        email_normalized = coalesce(public.leadconduit_events.email_normalized, excluded.email_normalized),
        raw_status = coalesce(public.leadconduit_events.raw_status, excluded.raw_status),
        step_id = coalesce(public.leadconduit_events.step_id, excluded.step_id),
        step_name = coalesce(public.leadconduit_events.step_name, excluded.step_name),
        rule_id = coalesce(public.leadconduit_events.rule_id, excluded.rule_id),
        rule_name = coalesce(public.leadconduit_events.rule_name, excluded.rule_name),
        rule_scope = coalesce(public.leadconduit_events.rule_scope, excluded.rule_scope),
        rule_scope_id = coalesce(public.leadconduit_events.rule_scope_id, excluded.rule_scope_id),
        reason_category = coalesce(public.leadconduit_events.reason_category, excluded.reason_category),
        lead_name = coalesce(public.leadconduit_events.lead_name, excluded.lead_name),
        submitted_phone = coalesce(public.leadconduit_events.submitted_phone, excluded.submitted_phone),
        submitted_email = coalesce(public.leadconduit_events.submitted_email, excluded.submitted_email),
        submitted_address = coalesce(public.leadconduit_events.submitted_address, excluded.submitted_address),
        campaign = coalesce(public.leadconduit_events.campaign, excluded.campaign),
        consent_reference = coalesce(public.leadconduit_events.consent_reference, excluded.consent_reference),
        trustedform_url = coalesce(public.leadconduit_events.trustedform_url, excluded.trustedform_url),
        attribution = excluded.attribution || public.leadconduit_events.attribution,
        processing_status = case
          when public.leadconduit_events.processing_status in ('processed', 'pending', 'failed')
            then public.leadconduit_events.processing_status
          when excluded.processing_status = 'observed' then 'observed'
          when public.leadconduit_events.processing_status = 'observed' then 'observed'
          else excluded.processing_status
        end,
        ingestion_channels = array_remove(array[
          case
            when 'webhook' = any(public.leadconduit_events.ingestion_channels) or p_channel = 'webhook'
              then 'webhook'
          end,
          case
            when 'poll' = any(public.leadconduit_events.ingestion_channels) or p_channel = 'poll'
              then 'poll'
          end
        ]::text[], null),
        first_observed_at = least(public.leadconduit_events.first_observed_at, excluded.first_observed_at),
        webhook_received_at = coalesce(
          least(public.leadconduit_events.webhook_received_at, excluded.webhook_received_at),
          public.leadconduit_events.webhook_received_at,
          excluded.webhook_received_at
        ),
        poll_observed_at = coalesce(
          least(public.leadconduit_events.poll_observed_at, excluded.poll_observed_at),
          public.leadconduit_events.poll_observed_at,
          excluded.poll_observed_at
        );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.upsert_leadconduit_event_batch(uuid, jsonb, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.upsert_leadconduit_event_batch(uuid, jsonb, text, timestamptz)
  to service_role;

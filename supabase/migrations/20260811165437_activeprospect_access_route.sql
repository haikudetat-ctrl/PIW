-- Tenant-safe vendor identity and immutable LeadConduit observation provenance.

drop index public.leads_source_external_id_idx;

create unique index leads_source_external_id_idx
  on public.leads(company_id, source_system, external_lead_id)
  where external_lead_id is not null;

alter table public.leads
  add constraint leads_company_id_id_key unique (company_id, id);

create or replace function public.submit_lead_intake_from_source(
  p_company_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_submitted_address text,
  p_notes text,
  p_correlation_id uuid,
  p_pipeline_version integer,
  p_source_system text,
  p_external_lead_id text default null,
  p_source_account_id text default null,
  p_source_record_id text default null,
  p_original_lead_source text default null,
  p_campaign text default null,
  p_consent_reference text default null,
  p_trustedform_url text default null,
  p_is_test boolean default false,
  p_phone_e164 text default null,
  p_email_normalized text default null
) returns table (
  lead_id uuid,
  property_id uuid,
  pipeline_run_id uuid,
  is_duplicate boolean
)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_property_id uuid;
  v_lead_id uuid;
  v_pipeline_run_id uuid;
begin
  if p_external_lead_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_company_id::text || chr(31) || p_source_system || chr(31) || p_external_lead_id,
        0
      )
    );

    select lead.id, lead.property_id
      into v_lead_id, v_property_id
    from public.leads as lead
    where lead.company_id = p_company_id
      and lead.source_system = p_source_system
      and lead.external_lead_id = p_external_lead_id
    limit 1;
  end if;

  if v_lead_id is not null then
    select pipeline.id
      into v_pipeline_run_id
    from public.pipeline_runs as pipeline
    where pipeline.company_id = p_company_id
      and pipeline.lead_id = v_lead_id
    order by pipeline.started_at desc
    limit 1;

    return query select v_lead_id, v_property_id, v_pipeline_run_id, true;
    return;
  end if;

  insert into public.properties (company_id, resolution_status)
  values (p_company_id, 'unresolved')
  returning id into v_property_id;

  insert into public.leads (
    company_id, property_id, name, phone, email, submitted_address, notes,
    source_system, external_lead_id, source_account_id, source_record_id,
    original_lead_source, campaign, consent_reference, trustedform_url,
    is_test, phone_e164, email_normalized
  ) values (
    p_company_id, v_property_id, p_name, p_phone, p_email, p_submitted_address, p_notes,
    p_source_system, p_external_lead_id, p_source_account_id, p_source_record_id,
    p_original_lead_source, p_campaign, p_consent_reference, p_trustedform_url,
    p_is_test, p_phone_e164, p_email_normalized
  )
  returning id into v_lead_id;

  insert into public.pipeline_runs (
    company_id, lead_id, property_id, correlation_id, pipeline_version, status
  ) values (
    p_company_id, v_lead_id, v_property_id, p_correlation_id, p_pipeline_version, 'received'
  )
  returning id into v_pipeline_run_id;

  return query select v_lead_id, v_property_id, v_pipeline_run_id, false;
end;
$$;

revoke all on function public.submit_lead_intake_from_source(
  uuid, text, text, text, text, text, uuid, integer, text, text, text, text,
  text, text, text, text, boolean, text, text
) from public, anon, authenticated;

grant execute on function public.submit_lead_intake_from_source(
  uuid, text, text, text, text, text, uuid, integer, text, text, text, text,
  text, text, text, text, boolean, text, text
) to service_role;

alter table public.leadconduit_events
  add column step_id text,
  add column step_name text,
  add column rule_id text,
  add column rule_name text,
  add column rule_scope text,
  add column rule_scope_id text,
  add column reason_category text,
  add column lead_name text,
  add column submitted_phone text,
  add column submitted_email text,
  add column submitted_address text,
  add column campaign text,
  add column consent_reference text,
  add column trustedform_url text,
  add column attribution jsonb not null default '{}'::jsonb,
  add column ingestion_channels text[] not null default '{}'::text[],
  add column first_observed_at timestamptz,
  add column webhook_received_at timestamptz,
  add column poll_observed_at timestamptz,
  add column processing_status text not null default 'observed',
  add column piw_lead_id uuid,
  add column processing_error_category text,
  add column processing_attempts integer not null default 0,
  add column processing_claimed_at timestamptz,
  add column processing_claimed_by text,
  add column processing_next_attempt_at timestamptz;

update public.leadconduit_events
set ingestion_channels = array['poll']::text[],
    poll_observed_at = ingested_at,
    first_observed_at = ingested_at;

alter table public.leadconduit_events
  alter column first_observed_at set not null,
  add constraint leadconduit_events_ingestion_provenance_check check (
    ingestion_channels <@ array['webhook', 'poll']::text[]
    and cardinality(ingestion_channels) =
      (case when 'webhook' = any(ingestion_channels) then 1 else 0 end)
      + (case when 'poll' = any(ingestion_channels) then 1 else 0 end)
    and (('webhook' = any(ingestion_channels)) = (webhook_received_at is not null))
    and (('poll' = any(ingestion_channels)) = (poll_observed_at is not null))
  ),
  add constraint leadconduit_events_processing_status_check check (
    processing_status in ('observed', 'pending', 'processed', 'failed', 'not_applicable')
  ),
  add constraint leadconduit_events_processing_state_check check (
    (processing_status = 'processed' and piw_lead_id is not null)
    or (processing_status in ('observed', 'pending') and piw_lead_id is null)
    or processing_status in ('failed', 'not_applicable')
  ),
  add constraint leadconduit_events_processing_error_category_check check (
    processing_error_category is null
    or (
      processing_status = 'failed'
      and processing_error_category in (
        'authentication', 'authorization', 'rate_limit', 'upstream',
        'invalid_response', 'persistence', 'mapping', 'invalid_payload',
        'flow_mismatch', 'unsupported_event', 'retry_exhausted'
      )
    )
  ),
  add constraint leadconduit_events_processing_attempts_check check (processing_attempts >= 0),
  add constraint leadconduit_events_company_id_id_key unique (company_id, id),
  add constraint leadconduit_events_company_piw_lead_fkey
    foreign key (company_id, piw_lead_id)
    references public.leads(company_id, id);

create index leadconduit_events_pending_processing_idx
  on public.leadconduit_events(company_id, processing_next_attempt_at, first_observed_at)
  where processing_status in ('observed', 'pending', 'failed');
create index leadconduit_events_active_lease_idx
  on public.leadconduit_events(company_id, processing_claimed_at)
  where processing_claimed_at is not null;
create index leadconduit_events_company_flow_observed_idx
  on public.leadconduit_events(company_id, flow_id, first_observed_at desc);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create or replace function private.redact_credential_values(p_value jsonb)
returns jsonb
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  v_redacted jsonb;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select coalesce(
        jsonb_object_agg(
          entry.key,
          case
            when entry.key ~* '(api[_. -]*key|token|authorization|password|secret|credential|private[_. -]*key)'
              then to_jsonb('[REDACTED]'::text)
            else private.redact_credential_values(entry.value)
          end
        ),
        '{}'::jsonb
      )
      into v_redacted
      from jsonb_each(p_value) as entry;
    when 'array' then
      select coalesce(
        jsonb_agg(private.redact_credential_values(element.value) order by element.ordinality),
        '[]'::jsonb
      )
      into v_redacted
      from jsonb_array_elements(p_value) with ordinality as element(value, ordinality);
    else
      v_redacted := p_value;
  end case;

  return v_redacted;
end;
$$;

create table public.leadconduit_source_metadata (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  flow_id text not null check (length(trim(flow_id)) > 0),
  source_id text not null check (length(trim(source_id)) > 0),
  source_name text,
  field_names text[] not null default '{}'::text[],
  acceptance_metadata jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null,
  constraint leadconduit_source_metadata_company_flow_source_key
    unique (company_id, flow_id, source_id),
  constraint leadconduit_source_metadata_company_flow_fkey
    foreign key (company_id, flow_id)
    references public.leadconduit_flows(company_id, flow_id)
    on delete cascade
);

create table public.leadconduit_flow_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  flow_id text not null check (length(trim(flow_id)) > 0),
  step_id text not null check (length(trim(step_id)) > 0),
  step_type text not null check (length(trim(step_type)) > 0),
  step_name text,
  step_order integer not null check (step_order >= 0),
  enabled boolean not null,
  outcome text,
  observed_at timestamptz not null,
  constraint leadconduit_flow_steps_company_flow_step_key
    unique (company_id, flow_id, step_id),
  constraint leadconduit_flow_steps_company_flow_fkey
    foreign key (company_id, flow_id)
    references public.leadconduit_flows(company_id, flow_id)
    on delete cascade
);

create table public.leadconduit_flow_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  flow_id text not null check (length(trim(flow_id)) > 0),
  rule_scope text not null
    check (rule_scope in ('flow_acceptance', 'source_acceptance', 'filter_step')),
  rule_scope_id text not null check (length(trim(rule_scope_id)) > 0),
  rule_id text not null check (length(trim(rule_id)) > 0),
  rule_name text,
  lhv text not null check (length(trim(lhv)) > 0),
  operator text not null check (length(trim(operator)) > 0),
  observed_at timestamptz not null,
  constraint leadconduit_flow_rules_company_scope_rule_key
    unique (company_id, flow_id, rule_scope, rule_scope_id, rule_id),
  constraint leadconduit_flow_rules_company_flow_fkey
    foreign key (company_id, flow_id)
    references public.leadconduit_flows(company_id, flow_id)
    on delete cascade
);

create index leadconduit_source_metadata_company_observed_idx
  on public.leadconduit_source_metadata(company_id, observed_at desc);
create index leadconduit_flow_steps_company_flow_order_idx
  on public.leadconduit_flow_steps(company_id, flow_id, step_order);
create index leadconduit_flow_rules_company_flow_scope_idx
  on public.leadconduit_flow_rules(company_id, flow_id, rule_scope, rule_scope_id);

create or replace function private.redact_leadconduit_source_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.acceptance_metadata := private.redact_credential_values(coalesce(new.acceptance_metadata, '{}'::jsonb));
  new.raw_payload := private.redact_credential_values(coalesce(new.raw_payload, '{}'::jsonb));
  return new;
end;
$$;

create trigger redact_leadconduit_source_metadata
before insert or update of acceptance_metadata, raw_payload
on public.leadconduit_source_metadata
for each row execute function private.redact_leadconduit_source_metadata();

alter table public.leadconduit_source_metadata enable row level security;
alter table public.leadconduit_flow_steps enable row level security;
alter table public.leadconduit_flow_rules enable row level security;

revoke all on public.leadconduit_source_metadata from public, anon, authenticated, service_role;
revoke all on public.leadconduit_flow_steps from public, anon, authenticated, service_role;
revoke all on public.leadconduit_flow_rules from public, anon, authenticated, service_role;

grant all on public.leadconduit_source_metadata to service_role;
grant all on public.leadconduit_flow_steps to service_role;
grant all on public.leadconduit_flow_rules to service_role;
revoke all on function private.redact_credential_values(jsonb) from public, anon, authenticated;
revoke all on function private.redact_leadconduit_source_metadata() from public, anon, authenticated;
grant execute on function private.redact_credential_values(jsonb) to service_role;
grant execute on function private.redact_leadconduit_source_metadata() to service_role;

grant select on public.leadconduit_source_metadata to authenticated;
grant select on public.leadconduit_flow_steps to authenticated;
grant select on public.leadconduit_flow_rules to authenticated;

create policy "company admins read LeadConduit source metadata"
  on public.leadconduit_source_metadata
  for select to authenticated
  using (company_id = (select public.current_company_id()));
create policy "company admins read LeadConduit flow steps"
  on public.leadconduit_flow_steps
  for select to authenticated
  using (company_id = (select public.current_company_id()));
create policy "company admins read LeadConduit flow rules"
  on public.leadconduit_flow_rules
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create or replace function public.upsert_leadconduit_event_batch(
  p_company_id uuid,
  p_events jsonb,
  p_channel text,
  p_observed_at timestamptz
) returns integer
language plpgsql
security invoker
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
      ingestion_channels, first_observed_at, webhook_received_at, poll_observed_at
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
      case when p_channel = 'poll' then p_observed_at end
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

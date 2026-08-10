-- Read-only Access Route ingestion. Vendor API credentials remain server-side;
-- authenticated dashboard users can only read tenant-scoped normalized rows.

create table public.integration_sync_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  source_system text not null check (source_system in ('leadconduit', 'leadmaster', 'jobnimbus')),
  sync_key text not null check (length(trim(sync_key)) > 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null default 'running'
    check (outcome in ('running', 'succeeded', 'partial', 'failed', 'skipped')),
  records_seen integer not null default 0 check (records_seen >= 0),
  records_written integer not null default 0 check (records_written >= 0),
  next_cursor text,
  error_category text,
  metadata jsonb not null default '{}'::jsonb,
  business_timezone text not null default 'America/New_York',
  unique (company_id, source_system, sync_key)
);

create table public.leadconduit_flows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  flow_id text not null check (length(trim(flow_id)) > 0),
  name text not null,
  enabled boolean not null default false,
  source_ids text[] not null default '{}'::text[],
  destination_ids text[] not null default '{}'::text[],
  field_ids text[] not null default '{}'::text[],
  raw_payload jsonb not null,
  vendor_created_at timestamptz,
  vendor_updated_at timestamptz,
  ingested_at timestamptz not null default now(),
  unique (company_id, flow_id)
);

create table public.leadconduit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  event_id text not null check (length(trim(event_id)) > 0),
  flow_id text,
  source_id text,
  source_name text,
  lead_id text,
  event_type text not null,
  occurred_at timestamptz not null,
  outcome text,
  external_lead_id text,
  phone_normalized text,
  email_normalized text,
  raw_status text,
  raw_payload jsonb not null,
  is_test boolean not null default false,
  ingested_at timestamptz not null default now(),
  unique (company_id, event_id)
);

create table public.leadmaster_custom_fields (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  workgroup text not null default '',
  field_id text not null check (length(trim(field_id)) > 0),
  label text not null,
  field_type text,
  raw_payload jsonb not null,
  ingested_at timestamptz not null default now(),
  unique (company_id, workgroup, field_id)
);

create table public.leadmaster_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  record_id text not null check (length(trim(record_id)) > 0),
  record_kind text not null check (record_kind in ('lead', 'opportunity')),
  recdno text,
  opportunity_id text,
  external_lead_id text,
  workgroup text,
  lead_source text,
  disposition text,
  opportunity_status text,
  opportunity_stage text,
  opportunity_value numeric,
  entered_at timestamptz not null,
  vendor_updated_at timestamptz,
  phone_normalized text,
  email_normalized text,
  raw_payload jsonb not null,
  ingested_at timestamptz not null default now(),
  unique (company_id, record_kind, record_id)
);

create table public.jobnimbus_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  contact_id text not null check (length(trim(contact_id)) > 0),
  external_lead_id text,
  display_name text,
  status text,
  phone_normalized text,
  email_normalized text,
  vendor_created_at timestamptz,
  vendor_updated_at timestamptz,
  raw_payload jsonb not null,
  ingested_at timestamptz not null default now(),
  unique (company_id, contact_id)
);

create table public.jobnimbus_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  job_id text not null check (length(trim(job_id)) > 0),
  contact_id text,
  external_lead_id text,
  source_system text not null default 'jobnimbus' check (source_system = 'jobnimbus'),
  status text,
  stage text,
  appointment_status text,
  appointment_at timestamptz,
  sold_value numeric check (sold_value is null or sold_value >= 0),
  reengagement_triggered boolean not null default false,
  vendor_created_at timestamptz,
  vendor_updated_at timestamptz,
  raw_payload jsonb not null,
  ingested_at timestamptz not null default now(),
  unique (company_id, job_id)
);

alter table public.vendor_status_mappings
  drop constraint vendor_status_mappings_canonical_field_check,
  add constraint vendor_status_mappings_canonical_field_check check (
    canonical_field in ('stage', 'contact_status', 'appointment_status', 'disposition', 'job_status')
  ),
  add column mapping_basis text not null default 'assumed'
    check (mapping_basis in ('assumed', 'confirmed')),
  add column mapping_notes text;

create index integration_sync_runs_company_started_idx
  on public.integration_sync_runs(company_id, started_at desc);
create index leadconduit_events_company_occurred_idx
  on public.leadconduit_events(company_id, occurred_at desc);
create index leadconduit_events_external_idx
  on public.leadconduit_events(company_id, external_lead_id) where external_lead_id is not null;
create index leadconduit_events_phone_idx
  on public.leadconduit_events(company_id, phone_normalized) where phone_normalized is not null;
create index leadconduit_events_email_idx
  on public.leadconduit_events(company_id, email_normalized) where email_normalized is not null;
create index leadmaster_records_entered_idx
  on public.leadmaster_records(company_id, entered_at desc);
create index leadmaster_records_external_idx
  on public.leadmaster_records(company_id, external_lead_id) where external_lead_id is not null;
create index leadmaster_records_phone_idx
  on public.leadmaster_records(company_id, phone_normalized) where phone_normalized is not null;
create index leadmaster_records_email_idx
  on public.leadmaster_records(company_id, email_normalized) where email_normalized is not null;
create index jobnimbus_contacts_external_idx
  on public.jobnimbus_contacts(company_id, external_lead_id) where external_lead_id is not null;
create index jobnimbus_contacts_phone_idx
  on public.jobnimbus_contacts(company_id, phone_normalized) where phone_normalized is not null;
create index jobnimbus_contacts_email_idx
  on public.jobnimbus_contacts(company_id, email_normalized) where email_normalized is not null;
create index jobnimbus_jobs_contact_idx on public.jobnimbus_jobs(company_id, contact_id);
create index jobnimbus_jobs_blind_spot_idx
  on public.jobnimbus_jobs(company_id, appointment_at desc)
  where reengagement_triggered = false
    and lower(coalesce(appointment_status, '')) in ('no-show', 'no show', 'noshow', 'cancelled', 'canceled');

alter table public.integration_sync_runs enable row level security;
alter table public.leadconduit_flows enable row level security;
alter table public.leadconduit_events enable row level security;
alter table public.leadmaster_custom_fields enable row level security;
alter table public.leadmaster_records enable row level security;
alter table public.jobnimbus_contacts enable row level security;
alter table public.jobnimbus_jobs enable row level security;

revoke all on public.integration_sync_runs from anon, authenticated;
revoke all on public.leadconduit_flows from anon, authenticated;
revoke all on public.leadconduit_events from anon, authenticated;
revoke all on public.leadmaster_custom_fields from anon, authenticated;
revoke all on public.leadmaster_records from anon, authenticated;
revoke all on public.jobnimbus_contacts from anon, authenticated;
revoke all on public.jobnimbus_jobs from anon, authenticated;

grant all on public.integration_sync_runs to service_role;
grant all on public.leadconduit_flows to service_role;
grant all on public.leadconduit_events to service_role;
grant all on public.leadmaster_custom_fields to service_role;
grant all on public.leadmaster_records to service_role;
grant all on public.jobnimbus_contacts to service_role;
grant all on public.jobnimbus_jobs to service_role;

grant select on public.integration_sync_runs to authenticated;
grant select on public.leadconduit_flows to authenticated;
grant select on public.leadconduit_events to authenticated;
grant select on public.leadmaster_custom_fields to authenticated;
grant select on public.leadmaster_records to authenticated;
grant select on public.jobnimbus_contacts to authenticated;
grant select on public.jobnimbus_jobs to authenticated;

create policy "company admins read integration sync runs" on public.integration_sync_runs
  for select to authenticated using (company_id = (select public.current_company_id()));
create policy "company admins read LeadConduit flows" on public.leadconduit_flows
  for select to authenticated using (company_id = (select public.current_company_id()));
create policy "company admins read LeadConduit events" on public.leadconduit_events
  for select to authenticated using (company_id = (select public.current_company_id()));
create policy "company admins read LeadMaster custom fields" on public.leadmaster_custom_fields
  for select to authenticated using (company_id = (select public.current_company_id()));
create policy "company admins read LeadMaster records" on public.leadmaster_records
  for select to authenticated using (company_id = (select public.current_company_id()));
create policy "company admins read JobNimbus contacts" on public.jobnimbus_contacts
  for select to authenticated using (company_id = (select public.current_company_id()));
create policy "company admins read JobNimbus jobs" on public.jobnimbus_jobs
  for select to authenticated using (company_id = (select public.current_company_id()));

-- Anchor reconciliation on LeadConduit's source event. Matching priority is
-- external ID, then normalized phone, then normalized email. Every raw status
-- stays visible and mappings carry their assumed/confirmed provenance.
create view public.reconciled_lead_routes
with (security_invoker = true)
as
with source_events as (
  select distinct on (company_id, lead_id)
    *
  from public.leadconduit_events
  where event_type = 'source' and lead_id is not null and not is_test
  order by company_id, lead_id, occurred_at desc
), leadmaster_best as (
  select distinct on (lc.id)
    lc.id as leadconduit_row_id,
    lm.*,
    case
      when lc.external_lead_id is not null and lm.external_lead_id = lc.external_lead_id then 'external_lead_id'
      when lc.phone_normalized is not null and lm.phone_normalized = lc.phone_normalized then 'normalized_phone'
      when lc.email_normalized is not null and lm.email_normalized = lc.email_normalized then 'normalized_email'
    end as match_method
  from source_events lc
  join public.leadmaster_records lm on lm.company_id = lc.company_id and (
    (lc.external_lead_id is not null and lm.external_lead_id = lc.external_lead_id)
    or (lc.phone_normalized is not null and lm.phone_normalized = lc.phone_normalized)
    or (lc.email_normalized is not null and lm.email_normalized = lc.email_normalized)
  )
  order by lc.id,
    case when lc.external_lead_id is not null and lm.external_lead_id = lc.external_lead_id then 1
         when lc.phone_normalized is not null and lm.phone_normalized = lc.phone_normalized then 2 else 3 end,
    lm.entered_at desc
), jobnimbus_best as (
  select distinct on (lc.id)
    lc.id as leadconduit_row_id,
    jnc.contact_id,
    jnc.status as contact_status,
    jnj.job_id,
    jnj.status as job_status,
    jnj.stage as job_stage,
    jnj.appointment_status,
    jnj.appointment_at,
    jnj.sold_value,
    case
      when lc.external_lead_id is not null and jnc.external_lead_id = lc.external_lead_id then 'external_lead_id'
      when lc.phone_normalized is not null and jnc.phone_normalized = lc.phone_normalized then 'normalized_phone'
      when lc.email_normalized is not null and jnc.email_normalized = lc.email_normalized then 'normalized_email'
    end as match_method
  from source_events lc
  join public.jobnimbus_contacts jnc on jnc.company_id = lc.company_id and (
    (lc.external_lead_id is not null and jnc.external_lead_id = lc.external_lead_id)
    or (lc.phone_normalized is not null and jnc.phone_normalized = lc.phone_normalized)
    or (lc.email_normalized is not null and jnc.email_normalized = lc.email_normalized)
  )
  left join public.jobnimbus_jobs jnj
    on jnj.company_id = jnc.company_id and jnj.contact_id = jnc.contact_id
  order by lc.id,
    case when lc.external_lead_id is not null and jnc.external_lead_id = lc.external_lead_id then 1
         when lc.phone_normalized is not null and jnc.phone_normalized = lc.phone_normalized then 2 else 3 end,
    jnj.vendor_updated_at desc nulls last
)
select
  lc.company_id,
  lc.event_id as leadconduit_event_id,
  lc.lead_id as leadconduit_lead_id,
  lc.flow_id,
  coalesce(lc.source_name, lc.source_id, 'Unknown') as lead_source,
  lc.occurred_at as lead_entered_at,
  lc.outcome as leadconduit_outcome,
  lc.raw_status as leadconduit_status,
  lcm.canonical_value as leadconduit_canonical_status,
  lcm.mapping_basis as leadconduit_mapping_basis,
  lm.record_id as leadmaster_record_id,
  lm.recdno as leadmaster_recdno,
  lm.disposition as leadmaster_disposition,
  lm.opportunity_status as leadmaster_opportunity_status,
  lm.opportunity_stage as leadmaster_opportunity_stage,
  lm.entered_at as leadmaster_entered_at,
  lm.match_method as leadmaster_match_method,
  lmm.canonical_value as leadmaster_canonical_status,
  lmm.mapping_basis as leadmaster_mapping_basis,
  jn.contact_id as jobnimbus_contact_id,
  jn.job_id as jobnimbus_job_id,
  jn.job_status as jobnimbus_status,
  jn.job_stage as jobnimbus_stage,
  jn.appointment_status as jobnimbus_appointment_status,
  jn.appointment_at,
  jn.sold_value,
  jn.match_method as jobnimbus_match_method,
  jnm.canonical_value as jobnimbus_canonical_status,
  jnm.mapping_basis as jobnimbus_mapping_basis
from source_events lc
left join leadmaster_best lm on lm.leadconduit_row_id = lc.id
left join jobnimbus_best jn on jn.leadconduit_row_id = lc.id
left join public.vendor_status_mappings lcm
  on lcm.company_id = lc.company_id and lcm.source_system = 'leadconduit'
  and lcm.raw_status = coalesce(lc.raw_status, lc.outcome) and lcm.is_active
left join public.vendor_status_mappings lmm
  on lmm.company_id = lc.company_id and lmm.source_system = 'leadmaster'
  and lmm.raw_status = coalesce(lm.opportunity_stage, lm.opportunity_status, lm.disposition) and lmm.is_active
left join public.vendor_status_mappings jnm
  on jnm.company_id = lc.company_id and jnm.source_system = 'jobnimbus'
  and jnm.raw_status = coalesce(jn.job_stage, jn.job_status, jn.appointment_status) and jnm.is_active;

create view public.jobnimbus_reengagement_blind_spots
with (security_invoker = true)
as
select
  j.company_id,
  j.job_id,
  j.contact_id,
  c.display_name,
  j.appointment_status,
  j.appointment_at,
  j.status as job_status,
  j.stage as job_stage,
  case
    when lower(coalesce(j.appointment_status, '')) in ('no-show', 'no show', 'noshow')
      then 'no-show — no re-engagement triggered'
    else 'cancelled — no re-engagement triggered'
  end as dashboard_state,
  j.vendor_updated_at
from public.jobnimbus_jobs j
left join public.jobnimbus_contacts c
  on c.company_id = j.company_id and c.contact_id = j.contact_id
where j.reengagement_triggered = false
  and lower(coalesce(j.appointment_status, '')) in ('no-show', 'no show', 'noshow', 'cancelled', 'canceled');

revoke all on public.reconciled_lead_routes from anon, authenticated;
revoke all on public.jobnimbus_reengagement_blind_spots from anon, authenticated;
grant select on public.reconciled_lead_routes to authenticated, service_role;
grant select on public.jobnimbus_reengagement_blind_spots to authenticated, service_role;

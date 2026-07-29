create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.pipeline_status as enum (
  'received', 'validating', 'enriching', 'analyzing', 'scoring',
  'estimating', 'complete', 'partial', 'review_required', 'failed'
);

create type public.worker_status as enum (
  'queued', 'running', 'completed', 'partial', 'review_required', 'failed'
);

create type public.observation_method as enum (
  'measured', 'calculated', 'assumed', 'reported'
);

create type public.observation_status as enum (
  'current', 'superseded', 'disputed', 'rejected'
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  display_name text not null check (length(trim(display_name)) > 0),
  created_at timestamptz not null default now()
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  canonical_address text,
  municipality text,
  county text,
  state_code text not null default 'NJ' check (state_code = 'NJ'),
  location extensions.geography(point, 4326),
  resolution_status text not null default 'unresolved'
    check (resolution_status in ('unresolved', 'resolved', 'review_required', 'unsupported')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  property_id uuid references public.properties(id),
  name text not null check (length(trim(name)) > 0),
  phone text not null check (length(trim(phone)) > 0),
  email text not null check (length(trim(email)) > 0),
  submitted_address text not null check (length(trim(submitted_address)) > 0),
  service_requested text not null default 'roofing' check (service_requested = 'roofing'),
  notes text,
  stage text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid references public.leads(id),
  property_id uuid references public.properties(id),
  correlation_id uuid not null unique,
  pipeline_version integer not null check (pipeline_version > 0),
  status public.pipeline_status not null default 'received',
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.worker_runs (
  id uuid primary key default gen_random_uuid(),
  pipeline_run_id uuid not null references public.pipeline_runs(id),
  worker_type text not null check (length(trim(worker_type)) > 0),
  worker_version integer not null check (worker_version > 0),
  idempotency_key text not null unique,
  status public.worker_status not null default 'queued',
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  started_at timestamptz,
  finished_at timestamptz
);

create table public.source_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  provider text not null check (length(trim(provider)) > 0),
  source_identifier text not null check (length(trim(source_identifier)) > 0),
  source_url text,
  retrieved_at timestamptz not null,
  effective_at timestamptz,
  raw_payload jsonb,
  unique (provider, source_identifier, retrieved_at)
);

create table public.evidence_artifacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  storage_path text not null unique check (length(trim(storage_path)) > 0),
  media_type text not null check (length(trim(media_type)) > 0),
  sha256 text not null check (sha256 ~ '^[0-9A-Fa-f]{64}$'),
  created_at timestamptz not null default now()
);

create table public.observations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  entity_type text not null check (length(trim(entity_type)) > 0),
  entity_id uuid not null,
  fact_type text not null check (length(trim(fact_type)) > 0),
  normalized_value jsonb not null,
  raw_value jsonb,
  units text,
  source_record_id uuid references public.source_records(id),
  method public.observation_method not null,
  confidence smallint not null check (confidence between 0 and 100),
  transformation_version text,
  status public.observation_status not null default 'current',
  created_at timestamptz not null default now()
);

create table public.provider_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  pipeline_run_id uuid references public.pipeline_runs(id),
  capability text not null check (length(trim(capability)) > 0),
  provider text not null check (length(trim(provider)) > 0),
  request_key text not null unique,
  status text not null check (status in ('requested', 'succeeded', 'failed', 'blocked_budget', 'cache_hit')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.provider_cost_entries (
  id uuid primary key default gen_random_uuid(),
  provider_request_id uuid not null references public.provider_requests(id),
  currency text not null default 'USD' check (currency = 'USD'),
  estimated_cost_micros bigint not null default 0 check (estimated_cost_micros >= 0),
  actual_cost_micros bigint check (actual_cost_micros >= 0),
  created_at timestamptz not null default now()
);

create table public.domain_events (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  pipeline_run_id uuid references public.pipeline_runs(id),
  event_name text not null check (length(trim(event_name)) > 0),
  schema_version integer not null check (schema_version > 0),
  correlation_id uuid not null,
  causation_event_id uuid references public.domain_events(id),
  idempotency_key text not null unique,
  payload jsonb not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.event_outbox (
  event_id uuid primary key references public.domain_events(id) on delete cascade,
  available_at timestamptz not null default now(),
  published_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  claimed_at timestamptz,
  claimed_by text
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id),
  actor_id uuid references auth.users(id),
  action text not null check (length(trim(action)) > 0),
  entity_type text not null check (length(trim(entity_type)) > 0),
  entity_id uuid,
  correlation_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_profiles_company_id_idx on public.admin_profiles(company_id);
create index properties_company_id_idx on public.properties(company_id);
create index leads_company_id_idx on public.leads(company_id);
create index leads_property_id_idx on public.leads(property_id);
create index pipeline_runs_company_id_idx on public.pipeline_runs(company_id);
create index pipeline_runs_lead_id_idx on public.pipeline_runs(lead_id);
create index pipeline_runs_property_id_idx on public.pipeline_runs(property_id);
create index worker_runs_pipeline_run_id_idx on public.worker_runs(pipeline_run_id);
create index source_records_company_id_idx on public.source_records(company_id);
create index evidence_artifacts_company_id_idx on public.evidence_artifacts(company_id);
create index observations_company_id_idx on public.observations(company_id);
create index observations_source_record_id_idx on public.observations(source_record_id);
create index observations_entity_fact_idx
  on public.observations(entity_type, entity_id, fact_type, created_at desc);
create index provider_requests_company_id_idx on public.provider_requests(company_id);
create index provider_requests_pipeline_run_id_idx on public.provider_requests(pipeline_run_id);
create index provider_cost_entries_provider_request_id_idx on public.provider_cost_entries(provider_request_id);
create index domain_events_company_id_idx on public.domain_events(company_id);
create index domain_events_pipeline_run_id_idx on public.domain_events(pipeline_run_id);
create index domain_events_causation_event_id_idx on public.domain_events(causation_event_id);
create index outbox_pending_idx on public.event_outbox(available_at) where published_at is null;
create index audit_company_created_idx on public.audit_log(company_id, created_at desc);
create index audit_log_actor_id_idx on public.audit_log(actor_id);

create or replace function public.current_company_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select company_id
  from public.admin_profiles
  where id = (select auth.uid())
$$;

alter table public.companies enable row level security;
alter table public.admin_profiles enable row level security;
alter table public.properties enable row level security;
alter table public.leads enable row level security;
alter table public.pipeline_runs enable row level security;
alter table public.worker_runs enable row level security;
alter table public.source_records enable row level security;
alter table public.evidence_artifacts enable row level security;
alter table public.observations enable row level security;
alter table public.provider_requests enable row level security;
alter table public.provider_cost_entries enable row level security;
alter table public.domain_events enable row level security;
alter table public.event_outbox enable row level security;
alter table public.audit_log enable row level security;

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
revoke execute on function public.current_company_id() from public, anon;

grant usage on schema public to authenticated;
grant execute on function public.current_company_id() to authenticated;
grant select on public.companies, public.admin_profiles, public.properties,
  public.pipeline_runs, public.worker_runs, public.source_records,
  public.evidence_artifacts, public.observations, public.provider_requests,
  public.provider_cost_entries, public.domain_events, public.audit_log to authenticated;
grant select, insert, update, delete on public.leads to authenticated;

create policy "company admins read company" on public.companies
  for select to authenticated
  using (id = (select public.current_company_id()));

create policy "admins read own profile" on public.admin_profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "company admins read properties" on public.properties
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read leads" on public.leads
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins write leads" on public.leads
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

create policy "company admins read pipeline runs" on public.pipeline_runs
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read worker runs" on public.worker_runs
  for select to authenticated
  using (
    exists (
      select 1
      from public.pipeline_runs
      where pipeline_runs.id = worker_runs.pipeline_run_id
        and pipeline_runs.company_id = (select public.current_company_id())
    )
  );

create policy "company admins read source records" on public.source_records
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read evidence artifacts" on public.evidence_artifacts
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read observations" on public.observations
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read provider requests" on public.provider_requests
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read provider costs" on public.provider_cost_entries
  for select to authenticated
  using (
    exists (
      select 1
      from public.provider_requests
      where provider_requests.id = provider_cost_entries.provider_request_id
        and provider_requests.company_id = (select public.current_company_id())
    )
  );

create policy "company admins read domain events" on public.domain_events
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read audit log" on public.audit_log
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create or replace function public.enqueue_domain_event(
  p_company_id uuid,
  p_event jsonb
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_event_id uuid := (p_event->>'id')::uuid;
begin
  insert into public.domain_events (
    id, company_id, pipeline_run_id, event_name, schema_version,
    correlation_id, causation_event_id, idempotency_key, payload, occurred_at
  ) values (
    v_event_id,
    p_company_id,
    (p_event->>'pipelineRunId')::uuid,
    p_event->>'name',
    (p_event->>'schemaVersion')::integer,
    (p_event->>'correlationId')::uuid,
    nullif(p_event->>'causationEventId', '')::uuid,
    p_event->>'idempotencyKey',
    p_event,
    (p_event->>'occurredAt')::timestamptz
  )
  on conflict (idempotency_key) do nothing;

  insert into public.event_outbox (event_id)
  select id from public.domain_events
  where idempotency_key = p_event->>'idempotencyKey'
  on conflict (event_id) do nothing;

  return v_event_id;
end;
$$;

create or replace function public.claim_outbox_events(
  p_limit integer,
  p_claimed_by text
) returns table (
  event_id uuid,
  payload jsonb,
  attempt_count integer
)
language plpgsql security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select outbox.event_id
    from public.event_outbox as outbox
    where outbox.published_at is null
      and outbox.available_at <= now()
      and (
        outbox.claimed_at is null
        or outbox.claimed_at < now() - interval '5 minutes'
      )
    order by outbox.available_at, outbox.event_id
    for update skip locked
    limit greatest(0, least(p_limit, 100))
  ),
  claimed as (
    update public.event_outbox as outbox
    set claimed_at = now(),
        claimed_by = p_claimed_by,
        attempt_count = outbox.attempt_count + 1
    from candidates
    where outbox.event_id = candidates.event_id
    returning outbox.event_id, outbox.attempt_count
  )
  select claimed.event_id, events.payload, claimed.attempt_count
  from claimed
  join public.domain_events as events on events.id = claimed.event_id;
end;
$$;

create or replace function public.complete_outbox_event(p_event_id uuid)
returns void
language sql security definer
set search_path = ''
as $$
  update public.event_outbox
  set published_at = now(), claimed_at = null, claimed_by = null, last_error = null
  where event_id = p_event_id and published_at is null
$$;

create or replace function public.fail_outbox_event(
  p_event_id uuid,
  p_error text
) returns void
language sql security definer
set search_path = ''
as $$
  update public.event_outbox
  set claimed_at = null,
      claimed_by = null,
      last_error = left(p_error, 500),
      available_at = now() + least(
        interval '15 minutes',
        interval '5 seconds' * power(2, least(attempt_count, 8))
      )
  where event_id = p_event_id and published_at is null
$$;

revoke all on function public.enqueue_domain_event(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.claim_outbox_events(integer, text) from public, anon, authenticated;
revoke all on function public.complete_outbox_event(uuid) from public, anon, authenticated;
revoke all on function public.fail_outbox_event(uuid, text) from public, anon, authenticated;

grant execute on function public.enqueue_domain_event(uuid, jsonb) to service_role;
grant execute on function public.claim_outbox_events(integer, text) to service_role;
grant execute on function public.complete_outbox_event(uuid) to service_role;
grant execute on function public.fail_outbox_event(uuid, text) to service_role;

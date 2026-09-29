-- Company-scoped JobNimbus warehouse: raw landing, query projections, and sync
-- bookkeeping. Ported from 2stack-roof-quote's proven sync, re-keyed from
-- account_id to PIW's company_id. Replaces the unused access-route JobNimbus
-- reader tables in a later migration once this path is verified.

-- -----------------------------------------------------------------------------
-- Per-company provider configuration
-- -----------------------------------------------------------------------------

create table public.company_integrations (
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null check (provider in ('jobnimbus')),
  -- Names the server environment variable holding the credential; the secret
  -- itself never enters the database. Restricted so a row cannot point the
  -- sync at an unrelated secret.
  env_key_name text not null check (env_key_name ~ '^JOBNIMBUS_API_KEY(_[A-Z0-9]+)*$'),
  -- cf_* key → semantic name. cf_* numbering is per JobNimbus account.
  field_map jsonb not null default '{}'::jsonb check (jsonb_typeof(field_map) = 'object'),
  -- Earliest date_created a full scan must cover for this account.
  history_start timestamptz not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (company_id, provider)
);

-- -----------------------------------------------------------------------------
-- Raw landing zone
-- -----------------------------------------------------------------------------

create table public.jobnimbus_records (
  company_id uuid not null references public.companies(id) on delete cascade,
  jnid text not null check (length(btrim(jnid)) > 0),
  record_type text not null check (
    record_type in ('job', 'contact', 'estimate', 'file', 'workorder', 'task')
  ),
  payload jsonb not null,
  content_hash text not null,
  jn_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (company_id, jnid)
);

create index jobnimbus_records_type
  on public.jobnimbus_records (company_id, record_type, jn_updated_at desc);

-- -----------------------------------------------------------------------------
-- Query projections (rebuildable from jobnimbus_records)
-- -----------------------------------------------------------------------------

create table public.jn_jobs (
  company_id uuid not null references public.companies(id) on delete cascade,
  jnid text not null,
  number text,
  status_name text,
  status_changed_at timestamptz,
  record_type_name text,
  primary_contact_jnid text,
  sales_rep_jnid text,
  sales_rep_name text,
  address_line1 text,
  city text,
  state_text text,
  zip text,
  shingle_line text,
  job_type text,
  estimate_total numeric(12, 2),
  approved_total numeric(12, 2),
  is_active boolean,
  is_archived boolean,
  jn_created_at timestamptz,
  jn_updated_at timestamptz,
  projected_at timestamptz not null default now(),
  primary key (company_id, jnid)
);

create index jn_jobs_status on public.jn_jobs (company_id, status_name);
create index jn_jobs_created on public.jn_jobs (company_id, jn_created_at desc);
create index jn_jobs_primary_contact on public.jn_jobs (company_id, primary_contact_jnid);

create table public.jn_contacts (
  company_id uuid not null references public.companies(id) on delete cascade,
  jnid text not null,
  display_name text,
  first_name text,
  last_name text,
  email_normalized text,
  phone_normalized text,
  status_name text,
  record_type_name text,
  source_name text,
  sales_rep_jnid text,
  sales_rep_name text,
  address_line1 text,
  city text,
  state_text text,
  zip text,
  is_archived boolean,
  jn_created_at timestamptz,
  jn_updated_at timestamptz,
  projected_at timestamptz not null default now(),
  primary key (company_id, jnid)
);

create index jn_contacts_phone on public.jn_contacts (company_id, phone_normalized)
  where phone_normalized is not null;
create index jn_contacts_email on public.jn_contacts (company_id, email_normalized)
  where email_normalized is not null;

create table public.jn_estimates (
  company_id uuid not null references public.companies(id) on delete cascade,
  jnid text not null,
  related_job_jnid text,
  number text,
  status_name text,
  source text,
  estimate_total numeric(12, 2),
  approved_total numeric(12, 2),
  jn_created_at timestamptz,
  jn_updated_at timestamptz,
  projected_at timestamptz not null default now(),
  primary key (company_id, jnid)
);

create index jn_estimates_related_job on public.jn_estimates (company_id, related_job_jnid);

-- -----------------------------------------------------------------------------
-- Sync bookkeeping
-- -----------------------------------------------------------------------------

create table public.jobnimbus_sync_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  record_type text not null check (
    record_type in ('job', 'contact', 'estimate', 'file', 'workorder', 'task')
  ),
  mode text not null check (mode in ('incremental', 'full')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (
    status in ('running', 'ok', 'failed', 'reconcile_mismatch')
  ),
  records_seen integer not null default 0 check (records_seen >= 0),
  records_changed integer not null default 0 check (records_changed >= 0),
  api_calls integer not null default 0 check (api_calls >= 0),
  transient_error_count integer not null default 0 check (transient_error_count >= 0),
  rate_limit_error_count integer not null default 0 check (rate_limit_error_count >= 0),
  watermark_from timestamptz,
  watermark_to timestamptz,
  error text
);

create index jobnimbus_sync_runs_company_started
  on public.jobnimbus_sync_runs (company_id, started_at desc);

create table public.jobnimbus_sync_state (
  company_id uuid not null references public.companies(id) on delete cascade,
  record_type text not null check (
    record_type in ('job', 'contact', 'estimate', 'file', 'workorder', 'task')
  ),
  watermark timestamptz not null,
  last_full_at timestamptz,
  primary key (company_id, record_type)
);

-- -----------------------------------------------------------------------------
-- Atomic raw landing and watermark advancement
-- -----------------------------------------------------------------------------

create or replace function public.land_jobnimbus_batch(
  p_company_id uuid,
  p_record_type text,
  p_records jsonb,
  p_watermark timestamptz
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_count integer;
begin
  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'p_records must be a JSON array' using errcode = '22023';
  end if;

  -- The sync-state row doubles as the per-company/type mutex. Creating it and
  -- then taking a row lock serializes first and subsequent batches; a later
  -- failure rolls the insert back with the raw landing.
  insert into public.jobnimbus_sync_state (company_id, record_type, watermark)
  values (p_company_id, p_record_type, p_watermark)
  on conflict (company_id, record_type) do nothing;

  perform 1
  from public.jobnimbus_sync_state
  where company_id = p_company_id
    and record_type = p_record_type
  for update;

  with incoming as materialized (
    select parsed.jnid, parsed.payload, parsed.content_hash, parsed.jn_updated_at
    from jsonb_to_recordset(p_records) as parsed(
      jnid text,
      payload jsonb,
      content_hash text,
      jn_updated_at timestamptz
    )
  ),
  prior as materialized (
    select
      incoming.jnid,
      existing.jnid is not null as existed,
      existing.content_hash as prior_content_hash
    from incoming
    left join public.jobnimbus_records existing
      on existing.company_id = p_company_id
      and existing.jnid = incoming.jnid
  ),
  upserted as (
    insert into public.jobnimbus_records (
      company_id, jnid, record_type, payload, content_hash, jn_updated_at
    )
    select
      p_company_id,
      incoming.jnid,
      p_record_type,
      incoming.payload,
      incoming.content_hash,
      incoming.jn_updated_at
    from incoming
    on conflict (company_id, jnid) do update
    set record_type = excluded.record_type,
        payload = excluded.payload,
        content_hash = excluded.content_hash,
        jn_updated_at = excluded.jn_updated_at
    -- Never let an older read overwrite a newer stored version.
    where public.jobnimbus_records.jn_updated_at is null
      or excluded.jn_updated_at >= public.jobnimbus_records.jn_updated_at
    returning jobnimbus_records.jnid
  )
  select count(*)::integer
  into changed_count
  from upserted
  join incoming using (jnid)
  join prior using (jnid)
  where not prior.existed
    or prior.prior_content_hash is distinct from incoming.content_hash;

  -- Observation time advances even when a stale version is correctly ignored.
  update public.jobnimbus_records existing
  set last_seen_at = clock_timestamp()
  from jsonb_to_recordset(p_records) as incoming(jnid text)
  where existing.company_id = p_company_id
    and existing.jnid = incoming.jnid;

  update public.jobnimbus_sync_state
  set watermark = greatest(public.jobnimbus_sync_state.watermark, p_watermark)
  where company_id = p_company_id
    and record_type = p_record_type;

  return changed_count;
end;
$$;

comment on function public.land_jobnimbus_batch(uuid, text, jsonb, timestamptz)
is 'Atomically upserts raw JobNimbus rows and advances jobnimbus_sync_state. Each p_records element must contain jnid, payload, content_hash, and optional jn_updated_at.';

-- -----------------------------------------------------------------------------
-- Deny-by-default Data API posture: the sync runs as service_role only.
-- Role-scoped dashboard read access arrives with the membership migration.
-- -----------------------------------------------------------------------------

alter table public.company_integrations enable row level security;
alter table public.jobnimbus_records enable row level security;
alter table public.jn_jobs enable row level security;
alter table public.jn_contacts enable row level security;
alter table public.jn_estimates enable row level security;
alter table public.jobnimbus_sync_runs enable row level security;
alter table public.jobnimbus_sync_state enable row level security;

revoke all on table
  public.company_integrations,
  public.jobnimbus_records,
  public.jn_jobs,
  public.jn_contacts,
  public.jn_estimates,
  public.jobnimbus_sync_runs,
  public.jobnimbus_sync_state
from anon, authenticated;

grant select, insert, update, delete on table
  public.company_integrations,
  public.jobnimbus_records,
  public.jn_jobs,
  public.jn_contacts,
  public.jn_estimates,
  public.jobnimbus_sync_runs,
  public.jobnimbus_sync_state
to service_role;

revoke all on function public.land_jobnimbus_batch(uuid, text, jsonb, timestamptz)
from public, anon, authenticated;
grant execute on function public.land_jobnimbus_batch(uuid, text, jsonb, timestamptz)
to service_role;

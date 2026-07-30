-- Module 3 (Production Support): permit/inspection status tracking.
-- Pulled forward ahead of Module 2/3 proper per the All Season engineering
-- plan (Section 5.2) because no source system today owns this data reliably
-- — it's currently scattered across spreadsheets, docs, and partial
-- JobNimbus records — so this has no client-access dependency.
--
-- Naming note: `job_permits` is deliberately distinct from PIW's own future
-- `permits` entity (architecture doc Section 6.1, not yet built). That table
-- will hold *historically discovered* roofing permits used as roof-age
-- evidence for lead scoring (Public Records Worker, Phase 4). This table
-- tracks the *live status* of a permit pulled for a specific sold job. Same
-- English word, unrelated concepts — kept in separate tables so a future
-- Phase 4 migration can add `public.permits` without any collision.
--
-- `jobs` here is intentionally minimal: just enough to anchor permit and
-- inspection tracking. Module 2 owns `contracts` and the full contract-to-job
-- handoff is still open (see plan Section 4.2), so this does not assume or
-- encode that handoff — it only supports creating a job directly from a
-- lead/property today. Expect a later migration to add `contract_id` and a
-- fuller production-status lifecycle once Module 2/3 are specced.

create type public.job_status as enum (
  'active', 'on_hold', 'complete', 'cancelled'
);

create type public.job_permit_status as enum (
  'not_started', 'pending_submission', 'submitted', 'under_review',
  'approved', 'rejected', 'expired'
);

create type public.job_inspection_status as enum (
  'scheduled', 'passed', 'failed', 'cancelled', 'rescheduled'
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid references public.leads(id),
  property_id uuid not null references public.properties(id),
  status public.job_status not null default 'active',
  notes text,
  created_by uuid references public.admin_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.job_permits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  job_id uuid not null references public.jobs(id) on delete cascade,
  permit_type text not null check (length(trim(permit_type)) > 0),
  municipality text,
  permit_number text,
  status public.job_permit_status not null default 'not_started',
  submitted_at timestamptz,
  approved_at timestamptz,
  expires_at timestamptz,
  notes text,
  created_by uuid references public.admin_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.job_inspections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  job_permit_id uuid not null references public.job_permits(id) on delete cascade,
  inspection_type text not null check (length(trim(inspection_type)) > 0),
  status public.job_inspection_status not null default 'scheduled',
  scheduled_at timestamptz,
  completed_at timestamptz,
  inspector_name text,
  result_notes text,
  created_by uuid references public.admin_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_company_id_idx on public.jobs(company_id);
create index jobs_lead_id_idx on public.jobs(lead_id);
create index jobs_property_id_idx on public.jobs(property_id);
create index jobs_open_idx on public.jobs(company_id) where status in ('active', 'on_hold');

create index job_permits_company_id_idx on public.job_permits(company_id);
create index job_permits_job_id_idx on public.job_permits(job_id);
create index job_permits_open_idx on public.job_permits(company_id)
  where status not in ('approved', 'rejected', 'expired');

create index job_inspections_company_id_idx on public.job_inspections(company_id);
create index job_inspections_job_permit_id_idx on public.job_inspections(job_permit_id);
create index job_inspections_scheduled_idx on public.job_inspections(company_id, scheduled_at)
  where status = 'scheduled';

alter table public.jobs enable row level security;
alter table public.job_permits enable row level security;
alter table public.job_inspections enable row level security;

revoke all on public.jobs from anon, authenticated;
revoke all on public.job_permits from anon, authenticated;
revoke all on public.job_inspections from anon, authenticated;

-- service_role bypasses RLS but, as in the foundation migration, this local
-- Postgres image grants it no implicit table privileges.
grant all on public.jobs to service_role;
grant all on public.job_permits to service_role;
grant all on public.job_inspections to service_role;

-- Manual-entry UI fallback: no upstream system owns this data today, so
-- admins read/write these directly, the same way tasks and interactions work
-- (see the crm migration) rather than through a service-role-only RPC.
grant select, insert, update on public.jobs to authenticated;
grant select, insert, update on public.job_permits to authenticated;
grant select, insert, update on public.job_inspections to authenticated;

create policy "company admins read jobs" on public.jobs
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins create jobs" on public.jobs
  for insert to authenticated
  with check (company_id = (select public.current_company_id()));

create policy "company admins update jobs" on public.jobs
  for update to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

create policy "company admins read job permits" on public.job_permits
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins create job permits" on public.job_permits
  for insert to authenticated
  with check (company_id = (select public.current_company_id()));

create policy "company admins update job permits" on public.job_permits
  for update to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

create policy "company admins read job inspections" on public.job_inspections
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins create job inspections" on public.job_inspections
  for insert to authenticated
  with check (company_id = (select public.current_company_id()));

create policy "company admins update job inspections" on public.job_inspections
  for update to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

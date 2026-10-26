-- Minimal stand-in for the tables 20261025120000_google_search_ads_attribution.sql
-- touches, so the migration and its functions can be exercised against a
-- plain Postgres when the full Supabase stack (PostGIS, auth) is unavailable.
-- Column shapes match the real migrations for every column the new code reads.
-- Usage: scripts/sql-sandbox/run.sh (needs a local postgres; see README there).

-- gen_random_uuid() is built in since Postgres 13.
create schema if not exists extensions;
create or replace function extensions.gen_random_uuid() returns uuid language sql as 'select pg_catalog.gen_random_uuid()';

do $$ begin
  create role anon; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

create table public.companies (id uuid primary key default gen_random_uuid(), name text not null);
create table public.admin_profiles (
  id uuid primary key, company_id uuid references public.companies(id), role text not null default 'manager'
);

create or replace function public.current_company_id() returns uuid language sql stable security definer set search_path = '' as $$
  select profile.company_id from public.admin_profiles as profile
  where profile.id = (select auth.uid()) and profile.role in ('manager', 'company_admin')
$$;
create or replace function public.has_company_role(p_minimum text) returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.admin_profiles as profile
    where profile.id = (select auth.uid()) and profile.role in ('manager', 'company_admin')
  )
$$;

create type public.appointment_status as enum ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show');

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null default 'Test',
  phone text not null default '555',
  email text not null default 'a@example.com',
  submitted_address text not null,
  phone_e164 text,
  email_normalized text,
  is_test boolean not null default false,
  source_system text not null default 'piw_intake',
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

create table public.website_arrivals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  occurred_at timestamptz not null default now(),
  request_path text not null,
  campaign_slug text check (
    campaign_slug is null or campaign_slug in ('weather-report', 'seasonal-shield', 'for-every-season')
  ),
  visitor_hash text not null default repeat('a', 64),
  fbclid text,
  is_likely_bot boolean not null default false
);

create table public.privacy_consent_evidence (
  evidence_id uuid primary key default gen_random_uuid(),
  consent_id uuid not null,
  company_id uuid references public.companies(id),
  lead_id uuid references public.leads(id),
  policy_version text not null default 'piw-privacy-v1',
  analytics_granted boolean not null default false,
  advertising_granted boolean not null default false,
  gpc_detected boolean not null default false,
  source text not null check (source in ('banner', 'preferences', 'gpc')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Mirrors the real table: no created_at (started_at/updated_at only).
create table public.roof_assessments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id),
  responses jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id),
  scheduled_at timestamptz not null,
  status public.appointment_status not null default 'scheduled',
  created_at timestamptz not null default now()
);

create table public.customers (id uuid primary key default gen_random_uuid(), company_id uuid not null);
create table public.customer_identities (
  company_id uuid not null, source_system text not null, external_id text not null,
  customer_id uuid not null references public.customers(id),
  primary key (company_id, source_system, external_id)
);
create table public.customer_journey_events (
  company_id uuid not null, customer_id uuid not null, stage text not null,
  occurred_at timestamptz not null, source_system text not null, source_ref text not null,
  is_approximate boolean not null default false,
  primary key (company_id, customer_id, stage, source_system, source_ref)
);
create table public.jn_jobs (
  company_id uuid not null, jnid text not null, approved_total numeric(12, 2),
  primary key (company_id, jnid)
);

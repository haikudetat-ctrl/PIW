-- Extend the property resolution lifecycle with a duplicate outcome and a
-- self-referencing merge pointer. resolution_status is text governed by a
-- check constraint, so replacing the constraint is transaction-safe.
alter table public.properties
  drop constraint properties_resolution_status_check;

alter table public.properties
  add constraint properties_resolution_status_check
  check (
    resolution_status in (
      'unresolved',
      'resolved',
      'review_required',
      'unsupported',
      'duplicate'
    )
  );

alter table public.properties
  add column merged_into_property_id uuid references public.properties(id);

create index properties_merged_into_property_id_idx
  on public.properties(merged_into_property_id);

create type public.address_match_method as enum (
  'exact_single_match',
  'no_match',
  'multiple_matches'
);

create table public.property_addresses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  property_id uuid not null references public.properties(id),
  -- One address observation per worker attempt prevents concurrent duplicate
  -- event delivery from recording the same attempt twice.
  worker_run_id uuid not null unique references public.worker_runs(id),
  submitted_address text not null check (length(trim(submitted_address)) > 0),
  canonical_address text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  location extensions.geography(point, 4326),
  municipality text,
  county text,
  state_code text check (state_code = 'NJ'),
  zip text,
  match_method public.address_match_method not null,
  confidence smallint not null check (confidence between 0 and 100),
  provider_request_id uuid references public.provider_requests(id),
  created_at timestamptz not null default now()
);

create table public.parcels (
  -- Deliberately no owner_name column: NJGIN ownership is redacted under
  -- Daniel's Law and must never be stored.
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  property_id uuid not null references public.properties(id),
  is_primary boolean not null default true,
  block text not null check (length(trim(block)) > 0),
  lot text not null check (length(trim(lot)) > 0),
  qualifier text,
  pams_pin text,
  gis_pin text,
  municipality_code text,
  municipality_name text,
  county text,
  property_class text,
  acreage numeric(10, 4) check (acreage >= 0),
  year_built integer check (year_built > 1600),
  land_value_cents bigint check (land_value_cents >= 0),
  improvement_value_cents bigint check (improvement_value_cents >= 0),
  net_value_cents bigint check (net_value_cents >= 0),
  property_location text,
  street_address text,
  building_description text,
  land_description text,
  dwelling_units integer check (dwelling_units >= 0),
  geometry extensions.geography(polygon, 4326),
  provider_request_id uuid references public.provider_requests(id),
  created_at timestamptz not null default now()
);

create table public.structures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  property_id uuid not null references public.properties(id),
  parcel_id uuid references public.parcels(id),
  is_primary boolean not null default true,
  -- Building-footprint geometry is a placeholder until Phase 4's GIS Worker
  -- refines it; Phase 3 derives it from the parcel record only.
  footprint_geometry extensions.geography(polygon, 4326),
  source text not null check (length(trim(source)) > 0),
  created_at timestamptz not null default now()
);

create type public.review_task_reason as enum (
  'low_address_confidence',
  'duplicate_candidates',
  'multiple_parcels',
  'condo_ambiguity',
  'commercial_property',
  'unsupported_property_type'
);

create type public.review_task_status as enum (
  'open',
  'resolved',
  'rejected',
  'retried',
  'unsupported'
);

create table public.review_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  pipeline_run_id uuid not null references public.pipeline_runs(id),
  lead_id uuid not null references public.leads(id),
  property_id uuid not null references public.properties(id),
  reason public.review_task_reason not null,
  status public.review_task_status not null default 'open',
  -- The calling server action reconstructs and republishes this event when a
  -- review task is retried.
  triggering_event_name text not null
    check (
      triggering_event_name in (
        'property/address.validation_requested',
        'property/discovery_requested'
      )
    ),
  candidate_data jsonb not null default '[]'::jsonb,
  retry_count integer not null default 0 check (retry_count >= 0),
  resolution_notes text,
  resolved_by uuid references public.admin_profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- Duplicate-delivery guards required by the address-validation and property
-- discovery workers.
create unique index parcels_property_id_primary_idx
  on public.parcels(property_id)
  where is_primary;

create unique index structures_property_id_primary_idx
  on public.structures(property_id)
  where is_primary;

create unique index review_tasks_open_pipeline_run_idx
  on public.review_tasks(pipeline_run_id)
  where status = 'open';

-- Every foreign key and RLS predicate has a leading, non-partial index. The
-- unique worker_run_id constraint above provides its foreign-key index.
create index property_addresses_company_id_idx
  on public.property_addresses(company_id);
create index property_addresses_property_id_idx
  on public.property_addresses(property_id, created_at desc);
create index property_addresses_provider_request_id_idx
  on public.property_addresses(provider_request_id);

create index parcels_company_id_idx
  on public.parcels(company_id);
create index parcels_property_id_idx
  on public.parcels(property_id);
create index parcels_provider_request_id_idx
  on public.parcels(provider_request_id);

create index structures_company_id_idx
  on public.structures(company_id);
create index structures_property_id_idx
  on public.structures(property_id);
create index structures_parcel_id_idx
  on public.structures(parcel_id);

create index review_tasks_company_id_idx
  on public.review_tasks(company_id);
create index review_tasks_pipeline_run_id_idx
  on public.review_tasks(pipeline_run_id);
create index review_tasks_lead_id_idx
  on public.review_tasks(lead_id);
create index review_tasks_property_id_idx
  on public.review_tasks(property_id);
create index review_tasks_resolved_by_idx
  on public.review_tasks(resolved_by);
create index review_tasks_open_idx
  on public.review_tasks(company_id, created_at desc)
  where status = 'open';

alter table public.property_addresses enable row level security;
alter table public.parcels enable row level security;
alter table public.structures enable row level security;
alter table public.review_tasks enable row level security;

revoke all on public.property_addresses from anon, authenticated;
revoke all on public.parcels from anon, authenticated;
revoke all on public.structures from anon, authenticated;
revoke all on public.review_tasks from anon, authenticated;

-- service_role is the only writer. Authenticated company admins receive
-- SELECT only, further restricted by tenant-scoped RLS policies.
grant all on public.property_addresses to service_role;
grant all on public.parcels to service_role;
grant all on public.structures to service_role;
grant all on public.review_tasks to service_role;

grant select on public.property_addresses to authenticated;
grant select on public.parcels to authenticated;
grant select on public.structures to authenticated;
grant select on public.review_tasks to authenticated;

create policy "company admins read property addresses"
  on public.property_addresses
  for select
  to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read parcels"
  on public.parcels
  for select
  to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read structures"
  on public.structures
  for select
  to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read review tasks"
  on public.review_tasks
  for select
  to authenticated
  using (company_id = (select public.current_company_id()));

-- Task 8 replaces this interface-compatible stub with review resolution
-- behavior. It remains invoker-security and callable only by service_role.
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
begin
  raise exception 'resolve_review_task is not yet implemented (Task 8)';
end;
$$;

revoke all on function public.resolve_review_task(
  uuid,
  uuid,
  text,
  uuid,
  integer,
  text
) from public, anon, authenticated;

grant execute on function public.resolve_review_task(
  uuid,
  uuid,
  text,
  uuid,
  integer,
  text
) to service_role;

-- Version-controlled canonical status dictionary. Left empty until real
-- LeadConduit/CallTools/dialer status values are documented (All Season
-- plan Section 7). This is what stops "Demo Complete" (LeadMaster) vs.
-- "Demoed" (HighLevel) vs. "Appointment Complete" (JobNimbus) from silently
-- collapsing into one value — each source's raw status maps through an
-- explicit, versioned row instead.
create table public.vendor_status_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  source_system text not null check (length(trim(source_system)) > 0),
  raw_status text not null check (length(trim(raw_status)) > 0),
  canonical_field text not null
    check (canonical_field in ('stage', 'contact_status', 'appointment_status', 'disposition')),
  canonical_value text not null check (length(trim(canonical_value)) > 0),
  mapping_version integer not null default 1 check (mapping_version > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, source_system, raw_status, canonical_field, mapping_version)
);

create index vendor_status_mappings_lookup_idx
  on public.vendor_status_mappings(company_id, source_system, raw_status)
  where is_active;

alter table public.vendor_status_mappings enable row level security;

revoke all on public.vendor_status_mappings from anon, authenticated;

grant all on public.vendor_status_mappings to service_role;
grant select on public.vendor_status_mappings to authenticated;

create policy "company admins read vendor status mappings" on public.vendor_status_mappings
  for select to authenticated
  using (company_id = (select public.current_company_id()));

-- Saved roof drawings from the staff measuring page (/roof-measure).
--
-- A drawing is the planes, edge labels and join/split choices a person made
-- over the Solar starting planes, plus a snapshot of the totals at save time
-- so lists and the JobNimbus job page can show squares without re-running
-- the geometry. Optional link to a JobNimbus job by jnid; the warehouse
-- re-projects jn_jobs, so this is a checked reference rather than a foreign
-- key. Nothing here feeds customer pricing.

create table public.roof_measurements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id),
  job_jnid text check (job_jnid is null or length(trim(job_jnid)) > 0),
  address text not null check (length(trim(address)) > 0),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  solar_building_name text,
  solar_imagery_date date,
  -- The trimmed Building Insights response the drawing started from, so a
  -- saved drawing reopens without another paid Solar call.
  solar_response jsonb check (solar_response is null or jsonb_typeof(solar_response) = 'object'),
  -- {version, planes, overrides, pairModes}; validated by the app.
  drawing jsonb not null check (jsonb_typeof(drawing) = 'object'),
  -- Typed-in measured report (Roofr, EagleView) for comparison, if any.
  measured jsonb check (measured is null or jsonb_typeof(measured) = 'object'),
  stories text check (stories is null or stories in ('one', 'two', 'three_plus', 'unknown')),
  waste_percent numeric(5, 2) check (waste_percent is null or waste_percent between 0 and 50),
  total_sloped_sqft numeric(10, 2) not null check (total_sloped_sqft >= 0),
  squares numeric(8, 2) not null check (squares >= 0),
  predominant_pitch_rise integer check (predominant_pitch_rise is null or predominant_pitch_rise between 0 and 30),
  lengths_ft jsonb not null default '{}'::jsonb check (jsonb_typeof(lengths_ft) = 'object'),
  created_by uuid default auth.uid() references public.admin_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index roof_measurements_company_created_idx
  on public.roof_measurements(company_id, created_at desc);
create index roof_measurements_company_job_idx
  on public.roof_measurements(company_id, job_jnid)
  where job_jnid is not null;

create function public.roof_measurements_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger roof_measurements_touch
  before update on public.roof_measurements
  for each row execute function public.roof_measurements_touch();

alter table public.roof_measurements enable row level security;

revoke all on public.roof_measurements from anon, authenticated;
grant select, insert, update, delete on public.roof_measurements to authenticated;
grant all on public.roof_measurements to service_role;

-- Managers and above, in their active company only. A linked job must be one
-- of that company's JobNimbus jobs.
create policy "managers read company roof measurements" on public.roof_measurements
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "managers add company roof measurements" on public.roof_measurements
  for insert to authenticated
  with check (
    company_id = (select public.current_company_id())
    and (
      job_jnid is null
      or exists (
        select 1 from public.jn_jobs
        where jn_jobs.jnid = roof_measurements.job_jnid
          and jn_jobs.company_id = roof_measurements.company_id
      )
    )
  );

create policy "managers update company roof measurements" on public.roof_measurements
  for update to authenticated
  using (company_id = (select public.current_company_id()))
  with check (
    company_id = (select public.current_company_id())
    and (
      job_jnid is null
      or exists (
        select 1 from public.jn_jobs
        where jn_jobs.jnid = roof_measurements.job_jnid
          and jn_jobs.company_id = roof_measurements.company_id
      )
    )
  );

create policy "managers delete company roof measurements" on public.roof_measurements
  for delete to authenticated
  using (company_id = (select public.current_company_id()));

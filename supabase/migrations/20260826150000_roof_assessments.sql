-- Resumable homeowner roof assessment state. Public visitors interact only
-- through the token-scoped server route; tables remain closed to anon.

create table public.roof_assessments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  estimate_id uuid not null references public.roof_estimates(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  status text not null default 'in_progress' check (
    status in ('in_progress', 'completed')
  ),
  current_step integer not null default 0 check (
    current_step between 0 and 9
  ),
  property_revealed_at timestamptz,
  responses jsonb not null default '{}'::jsonb check (
    jsonb_typeof(responses) = 'object'
  ),
  scores jsonb not null default '{}'::jsonb check (
    jsonb_typeof(scores) = 'object'
  ),
  recommendation text check (
    recommendation in (
      'monitor_or_repair',
      'professional_inspection',
      'replacement_may_make_sense'
    )
  ),
  assessment_version text not null default 'roof-check-v1' check (
    length(trim(assessment_version)) > 0
  ),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (estimate_id),
  check (
    (status = 'in_progress' and completed_at is null) or
    (
      status = 'completed' and
      completed_at is not null and
      recommendation is not null
    )
  )
);

create index roof_assessments_company_updated_idx
  on public.roof_assessments(company_id, updated_at desc);
create index roof_assessments_lead_id_idx
  on public.roof_assessments(lead_id);

alter table public.roof_assessments enable row level security;

revoke all on public.roof_assessments from anon, authenticated;
grant all on public.roof_assessments to service_role;
grant select on public.roof_assessments to authenticated;

create policy "company admins read roof assessments"
  on public.roof_assessments
  for select
  to authenticated
  using (company_id = (select public.current_company_id()));

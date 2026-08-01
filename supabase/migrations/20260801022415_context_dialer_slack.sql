-- Durable handoff from enrichment to the Context Dialer and Slack. Supabase
-- owns delivery state so the executor can move from Inngest to n8n later.

create table public.context_dialer_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  pipeline_run_id uuid not null references public.pipeline_runs(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  estimate_id uuid references public.roof_estimates(id) on delete set null,
  status text not null default 'queued' check (
    status in ('queued', 'sent', 'failed')
  ),
  scheduled_for timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  sent_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pipeline_run_id)
);

create index context_dialer_deliveries_company_id_idx
  on public.context_dialer_deliveries(company_id);
create index context_dialer_deliveries_lead_id_idx
  on public.context_dialer_deliveries(lead_id);
create index context_dialer_deliveries_estimate_id_idx
  on public.context_dialer_deliveries(estimate_id)
  where estimate_id is not null;
create index context_dialer_deliveries_queued_idx
  on public.context_dialer_deliveries(scheduled_for)
  where status = 'queued';

alter table public.context_dialer_deliveries enable row level security;

revoke all on public.context_dialer_deliveries from anon, authenticated;
grant all on public.context_dialer_deliveries to service_role;
grant select on public.context_dialer_deliveries to authenticated;

create policy "company admins read context dialer deliveries"
  on public.context_dialer_deliveries
  for select
  to authenticated
  using (company_id = (select public.current_company_id()));

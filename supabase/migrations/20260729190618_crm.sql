-- Convert leads.stage from free text to a governed pipeline-stage enum.
create type public.lead_stage as enum (
  'new',
  'contacting',
  'appointment_set',
  'estimating',
  'proposal_sent',
  'won',
  'lost',
  'nurture'
);

alter table public.leads alter column stage drop default;
alter table public.leads
  alter column stage type public.lead_stage
  using stage::public.lead_stage;
alter table public.leads alter column stage set default 'new'::public.lead_stage;

create type public.interaction_type as enum (
  'call', 'email', 'text', 'site_visit', 'note'
);

create type public.task_status as enum (
  'open', 'complete', 'cancelled'
);

create type public.notification_type as enum (
  'lead_submitted', 'review_task_created', 'pipeline_stuck', 'pipeline_failed'
);

create table public.lead_stage_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id) on delete cascade,
  from_stage public.lead_stage,
  to_stage public.lead_stage not null,
  changed_by uuid references public.admin_profiles(id),
  note text,
  changed_at timestamptz not null default now()
);

-- Exactly one system-authored "initial stage" row per lead. The CRM Writer
-- relies on this constraint to stay idempotent under duplicate event delivery.
create unique index lead_stage_history_initial_idx
  on public.lead_stage_history(lead_id)
  where from_stage is null;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text,
  due_at timestamptz,
  assigned_to uuid references public.admin_profiles(id),
  status public.task_status not null default 'open',
  completed_at timestamptz,
  created_by uuid references public.admin_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id) on delete cascade,
  type public.interaction_type not null,
  summary text not null check (length(trim(summary)) > 0),
  occurred_at timestamptz not null default now(),
  created_by uuid references public.admin_profiles(id),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid references public.leads(id) on delete cascade,
  type public.notification_type not null,
  title text not null check (length(trim(title)) > 0),
  body text,
  correlation_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- One notification per (correlation, type). The CRM Writer relies on this
-- constraint to stay idempotent under duplicate event delivery.
create unique index notifications_correlation_type_idx
  on public.notifications(correlation_id, type)
  where correlation_id is not null;

create index lead_stage_history_company_id_idx on public.lead_stage_history(company_id);
create index lead_stage_history_lead_id_idx on public.lead_stage_history(lead_id, changed_at desc);
create index tasks_company_id_idx on public.tasks(company_id);
create index tasks_lead_id_idx on public.tasks(lead_id);
create index tasks_status_due_at_idx on public.tasks(status, due_at);
create index interactions_company_id_idx on public.interactions(company_id);
create index interactions_lead_id_idx on public.interactions(lead_id, occurred_at desc);
create index notifications_company_id_created_idx on public.notifications(company_id, created_at desc);
create index notifications_lead_id_idx on public.notifications(lead_id);
create index notifications_unread_idx on public.notifications(company_id) where read_at is null;

alter table public.lead_stage_history enable row level security;
alter table public.tasks enable row level security;
alter table public.interactions enable row level security;
alter table public.notifications enable row level security;

revoke all on public.lead_stage_history from anon, authenticated;
revoke all on public.tasks from anon, authenticated;
revoke all on public.interactions from anon, authenticated;
revoke all on public.notifications from anon, authenticated;

-- service_role bypasses RLS but, as in the foundation migration, this local
-- Postgres image grants it no implicit table privileges.
grant all on public.lead_stage_history to service_role;
grant all on public.tasks to service_role;
grant all on public.interactions to service_role;
grant all on public.notifications to service_role;

grant select on public.lead_stage_history to authenticated;
grant select, insert, update on public.tasks to authenticated;
grant select, insert on public.interactions to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy "company admins read lead stage history" on public.lead_stage_history
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read tasks" on public.tasks
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins create tasks" on public.tasks
  for insert to authenticated
  with check (company_id = (select public.current_company_id()));

create policy "company admins update tasks" on public.tasks
  for update to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

create policy "company admins read interactions" on public.interactions
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins create interactions" on public.interactions
  for insert to authenticated
  with check (company_id = (select public.current_company_id()));

create policy "company admins read notifications" on public.notifications
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins mark notifications read" on public.notifications
  for update to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

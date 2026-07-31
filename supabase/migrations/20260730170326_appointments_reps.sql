-- Module 2 (Sales Support): appointments, sales representatives, and the
-- vendor-neutral landing table for customer-facing representative intros.
--
-- There is intentionally no email/SMS dispatch in this migration. The
-- Inngest worker composes a ready-to-send message into
-- appointment_rep_intros; a future channel adapter will advance queued rows
-- to sent or failed.

create type public.appointment_status as enum (
  'scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'
);

create type public.appointment_rep_intro_status as enum (
  'queued', 'sent', 'failed'
);

create table public.reps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null check (length(trim(name)) > 0),
  photo_url text,
  bio text,
  credentials text,
  community_connection text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id) on delete cascade,
  rep_id uuid references public.reps(id),
  scheduled_at timestamptz not null,
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  status public.appointment_status not null default 'scheduled',
  notes text,
  created_by uuid references public.admin_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.appointment_rep_intros (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  rep_id uuid not null references public.reps(id),
  composed_subject text not null check (length(trim(composed_subject)) > 0),
  composed_body text not null check (length(trim(composed_body)) > 0),
  status public.appointment_rep_intro_status not null default 'queued',
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index reps_company_id_idx on public.reps(company_id);
create index appointments_company_id_idx on public.appointments(company_id);
create index appointments_lead_id_idx on public.appointments(lead_id);
create index appointments_rep_id_idx on public.appointments(rep_id);
create index appointments_created_by_idx on public.appointments(created_by);
create index appointments_upcoming_idx
  on public.appointments(company_id, scheduled_at)
  where status in ('scheduled', 'confirmed');
create index appointment_rep_intros_company_id_idx
  on public.appointment_rep_intros(company_id);
create index appointment_rep_intros_rep_id_idx
  on public.appointment_rep_intros(rep_id);
create unique index appointment_rep_intros_appointment_id_idx
  on public.appointment_rep_intros(appointment_id);

alter table public.reps enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_rep_intros enable row level security;

revoke all on public.reps from anon, authenticated;
revoke all on public.appointments from anon, authenticated;
revoke all on public.appointment_rep_intros from anon, authenticated;

grant all on public.reps to service_role;
grant all on public.appointments to service_role;
grant all on public.appointment_rep_intros to service_role;

grant select, insert, update on public.reps to authenticated;
grant select on public.appointments to authenticated;
grant insert (
  company_id, lead_id, scheduled_at, duration_minutes, notes, status
) on public.appointments to authenticated;
grant update (
  company_id, lead_id, scheduled_at, duration_minutes, notes, status
) on public.appointments to authenticated;
grant select on public.appointment_rep_intros to authenticated;

create policy "company admins read reps" on public.reps
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins create reps" on public.reps
  for insert to authenticated
  with check (company_id = (select public.current_company_id()));

create policy "company admins update reps" on public.reps
  for update to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

create policy "company admins read appointments" on public.appointments
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins create appointments" on public.appointments
  for insert to authenticated
  with check (company_id = (select public.current_company_id()));

create policy "company admins update appointments" on public.appointments
  for update to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

create policy "company admins read appointment rep intros"
  on public.appointment_rep_intros
  for select to authenticated
  using (company_id = (select public.current_company_id()));

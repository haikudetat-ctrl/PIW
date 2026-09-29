-- Customer journey backbone: one customer across PIW, LeadConduit, JobNimbus
-- (and LeadMaster once its exports land), a stage timeline per customer, and
-- per-source costs.
--
-- Matching order when a record arrives:
--   1. an explicit link (PIW lead id carried back through LeadConduit; a
--      JobNimbus job's primary contact);
--   2. E.164 phone;
--   3. normalized email.
-- A phone or email that already belongs to more than one customer is never
-- used to merge; the record is logged in customer_match_conflicts instead.

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- First-touch attribution: the source of the record that created the customer.
  source_name text,
  first_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create index customers_company_idx on public.customers (company_id, first_seen_at desc);

create table public.customer_identities (
  company_id uuid not null references public.companies(id) on delete cascade,
  source_system text not null check (
    source_system in ('piw_lead', 'leadconduit', 'jobnimbus_contact', 'jobnimbus_job', 'leadmaster')
  ),
  external_id text not null check (length(btrim(external_id)) > 0),
  customer_id uuid not null references public.customers(id) on delete cascade,
  phone_normalized text,
  email_normalized text,
  matched_by text not null check (matched_by in ('new', 'explicit', 'phone', 'email')),
  created_at timestamptz not null default now(),
  primary key (company_id, source_system, external_id)
);

create index customer_identities_customer_idx on public.customer_identities (customer_id);
create index customer_identities_phone_idx on public.customer_identities (company_id, phone_normalized)
  where phone_normalized is not null;
create index customer_identities_email_idx on public.customer_identities (company_id, email_normalized)
  where email_normalized is not null;

create table public.customer_match_conflicts (
  company_id uuid not null references public.companies(id) on delete cascade,
  source_system text not null,
  external_id text not null,
  reason text not null check (reason in ('ambiguous_phone', 'ambiguous_email', 'missing_contact')),
  candidate_count integer not null default 0,
  last_seen_at timestamptz not null default now(),
  primary key (company_id, source_system, external_id)
);

create table public.customer_journey_events (
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  stage text not null check (stage in (
    'lead_received', 'ap_intake', 'ap_delivered', 'ap_filtered',
    'contacted', 'appointment_set', 'appointment_ran', 'appointment_no_show',
    'handoff', 'quoted', 'sold', 'in_production', 'completed', 'lost'
  )),
  occurred_at timestamptz not null,
  source_system text not null,
  source_ref text not null,
  -- True when the time is inferred (e.g. a job first seen already past "sold"
  -- is given its current status-change time as the sale time).
  is_approximate boolean not null default false,
  recorded_at timestamptz not null default now(),
  primary key (company_id, customer_id, stage, source_system, source_ref)
);

create index customer_journey_events_stage_idx
  on public.customer_journey_events (company_id, stage, occurred_at desc);

-- JobNimbus status → journey stage. company_id null is the default mapping;
-- a company row overrides it. `implies` lists earlier stages a record in this
-- status must have passed, recorded as approximate when not seen directly.
create table public.jobnimbus_status_stages (
  company_id uuid references public.companies(id) on delete cascade,
  status_name text not null,
  stage text,
  implies text[] not null default '{}',
  unique nulls not distinct (company_id, status_name)
);

insert into public.jobnimbus_status_stages (company_id, status_name, stage, implies) values
  (null, 'Appointment Scheduled', 'appointment_set', '{}'),
  (null, 'No Show', 'appointment_no_show', '{appointment_set}'),
  (null, 'Quoted', 'quoted', '{}'),
  (null, 'Signed Contract', 'sold', '{}'),
  (null, 'Job Prep', 'in_production', '{sold}'),
  (null, 'Final Walk Through', 'in_production', '{sold}'),
  (null, 'Job Completed', 'completed', '{sold}'),
  (null, 'Pending Payments', 'completed', '{sold}'),
  (null, 'Lost', 'lost', '{}');

create table public.source_costs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_name text not null check (length(btrim(source_name)) > 0),
  cost_type text not null check (cost_type in ('per_lead', 'monthly')),
  amount numeric(12, 2) not null check (amount >= 0),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create index source_costs_company_source_idx on public.source_costs (company_id, source_name, effective_from);

-- -----------------------------------------------------------------------------
-- Matching
-- -----------------------------------------------------------------------------

create function public.match_customer_by_contact(
  p_company_id uuid,
  p_phone text,
  p_email text,
  out customer_id uuid,
  out outcome text,
  out candidate_count integer
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_candidates uuid[];
begin
  if p_phone is not null then
    select array_agg(distinct identity.customer_id) into v_candidates
    from public.customer_identities as identity
    where identity.company_id = p_company_id and identity.phone_normalized = p_phone;
    if coalesce(array_length(v_candidates, 1), 0) = 1 then
      customer_id := v_candidates[1]; outcome := 'phone'; candidate_count := 1; return;
    elsif coalesce(array_length(v_candidates, 1), 0) > 1 then
      outcome := 'ambiguous_phone'; candidate_count := array_length(v_candidates, 1); return;
    end if;
  end if;

  if p_email is not null then
    select array_agg(distinct identity.customer_id) into v_candidates
    from public.customer_identities as identity
    where identity.company_id = p_company_id and identity.email_normalized = p_email;
    if coalesce(array_length(v_candidates, 1), 0) = 1 then
      customer_id := v_candidates[1]; outcome := 'email'; candidate_count := 1; return;
    elsif coalesce(array_length(v_candidates, 1), 0) > 1 then
      outcome := 'ambiguous_email'; candidate_count := array_length(v_candidates, 1); return;
    end if;
  end if;

  outcome := 'none'; candidate_count := 0;
end;
$$;

-- Attaches one external record to a customer: explicit link first, then
-- phone/email, else a new customer. Returns null when ambiguous (logged).
create function public.attach_customer_identity(
  p_company_id uuid,
  p_source_system text,
  p_external_id text,
  p_phone text,
  p_email text,
  p_explicit_customer_id uuid,
  p_source_name text,
  p_seen_at timestamptz
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_match record;
  v_customer_id uuid;
  v_matched_by text;
begin
  if p_explicit_customer_id is not null then
    v_customer_id := p_explicit_customer_id;
    v_matched_by := 'explicit';
  else
    select * into v_match from public.match_customer_by_contact(p_company_id, p_phone, p_email);
    if v_match.outcome in ('ambiguous_phone', 'ambiguous_email') then
      insert into public.customer_match_conflicts
        (company_id, source_system, external_id, reason, candidate_count, last_seen_at)
      values (p_company_id, p_source_system, p_external_id, v_match.outcome, v_match.candidate_count, pg_catalog.now())
      on conflict (company_id, source_system, external_id) do update
      set reason = excluded.reason, candidate_count = excluded.candidate_count, last_seen_at = excluded.last_seen_at;
      return null;
    end if;
    v_customer_id := v_match.customer_id;
    v_matched_by := case when v_match.outcome = 'none' then 'new' else v_match.outcome end;
  end if;

  if v_customer_id is null then
    insert into public.customers (company_id, source_name, first_seen_at)
    values (p_company_id, nullif(pg_catalog.btrim(p_source_name), ''), p_seen_at)
    returning id into v_customer_id;
  end if;

  insert into public.customer_identities
    (company_id, source_system, external_id, customer_id, phone_normalized, email_normalized, matched_by)
  values (p_company_id, p_source_system, p_external_id, v_customer_id, p_phone, p_email, v_matched_by)
  on conflict (company_id, source_system, external_id) do nothing;

  delete from public.customer_match_conflicts
  where company_id = p_company_id and source_system = p_source_system and external_id = p_external_id;

  return v_customer_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Refresh: attach new records, then (re)derive stage events. Idempotent; safe
-- to run after every sync. Events are never deleted, so a stage a customer
-- reached stays on their timeline even after the source status moves on.
-- -----------------------------------------------------------------------------

create function public.refresh_customer_journey(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_customer_id uuid;
  v_explicit uuid;
  v_attached integer := 0;
  v_unmatched integer := 0;
  v_events integer := 0;
  v_rows integer;
begin
  -- 1. PIW leads.
  for r in
    select lead.id, lead.phone_e164, lead.email_normalized, lead.created_at,
      coalesce(nullif(pg_catalog.btrim(lead.original_lead_source), ''),
               nullif(pg_catalog.btrim(lead.utm_campaign), ''),
               lead.source_system) as source_name
    from public.leads as lead
    where lead.company_id = p_company_id
      and not lead.is_test
      and not exists (
        select 1 from public.customer_identities as identity
        where identity.company_id = p_company_id
          and identity.source_system = 'piw_lead'
          and identity.external_id = lead.id::text
      )
    order by lead.created_at
  loop
    v_customer_id := public.attach_customer_identity(
      p_company_id, 'piw_lead', r.id::text, r.phone_e164, r.email_normalized,
      null, r.source_name, r.created_at);
    if v_customer_id is null then v_unmatched := v_unmatched + 1; else v_attached := v_attached + 1; end if;
  end loop;

  -- 2. LeadConduit leads, one identity per (flow, lead).
  for r in
    select event.flow_id, event.lead_id,
      pg_catalog.min(event.occurred_at) as first_at,
      pg_catalog.max(event.phone_normalized) as phone,
      pg_catalog.max(event.email_normalized) as email,
      pg_catalog.max(event.attribution ->> 'piw_reference') as piw_reference,
      pg_catalog.max(event.source_name) as source_name
    from public.leadconduit_events as event
    where event.company_id = p_company_id
      and not event.is_test
      and event.lead_id is not null
      and event.flow_id is not null
      and event.event_type in ('checkpoint_intake', 'shadow_checkpoint', 'checkpoint_delivered')
      and not exists (
        select 1 from public.customer_identities as identity
        where identity.company_id = p_company_id
          and identity.source_system = 'leadconduit'
          and identity.external_id = event.flow_id || ':' || event.lead_id
      )
    group by event.flow_id, event.lead_id
    order by pg_catalog.min(event.occurred_at)
  loop
    v_explicit := null;
    if r.piw_reference ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select identity.customer_id into v_explicit
      from public.customer_identities as identity
      where identity.company_id = p_company_id
        and identity.source_system = 'piw_lead'
        and identity.external_id = pg_catalog.lower(r.piw_reference);
    end if;
    v_customer_id := public.attach_customer_identity(
      p_company_id, 'leadconduit', r.flow_id || ':' || r.lead_id, r.phone, r.email,
      v_explicit, r.source_name, r.first_at);
    if v_customer_id is null then v_unmatched := v_unmatched + 1; else v_attached := v_attached + 1; end if;
  end loop;

  -- 3. JobNimbus contacts.
  for r in
    select contact.jnid, contact.phone_normalized, contact.email_normalized,
      contact.source_name, contact.jn_created_at
    from public.jn_contacts as contact
    where contact.company_id = p_company_id
      and not exists (
        select 1 from public.customer_identities as identity
        where identity.company_id = p_company_id
          and identity.source_system = 'jobnimbus_contact'
          and identity.external_id = contact.jnid
      )
    order by contact.jn_created_at nulls last
  loop
    v_customer_id := public.attach_customer_identity(
      p_company_id, 'jobnimbus_contact', r.jnid, r.phone_normalized, r.email_normalized,
      null, r.source_name, r.jn_created_at);
    if v_customer_id is null then v_unmatched := v_unmatched + 1; else v_attached := v_attached + 1; end if;
  end loop;

  -- 4. JobNimbus jobs, through their primary contact only.
  for r in
    select job.jnid, contact_identity.customer_id
    from public.jn_jobs as job
    left join public.customer_identities as contact_identity
      on contact_identity.company_id = p_company_id
     and contact_identity.source_system = 'jobnimbus_contact'
     and contact_identity.external_id = job.primary_contact_jnid
    where job.company_id = p_company_id
      and not exists (
        select 1 from public.customer_identities as identity
        where identity.company_id = p_company_id
          and identity.source_system = 'jobnimbus_job'
          and identity.external_id = job.jnid
      )
  loop
    if r.customer_id is null then
      insert into public.customer_match_conflicts (company_id, source_system, external_id, reason)
      values (p_company_id, 'jobnimbus_job', r.jnid, 'missing_contact')
      on conflict (company_id, source_system, external_id) do update set last_seen_at = pg_catalog.now();
      v_unmatched := v_unmatched + 1;
    else
      perform public.attach_customer_identity(
        p_company_id, 'jobnimbus_job', r.jnid, null, null, r.customer_id, null, null);
      v_attached := v_attached + 1;
    end if;
  end loop;

  -- 5. Stage events.
  insert into public.customer_journey_events
    (company_id, customer_id, stage, occurred_at, source_system, source_ref)
  select p_company_id, identity.customer_id, 'lead_received', lead.created_at, 'piw_lead', lead.id::text
  from public.customer_identities as identity
  join public.leads as lead on lead.id::text = identity.external_id and lead.company_id = p_company_id
  where identity.company_id = p_company_id and identity.source_system = 'piw_lead'
  on conflict do nothing;
  get diagnostics v_rows = row_count; v_events := v_events + v_rows;

  insert into public.customer_journey_events
    (company_id, customer_id, stage, occurred_at, source_system, source_ref)
  select p_company_id, identity.customer_id,
    case event.event_type when 'checkpoint_intake' then 'ap_intake' else 'ap_delivered' end,
    event.occurred_at, 'leadconduit', identity.external_id
  from public.leadconduit_events as event
  join public.customer_identities as identity
    on identity.company_id = p_company_id
   and identity.source_system = 'leadconduit'
   and identity.external_id = event.flow_id || ':' || event.lead_id
  where event.company_id = p_company_id
    and not event.is_test
    and event.event_type in ('checkpoint_intake', 'checkpoint_delivered')
  on conflict do nothing;
  get diagnostics v_rows = row_count; v_events := v_events + v_rows;

  insert into public.customer_journey_events
    (company_id, customer_id, stage, occurred_at, source_system, source_ref)
  select p_company_id, identity.customer_id, 'ap_filtered', filtered.entered_at, 'leadconduit', identity.external_id
  from public.leadconduit_filtered_leads as filtered
  join public.customer_identities as identity
    on identity.company_id = p_company_id
   and identity.source_system = 'leadconduit'
   and identity.external_id = filtered.flow_id || ':' || filtered.lead_id
  where filtered.company_id = p_company_id and not filtered.is_test
  on conflict do nothing;
  get diagnostics v_rows = row_count; v_events := v_events + v_rows;

  -- Handoff: the job's creation in JobNimbus.
  insert into public.customer_journey_events
    (company_id, customer_id, stage, occurred_at, source_system, source_ref)
  select p_company_id, identity.customer_id, 'handoff', job.jn_created_at, 'jobnimbus_job', job.jnid
  from public.jn_jobs as job
  join public.customer_identities as identity
    on identity.company_id = p_company_id
   and identity.source_system = 'jobnimbus_job'
   and identity.external_id = job.jnid
  where job.company_id = p_company_id and job.jn_created_at is not null
  on conflict do nothing;
  get diagnostics v_rows = row_count; v_events := v_events + v_rows;

  -- Quoted: the first estimate's creation time is exact.
  insert into public.customer_journey_events
    (company_id, customer_id, stage, occurred_at, source_system, source_ref)
  select p_company_id, identity.customer_id, 'quoted', pg_catalog.min(estimate.jn_created_at),
    'jobnimbus_job', identity.external_id
  from public.jn_estimates as estimate
  join public.customer_identities as identity
    on identity.company_id = p_company_id
   and identity.source_system = 'jobnimbus_job'
   and identity.external_id = estimate.related_job_jnid
  where estimate.company_id = p_company_id and estimate.jn_created_at is not null
  group by identity.customer_id, identity.external_id
  on conflict do nothing;
  get diagnostics v_rows = row_count; v_events := v_events + v_rows;

  -- Current status (exact: the time the job entered it), then implied earlier
  -- stages (approximate). A company mapping overrides the default.
  with job_status as (
    select identity.customer_id, job.jnid, job.status_changed_at, mapping.stage, mapping.implies
    from public.jn_jobs as job
    join public.customer_identities as identity
      on identity.company_id = p_company_id
     and identity.source_system = 'jobnimbus_job'
     and identity.external_id = job.jnid
    join lateral (
      select candidate.stage, candidate.implies
      from public.jobnimbus_status_stages as candidate
      where candidate.status_name = job.status_name
        and (candidate.company_id = p_company_id or candidate.company_id is null)
      order by candidate.company_id nulls last
      limit 1
    ) as mapping on true
    where job.company_id = p_company_id and job.status_changed_at is not null
  ),
  current_stage as (
    insert into public.customer_journey_events
      (company_id, customer_id, stage, occurred_at, source_system, source_ref)
    select p_company_id, customer_id, stage, status_changed_at, 'jobnimbus_job', jnid
    from job_status
    where stage is not null
    on conflict do nothing
    returning 1
  ),
  implied_stage as (
    insert into public.customer_journey_events
      (company_id, customer_id, stage, occurred_at, source_system, source_ref, is_approximate)
    select p_company_id, job_status.customer_id, implied.stage, job_status.status_changed_at,
      'jobnimbus_job', job_status.jnid, true
    from job_status
    cross join lateral pg_catalog.unnest(job_status.implies) as implied(stage)
    on conflict do nothing
    returning 1
  )
  select (select count(*) from current_stage) + (select count(*) from implied_stage) into v_rows;
  v_events := v_events + v_rows;

  update public.customers as customer
  set first_seen_at = first_event.first_at
  from (
    select event.customer_id, pg_catalog.min(event.occurred_at) as first_at
    from public.customer_journey_events as event
    where event.company_id = p_company_id
    group by event.customer_id
  ) as first_event
  where customer.id = first_event.customer_id
    and customer.first_seen_at is distinct from first_event.first_at
    and (customer.first_seen_at is null or first_event.first_at < customer.first_seen_at);

  return pg_catalog.jsonb_build_object(
    'attached', v_attached,
    'unmatched', v_unmatched,
    'events_added', v_events,
    'open_conflicts', (select count(*) from public.customer_match_conflicts where company_id = p_company_id)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Access
-- -----------------------------------------------------------------------------

alter table public.customers enable row level security;
alter table public.customer_identities enable row level security;
alter table public.customer_match_conflicts enable row level security;
alter table public.customer_journey_events enable row level security;
alter table public.jobnimbus_status_stages enable row level security;
alter table public.source_costs enable row level security;

revoke all on public.customers, public.customer_identities, public.customer_match_conflicts,
  public.customer_journey_events, public.jobnimbus_status_stages, public.source_costs
  from anon, authenticated;
grant select, insert, update, delete on public.customers, public.customer_identities,
  public.customer_match_conflicts, public.customer_journey_events, public.jobnimbus_status_stages,
  public.source_costs
  to service_role;
grant select on public.customers, public.customer_identities, public.customer_match_conflicts,
  public.customer_journey_events, public.source_costs
  to authenticated;

-- Managers and above read the whole company's journey. Employee-scoped reads
-- arrive with the journey dashboard.
create policy "managers read customers" on public.customers
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "managers read customer identities" on public.customer_identities
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "managers read journey events" on public.customer_journey_events
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read match conflicts" on public.customer_match_conflicts
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (select public.has_company_role('company_admin'))
  );

create policy "managers read source costs" on public.source_costs
  for select to authenticated
  using (company_id = (select public.current_company_id()));

revoke execute on function
  public.match_customer_by_contact(uuid, text, text),
  public.attach_customer_identity(uuid, text, text, text, text, uuid, text, timestamptz),
  public.refresh_customer_journey(uuid)
from public, anon, authenticated;
grant execute on function
  public.match_customer_by_contact(uuid, text, text),
  public.attach_customer_identity(uuid, text, text, text, text, uuid, text, timestamptz),
  public.refresh_customer_journey(uuid)
to service_role;

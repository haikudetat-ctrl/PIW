-- Safe delta from the supplied speed-to-lead and Meta CAPI drafts.
-- The supplied roof lookup schema is intentionally not applied: PIW already
-- has tenant-scoped roof_insights/roof_estimates, consent records, a 180-day
-- cache, and the atomic reserve_provider_usage quota gate.

alter table public.leads
  add column fbclid text,
  add column fbp text,
  add column fbc text,
  add column meta_lead_id text,
  add column client_ip_address inet,
  add column client_user_agent text,
  add column first_contact_attempted_at timestamptz,
  add column first_contact_channel text,
  add column contacted_at timestamptz,
  add column time_to_first_contact_seconds integer,
  add column speed_to_lead_status text not null default 'pending';

alter table public.leads
  add constraint leads_first_contact_channel_check check (
    first_contact_channel is null
    or first_contact_channel in ('sms', 'call', 'sms+call')
  ),
  add constraint leads_time_to_first_contact_seconds_check check (
    time_to_first_contact_seconds is null
    or time_to_first_contact_seconds >= 0
  ),
  add constraint leads_speed_to_lead_status_check check (
    speed_to_lead_status in (
      'pending', 'attempted', 'queued_after_hours', 'contacted', 'escalated'
    )
  );

create index leads_speed_to_lead_queue_idx
  on public.leads(company_id, speed_to_lead_status, created_at)
  where speed_to_lead_status in ('pending', 'queued_after_hours', 'escalated');

create table public.speed_to_lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  event_type text not null check (
    event_type in ('sms_sent', 'call_queued', 'escalated', 'contacted')
  ),
  channel text check (channel is null or channel in ('sms', 'call', 'sms+call')),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index speed_to_lead_events_lead_occurred_idx
  on public.speed_to_lead_events(lead_id, occurred_at desc);

create table public.meta_conversion_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  event_name text not null check (event_name in ('Purchase', 'JobCompleted')),
  event_id text not null check (length(trim(event_id)) > 0),
  event_time timestamptz not null,
  value numeric check (value is null or value >= 0),
  currency text not null default 'USD' check (currency = 'USD'),
  meta_response_status integer check (
    meta_response_status is null
    or meta_response_status between 100 and 599
  ),
  meta_response_body jsonb,
  created_at timestamptz not null default now(),
  unique (event_id)
);

create index meta_conversion_events_lead_created_idx
  on public.meta_conversion_events(lead_id, created_at desc);

create or replace function public.set_time_to_first_contact()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.contacted_at is not null
     and new.contacted_at is distinct from old.contacted_at then
    new.time_to_first_contact_seconds :=
      extract(epoch from (new.contacted_at - new.created_at))::integer;
    new.speed_to_lead_status := 'contacted';
  end if;
  return new;
end;
$$;

create trigger leads_set_time_to_first_contact
  before update of contacted_at on public.leads
  for each row execute function public.set_time_to_first_contact();

alter table public.speed_to_lead_events enable row level security;
alter table public.meta_conversion_events enable row level security;

revoke all on public.speed_to_lead_events from anon, authenticated;
revoke all on public.meta_conversion_events from anon, authenticated;

grant all on public.speed_to_lead_events to service_role;
grant all on public.meta_conversion_events to service_role;
grant select on public.speed_to_lead_events to authenticated;
grant select on public.meta_conversion_events to authenticated;

create policy "company admins read speed to lead events"
  on public.speed_to_lead_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.leads
      where leads.id = speed_to_lead_events.lead_id
        and leads.company_id = (select public.current_company_id())
    )
  );

create policy "company admins read Meta conversion events"
  on public.meta_conversion_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.leads
      where leads.id = meta_conversion_events.lead_id
        and leads.company_id = (select public.current_company_id())
    )
  );

revoke execute on function public.set_time_to_first_contact()
  from public, anon, authenticated;
grant execute on function public.set_time_to_first_contact() to service_role;

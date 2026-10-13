-- Two-way texting with leads through a Twilio Messaging Service.
--
-- company_sms_settings holds each company's sending number and Messaging
-- Service; texting stays off until a row is enabled. sms_messages is the
-- conversation log: outbound texts sent from Rake and inbound replies from
-- Twilio's webhook. The app writes both with the service role after its own
-- checks (role, SMS consent, suppression, quiet hours); members read them.

create table public.company_sms_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  messaging_service_sid text not null check (messaging_service_sid ~ '^MG[0-9a-fA-F]{32}$'),
  from_e164 text not null unique check (from_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  enabled boolean not null default false,
  -- Company-local hours (America/New_York) when texts are held back.
  quiet_start_hour smallint not null default 21 check (quiet_start_hour between 0 and 23),
  quiet_end_hour smallint not null default 8 check (quiet_end_hour between 0 and 23),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  direction text not null check (direction in ('outbound', 'inbound')),
  body text not null check (length(body) between 1 and 1600),
  from_e164 text not null check (from_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  to_e164 text not null check (to_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null check (
    status in ('sending', 'queued', 'sent', 'delivered', 'undelivered', 'failed', 'received')
  ),
  provider_sid text unique check (provider_sid is null or provider_sid ~ '^(SM|MM)[0-9a-fA-F]{32}$'),
  error_code text,
  segments smallint check (segments is null or segments > 0),
  sent_by uuid references auth.users(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  status_updated_at timestamptz not null default now(),
  check ((direction = 'inbound') = (status = 'received')),
  check (direction = 'outbound' or read_at is null or read_at >= created_at)
);

create index sms_messages_lead_idx on public.sms_messages (company_id, lead_id, created_at desc);
create index sms_messages_unread_idx on public.sms_messages (company_id, created_at desc)
  where direction = 'inbound' and read_at is null;
create index sms_messages_from_idx on public.sms_messages (company_id, from_e164, created_at desc);

alter table public.company_sms_settings enable row level security;
alter table public.sms_messages enable row level security;

revoke all on public.company_sms_settings from anon, authenticated;
revoke all on public.sms_messages from anon, authenticated;
grant all on public.company_sms_settings to service_role;
grant all on public.sms_messages to service_role;
grant select on public.company_sms_settings to authenticated;
grant select on public.sms_messages to authenticated;

create policy "managers read sms settings" on public.company_sms_settings
  for select to authenticated
  using (
    company_id = (select public.current_member_company_id())
    and (select public.has_company_role('manager'))
  );

create policy "managers read sms messages" on public.sms_messages
  for select to authenticated
  using (
    company_id = (select public.current_member_company_id())
    and (select public.has_company_role('manager'))
  );

-- Opening a conversation marks its replies read.
create function public.mark_sms_read(p_lead_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.has_company_role('manager') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.sms_messages
  set read_at = now()
  where company_id = public.current_member_company_id()
    and lead_id = p_lead_id
    and direction = 'inbound'
    and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.mark_sms_read(uuid) from public, anon;
grant execute on function public.mark_sms_read(uuid) to authenticated, service_role;

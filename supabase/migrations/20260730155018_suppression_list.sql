-- Stop-contact registry. Every outbound send (dialer, CallTools posting,
-- future sequencing/reminders) must check is_suppressed() first — required
-- by the Module 1 acceptance criterion that a reply/opt-out/self-booking
-- measurably stops outreach.
create table public.suppression_list (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  channel text not null check (channel in ('call', 'sms', 'email')),
  phone_e164 text,
  email_normalized text,
  reason text not null check (length(trim(reason)) > 0),
  source_system text not null check (length(trim(source_system)) > 0),
  created_at timestamptz not null default now(),
  check (phone_e164 is not null or email_normalized is not null)
);

create unique index suppression_list_phone_channel_idx
  on public.suppression_list(company_id, channel, phone_e164)
  where phone_e164 is not null;
create unique index suppression_list_email_channel_idx
  on public.suppression_list(company_id, channel, email_normalized)
  where email_normalized is not null;

alter table public.suppression_list enable row level security;

revoke all on public.suppression_list from anon, authenticated;

grant all on public.suppression_list to service_role;
grant select on public.suppression_list to authenticated;

create policy "company admins read suppression list" on public.suppression_list
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create or replace function public.is_suppressed(
  p_company_id uuid,
  p_channel text,
  p_phone_e164 text,
  p_email_normalized text
) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.suppression_list
    where company_id = p_company_id
      and channel = p_channel
      and (
        (p_phone_e164 is not null and phone_e164 = p_phone_e164)
        or (p_email_normalized is not null and email_normalized = p_email_normalized)
      )
  )
$$;

revoke all on function public.is_suppressed(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.is_suppressed(uuid, text, text, text)
  to service_role;

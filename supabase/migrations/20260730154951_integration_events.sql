-- Raw vendor webhook ingestion log. Distinct from domain_events/event_outbox
-- (PIW's internal pipeline events): this is the inbound-vendor audit trail —
-- every LeadConduit/CallTools/etc. delivery is recorded here before anything
-- downstream acts on it, so idempotency and replay are provable per vendor.
create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  source_system text not null check (length(trim(source_system)) > 0),
  event_type text not null check (length(trim(event_type)) > 0),
  idempotency_key text not null check (length(trim(idempotency_key)) > 0),
  raw_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text not null default 'received'
    check (outcome in ('received', 'processed', 'duplicate', 'error')),
  error_category text,
  unique (company_id, idempotency_key)
);

create index integration_events_company_received_idx
  on public.integration_events(company_id, received_at desc);
create index integration_events_error_idx
  on public.integration_events(company_id) where outcome = 'error';

alter table public.integration_events enable row level security;

revoke all on public.integration_events from anon, authenticated;

-- service_role bypasses RLS but, as in the foundation migration, this local
-- Postgres image grants it no implicit table privileges.
grant all on public.integration_events to service_role;

grant select on public.integration_events to authenticated;

create policy "company admins read integration events" on public.integration_events
  for select to authenticated
  using (company_id = (select public.current_company_id()));

-- Idempotent recorder: a vendor delivering the same event twice (their retry
-- behavior, not ours) gets the same event_id back and is told it was a
-- duplicate rather than creating a second row.
create or replace function public.record_integration_event(
  p_company_id uuid,
  p_source_system text,
  p_event_type text,
  p_idempotency_key text,
  p_raw_payload jsonb
) returns table (
  event_id uuid,
  is_duplicate boolean
)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_inserted_id uuid;
begin
  insert into public.integration_events (
    company_id, source_system, event_type, idempotency_key, raw_payload
  ) values (
    p_company_id, p_source_system, p_event_type, p_idempotency_key, p_raw_payload
  )
  on conflict (company_id, idempotency_key) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is not null then
    return query select v_inserted_id, false;
    return;
  end if;

  select id into v_event_id
  from public.integration_events
  where company_id = p_company_id and idempotency_key = p_idempotency_key;

  return query select v_event_id, true;
end;
$$;

create or replace function public.mark_integration_event_processed(
  p_event_id uuid,
  p_outcome text,
  p_error_category text default null
) returns void
language sql security definer
set search_path = ''
as $$
  update public.integration_events
  set processed_at = now(), outcome = p_outcome, error_category = p_error_category
  where id = p_event_id
$$;

revoke all on function public.record_integration_event(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.mark_integration_event_processed(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.record_integration_event(uuid, text, text, text, jsonb)
  to service_role;
grant execute on function public.mark_integration_event_processed(uuid, text, text)
  to service_role;

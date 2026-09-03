-- Durable fan-out for Meta-attributed All Season leads. The ledger contains
-- routing state only; contact data remains in public.leads.

create table public.lead_distribution_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id) on delete cascade,
  pipeline_run_id uuid not null references public.pipeline_runs(id) on delete cascade,
  destination text not null check (destination in ('activeprospect', 'internal_email')),
  source_label text not null check (source_label in ('Meta70', 'Meta30')),
  status text not null default 'pending' check (
    status in ('pending', 'sending', 'sent', 'rejected', 'retryable_failed', 'permanent_failed')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default pg_catalog.now(),
  claimed_at timestamptz,
  external_id text check (external_id is null or pg_catalog.length(external_id) <= 256),
  outcome text check (outcome is null or pg_catalog.length(outcome) <= 128),
  last_error text check (last_error is null or pg_catalog.length(last_error) <= 1000),
  sent_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (lead_id, destination)
);

create index lead_distribution_pending_idx
  on public.lead_distribution_deliveries(available_at, created_at)
  where status in ('pending', 'retryable_failed', 'sending');
create index lead_distribution_company_lead_idx
  on public.lead_distribution_deliveries(company_id, lead_id);

alter table public.lead_distribution_deliveries enable row level security;
revoke all on table public.lead_distribution_deliveries
  from public, anon, authenticated, service_role;
grant select on table public.lead_distribution_deliveries to service_role;

create function public.queue_meta_lead_distribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_label text;
  v_inserted integer;
  v_event_id uuid;
  v_activeprospect_delivery_id uuid;
  v_internal_email_delivery_id uuid;
  v_occurred_at timestamptz := pg_catalog.now();
  v_idempotency_key text;
  v_event_payload jsonb;
begin
  select case
    when pg_catalog.lower(pg_catalog.btrim(lead.utm_source)) in ('meta', 'facebook', 'instagram')
      and pg_catalog.btrim(lead.utm_campaign) in ('AS | Campaign 1', 'Meta70') then 'Meta70'
    when pg_catalog.lower(pg_catalog.btrim(lead.utm_source)) in ('meta', 'facebook', 'instagram')
      and pg_catalog.btrim(lead.utm_campaign) in ('AS | Campaign 2', 'Meta30') then 'Meta30'
    else null
  end
  into v_source_label
  from public.leads as lead
  where lead.id = new.lead_id
    and lead.company_id = new.company_id
    and lead.source_system <> 'leadconduit';

  if v_source_label is null then
    return new;
  end if;

  insert into public.lead_distribution_deliveries(
    company_id, lead_id, pipeline_run_id, destination, source_label
  )
  select new.company_id, new.lead_id, new.id, destination.name, v_source_label
  from (values ('activeprospect'), ('internal_email')) as destination(name)
  on conflict (lead_id, destination) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return new;
  end if;

  select delivery.id into v_activeprospect_delivery_id
  from public.lead_distribution_deliveries as delivery
  where delivery.lead_id = new.lead_id and delivery.destination = 'activeprospect';
  select delivery.id into v_internal_email_delivery_id
  from public.lead_distribution_deliveries as delivery
  where delivery.lead_id = new.lead_id and delivery.destination = 'internal_email';

  v_event_id := extensions.gen_random_uuid();
  v_idempotency_key := 'lead-distribution:' || new.lead_id::text;
  v_event_payload := pg_catalog.jsonb_build_object(
    'id', v_event_id,
    'name', 'lead/distribution.requested',
    'schemaVersion', 1,
    'correlationId', new.correlation_id,
    'leadId', new.lead_id,
    'pipelineRunId', new.id,
    'occurredAt', pg_catalog.to_char(
      v_occurred_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'idempotencyKey', v_idempotency_key,
    'data', pg_catalog.jsonb_build_object(
      'leadId', new.lead_id,
      'sourceLabel', v_source_label,
      'activeProspectDeliveryId', v_activeprospect_delivery_id,
      'internalEmailDeliveryId', v_internal_email_delivery_id
    )
  );

  insert into public.domain_events(
    id, company_id, pipeline_run_id, event_name, schema_version,
    correlation_id, idempotency_key, payload, occurred_at
  ) values (
    v_event_id, new.company_id, new.id,
    'lead/distribution.requested', 1, new.correlation_id,
    v_idempotency_key, v_event_payload, v_occurred_at
  )
  on conflict (idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning id into v_event_id;

  insert into public.event_outbox(event_id)
  values (v_event_id)
  on conflict (event_id) do nothing;

  return new;
end;
$$;

create trigger pipeline_runs_queue_meta_lead_distribution
after insert on public.pipeline_runs
for each row
when (new.lead_id is not null)
execute function public.queue_meta_lead_distribution();

create function public.claim_lead_distribution_delivery(
  p_delivery_id uuid,
  p_company_id uuid,
  p_now timestamptz
) returns table (
  delivery_id uuid,
  company_id uuid,
  lead_id uuid,
  destination text,
  source_label text,
  attempt_count integer,
  name text,
  phone text,
  email text,
  submitted_address text,
  notes text,
  source_system text,
  source_submitted_at timestamptz,
  trustedform_url text,
  source_ip_address inet,
  source_user_agent text,
  utm_source text,
  utm_campaign text
)
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    update public.lead_distribution_deliveries as delivery
    set status = 'sending',
        attempt_count = delivery.attempt_count + 1,
        claimed_at = p_now,
        updated_at = p_now
    where delivery.id = p_delivery_id
      and delivery.company_id = p_company_id
      and delivery.available_at <= p_now
      and (
        delivery.status in ('pending', 'retryable_failed')
        or (delivery.status = 'sending' and delivery.claimed_at <= p_now - interval '10 minutes')
      )
    returning delivery.*
  )
  select claimed.id, claimed.company_id, claimed.lead_id, claimed.destination,
         claimed.source_label, claimed.attempt_count, lead.name, lead.phone,
         lead.email, lead.submitted_address, lead.notes, lead.source_system,
         coalesce(lead.source_submitted_at, lead.created_at),
         lead.trustedform_url, lead.client_ip_address, lead.client_user_agent, lead.utm_source,
         lead.utm_campaign
  from claimed
  join public.leads as lead
    on lead.id = claimed.lead_id and lead.company_id = claimed.company_id;
$$;

create function public.list_pending_lead_distribution_deliveries(
  p_company_id uuid,
  p_limit integer,
  p_now timestamptz
) returns table (
  delivery_id uuid,
  lead_id uuid,
  destination text,
  source_label text
)
language sql
security definer
set search_path = ''
as $$
  select delivery.id, delivery.lead_id, delivery.destination, delivery.source_label
  from public.lead_distribution_deliveries as delivery
  where delivery.available_at <= p_now
    and delivery.company_id = p_company_id
    and (
      delivery.status in ('pending', 'retryable_failed')
      or (delivery.status = 'sending' and delivery.claimed_at <= p_now - interval '10 minutes')
    )
  order by delivery.available_at, delivery.created_at
  limit greatest(0, least(p_limit, 500));
$$;

create function public.complete_lead_distribution_delivery(
  p_delivery_id uuid,
  p_status text,
  p_external_id text,
  p_outcome text,
  p_last_error text,
  p_available_at timestamptz
) returns setof public.lead_distribution_deliveries
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'rejected', 'retryable_failed', 'permanent_failed') then
    raise exception 'Invalid lead distribution completion status';
  end if;
  if p_status = 'retryable_failed' and p_available_at is null then
    raise exception 'Retryable delivery requires available_at';
  end if;

  return query
  update public.lead_distribution_deliveries as delivery
  set status = case
        when p_status = 'retryable_failed' and delivery.attempt_count >= 5 then 'permanent_failed'
        else p_status
      end,
      external_id = nullif(pg_catalog.left(p_external_id, 256), ''),
      outcome = nullif(pg_catalog.left(p_outcome, 128), ''),
      last_error = nullif(pg_catalog.left(p_last_error, 1000), ''),
      available_at = case
        when p_status = 'retryable_failed' and delivery.attempt_count < 5 then p_available_at
        else delivery.available_at
      end,
      claimed_at = null,
      sent_at = case when p_status = 'sent' then pg_catalog.now() else delivery.sent_at end,
      updated_at = pg_catalog.now()
  where delivery.id = p_delivery_id
    and delivery.status = 'sending'
  returning delivery.*;
end;
$$;

revoke all on function public.queue_meta_lead_distribution() from public, anon, authenticated, service_role;
revoke all on function public.claim_lead_distribution_delivery(uuid,uuid,timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.list_pending_lead_distribution_deliveries(uuid,integer,timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.complete_lead_distribution_delivery(uuid,text,text,text,text,timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.claim_lead_distribution_delivery(uuid,uuid,timestamptz) to service_role;
grant execute on function public.list_pending_lead_distribution_deliveries(uuid,integer,timestamptz) to service_role;
grant execute on function public.complete_lead_distribution_delivery(uuid,text,text,text,text,timestamptz) to service_role;

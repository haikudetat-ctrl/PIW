create or replace function public.enqueue_domain_event(
  p_company_id uuid,
  p_event jsonb
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_requested_event_id uuid := (p_event->>'id')::uuid;
  v_persisted_event_id uuid;
begin
  insert into public.domain_events (
    id, company_id, pipeline_run_id, event_name, schema_version,
    correlation_id, causation_event_id, idempotency_key, payload, occurred_at
  ) values (
    v_requested_event_id,
    p_company_id,
    (p_event->>'pipelineRunId')::uuid,
    p_event->>'name',
    (p_event->>'schemaVersion')::integer,
    (p_event->>'correlationId')::uuid,
    nullif(p_event->>'causationEventId', '')::uuid,
    p_event->>'idempotencyKey',
    p_event,
    (p_event->>'occurredAt')::timestamptz
  )
  on conflict (idempotency_key) do nothing;

  select events.id
  into v_persisted_event_id
  from public.domain_events as events
  where events.idempotency_key = p_event->>'idempotencyKey';

  if v_persisted_event_id is null then
    raise exception 'Unable to resolve persisted domain event';
  end if;

  insert into public.event_outbox (event_id)
  values (v_persisted_event_id)
  on conflict (event_id) do nothing;

  return v_persisted_event_id;
end;
$$;

revoke all on function public.enqueue_domain_event(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.enqueue_domain_event(uuid, jsonb) to service_role;

-- Split ActiveProspect fan-out into two durable destinations so each flow can
-- succeed, reject, and retry without changing the other flow's lifecycle.

alter table public.lead_distribution_deliveries
  drop constraint if exists lead_distribution_deliveries_destination_check;

update public.lead_distribution_deliveries
set destination = 'activeprospect_existing'
where destination = 'activeprospect';

alter table public.lead_distribution_deliveries
  add constraint lead_distribution_deliveries_destination_check
  check (destination in (
    'activeprospect_existing',
    'activeprospect_secondary',
    'internal_email'
  ));

create or replace function public.queue_meta_lead_distribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_label text;
  v_inserted integer;
  v_event_id uuid;
  v_activeprospect_existing_delivery_id uuid;
  v_activeprospect_secondary_delivery_id uuid;
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
  from (
    values
      ('activeprospect_existing'),
      ('activeprospect_secondary'),
      ('internal_email')
  ) as destination(name)
  on conflict (lead_id, destination) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return new;
  end if;

  select delivery.id into v_activeprospect_existing_delivery_id
  from public.lead_distribution_deliveries as delivery
  where delivery.lead_id = new.lead_id
    and delivery.destination = 'activeprospect_existing';

  select delivery.id into v_activeprospect_secondary_delivery_id
  from public.lead_distribution_deliveries as delivery
  where delivery.lead_id = new.lead_id
    and delivery.destination = 'activeprospect_secondary';

  select delivery.id into v_internal_email_delivery_id
  from public.lead_distribution_deliveries as delivery
  where delivery.lead_id = new.lead_id
    and delivery.destination = 'internal_email';

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
      -- Preserve the original key while all consumers move to the explicit pair.
      'activeProspectDeliveryId', v_activeprospect_existing_delivery_id,
      'activeProspectDeliveryIds', pg_catalog.jsonb_build_array(
        v_activeprospect_existing_delivery_id,
        v_activeprospect_secondary_delivery_id
      ),
      'activeProspectExistingDeliveryId', v_activeprospect_existing_delivery_id,
      'activeProspectSecondaryDeliveryId', v_activeprospect_secondary_delivery_id,
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

begin;

select plan(4);

insert into public.companies(id, name)
values ('94000000-0000-4000-8000-000000000001', 'Dual ActiveProspect Test Company');

insert into public.properties(id, company_id, canonical_address)
values (
  '94000000-0000-4000-8000-000000000101',
  '94000000-0000-4000-8000-000000000001',
  '101 Fanout Way, Newark, NJ 07102'
);

insert into public.leads(
  id, company_id, property_id, name, phone, email, submitted_address,
  source_system, external_lead_id, source_submitted_at, phone_e164,
  email_normalized, utm_source, utm_campaign, client_ip_address, client_user_agent
) values (
  '94000000-0000-4000-8000-000000000201',
  '94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000101',
  'Dual Delivery', '+12015550101', 'dual@example.com',
  '101 Fanout Way, Newark, NJ 07102', 'canonical-roof-assessment',
  '94000000-0000-4000-8000-000000000301', '2026-09-22T16:00:00Z',
  '+12015550101', 'dual@example.com', 'meta', 'AS | Campaign 1',
  '127.0.0.1', 'pgtap'
);

insert into public.pipeline_runs(
  id, company_id, lead_id, property_id, correlation_id, pipeline_version
) values (
  '94000000-0000-4000-8000-000000000401',
  '94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000201',
  '94000000-0000-4000-8000-000000000101',
  '94000000-0000-4000-8000-000000000501', 1
);

select is(
  (select count(*) from public.lead_distribution_deliveries
   where lead_id = '94000000-0000-4000-8000-000000000201'
     and destination like 'activeprospect_%'),
  2::bigint,
  'an eligible lead queues two independently tracked ActiveProspect deliveries'
);

select is(
  (select pg_catalog.array_agg(destination order by destination)
   from public.lead_distribution_deliveries
   where lead_id = '94000000-0000-4000-8000-000000000201'
     and destination like 'activeprospect_%'),
  array['activeprospect_existing', 'activeprospect_secondary']::text[],
  'the ledger distinguishes the existing and secondary flow targets'
);

select is(
  (select pg_catalog.jsonb_array_length(payload->'data'->'activeProspectDeliveryIds')
   from public.domain_events
   where idempotency_key = 'lead-distribution:94000000-0000-4000-8000-000000000201'),
  2,
  'the durable event carries both ActiveProspect delivery IDs'
);

select is(
  (select count(*) from public.claim_lead_distribution_delivery(
    (select id from public.lead_distribution_deliveries
     where lead_id = '94000000-0000-4000-8000-000000000201'
       and destination = 'activeprospect_secondary'),
    '94000000-0000-4000-8000-000000000001',
    '2099-09-22T16:01:00Z'
  )),
  1::bigint,
  'the secondary flow can be claimed and retried independently'
);

select * from finish();
rollback;

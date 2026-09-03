begin;

select plan(28);

select has_table('public', 'lead_distribution_deliveries', 'Lead distribution ledger exists');
select has_column('public', 'lead_distribution_deliveries', 'destination', 'delivery identifies its destination');
select has_column('public', 'lead_distribution_deliveries', 'source_label', 'delivery preserves the mapped source label');
select hasnt_column('public', 'lead_distribution_deliveries', 'email', 'delivery does not duplicate email PII');
select hasnt_column('public', 'lead_distribution_deliveries', 'phone', 'delivery does not duplicate phone PII');
select hasnt_column('public', 'lead_distribution_deliveries', 'payload', 'delivery does not persist an outbound payload');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.lead_distribution_deliveries'::regclass),
  'delivery ledger has RLS enabled'
);
select table_privs_are('public', 'lead_distribution_deliveries', 'anon', array[]::text[], 'anonymous clients have no grants');
select table_privs_are('public', 'lead_distribution_deliveries', 'authenticated', array[]::text[], 'authenticated clients have no grants');
select table_privs_are('public', 'lead_distribution_deliveries', 'service_role', array['SELECT'], 'service role can only read directly');

select has_function(
  'public', 'claim_lead_distribution_delivery', array['uuid','uuid','timestamp with time zone'],
  'claim RPC exists'
);
select has_function(
  'public', 'list_pending_lead_distribution_deliveries', array['uuid','integer','timestamp with time zone'],
  'pending-list RPC exists'
);
select has_function(
  'public', 'complete_lead_distribution_delivery',
  array['uuid','text','text','text','text','timestamp with time zone'],
  'completion RPC exists'
);
select ok(
  (select pg_catalog.bool_and(proc.prosecdef and proc.proconfig = array['search_path=""'])
   from pg_catalog.pg_proc as proc
   where proc.oid in (
     'public.claim_lead_distribution_delivery(uuid,uuid,timestamptz)'::regprocedure,
     'public.list_pending_lead_distribution_deliveries(uuid,integer,timestamptz)'::regprocedure,
     'public.complete_lead_distribution_delivery(uuid,text,text,text,text,timestamptz)'::regprocedure
   )),
  'delivery RPCs are security definer functions with an empty search path'
);
select ok(
  (select pg_catalog.bool_and(
     pg_catalog.has_function_privilege('service_role', proc.oid, 'EXECUTE')
     and not pg_catalog.has_function_privilege('public', proc.oid, 'EXECUTE')
     and not pg_catalog.has_function_privilege('anon', proc.oid, 'EXECUTE')
     and not pg_catalog.has_function_privilege('authenticated', proc.oid, 'EXECUTE')
   )
   from pg_catalog.pg_proc as proc
   where proc.oid in (
     'public.claim_lead_distribution_delivery(uuid,uuid,timestamptz)'::regprocedure,
     'public.list_pending_lead_distribution_deliveries(uuid,integer,timestamptz)'::regprocedure,
     'public.complete_lead_distribution_delivery(uuid,text,text,text,text,timestamptz)'::regprocedure
   )),
  'service role alone can execute delivery RPCs'
);

insert into public.companies(id, name)
values ('93000000-0000-4000-8000-000000000001', 'Lead Distribution Test Company');

insert into public.properties(id, company_id, canonical_address)
values
  ('93000000-0000-4000-8000-000000000101', '93000000-0000-4000-8000-000000000001', '101 Campaign Way, Newark, NJ 07102'),
  ('93000000-0000-4000-8000-000000000102', '93000000-0000-4000-8000-000000000001', '102 Campaign Way, Newark, NJ 07102'),
  ('93000000-0000-4000-8000-000000000103', '93000000-0000-4000-8000-000000000001', '103 Search Way, Newark, NJ 07102');

insert into public.leads(
  id, company_id, property_id, name, phone, email, submitted_address,
  source_system, external_lead_id, source_submitted_at, phone_e164,
  email_normalized, utm_source, utm_campaign, client_ip_address, client_user_agent
) values
  ('93000000-0000-4000-8000-000000000201', '93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000101', 'Meta Seventy', '+12015550101', 'meta70@example.com', '101 Campaign Way, Newark, NJ 07102', 'canonical-roof-assessment', '93000000-0000-4000-8000-000000000301', '2026-09-03T12:00:00Z', '+12015550101', 'meta70@example.com', 'meta', 'AS | Campaign 1', '127.0.0.1', 'pgtap'),
  ('93000000-0000-4000-8000-000000000202', '93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000102', 'Meta Thirty', '+12015550102', 'meta30@example.com', '102 Campaign Way, Newark, NJ 07102', 'canonical-roof-assessment', '93000000-0000-4000-8000-000000000302', '2026-09-03T12:01:00Z', '+12015550102', 'meta30@example.com', 'facebook', 'AS | Campaign 2', '127.0.0.1', 'pgtap'),
  ('93000000-0000-4000-8000-000000000203', '93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000103', 'Organic Search', '+12015550103', 'search@example.com', '103 Search Way, Newark, NJ 07102', 'canonical-roof-assessment', '93000000-0000-4000-8000-000000000303', '2026-09-03T12:02:00Z', '+12015550103', 'search@example.com', 'google', 'brand', '127.0.0.1', 'pgtap');

insert into public.pipeline_runs(id, company_id, lead_id, property_id, correlation_id, pipeline_version)
values
  ('93000000-0000-4000-8000-000000000401', '93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000201', '93000000-0000-4000-8000-000000000101', '93000000-0000-4000-8000-000000000501', 1),
  ('93000000-0000-4000-8000-000000000402', '93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000202', '93000000-0000-4000-8000-000000000102', '93000000-0000-4000-8000-000000000502', 1),
  ('93000000-0000-4000-8000-000000000403', '93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000203', '93000000-0000-4000-8000-000000000103', '93000000-0000-4000-8000-000000000503', 1);

select is(
  (select count(*) from public.lead_distribution_deliveries where lead_id='93000000-0000-4000-8000-000000000201'),
  2::bigint, 'Campaign 1 creates two independent deliveries'
);
select is(
  (select min(source_label) from public.lead_distribution_deliveries where lead_id='93000000-0000-4000-8000-000000000201'),
  'Meta70', 'Campaign 1 maps to Meta70'
);
select is(
  (select count(*) from public.lead_distribution_deliveries where lead_id='93000000-0000-4000-8000-000000000202'),
  2::bigint, 'Campaign 2 creates two independent deliveries'
);
select is(
  (select min(source_label) from public.lead_distribution_deliveries where lead_id='93000000-0000-4000-8000-000000000202'),
  'Meta30', 'Campaign 2 maps to Meta30'
);
select is(
  (select count(*) from public.lead_distribution_deliveries where lead_id='93000000-0000-4000-8000-000000000203'),
  0::bigint, 'non-Meta traffic is not distributed'
);
select is(
  (select count(*) from public.domain_events where event_name='lead/distribution.requested'),
  2::bigint, 'one distribution event is created for each eligible lead'
);
select is(
  (select (payload->>'name') || ':' || (payload->'data'->>'sourceLabel')
   from public.domain_events where idempotency_key='lead-distribution:93000000-0000-4000-8000-000000000201'),
  'lead/distribution.requested:Meta70', 'outbox payload contains a valid sparse routing envelope'
);
select is(
  (select count(*) from public.event_outbox as outbox join public.domain_events as event on event.id=outbox.event_id where event.event_name='lead/distribution.requested'),
  2::bigint, 'distribution events are placed in the transactional outbox'
);

create temp table claimed_activeprospect as
select * from public.claim_lead_distribution_delivery(
  (select id from public.lead_distribution_deliveries where lead_id='93000000-0000-4000-8000-000000000201' and destination='activeprospect'),
  '93000000-0000-4000-8000-000000000001',
  '2099-09-03T13:00:00Z'
);
select is(
  (select count(*) from public.claim_lead_distribution_delivery(
    (select id from public.lead_distribution_deliveries where lead_id='93000000-0000-4000-8000-000000000202' and destination='activeprospect'),
    '93000000-0000-4000-8000-000000000099', '2099-09-03T13:00:00Z'
  )),
  0::bigint, 'claim refuses a delivery outside the configured company boundary'
);
select is((select count(*) from claimed_activeprospect), 1::bigint, 'a pending destination can be claimed');
select is(
  (select status from public.lead_distribution_deliveries where lead_id='93000000-0000-4000-8000-000000000201' and destination='internal_email'),
  'pending', 'claiming ActiveProspect does not block the email destination'
);
select is(
  (select count(*) from public.claim_lead_distribution_delivery((select delivery_id from claimed_activeprospect), '93000000-0000-4000-8000-000000000001', '2099-09-03T13:00:01Z')),
  0::bigint, 'a sending delivery cannot be claimed twice'
);

select * from public.complete_lead_distribution_delivery(
  (select delivery_id from claimed_activeprospect), 'sent', 'leadconduit-id-123', 'success', null, null
);
select is(
  (select status || ':' || external_id from public.lead_distribution_deliveries where id=(select delivery_id from claimed_activeprospect)),
  'sent:leadconduit-id-123', 'successful completion persists destination evidence'
);

select * from finish();
rollback;

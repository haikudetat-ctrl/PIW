begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

select has_extension('postgis', 'PostGIS is enabled');
select has_table('public', 'properties', 'properties exists');
select has_table('public', 'observations', 'observations exists');
select has_table('public', 'event_outbox', 'event_outbox exists');
select has_table('public', 'audit_log', 'audit_log exists');
select policies_are(
  'public',
  'properties',
  array['company admins read properties'],
  'properties has explicit read policy'
);
select policies_are(
  'public',
  'leads',
  array['company admins read leads', 'company admins write leads'],
  'leads has explicit admin policies'
);
select is(
  has_table_privilege('anon', 'public.leads', 'select'),
  false,
  'anonymous users cannot select leads'
);

insert into public.companies (id, name)
values ('00000000-0000-4000-8000-000000000001', 'PIW Local Roofing')
on conflict (id) do nothing;

insert into public.pipeline_runs (
  id, company_id, correlation_id, pipeline_version, status
) values (
  '22222222-2222-4222-8222-222222222222',
  '00000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  1,
  'received'
);

select public.enqueue_domain_event(
  '00000000-0000-4000-8000-000000000001',
  '{
    "id":"44444444-4444-4444-8444-444444444444",
    "name":"system/diagnostic.requested",
    "schemaVersion":1,
    "correlationId":"11111111-1111-4111-8111-111111111111",
    "pipelineRunId":"22222222-2222-4222-8222-222222222222",
    "occurredAt":"2026-07-29T12:00:00.000Z",
    "idempotencyKey":"system/diagnostic.requested:22222222-2222-4222-8222-222222222222",
    "data":{"requestedBy":"33333333-3333-4333-8333-333333333333"}
  }'::jsonb
);
select is(
  public.enqueue_domain_event(
    '00000000-0000-4000-8000-000000000001',
    '{
      "id":"55555555-5555-4555-8555-555555555555",
      "name":"system/diagnostic.requested",
      "schemaVersion":1,
      "correlationId":"11111111-1111-4111-8111-111111111111",
      "pipelineRunId":"22222222-2222-4222-8222-222222222222",
      "occurredAt":"2026-07-29T12:01:00.000Z",
      "idempotencyKey":"system/diagnostic.requested:22222222-2222-4222-8222-222222222222",
      "data":{"requestedBy":"33333333-3333-4333-8333-333333333333"}
    }'::jsonb
  ),
  '44444444-4444-4444-8444-444444444444'::uuid,
  'duplicate enqueue returns the original persisted event id'
);

select is(
  (select count(*) from public.domain_events where id = '44444444-4444-4444-8444-444444444444'),
  1::bigint,
  'duplicate enqueue creates one domain event'
);
select is(
  (select count(*) from public.event_outbox where event_id = '44444444-4444-4444-8444-444444444444'),
  1::bigint,
  'duplicate enqueue creates one outbox row'
);
select function_privs_are(
  'public', 'enqueue_domain_event', array['uuid', 'jsonb'], 'anon', array[]::text[],
  'anonymous role cannot enqueue events'
);
select function_privs_are(
  'public', 'enqueue_domain_event', array['uuid', 'jsonb'], 'authenticated', array[]::text[],
  'authenticated role cannot enqueue events'
);
select is(
  (select count(*) from public.claim_outbox_events(1, 'first-claimer')),
  1::bigint,
  'first claimant leases the pending event'
);
select is(
  (select count(*) from public.claim_outbox_events(1, 'second-claimer')),
  0::bigint,
  'second claimant cannot lease an active claim'
);

select * from finish();

rollback;

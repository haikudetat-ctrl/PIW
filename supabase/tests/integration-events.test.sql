begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

select has_table('public', 'integration_events', 'integration_events exists');
select policies_are(
  'public', 'integration_events',
  array['company admins read integration events'],
  'integration_events has a single read policy'
);
select is(
  has_table_privilege('anon', 'public.integration_events', 'select'),
  false,
  'anonymous users cannot select integration events'
);
select is(
  has_table_privilege('authenticated', 'public.integration_events', 'insert'),
  false,
  'authenticated admins cannot directly insert integration events'
);
select is(
  has_table_privilege('service_role', 'public.integration_events', 'insert'),
  true,
  'service role can insert integration events'
);
select function_privs_are(
  'public', 'record_integration_event', array['uuid', 'text', 'text', 'text', 'jsonb'],
  'anon', array[]::text[],
  'anonymous role cannot record integration events'
);
select function_privs_are(
  'public', 'record_integration_event', array['uuid', 'text', 'text', 'text', 'jsonb'],
  'authenticated', array[]::text[],
  'authenticated role cannot record integration events directly'
);

insert into public.companies (id, name)
values ('00000000-0000-4000-8000-000000000001', 'PIW Local Roofing')
on conflict (id) do nothing;

select is(
  (select is_duplicate from public.record_integration_event(
    '00000000-0000-4000-8000-000000000001', 'leadconduit', 'lead.created',
    'lc-evt-1', '{"foo":"bar"}'::jsonb
  )),
  false,
  'first delivery of an event is not a duplicate'
);
select is(
  (select is_duplicate from public.record_integration_event(
    '00000000-0000-4000-8000-000000000001', 'leadconduit', 'lead.created',
    'lc-evt-1', '{"foo":"bar"}'::jsonb
  )),
  true,
  'a redelivered event with the same idempotency key is a duplicate'
);
select is(
  (select count(*) from public.integration_events where idempotency_key = 'lc-evt-1'),
  1::bigint,
  'a redelivered event does not create a second row'
);

select public.mark_integration_event_processed(
  (select id from public.integration_events where idempotency_key = 'lc-evt-1'),
  'processed',
  null
);
select is(
  (select outcome from public.integration_events where idempotency_key = 'lc-evt-1'),
  'processed',
  'mark_integration_event_processed updates the outcome'
);

select * from finish();

rollback;

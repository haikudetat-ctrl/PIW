begin;
select plan(27);

select has_column('public', 'leads', 'fbclid', 'leads capture fbclid');
select has_column('public', 'leads', 'fbp', 'leads capture fbp');
select has_column('public', 'leads', 'fbc', 'leads capture fbc');
select has_column('public', 'leads', 'meta_lead_id', 'leads capture native Meta lead ids');
select col_type_is('public', 'leads', 'client_ip_address', 'inet', 'client IP uses inet');
select has_column('public', 'leads', 'client_user_agent', 'leads capture the attribution user agent');
select has_column('public', 'leads', 'first_contact_attempted_at', 'first contact attempt is tracked');
select has_column('public', 'leads', 'first_contact_channel', 'first contact channel is tracked');
select has_column('public', 'leads', 'contacted_at', 'successful contact is tracked');
select has_column('public', 'leads', 'time_to_first_contact_seconds', 'contact latency is tracked');
select has_column('public', 'leads', 'speed_to_lead_status', 'speed-to-lead state is tracked');

select has_table('public', 'speed_to_lead_events', 'speed-to-lead event log exists');
select has_table('public', 'meta_conversion_events', 'Meta CAPI event log exists');
select is((select relrowsecurity from pg_class where oid = 'public.speed_to_lead_events'::regclass), true, 'speed events use RLS');
select is((select relrowsecurity from pg_class where oid = 'public.meta_conversion_events'::regclass), true, 'Meta events use RLS');
select is(has_table_privilege('anon', 'public.speed_to_lead_events', 'select'), false, 'anon cannot read speed events');
select is(has_table_privilege('anon', 'public.meta_conversion_events', 'select'), false, 'anon cannot read Meta events');
select is(has_table_privilege('authenticated', 'public.speed_to_lead_events', 'select'), true, 'admins can query speed events through RLS');
select is(has_table_privilege('authenticated', 'public.meta_conversion_events', 'select'), true, 'admins can query Meta events through RLS');
select is(has_table_privilege('authenticated', 'public.speed_to_lead_events', 'insert'), false, 'clients cannot write speed events');
select is(has_table_privilege('authenticated', 'public.meta_conversion_events', 'insert'), false, 'clients cannot write Meta events');
select has_index('public', 'speed_to_lead_events', 'speed_to_lead_events_lead_occurred_idx', 'speed event foreign key is indexed');
select has_index('public', 'meta_conversion_events', 'meta_conversion_events_lead_created_idx', 'Meta event foreign key is indexed');

insert into public.companies (id, name)
values ('96000000-0000-4000-8000-000000000001', 'Lead Automation Test Company');

insert into public.leads (
  id, company_id, name, phone, email, submitted_address, created_at
) values (
  '96000000-0000-4000-8000-000000000002',
  '96000000-0000-4000-8000-000000000001',
  'Morgan Homeowner', '+16095550199', 'morgan@example.com',
  '14 Test Lane, Trenton, NJ 08608', '2026-08-01T12:00:00Z'
);

update public.leads
set contacted_at = '2026-08-01T12:02:00Z'
where id = '96000000-0000-4000-8000-000000000002';

select is(
  (select time_to_first_contact_seconds from public.leads where id = '96000000-0000-4000-8000-000000000002'),
  120,
  'contact latency is computed by the trigger'
);
select is(
  (select speed_to_lead_status from public.leads where id = '96000000-0000-4000-8000-000000000002'),
  'contacted',
  'setting contacted_at terminalizes speed-to-lead state'
);

insert into public.meta_conversion_events (
  lead_id, event_name, event_id, event_time, value
) values (
  '96000000-0000-4000-8000-000000000002',
  'Purchase', '96000000-0000-4000-8000-000000000002-Purchase', now(), 15000
);

select throws_ok(
  $$
    insert into public.meta_conversion_events (
      lead_id, event_name, event_id, event_time, value
    ) values (
      '96000000-0000-4000-8000-000000000002',
      'Purchase', '96000000-0000-4000-8000-000000000002-Purchase', now(), 15000
    )
  $$,
  '23505', null, 'Meta event ids are retry-safe'
);

select throws_ok(
  $$
    insert into public.speed_to_lead_events (lead_id, event_type)
    values ('96000000-0000-4000-8000-000000000002', 'unknown')
  $$,
  '23514', null, 'unknown speed event types are rejected'
);

select * from finish();
rollback;

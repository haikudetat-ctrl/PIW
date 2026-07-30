begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select has_table('public', 'suppression_list', 'suppression_list exists');
select policies_are(
  'public', 'suppression_list',
  array['company admins read suppression list'],
  'suppression_list has a single read policy'
);
select is(
  has_table_privilege('anon', 'public.suppression_list', 'select'),
  false,
  'anonymous users cannot select the suppression list'
);
select is(
  has_table_privilege('authenticated', 'public.suppression_list', 'insert'),
  false,
  'authenticated admins cannot directly insert suppression entries'
);
select is(
  has_table_privilege('service_role', 'public.suppression_list', 'insert'),
  true,
  'service role can insert suppression entries'
);
select function_privs_are(
  'public', 'is_suppressed', array['uuid', 'text', 'text', 'text'],
  'anon', array[]::text[],
  'anonymous role cannot check suppression'
);

insert into public.companies (id, name)
values ('00000000-0000-4000-8000-000000000001', 'PIW Local Roofing')
on conflict (id) do nothing;

insert into public.suppression_list (company_id, channel, phone_e164, reason, source_system)
values (
  '00000000-0000-4000-8000-000000000001', 'call', '+15555550100',
  'replied STOP', 'calltools'
);

select is(
  public.is_suppressed('00000000-0000-4000-8000-000000000001', 'call', '+15555550100', null),
  true,
  'a suppressed phone number blocks the call channel'
);
select is(
  public.is_suppressed('00000000-0000-4000-8000-000000000001', 'sms', '+15555550100', null),
  false,
  'suppression is scoped to the channel it was recorded for'
);
select is(
  public.is_suppressed('00000000-0000-4000-8000-000000000001', 'call', '+15555559999', null),
  false,
  'an unrelated phone number is not suppressed'
);

select throws_ok(
  $$insert into public.suppression_list (company_id, channel, phone_e164, reason, source_system)
    values ('00000000-0000-4000-8000-000000000001', 'call', '+15555550100', 'dup', 'test')$$,
  '23505',
  null,
  'a duplicate (company, channel, phone) suppression entry is rejected'
);

select * from finish();

rollback;

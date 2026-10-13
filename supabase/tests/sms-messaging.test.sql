begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

select has_table('public', 'sms_messages', 'texts are logged');
select has_table('public', 'company_sms_settings', 'each company has its texting settings');
select is(has_table_privilege('anon', 'public.sms_messages', 'select'), false, 'anon cannot read texts');
select is(has_table_privilege('authenticated', 'public.sms_messages', 'insert'), false, 'members cannot write texts directly');
select is(has_table_privilege('authenticated', 'public.company_sms_settings', 'update'), false, 'members cannot change texting settings');

insert into public.companies(id, name) values
  ('96000000-0000-4000-8000-000000000001', 'Texting Company'),
  ('96000000-0000-4000-8000-000000000002', 'Other Texting Company');
insert into auth.users(id, email) values
  ('96000000-0000-4000-8000-000000000101', 'texting-admin@example.com'),
  ('96000000-0000-4000-8000-000000000102', 'other-texting-admin@example.com'),
  ('96000000-0000-4000-8000-000000000103', 'texting-employee@example.com');
insert into public.admin_profiles(id, company_id, display_name) values
  ('96000000-0000-4000-8000-000000000101', '96000000-0000-4000-8000-000000000001', 'Texting Admin'),
  ('96000000-0000-4000-8000-000000000102', '96000000-0000-4000-8000-000000000002', 'Other Admin');
insert into public.company_memberships(user_id, company_id, role, is_active) values
  ('96000000-0000-4000-8000-000000000103', '96000000-0000-4000-8000-000000000001', 'employee', true);

insert into public.company_sms_settings(company_id, messaging_service_sid, from_e164, enabled) values
  ('96000000-0000-4000-8000-000000000001', 'MG' || repeat('a', 32), '+16095550199', true);

insert into public.properties(id, company_id, canonical_address, resolution_status) values
  ('96000000-0000-4000-8000-000000000011', '96000000-0000-4000-8000-000000000001', '1 Text St, Galloway, NJ 08205', 'resolved');
insert into public.leads(id, company_id, property_id, name, phone, email, submitted_address) values
  ('96000000-0000-4000-8000-000000000021', '96000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000011',
   'Texting Lead', '+16095550101', 'texting-lead@example.com', '1 Text St, Galloway, NJ 08205');

insert into public.sms_messages(company_id, lead_id, direction, body, from_e164, to_e164, status, provider_sid) values
  ('96000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000021', 'outbound', 'Hi there',
   '+16095550199', '+16095550101', 'delivered', 'SM' || repeat('b', 32)),
  ('96000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000021', 'inbound', 'Tuesday works',
   '+16095550101', '+16095550199', 'received', 'SM' || repeat('c', 32));

select throws_ok(
  $$insert into public.sms_messages(company_id, direction, body, from_e164, to_e164, status)
    values ('96000000-0000-4000-8000-000000000001', 'inbound', 'x', '+16095550101', '+16095550199', 'delivered')$$,
  '23514', null, 'an inbound text is always received'
);
select throws_ok(
  $$insert into public.sms_messages(company_id, direction, body, from_e164, to_e164, status, provider_sid)
    values ('96000000-0000-4000-8000-000000000001', 'inbound', 'x', '+16095550101', '+16095550199', 'received', 'SM' || repeat('c', 32))$$,
  '23505', null, 'a Twilio message is recorded once'
);

select set_config('request.jwt.claims', '{"sub":"96000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.sms_messages), 2, 'company admins read their company''s texts');
select is((select count(*)::int from public.company_sms_settings), 1, 'company admins read their texting settings');
select is(public.mark_sms_read('96000000-0000-4000-8000-000000000021'), 1, 'opening the conversation reads its replies');

reset role;
select set_config('request.jwt.claims', '{"sub":"96000000-0000-4000-8000-000000000102","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.sms_messages), 0, 'other companies cannot read the texts');

reset role;
select set_config('request.jwt.claims', '{"sub":"96000000-0000-4000-8000-000000000103","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.sms_messages), 0, 'employees below manager cannot read texts');
select throws_ok(
  $$select public.mark_sms_read('96000000-0000-4000-8000-000000000021')$$,
  '42501', null, 'employees cannot mark texts read'
);

reset role;

select * from finish();
rollback;

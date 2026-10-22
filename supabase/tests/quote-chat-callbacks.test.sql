begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

select has_column('public', 'tasks', 'origin', 'tasks record when the system created them for a homeowner');
select is(has_function_privilege('anon', 'public.request_estimate_callback(uuid, text, timestamptz)', 'execute'), false, 'anon cannot request callbacks directly');
select is(has_function_privilege('authenticated', 'public.request_estimate_callback(uuid, text, timestamptz)', 'execute'), false, 'members cannot request callbacks directly');
select is(has_function_privilege('service_role', 'public.request_estimate_callback(uuid, text, timestamptz)', 'execute'), true, 'the server requests callbacks through the service role');

insert into public.companies(id, name) values ('98000000-0000-4000-8000-000000000001', 'Callback Company');
insert into public.properties(id, company_id, canonical_address, resolution_status) values
  ('98000000-0000-4000-8000-000000000011', '98000000-0000-4000-8000-000000000001', '2 Call St, Cherry Hill, NJ 08002', 'resolved');
insert into public.leads(id, company_id, property_id, name, phone, email, submitted_address, stage) values
  ('98000000-0000-4000-8000-000000000021', '98000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000011',
   'Casey Morgan', '+16095550199', 'casey@example.com', '2 Call St, Cherry Hill, NJ 08002', 'new');
insert into public.roof_estimates(id, company_id, lead_id, property_id, public_token) values
  ('98000000-0000-4000-8000-000000000031', '98000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000021',
   '98000000-0000-4000-8000-000000000011', '98000000-0000-4000-8000-0000000000aa');

select throws_ok(
  $$select * from public.request_estimate_callback('98000000-0000-4000-8000-0000000000aa', 'midnight', now())$$,
  'P0001', 'Unsupported call window', 'an unknown call window is refused'
);
select throws_ok(
  $$select * from public.request_estimate_callback('98000000-0000-4000-8000-0000000000bb', 'asap', now())$$,
  'P0001', 'Estimate not found', 'an unknown estimate token is refused'
);

select is(
  (select created from public.request_estimate_callback('98000000-0000-4000-8000-0000000000aa', 'Morning', '2026-10-20 13:00+00')),
  true, 'the first request creates a task'
);
select is(
  (select count(*)::int from public.tasks where lead_id = '98000000-0000-4000-8000-000000000021' and origin = 'callback_request' and status = 'open'),
  1, 'one open callback task'
);
select is(
  (select description from public.tasks where lead_id = '98000000-0000-4000-8000-000000000021' and origin = 'callback_request'),
  'The homeowner asked for a call in the morning (9 to 12), Eastern time.', 'the task says when to call'
);
select is(
  (select due_at from public.tasks where lead_id = '98000000-0000-4000-8000-000000000021' and origin = 'callback_request'),
  '2026-10-20 13:00+00'::timestamptz, 'the task is due when the window opens'
);
select is(
  (select count(*)::int from public.notifications where lead_id = '98000000-0000-4000-8000-000000000021' and type = 'callback_requested'),
  1, 'staff get one notification'
);

select is(
  (select created from public.request_estimate_callback('98000000-0000-4000-8000-0000000000aa', 'asap', '2026-10-19 18:00+00')),
  false, 'asking again updates the same task'
);
select is(
  (select description from public.tasks where lead_id = '98000000-0000-4000-8000-000000000021' and origin = 'callback_request' and status = 'open'),
  'The homeowner asked for a call as soon as possible, Eastern time.', 'the new preferred time replaces the old one'
);
select is(
  (select count(*)::int from public.notifications where lead_id = '98000000-0000-4000-8000-000000000021' and type = 'callback_requested'),
  1, 'asking again does not notify twice'
);

select throws_ok(
  $$insert into public.tasks(company_id, lead_id, title, origin)
    values ('98000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000021', 'Duplicate', 'callback_request')$$,
  '23505', null, 'a lead never has two open callback tasks'
);

update public.tasks set status = 'complete', completed_at = now()
where lead_id = '98000000-0000-4000-8000-000000000021' and origin = 'callback_request';
select is(
  (select created from public.request_estimate_callback('98000000-0000-4000-8000-0000000000aa', 'evening', '2026-10-20 21:00+00')),
  true, 'after the call is done, a new request opens a new task'
);
select is(
  (select count(*)::int from public.tasks where lead_id = '98000000-0000-4000-8000-000000000021' and origin = 'callback_request'),
  2, 'the finished task stays in the history'
);

select * from finish();
rollback;

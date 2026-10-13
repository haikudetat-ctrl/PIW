begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select has_function('public', 'pipeline_jobnimbus', array['text', 'integer', 'timestamp with time zone'], 'the JobNimbus pipeline exists');
select is(has_function_privilege('anon', 'public.pipeline_jobnimbus(text, integer, timestamptz)', 'execute'), false, 'anon cannot read the JobNimbus pipeline');
select is(has_table_privilege('authenticated', 'public.jobnimbus_status_stages', 'insert'), false, 'signed-in users cannot change the status map');

insert into public.companies(id, name) values
  ('95000000-0000-4000-8000-000000000001', 'Pipeline Company'),
  ('95000000-0000-4000-8000-000000000002', 'Other Pipeline Company');
insert into auth.users(id, email) values
  ('95000000-0000-4000-8000-000000000101', 'pipeline-admin@example.com'),
  ('95000000-0000-4000-8000-000000000102', 'other-pipeline-admin@example.com');
insert into public.admin_profiles(id, company_id, display_name) values
  ('95000000-0000-4000-8000-000000000101', '95000000-0000-4000-8000-000000000001', 'Pipeline Admin'),
  ('95000000-0000-4000-8000-000000000102', '95000000-0000-4000-8000-000000000002', 'Other Admin');

insert into public.jn_contacts(company_id, jnid, display_name) values
  ('95000000-0000-4000-8000-000000000001', 'c2', 'Pat Jones');
insert into public.jn_jobs(company_id, jnid, number, status_name, primary_contact_jnid, sales_rep_name, address_line1, city,
                           estimate_total, approved_total, is_archived, status_changed_at, jn_created_at) values
  ('95000000-0000-4000-8000-000000000001', 'p1', '101', 'Lead', null, null, null, null, null, null, false, now() - interval '1 day', now() - interval '1 day'),
  ('95000000-0000-4000-8000-000000000001', 'p2', '102', 'Quoted', 'c2', 'Micah Wilson', '2 B St', 'Galloway', 12000, 0, false, now() - interval '2 days', now() - interval '9 days'),
  ('95000000-0000-4000-8000-000000000001', 'p3', '103', 'Quoted', null, null, null, null, null, null, null, now() - interval '5 days', now() - interval '9 days'),
  ('95000000-0000-4000-8000-000000000001', 'p4', '104', 'Signed Contract', null, null, null, null, 15000, 20000, false, now() - interval '3 days', now() - interval '30 days'),
  ('95000000-0000-4000-8000-000000000001', 'p5', '105', 'Estimating', null, null, null, null, null, null, false, now() - interval '3 days', now() - interval '3 days'),
  ('95000000-0000-4000-8000-000000000001', 'p6', '106', 'No Show', null, null, null, null, null, null, false, now() - interval '3 days', now() - interval '3 days'),
  ('95000000-0000-4000-8000-000000000001', 'p7', '107', 'Quoted', null, null, null, null, 9000, null, false, '2024-01-05', '2024-01-01'),
  ('95000000-0000-4000-8000-000000000001', 'p8', '108', 'Quoted', null, null, null, null, 9000, null, true, now() - interval '1 day', now() - interval '1 day'),
  ('95000000-0000-4000-8000-000000000001', 'p9', '109', 'Lead', null, null, null, null, null, null, false, now() - interval '1 day', now() - interval '1 day'),
  ('95000000-0000-4000-8000-000000000001', 'p10', '110', 'Lost', null, null, null, null, null, null, false, now() - interval '1 day', now() - interval '1 day'),
  ('95000000-0000-4000-8000-000000000001', 'p11', '111', 'Mystery', null, null, null, null, null, null, false, now() - interval '1 day', now() - interval '1 day'),
  ('95000000-0000-4000-8000-000000000001', 'p12', '112', 'Lead', null, null, null, null, null, null, false, now() - interval '1 day', now() - interval '1 day'),
  ('95000000-0000-4000-8000-000000000002', 'o1', '201', 'Quoted', null, null, null, null, 5000, null, false, now() - interval '1 day', now() - interval '1 day');
insert into public.jn_files(company_id, jnid, filename, related_job_jnid, jn_created_at) values
  ('95000000-0000-4000-8000-000000000001', 'f2', 'Roofr report.pdf', 'p2', now() - interval '2 days');
insert into public.jobnimbus_roofr_reports(company_id, file_jnid, job_jnid, outcome, total_squares) values
  ('95000000-0000-4000-8000-000000000001', 'f2', 'p2', 'ingested', 21.5);

-- p9 belongs to a customer who is also a Rake lead; p12 only to a test lead.
insert into public.properties(id, company_id, canonical_address, resolution_status) values
  ('95000000-0000-4000-8000-000000000011', '95000000-0000-4000-8000-000000000001', '9 I St, Galloway, NJ 08205', 'resolved');
insert into public.leads(id, company_id, property_id, name, phone, email, submitted_address, is_test) values
  ('95000000-0000-4000-8000-000000000021', '95000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000011',
   'Linked Lead', '+16095550221', 'linked-lead@example.com', '9 I St, Galloway, NJ 08205', false),
  ('95000000-0000-4000-8000-000000000022', '95000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000011',
   'Test Lead', '+16095550222', 'pipeline-test@example.com', '9 I St, Galloway, NJ 08205', true);
insert into public.customers(id, company_id, source_name) values
  ('95000000-0000-4000-8000-000000000031', '95000000-0000-4000-8000-000000000001', 'piw_intake'),
  ('95000000-0000-4000-8000-000000000032', '95000000-0000-4000-8000-000000000001', 'piw_intake');
insert into public.customer_identities(company_id, source_system, external_id, customer_id, matched_by) values
  ('95000000-0000-4000-8000-000000000001', 'piw_lead', '95000000-0000-4000-8000-000000000021', '95000000-0000-4000-8000-000000000031', 'new'),
  ('95000000-0000-4000-8000-000000000001', 'jobnimbus_job', 'p9', '95000000-0000-4000-8000-000000000031', 'phone'),
  ('95000000-0000-4000-8000-000000000001', 'piw_lead', '95000000-0000-4000-8000-000000000022', '95000000-0000-4000-8000-000000000032', 'new'),
  ('95000000-0000-4000-8000-000000000001', 'jobnimbus_job', 'p12', '95000000-0000-4000-8000-000000000032', 'phone');

select set_config('request.jwt.claims', '{"sub":"95000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select jsonb_object_agg(row ->> 'stage', (row ->> 'jobs')::int) from jsonb_array_elements(public.pipeline_jobnimbus() -> 'stages') as row),
  '{"new": 3, "appointment_set": 1, "estimating": 1, "proposal_sent": 2, "won": 1, "lost": 1}'::jsonb,
  'statuses map to lead stages; old, archived and already-linked jobs are left out'
);
select is(
  (select (row ->> 'value')::numeric from jsonb_array_elements(public.pipeline_jobnimbus() -> 'stages') as row where row ->> 'stage' = 'won'),
  20000::numeric,
  'a job is valued at its approved total'
);
select is(
  (select (row ->> 'value')::numeric from jsonb_array_elements(public.pipeline_jobnimbus() -> 'stages') as row where row ->> 'stage' = 'proposal_sent'),
  12000::numeric,
  'an unapproved job is valued at its estimate total'
);
select is(
  (select array_agg(row ->> 'jnid' order by row ->> 'jnid') from jsonb_array_elements(public.pipeline_jobnimbus(null, 1) -> 'jobs') as row),
  array['p1', 'p10', 'p2', 'p4', 'p5', 'p6'],
  'the limit keeps the most recently active jobs of each stage'
);
select is(
  (select row - 'activity_at' from jsonb_array_elements(public.pipeline_jobnimbus() -> 'jobs') as row where row ->> 'jnid' = 'p2'),
  '{"jnid": "p2", "number": "102", "name": "Pat Jones", "address": "2 B St, Galloway", "status_name": "Quoted",
    "stage": "proposal_sent", "sales_rep_name": "Micah Wilson", "value": 12000.00, "roofr_squares": 21.50}'::jsonb,
  'a job card carries its contact, address, rep, value and Roofr squares'
);
select is(
  public.pipeline_jobnimbus() -> 'linked_leads',
  '[{"lead_id": "95000000-0000-4000-8000-000000000021", "jnid": "p9", "status_name": "Lead"}]'::jsonb,
  'a job already on the board as a Rake lead is reported against that lead'
);
select is(
  (select array_agg(distinct row ->> 'stage') from jsonb_array_elements(public.pipeline_jobnimbus('won') -> 'jobs') as row),
  array['won'],
  'one stage can be asked for'
);
select is(
  (select (row ->> 'jobs')::int from jsonb_array_elements(public.pipeline_jobnimbus(null, 0, '2023-01-01') -> 'stages') as row where row ->> 'stage' = 'proposal_sent'),
  3,
  'an earlier start brings older jobs back'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"95000000-0000-4000-8000-000000000102","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select array_agg(row ->> 'jnid') from jsonb_array_elements(public.pipeline_jobnimbus() -> 'jobs') as row),
  array['o1'],
  'members only see their own company''s jobs'
);

reset role;

select * from finish();
rollback;

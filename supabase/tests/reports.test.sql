begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

select has_table('public', 'jobnimbus_census', 'the JobNimbus census exists');
select has_function('public', 'report_funnel', array['timestamp with time zone', 'timestamp with time zone'], 'the funnel report exists');
select has_function('public', 'report_jobs', array['timestamp with time zone', 'timestamp with time zone'], 'the jobs report exists');
select has_function('public', 'report_measurements', 'the measurements report exists');
select is(has_function_privilege('anon', 'public.report_funnel(timestamptz, timestamptz)', 'execute'), false, 'anon cannot run reports');
select is(has_function_privilege('authenticated', 'public.capture_jobnimbus_census(uuid)', 'execute'), false, 'signed-in users cannot write a census');
select is(has_table_privilege('authenticated', 'public.jobnimbus_census', 'insert'), false, 'signed-in users cannot insert a census');

insert into public.companies(id, name) values
  ('94000000-0000-4000-8000-000000000001', 'Report Company'),
  ('94000000-0000-4000-8000-000000000002', 'Other Report Company');
insert into auth.users(id, email) values
  ('94000000-0000-4000-8000-000000000101', 'report-admin@example.com'),
  ('94000000-0000-4000-8000-000000000102', 'other-report-admin@example.com');
insert into public.admin_profiles(id, company_id, display_name) values
  ('94000000-0000-4000-8000-000000000101', '94000000-0000-4000-8000-000000000001', 'Report Admin'),
  ('94000000-0000-4000-8000-000000000102', '94000000-0000-4000-8000-000000000002', 'Other Admin');

insert into public.jn_jobs(company_id, jnid, status_name, sales_rep_name, shingle_line, city, address_line1, zip, approved_total, jn_created_at) values
  ('94000000-0000-4000-8000-000000000001', 'j1', 'Signed Contract', 'Pete Thomas', 'Landmark', 'galloway', '1 A St', '08205', 20000, '2026-09-01'),
  ('94000000-0000-4000-8000-000000000001', 'j2', 'Quoted', 'Pete Thomas', null, 'Toms River', '2 B St', '08753', 0, '2026-09-05'),
  ('94000000-0000-4000-8000-000000000001', 'j3', 'Mystery', null, null, null, null, null, null, '2026-09-10'),
  ('94000000-0000-4000-8000-000000000001', 'j4', 'Signed Contract', 'Pete Thomas', 'Landmark', 'Galloway', '4 D St', '08205', 99999, '2024-01-01'),
  ('94000000-0000-4000-8000-000000000001', 'j5', 'Quoted', null, 'Patriot', 'Galloway', '5 E St', '08205', 0, '2026-09-04');
insert into public.jn_contacts(company_id, jnid, phone_normalized) values
  ('94000000-0000-4000-8000-000000000001', 'c1', '+16095550101'),
  ('94000000-0000-4000-8000-000000000001', 'c2', null);

insert into public.properties(id, company_id, canonical_address, resolution_status) values
  ('94000000-0000-4000-8000-000000000011', '94000000-0000-4000-8000-000000000001', '5 E St, Galloway, NJ 08205', 'resolved');
insert into public.leads(id, company_id, property_id, name, phone, email, submitted_address, is_test) values
  ('94000000-0000-4000-8000-000000000021', '94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000011',
   'Report Lead', '+16095550121', 'report-lead@example.com', '5 E St, Galloway, NJ 08205', false),
  ('94000000-0000-4000-8000-000000000022', '94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000011',
   'Test Lead', '+16095550122', 'report-test@example.com', '5 E St, Galloway, NJ 08205', true);
insert into public.roof_estimates(company_id, lead_id, property_id, status, roof_squares, range_low_cents, range_high_cents) values
  ('94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000021', '94000000-0000-4000-8000-000000000011', 'ready', 22, 1700000, 2200000),
  ('94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000022', '94000000-0000-4000-8000-000000000011', 'ready', 30, 1700000, 2200000);
insert into public.jn_files(company_id, jnid, filename, related_job_jnid, jn_created_at) values
  ('94000000-0000-4000-8000-000000000001', 'f5', 'Roofr report.pdf', 'j5', '2026-09-04');
insert into public.jobnimbus_roofr_reports(company_id, file_jnid, job_jnid, outcome, total_squares) values
  ('94000000-0000-4000-8000-000000000001', 'f5', 'j5', 'ingested', 20);

insert into public.customers(id, company_id, source_name) values
  ('94000000-0000-4000-8000-000000000031', '94000000-0000-4000-8000-000000000001', 'RC'),
  ('94000000-0000-4000-8000-000000000032', '94000000-0000-4000-8000-000000000001', 'RC'),
  ('94000000-0000-4000-8000-000000000033', '94000000-0000-4000-8000-000000000001', null),
  ('94000000-0000-4000-8000-000000000034', '94000000-0000-4000-8000-000000000001', 'piw_intake'),
  ('94000000-0000-4000-8000-000000000035', '94000000-0000-4000-8000-000000000001', 'RC');
insert into public.customer_identities(company_id, source_system, external_id, customer_id, matched_by) values
  ('94000000-0000-4000-8000-000000000001', 'piw_lead', '94000000-0000-4000-8000-000000000021', '94000000-0000-4000-8000-000000000034', 'new'),
  ('94000000-0000-4000-8000-000000000001', 'jobnimbus_job', 'j5', '94000000-0000-4000-8000-000000000034', 'phone');
insert into public.customer_journey_events(company_id, customer_id, stage, occurred_at, source_system, source_ref) values
  ('94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000031', 'handoff', '2026-09-01', 'jobnimbus_job', 'j1'),
  ('94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000031', 'quoted', '2026-09-02', 'jobnimbus_job', 'j1'),
  ('94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000031', 'sold', '2026-09-09', 'jobnimbus_job', 'j1'),
  ('94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000032', 'handoff', '2026-09-05', 'jobnimbus_job', 'j2'),
  ('94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000032', 'quoted', '2026-09-06', 'jobnimbus_job', 'j2'),
  ('94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000033', 'handoff', '2026-09-10', 'jobnimbus_job', 'j3'),
  ('94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000033', 'lost', '2026-09-12', 'jobnimbus_job', 'j3'),
  ('94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000034', 'lead_received', '2026-09-03', 'piw_lead', '94000000-0000-4000-8000-000000000021'),
  ('94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000034', 'handoff', '2026-09-04', 'jobnimbus_job', 'j5'),
  ('94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000034', 'quoted', '2026-09-04 12:00', 'jobnimbus_job', 'j5'),
  ('94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000035', 'handoff', '2024-01-01', 'jobnimbus_job', 'j4'),
  ('94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000035', 'sold', '2024-01-05', 'jobnimbus_job', 'j4');

-- Census, as the warehouse sync takes it.
select isnt(public.capture_jobnimbus_census('94000000-0000-4000-8000-000000000001'), null, 'a census is captured');
select is(
  (select jobs::text || '/' || contacts::text || '/' || (job_field_counts ->> 'shingle_line') || '/' || (contact_field_counts ->> 'phone_normalized')
   from public.jobnimbus_census where company_id = '94000000-0000-4000-8000-000000000001'),
  '5/2/3/1', 'the census counts jobs, contacts and filled fields'
);
select is(
  (select unmapped_statuses from public.jobnimbus_census where company_id = '94000000-0000-4000-8000-000000000001'),
  '[{"jobs": 1, "status": "Mystery"}]'::jsonb, 'statuses with no stage are listed'
);

select set_config('request.jwt.claims', '{"sub":"94000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
set local role authenticated;

select is((select report ->> 'leads' from (select public.report_funnel('2026-08-15', '2026-10-01') as report) as funnel), '4', 'customers who came in during the window form the cohort');
select is((select report ->> 'prior_leads' from (select public.report_funnel('2026-08-15', '2026-10-01') as report) as funnel), '0', 'the prior period is the same length before the window');
select is(
  (select string_agg(step ->> 'key' || ':' || (step ->> 'customers'), ',') from (select public.report_funnel('2026-08-15', '2026-10-01') as report) as funnel, jsonb_array_elements(report -> 'steps') as step),
  'lead:4,appointment:3,quoted:3,sold:1,completed:0',
  'each step counts customers who reached it or a later stage'
);
select is((select report ->> 'lost' from (select public.report_funnel('2026-08-15', '2026-10-01') as report) as funnel), '1', 'customers lost before a sale are counted');
select is((select (report ->> 'revenue')::numeric from (select public.report_funnel('2026-08-15', '2026-10-01') as report) as funnel), 20000::numeric, 'revenue is the approved total of sold jobs in the cohort');
select is((select (report -> 'median_days' ->> 'quoted_to_sold')::numeric from (select public.report_funnel('2026-08-15', '2026-10-01') as report) as funnel), 7::numeric, 'time from quoted to sold');
select is(
  (select source -> 'leads' from (select public.report_funnel('2026-08-15', '2026-10-01') as report) as funnel, jsonb_array_elements(report -> 'sources') as source where source ->> 'source' = 'RC'),
  '2'::jsonb, 'leads group by first-touch source'
);

select is((select report ->> 'jobs' from (select public.report_jobs('2026-08-15', '2026-10-01') as report) as jobs_report), '4', 'jobs created in the window');
select is((select report ->> 'quoted' || '/' || (report ->> 'sold') || '/' || (report ->> 'measured') from (select public.report_jobs('2026-08-15', '2026-10-01') as report) as jobs_report), '3/1/1', 'quoted, sold and Roofr-measured jobs');
select is(
  (select report -> 'reps' -> 0 from (select public.report_jobs('2026-08-15', '2026-10-01') as report) as jobs_report),
  '{"rep": "Pete Thomas", "jobs": 2, "sold": 1, "quoted": 2, "revenue": 20000}'::jsonb,
  'reps rank by revenue'
);
select is(
  (select town from (select public.report_jobs('2026-08-15', '2026-10-01') as report) as jobs_report, jsonb_array_elements(report -> 'territory') as town where town ->> 'city' = 'Galloway'),
  '{"city": "Galloway", "jobs": 2, "sold": 1, "measured": 1}'::jsonb,
  'towns are normalized and carry measurement coverage'
);

select is((select report -> 'estimates' from (select public.report_measurements() as report) as measurements), '{"ready": 1}'::jsonb, 'test leads are left out of estimate counts');
select is(
  (select report -> 'pairs' from (select public.report_measurements() as report) as measurements),
  '[{"job_jnid": "j5", "lead_id": "94000000-0000-4000-8000-000000000021", "lead_name": "Report Lead", "roofr_squares": 20, "estimate_squares": 22}]'::jsonb,
  'a lead estimate pairs with the Roofr report on the same customer''s job'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"94000000-0000-4000-8000-000000000102","role":"authenticated"}', true);
set local role authenticated;

select is((select public.report_funnel('2026-08-15', '2026-10-01') ->> 'leads'), '0', 'another company sees none of the funnel');
select is((select public.report_jobs('2026-08-15', '2026-10-01') ->> 'jobs'), '0', 'another company sees none of the jobs');
select is((select count(*) from public.jobnimbus_census), 0::bigint, 'another company cannot read the census');

reset role;

select * from finish();
rollback;

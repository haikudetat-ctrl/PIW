begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select has_table('public', 'jn_files', 'JobNimbus file projection exists');
select has_table('public', 'jobnimbus_roofr_reports', 'Roofr report outcomes exist');
select has_view('public', 'jobnimbus_job_roof_measurements', 'measurement-of-record view exists');

select is(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.jn_files'::regclass, 'public.jobnimbus_roofr_reports'::regclass)),
  true, 'both tables use RLS'
);
select is(has_table_privilege('anon', 'public.jn_files', 'select'), false, 'anon cannot read files');
select is(has_table_privilege('authenticated', 'public.jobnimbus_roofr_reports', 'insert'), false,
  'signed-in users cannot write report outcomes');

insert into public.companies(id, name) values
  ('93000000-0000-4000-8000-000000000001', 'Roofr Test Company');
insert into public.jn_files(company_id, jnid, filename, related_job_jnid, jn_created_at) values
  ('93000000-0000-4000-8000-000000000001', 'old', 'Roofr old.pdf', 'job-1', '2026-01-01'),
  ('93000000-0000-4000-8000-000000000001', 'new', 'Roofr new.pdf', 'job-1', '2026-02-01'),
  ('93000000-0000-4000-8000-000000000001', 'bad', 'Roofr bad.pdf', 'job-2', '2026-03-01');

select throws_ok(
  $$insert into public.jobnimbus_roofr_reports(company_id, file_jnid, job_jnid, outcome)
    values ('93000000-0000-4000-8000-000000000001', 'old', 'job-1', 'ingested')$$,
  '23514', null, 'an ingested report must carry a measurement'
);
select throws_ok(
  $$insert into public.jobnimbus_roofr_reports(company_id, file_jnid, job_jnid, outcome, total_squares)
    values ('93000000-0000-4000-8000-000000000001', 'bad', 'job-2', 'corrupt_pdf', 20)$$,
  '23514', null, 'a failed report cannot carry a measurement'
);
select throws_ok(
  $$insert into public.jobnimbus_roofr_reports(company_id, file_jnid, job_jnid, outcome, total_squares)
    values ('93000000-0000-4000-8000-000000000001', 'old', 'job-1', 'ingested', 4)$$,
  '23514', null, 'a measurement below six squares is an outbuilding, not a roof'
);

insert into public.jobnimbus_roofr_reports(company_id, file_jnid, job_jnid, outcome, total_squares) values
  ('93000000-0000-4000-8000-000000000001', 'old', 'job-1', 'ingested', 24.5),
  ('93000000-0000-4000-8000-000000000001', 'new', 'job-1', 'ingested', 28.57);
insert into public.jobnimbus_roofr_reports(company_id, file_jnid, job_jnid, outcome) values
  ('93000000-0000-4000-8000-000000000001', 'bad', 'job-2', 'corrupt_pdf');

select is(
  (select string_agg(job_jnid || ':' || file_jnid || ':' || total_squares, ',' order by job_jnid)
   from public.jobnimbus_job_roof_measurements
   where company_id = '93000000-0000-4000-8000-000000000001'),
  'job-1:new:28.57',
  'the newest ingested report is the measurement of record; failed reports are excluded'
);

delete from public.jn_files where company_id = '93000000-0000-4000-8000-000000000001' and jnid = 'new';
select is(
  (select file_jnid from public.jobnimbus_job_roof_measurements
   where company_id = '93000000-0000-4000-8000-000000000001' and job_jnid = 'job-1'),
  'old', 'deleting a file removes its report and falls back to the prior one'
);
select is(
  (select count(*) from pg_policies where schemaname = 'public'
   and tablename in ('jn_files', 'jobnimbus_roofr_reports')),
  2::bigint, 'each table has one member read policy'
);

select * from finish();
rollback;

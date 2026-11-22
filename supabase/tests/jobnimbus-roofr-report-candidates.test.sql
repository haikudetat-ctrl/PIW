begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select has_view('public', 'jobnimbus_roofr_report_candidates', 'Roofr report candidate view exists');
select is(has_table_privilege('authenticated', 'public.jobnimbus_roofr_report_candidates', 'select'), false,
  'signed-in users cannot list report candidates');

insert into public.companies(id, name) values
  ('94000000-0000-4000-8000-000000000001', 'Roofr Candidate Company');
insert into public.jn_jobs(company_id, jnid, primary_contact_jnid, jn_created_at) values
  ('94000000-0000-4000-8000-000000000001', 'job-old', 'contact-1', '2026-01-01'),
  ('94000000-0000-4000-8000-000000000001', 'job-new', 'contact-1', '2026-06-01'),
  ('94000000-0000-4000-8000-000000000001', 'job-2', 'contact-2', '2026-01-01');
insert into public.jn_files(company_id, jnid, filename, content_type, size, pages, related_job_jnid, related_contact_jnid, jn_created_at) values
  ('94000000-0000-4000-8000-000000000001', 'named', 'Smith Roof R.pdf', 'application/pdf', 400000, 7, 'job-2', null, '2026-02-01'),
  ('94000000-0000-4000-8000-000000000001', 'address', '12 Main Street, Toms River, New Jersey, United States.pdf', 'application/pdf', 400000, 7, 'job-2', null, '2026-02-01'),
  ('94000000-0000-4000-8000-000000000001', 'shape', 'Jeanine .pdf', 'application/pdf', 400000, 7, 'job-2', null, '2026-02-01'),
  ('94000000-0000-4000-8000-000000000001', 'estimate', 'Estimate 1234.pdf', 'application/pdf', 400000, 7, 'job-2', null, '2026-02-01'),
  ('94000000-0000-4000-8000-000000000001', 'too-long', 'Some packet.pdf', 'application/pdf', 400000, 30, 'job-2', null, '2026-02-01'),
  ('94000000-0000-4000-8000-000000000001', 'photo', 'roofr measurement.jpg', 'image/jpeg', 400000, null, 'job-2', null, '2026-02-01'),
  ('94000000-0000-4000-8000-000000000001', 'on-contact', 'Roofr Measurements - A Person.pdf', 'application/pdf', 400000, 8, null, 'contact-1', '2026-03-01'),
  ('94000000-0000-4000-8000-000000000001', 'contact-later', 'Roofr later.pdf', 'application/pdf', 400000, 8, null, 'contact-1', '2026-07-01'),
  ('94000000-0000-4000-8000-000000000001', 'orphan', 'Roofr orphan.pdf', 'application/pdf', 400000, 8, null, 'contact-none', '2026-03-01');

select is(
  (select string_agg(file_jnid || ':' || match_rank, ',' order by file_jnid) from public.jobnimbus_roofr_report_candidates
   where company_id = '94000000-0000-4000-8000-000000000001' and job_jnid = 'job-2'),
  'address:1,named:0,shape:2',
  'named, address-named and report-shaped PDFs are candidates; estimates, long packets and photos are not'
);
select is(
  (select job_jnid from public.jobnimbus_roofr_report_candidates
   where company_id = '94000000-0000-4000-8000-000000000001' and file_jnid = 'on-contact'),
  'job-old', 'a contact-only report belongs to the contact''s newest job created by then'
);
select is(
  (select job_jnid from public.jobnimbus_roofr_report_candidates
   where company_id = '94000000-0000-4000-8000-000000000001' and file_jnid = 'contact-later'),
  'job-new', 'a later contact-only report belongs to the newer job'
);
select is(
  (select count(*) from public.jobnimbus_roofr_report_candidates
   where company_id = '94000000-0000-4000-8000-000000000001' and file_jnid = 'orphan'),
  0::bigint, 'a report whose contact has no job is not a candidate'
);

insert into public.jobnimbus_roofr_reports(company_id, file_jnid, job_jnid, outcome) values
  ('94000000-0000-4000-8000-000000000001', 'shape', 'job-2', 'not_roofr');
insert into public.jobnimbus_roofr_reports(company_id, file_jnid, job_jnid, outcome, total_squares, eaves_ft, ridges_ft) values
  ('94000000-0000-4000-8000-000000000001', 'named', 'job-2', 'ingested', 24.5, 443.75, 163.5);

select is(
  (select eaves_ft || '/' || ridges_ft from public.jobnimbus_job_roof_measurements
   where company_id = '94000000-0000-4000-8000-000000000001' and job_jnid = 'job-2'),
  '443.75/163.50', 'the measurement of record carries edge footage'
);
select throws_ok(
  $$insert into public.jobnimbus_roofr_reports(company_id, file_jnid, job_jnid, outcome, total_squares, eaves_ft)
    values ('94000000-0000-4000-8000-000000000001', 'address', 'job-2', 'ingested', 20, -1)$$,
  '23514', null, 'footage cannot be negative'
);
select throws_ok(
  $$insert into public.jobnimbus_roofr_reports(company_id, file_jnid, job_jnid, outcome, total_squares)
    values ('94000000-0000-4000-8000-000000000001', 'address', 'job-2', 'not_roofr', 20)$$,
  '23514', null, 'a file that is not a Roofr report cannot carry a measurement'
);

select * from finish();
rollback;

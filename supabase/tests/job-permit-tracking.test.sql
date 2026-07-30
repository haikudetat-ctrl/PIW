begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select has_table('public', 'jobs', 'jobs exists');
select has_table('public', 'job_permits', 'job_permits exists');
select has_table('public', 'job_inspections', 'job_inspections exists');

select policies_are(
  'public', 'jobs',
  array['company admins read jobs', 'company admins create jobs', 'company admins update jobs'],
  'jobs has explicit read/create/update policies'
);
select policies_are(
  'public', 'job_permits',
  array['company admins read job permits', 'company admins create job permits', 'company admins update job permits'],
  'job_permits has explicit read/create/update policies'
);
select policies_are(
  'public', 'job_inspections',
  array['company admins read job inspections', 'company admins create job inspections', 'company admins update job inspections'],
  'job_inspections has explicit read/create/update policies'
);

select is(
  has_table_privilege('anon', 'public.jobs', 'select'),
  false,
  'anonymous users cannot select jobs'
);
select is(
  has_table_privilege('authenticated', 'public.jobs', 'insert'),
  true,
  'authenticated admins can directly create jobs (manual-entry fallback)'
);
select is(
  has_table_privilege('authenticated', 'public.job_permits', 'update'),
  true,
  'authenticated admins can directly update job permits (manual-entry fallback)'
);
select is(
  has_table_privilege('authenticated', 'public.job_inspections', 'insert'),
  true,
  'authenticated admins can directly create job inspections (manual-entry fallback)'
);

insert into public.companies (id, name)
values ('00000000-0000-4000-8000-000000000001', 'PIW Local Roofing')
on conflict (id) do nothing;

select is(
  (select count(*) from public.submit_lead_intake(
    '00000000-0000-4000-8000-000000000001',
    'Riley Chen', '555-010-3000', 'riley@example.com',
    '4 Oak Ct, Camden, NJ', null,
    '66666666-6666-4666-8666-666666666666', 1
  )),
  1::bigint,
  'submit_lead_intake returns one row'
);

insert into public.jobs (id, company_id, lead_id, property_id, status)
select
  '88888888-8888-4888-8888-888888888888',
  '00000000-0000-4000-8000-000000000001',
  leads.id,
  leads.property_id,
  'active'
from public.leads as leads
where leads.submitted_address = '4 Oak Ct, Camden, NJ';

select is(
  (select status from public.jobs where id = '88888888-8888-4888-8888-888888888888'),
  'active'::public.job_status,
  'job defaults to active status'
);

insert into public.job_permits (
  id, company_id, job_id, permit_type, municipality, status
) values (
  '99999999-9999-4999-8999-999999999999',
  '00000000-0000-4000-8000-000000000001',
  '88888888-8888-4888-8888-888888888888',
  'roofing',
  'Camden',
  'not_started'
);

select is(
  (select count(*) from public.job_permits where job_id = '88888888-8888-4888-8888-888888888888'),
  1::bigint,
  'job permit links to the job'
);

update public.job_permits
set status = 'submitted', submitted_at = now()
where id = '99999999-9999-4999-8999-999999999999';

select is(
  (select status from public.job_permits where id = '99999999-9999-4999-8999-999999999999'),
  'submitted'::public.job_permit_status,
  'job permit status updates'
);

insert into public.job_inspections (
  id, company_id, job_permit_id, inspection_type, status
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '00000000-0000-4000-8000-000000000001',
  '99999999-9999-4999-8999-999999999999',
  'final',
  'scheduled'
);

select is(
  (select count(*) from public.job_inspections where job_permit_id = '99999999-9999-4999-8999-999999999999'),
  1::bigint,
  'job inspection links to the job permit'
);

select throws_ok(
  $$ insert into public.job_permits (company_id, job_id, permit_type, status)
     values ('00000000-0000-4000-8000-000000000001', '88888888-8888-4888-8888-888888888888', '', 'not_started') $$,
  '23514',
  null,
  'job permit rejects a blank permit_type'
);

delete from public.jobs where id = '88888888-8888-4888-8888-888888888888';

select is(
  (select count(*) from public.job_permits where job_id = '88888888-8888-4888-8888-888888888888'),
  0::bigint,
  'deleting a job cascades to its permits'
);
select is(
  (select count(*) from public.job_inspections where job_permit_id = '99999999-9999-4999-8999-999999999999'),
  0::bigint,
  'deleting a job cascades to its permits'' inspections'
);

select * from finish();

rollback;

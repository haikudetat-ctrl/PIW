begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.companies(id, name) values
  ('97000000-0000-4000-8000-00000000000a', 'Measure Company A'),
  ('97000000-0000-4000-8000-00000000000b', 'Measure Company B');

insert into auth.users(id, email) values
  ('97000000-0000-4000-8000-000000000101', 'admin@measure.test'),
  ('97000000-0000-4000-8000-000000000102', 'employee@measure.test'),
  ('97000000-0000-4000-8000-000000000103', 'outsider@measure.test');

-- A bare admin_profiles insert makes a company admin.
insert into public.admin_profiles(id, company_id, display_name) values
  ('97000000-0000-4000-8000-000000000101', '97000000-0000-4000-8000-00000000000a', 'Admin A'),
  ('97000000-0000-4000-8000-000000000103', '97000000-0000-4000-8000-00000000000b', 'Admin B');
select public.grant_company_membership('employee@measure.test', '97000000-0000-4000-8000-00000000000a', 'employee', 'Employee A');

insert into public.jn_jobs(company_id, jnid, address_line1) values
  ('97000000-0000-4000-8000-00000000000a', 'job-a', '1 Measure Way'),
  ('97000000-0000-4000-8000-00000000000b', 'job-b', '2 Other Way');

select has_table('public', 'roof_measurements', 'saved roof drawings have a table');
select is(
  (select relrowsecurity from pg_class where oid = 'public.roof_measurements'::regclass),
  true,
  'roof_measurements has RLS enabled'
);
select ok(not has_table_privilege('anon', 'public.roof_measurements', 'select'), 'anonymous visitors cannot read drawings');

create function pg_temp.drawing_insert(v_job text default null, v_company uuid default null)
returns void language plpgsql as $$
begin
  if v_company is null then
    insert into public.roof_measurements(address, latitude, longitude, drawing, total_sloped_sqft, squares, job_jnid)
    values ('1 Measure Way, Haddon Township, NJ', 39.9, -75.05, '{"version":1,"planes":[]}', 1533.17, 15.33, v_job);
  else
    insert into public.roof_measurements(company_id, address, latitude, longitude, drawing, total_sloped_sqft, squares, job_jnid)
    values (v_company, '1 Measure Way, Haddon Township, NJ', 39.9, -75.05, '{"version":1,"planes":[]}', 1533.17, 15.33, v_job);
  end if;
end;
$$;
grant execute on function pg_temp.drawing_insert(text, uuid) to authenticated;

-- Company A admin.
select set_config('request.jwt.claims', '{"sub":"97000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
set local role authenticated;

select lives_ok($$select pg_temp.drawing_insert('job-a')$$, 'a manager saves a drawing linked to their own job');
select is(
  (select company_id from public.roof_measurements limit 1),
  '97000000-0000-4000-8000-00000000000a'::uuid,
  'the drawing lands in the saver''s company without naming it'
);
select is(
  (select created_by from public.roof_measurements limit 1),
  '97000000-0000-4000-8000-000000000101'::uuid,
  'the drawing records who saved it'
);
select throws_ok($$select pg_temp.drawing_insert('job-b')$$, '42501', null, 'a drawing cannot link to another company''s job');
select throws_ok(
  $$select pg_temp.drawing_insert(null, '97000000-0000-4000-8000-00000000000b')$$,
  '42501', null, 'a drawing cannot be written into another company'
);
select lives_ok(
  $$update public.roof_measurements set squares = 13.53, drawing = '{"version":1,"planes":[{}]}'$$,
  'a manager updates their company''s drawing'
);
select is((select squares from public.roof_measurements limit 1), 13.53::numeric, 'the update is kept');

reset role;

-- Company B admin sees nothing from A.
select set_config('request.jwt.claims', '{"sub":"97000000-0000-4000-8000-000000000103","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.roof_measurements), 0::bigint, 'another company cannot read the drawing');
delete from public.roof_measurements;
reset role;
select is((select count(*) from public.roof_measurements), 1::bigint, 'another company cannot delete the drawing');

-- Company A employee (below Manager).
select set_config('request.jwt.claims', '{"sub":"97000000-0000-4000-8000-000000000102","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.roof_measurements), 0::bigint, 'employees cannot read drawings');
select throws_ok($$select pg_temp.drawing_insert()$$, '42501', null, 'employees cannot save drawings');
reset role;

select * from finish();
rollback;

begin;

select plan(31);

-- Companies A (under test) and B (outsider).
insert into public.companies(id, name) values
  ('96000000-0000-4000-8000-00000000000a', 'Roles Company A'),
  ('96000000-0000-4000-8000-00000000000b', 'Roles Company B');

insert into auth.users(id, email) values
  ('96000000-0000-4000-8000-000000000101', 'admin@roles.test'),
  ('96000000-0000-4000-8000-000000000102', 'manager@roles.test'),
  ('96000000-0000-4000-8000-000000000103', 'employee@roles.test'),
  ('96000000-0000-4000-8000-000000000104', 'former@roles.test'),
  ('96000000-0000-4000-8000-000000000105', 'owner@roles.test'),
  ('96000000-0000-4000-8000-000000000106', 'outsider@roles.test'),
  ('96000000-0000-4000-8000-000000000107', 'unlinked@roles.test');

-- The documented path (a bare admin_profiles insert) still yields a full admin.
insert into public.admin_profiles(id, company_id, display_name)
values ('96000000-0000-4000-8000-000000000101', '96000000-0000-4000-8000-00000000000a', 'Company Admin');

select is(
  (select role from public.company_memberships
   where user_id = '96000000-0000-4000-8000-000000000101'),
  'company_admin',
  'a bare admin_profiles insert grants a company admin membership'
);

select is(
  public.grant_company_membership('MANAGER@roles.test', '96000000-0000-4000-8000-00000000000a', 'manager', 'Manager'),
  '96000000-0000-4000-8000-000000000102'::uuid,
  'provisioning resolves the login by case-insensitive email'
);

select public.grant_company_membership('employee@roles.test', '96000000-0000-4000-8000-00000000000a', 'employee', 'Employee');
select public.grant_company_membership('former@roles.test', '96000000-0000-4000-8000-00000000000a', 'manager', 'Former');
update public.company_memberships set is_active = false
where user_id = '96000000-0000-4000-8000-000000000104';

select is(
  (select role from public.company_memberships
   where user_id = '96000000-0000-4000-8000-000000000103'),
  'employee',
  'explicit provisioning is not widened by the admin_profiles trigger'
);

select is(
  (select company_id from public.admin_profiles where id = '96000000-0000-4000-8000-000000000103'),
  '96000000-0000-4000-8000-00000000000a'::uuid,
  'provisioning creates the active-company profile'
);

select throws_ok(
  $$select public.grant_company_membership('employee@roles.test', '96000000-0000-4000-8000-00000000000a', 'owner', 'X')$$,
  '22023', 'Unknown company role owner',
  'unknown roles are rejected'
);

select throws_ok(
  $$select public.grant_company_membership('nobody@roles.test', '96000000-0000-4000-8000-00000000000a', 'employee', 'X')$$,
  'P0002', 'No auth user exists for that email',
  'provisioning requires an existing login'
);

-- Platform owner: profile in company A with no membership, plus platform admin.
insert into public.platform_admins(user_id) values ('96000000-0000-4000-8000-000000000105');
insert into public.company_memberships(user_id, company_id, role)
values ('96000000-0000-4000-8000-000000000105', '96000000-0000-4000-8000-00000000000a', 'employee');
insert into public.admin_profiles(id, company_id, display_name)
values ('96000000-0000-4000-8000-000000000105', '96000000-0000-4000-8000-00000000000a', 'Owner');

select public.grant_company_membership('outsider@roles.test', '96000000-0000-4000-8000-00000000000b', 'company_admin', 'Outsider');

-- Company A data.
insert into public.properties(id, company_id, canonical_address) values
  ('96000000-0000-4000-8000-000000000201', '96000000-0000-4000-8000-00000000000a', '1 Roles Way, Newark, NJ 07102');
insert into public.leads(id, company_id, property_id, name, phone, email, submitted_address, source_system)
values (
  '96000000-0000-4000-8000-000000000301', '96000000-0000-4000-8000-00000000000a',
  '96000000-0000-4000-8000-000000000201', 'Roles Lead', '+12015550111', 'lead@roles.test',
  '1 Roles Way, Newark, NJ 07102', 'manual'
);

insert into public.jn_jobs(company_id, jnid, sales_rep_jnid, sales_rep_name, approved_total) values
  ('96000000-0000-4000-8000-00000000000a', 'job-employee', 'rep-employee', 'Employee Rep', 15000),
  ('96000000-0000-4000-8000-00000000000a', 'job-other', 'rep-other', 'Other Rep', 22000),
  ('96000000-0000-4000-8000-00000000000a', 'job-unassigned', null, null, 9000);
insert into public.jn_estimates(company_id, jnid, related_job_jnid) values
  ('96000000-0000-4000-8000-00000000000a', 'est-employee', 'job-employee'),
  ('96000000-0000-4000-8000-00000000000a', 'est-other', 'job-other');
insert into public.jobnimbus_sync_runs(company_id, record_type, mode)
values ('96000000-0000-4000-8000-00000000000a', 'job', 'full');

-- Rep discovery and linking.
select is(
  public.discover_jobnimbus_reps('96000000-0000-4000-8000-00000000000a'),
  2,
  'every distinct JobNimbus sales rep is recorded once'
);

update public.rep_identities set external_email = 'Employee@Roles.test'
where external_user_id = 'rep-employee';

select is(
  public.link_rep_identities_by_email('96000000-0000-4000-8000-00000000000a'),
  1,
  'an identity whose email matches an active member is linked'
);

select is(
  (select user_id from public.rep_identities where external_user_id = 'rep-employee'),
  '96000000-0000-4000-8000-000000000103'::uuid,
  'the rep is linked to the employee login'
);

select is(
  (select match_method from public.rep_identities where external_user_id = 'rep-other'),
  null::text,
  'reps without a matching email stay unlinked'
);

-- ---------------------------------------------------------------------------
-- Company admin
select set_config('request.jwt.claims', '{"sub":"96000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
set local role authenticated;

select is(public.current_company_role(), 'company_admin', 'company admin role resolves');
select is(public.current_company_id(), '96000000-0000-4000-8000-00000000000a'::uuid, 'company admins get CRM access');
select is((select count(*) from public.company_memberships), 5::bigint, 'company admins see every membership in their company');
select is((select count(*) from public.jobnimbus_sync_runs), 1::bigint, 'company admins see sync runs');

reset role;

-- ---------------------------------------------------------------------------
-- Manager
select set_config('request.jwt.claims', '{"sub":"96000000-0000-4000-8000-000000000102","role":"authenticated"}', true);
set local role authenticated;

select is(public.current_company_id(), '96000000-0000-4000-8000-00000000000a'::uuid, 'managers get CRM access');
select is((select count(*) from public.admin_profiles), 1::bigint, 'managers can load their own profile');
select is((select count(*) from public.leads), 1::bigint, 'managers see company leads');
select is((select count(*) from public.jn_jobs), 3::bigint, 'managers see every company JobNimbus job');
select is((select count(*) from public.jobnimbus_sync_runs), 0::bigint, 'managers do not see sync operations');
select is((select count(*) from public.company_memberships), 1::bigint, 'managers see only their own membership');

reset role;

-- ---------------------------------------------------------------------------
-- Employee
select set_config('request.jwt.claims', '{"sub":"96000000-0000-4000-8000-000000000103","role":"authenticated"}', true);
set local role authenticated;

select is(public.current_company_id(), null::uuid, 'employees get no CRM company');
select is((select count(*) from public.admin_profiles), 0::bigint, 'employees fail the server-action profile check');
select is((select count(*) from public.leads), 0::bigint, 'employees cannot read company leads');
select is(
  (select array_agg(jnid order by jnid) from public.jn_jobs),
  array['job-employee'],
  'employees see only JobNimbus jobs assigned to them'
);
select is(
  (select array_agg(jnid order by jnid) from public.jn_estimates),
  array['est-employee'],
  'employees see only estimates on their jobs'
);
select is(
  (select role from public.get_my_access()),
  'employee',
  'the app shell can still identify an employee'
);

select throws_ok(
  $$select public.grant_company_membership('unlinked@roles.test', '96000000-0000-4000-8000-00000000000a', 'company_admin', 'X')$$,
  '42501', null,
  'members cannot provision memberships'
);

reset role;

-- ---------------------------------------------------------------------------
-- Deactivated member
select set_config('request.jwt.claims', '{"sub":"96000000-0000-4000-8000-000000000104","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*) from public.get_my_access()), 0::bigint, 'a deactivated member has no access');

reset role;

-- ---------------------------------------------------------------------------
-- Platform owner (employee membership, but platform admin)
select set_config('request.jwt.claims', '{"sub":"96000000-0000-4000-8000-000000000105","role":"authenticated"}', true);
set local role authenticated;

select is(public.current_company_role(), 'super_admin', 'platform admins resolve as super admin');
select is((select count(*) from public.jobnimbus_sync_runs), 1::bigint, 'super admins see company operations');

reset role;

-- ---------------------------------------------------------------------------
-- Admin of another company
select set_config('request.jwt.claims', '{"sub":"96000000-0000-4000-8000-000000000106","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*) from public.jn_jobs), 0::bigint, 'another company''s admin sees none of company A''s jobs');

reset role;

select * from finish();

rollback;

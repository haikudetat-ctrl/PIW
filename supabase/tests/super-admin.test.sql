begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

select is(has_function_privilege('anon', 'public.switch_active_company(uuid)', 'execute'), false, 'anon cannot switch companies');
select is(has_function_privilege('anon', 'public.platform_health()', 'execute'), false, 'anon cannot read platform health');

insert into public.companies(id, name) values
  ('95000000-0000-4000-8000-000000000001', 'Alpha Roofing'),
  ('95000000-0000-4000-8000-000000000002', 'Beta Roofing');
insert into auth.users(id, email) values
  ('95000000-0000-4000-8000-000000000101', 'super@example.com'),
  ('95000000-0000-4000-8000-000000000102', 'alpha-admin@example.com'),
  ('95000000-0000-4000-8000-000000000103', 'alpha-manager@example.com'),
  ('95000000-0000-4000-8000-000000000104', 'alpha-employee@example.com');
insert into public.platform_admins(user_id) values ('95000000-0000-4000-8000-000000000101');
-- The super admin's profile sits in Alpha (which also makes them an Alpha
-- company admin) and has no membership in Beta.
insert into public.admin_profiles(id, company_id, display_name) values
  ('95000000-0000-4000-8000-000000000101', '95000000-0000-4000-8000-000000000001', 'Super'),
  ('95000000-0000-4000-8000-000000000102', '95000000-0000-4000-8000-000000000001', 'Alpha Admin');
select public.grant_company_membership('alpha-manager@example.com', '95000000-0000-4000-8000-000000000001', 'manager', 'Alpha Manager');
select public.grant_company_membership('alpha-employee@example.com', '95000000-0000-4000-8000-000000000001', 'employee', 'Alpha Employee');

-- Company admin ------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"95000000-0000-4000-8000-000000000102","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select string_agg(name, ',') from public.list_my_companies()),
  'Alpha Roofing', 'a company admin can switch only to their own companies'
);
select throws_ok(
  $$select public.switch_active_company('95000000-0000-4000-8000-000000000002')$$,
  '42501', 'Not a member of that company', 'a company admin cannot switch into another company'
);
select throws_ok(
  $$select public.create_company('Gamma Roofing', '')$$,
  '42501', 'Only a super admin can create companies', 'a company admin cannot create companies'
);
select throws_ok(
  $$select public.platform_health()$$,
  '42501', 'Only a super admin can see platform health', 'a company admin cannot read platform health'
);
select is(
  (select string_agg(email || ':' || role, ',' order by email) from public.list_company_members()),
  'alpha-admin@example.com:company_admin,alpha-employee@example.com:employee,alpha-manager@example.com:manager,super@example.com:company_admin',
  'a company admin sees their company''s members'
);
select lives_ok(
  $$select public.update_company_member('95000000-0000-4000-8000-000000000104', 'manager', true)$$,
  'a company admin can change a member''s role'
);
select lives_ok(
  $$select public.update_company_member('95000000-0000-4000-8000-000000000103', 'manager', false)$$,
  'a company admin can deactivate a member'
);
select throws_ok(
  $$select public.update_company_member('95000000-0000-4000-8000-000000000102', 'employee', true)$$,
  '42501', 'You cannot change your own role or access', 'nobody can demote themselves'
);
select throws_ok(
  $$select public.update_company_member('95000000-0000-4000-8000-000000000999', 'employee', true)$$,
  'P0002', 'That person is not a member of this company', 'a non-member cannot be changed'
);
reset role;

select is(
  (select role || ':' || is_active from public.company_memberships where user_id = '95000000-0000-4000-8000-000000000103'),
  'manager:false', 'deactivation is recorded'
);

-- Manager ------------------------------------------------------------------
update public.company_memberships set is_active = true where user_id = '95000000-0000-4000-8000-000000000103';
select set_config('request.jwt.claims', '{"sub":"95000000-0000-4000-8000-000000000103","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.list_company_members()), 0::bigint, 'a manager cannot list the team');
select throws_ok(
  $$select public.update_company_member('95000000-0000-4000-8000-000000000104', 'employee', true)$$,
  '42501', 'Only a company admin can change roles', 'a manager cannot change roles'
);
reset role;

-- Super admin --------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"95000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select string_agg(name || ':' || is_current, ',' order by name) from public.list_my_companies()
   where name in ('Alpha Roofing', 'Beta Roofing')),
  'Alpha Roofing:true,Beta Roofing:false', 'a super admin can switch to every company'
);
select lives_ok(
  $$select public.switch_active_company('95000000-0000-4000-8000-000000000002')$$,
  'a super admin can switch into a company without a membership'
);
select is(public.current_company_id(), '95000000-0000-4000-8000-000000000002'::uuid, 'company-scoped access follows the switch');

select isnt(public.create_company('Gamma Roofing', 'JOBNIMBUS_API_KEY_GAMMA'), null, 'a super admin can create a company');
reset role;
select is(
  (select company.name || ':' || integration.env_key_name || ':' || integration.enabled
   from public.companies as company
   join public.company_integrations as integration on integration.company_id = company.id
   where company.name = 'Gamma Roofing'),
  'Gamma Roofing:JOBNIMBUS_API_KEY_GAMMA:false',
  'a super admin creates a company with its JobNimbus sync off'
);
set local role authenticated;

select is(
  (select count(*) from jsonb_array_elements(public.platform_health()) as company
   where company ->> 'name' in ('Alpha Roofing', 'Beta Roofing', 'Gamma Roofing')),
  3::bigint, 'platform health covers every company'
);
select is(
  (select company ->> 'members' from jsonb_array_elements(public.platform_health()) as company where company ->> 'name' = 'Alpha Roofing'),
  '4', 'platform health counts active members'
);

reset role;

select * from finish();
rollback;

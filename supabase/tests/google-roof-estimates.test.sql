begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

select has_table('public', 'lead_consents', 'lead_consents exists');
select has_table('public', 'provider_usage_monthly', 'provider usage counter exists');
select has_table('public', 'roof_insights', 'Google roof insight cache exists');
select has_table('public', 'roof_estimates', 'roof estimates exists');
select has_table('public', 'estimate_deliveries', 'estimate deliveries exists');
select has_column(
  'public', 'roof_estimates', 'reused_from_estimate_id',
  'roof estimate quote reuse records its source estimate'
);
select has_index(
  'public', 'roof_estimates', 'roof_estimates_reusable_quote_idx',
  'ready quotes have a property reuse lookup index'
);

select has_function(
  'public', 'reserve_provider_usage', array['text', 'date', 'integer'],
  'atomic provider quota reservation exists'
);
select has_function(
  'public', 'submit_roof_estimate_lead',
  array['uuid','text','text','text','text','text','text','text','uuid','integer','text'],
  'consented public estimate submission function exists'
);

select is((select relrowsecurity from pg_class where oid = 'public.lead_consents'::regclass), true, 'lead consents uses RLS');
select is((select relrowsecurity from pg_class where oid = 'public.provider_usage_monthly'::regclass), true, 'provider usage uses RLS');
select is((select relrowsecurity from pg_class where oid = 'public.roof_insights'::regclass), true, 'roof insights uses RLS');
select is((select relrowsecurity from pg_class where oid = 'public.roof_estimates'::regclass), true, 'roof estimates uses RLS');
select is((select relrowsecurity from pg_class where oid = 'public.estimate_deliveries'::regclass), true, 'estimate deliveries uses RLS');

select is(has_table_privilege('anon', 'public.lead_consents', 'select'), false, 'anon cannot read consent records');
select is(has_table_privilege('anon', 'public.provider_usage_monthly', 'select'), false, 'anon cannot inspect quota counters');
select is(has_table_privilege('anon', 'public.roof_insights', 'select'), false, 'anon cannot read provider responses');
select is(has_table_privilege('anon', 'public.roof_estimates', 'select'), false, 'anon cannot enumerate estimates');
select is(has_table_privilege('anon', 'public.estimate_deliveries', 'select'), false, 'anon cannot read delivery destinations');

select function_privs_are(
  'public', 'reserve_provider_usage', array['text','date','integer'],
  'anon', array[]::text[], 'anon cannot reserve paid provider usage'
);
select function_privs_are(
  'public', 'submit_roof_estimate_lead',
  array['uuid','text','text','text','text','text','text','text','uuid','integer','text'],
  'authenticated', array[]::text[], 'authenticated clients cannot bypass the server submission gate'
);
select function_privs_are(
  'public', 'submit_roof_estimate_lead',
  array['uuid','text','text','text','text','text','text','text','uuid','integer','text'],
  'service_role', array['EXECUTE'], 'service role owns estimate submission'
);

select is((select allowed from public.reserve_provider_usage('google_solar_building_insights', date '2026-07-01', 2)), true, 'first reserved Solar call is allowed');
select is((select allowed from public.reserve_provider_usage('google_solar_building_insights', date '2026-07-01', 2)), true, 'last call within the cap is allowed');
select is((select allowed from public.reserve_provider_usage('google_solar_building_insights', date '2026-07-01', 2)), false, 'call beyond the cap is blocked');

insert into public.companies (id, name)
values ('90000000-0000-4000-8000-000000000001', 'Google Estimate Test Company');

create temp table submitted_estimate as
select * from public.submit_roof_estimate_lead(
  '90000000-0000-4000-8000-000000000001',
  'Taylor Homeowner', '+16095550100', 'taylor@example.com',
  '12 Birch Street, Trenton, NJ 08608', 'roof-estimate-v1',
  '127.0.0.1', 'pgtap', '90000000-0000-4000-8000-000000000002', 2
);

select is(
  (select count(*) from public.lead_consents where lead_id = (select lead_id from submitted_estimate)),
  3::bigint,
  'submission records processing, email, and SMS consent'
);
select is(
  (select status from public.roof_estimates where id = (select estimate_id from submitted_estimate)),
  'pending',
  'submission starts one pending estimate'
);
select is(
  (select count(*) from public.pipeline_runs where id = (select pipeline_run_id from submitted_estimate)),
  1::bigint,
  'submission starts the property intelligence pipeline'
);

select * from finish();
rollback;

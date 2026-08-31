begin;

create extension if not exists pgtap with schema extensions;

select plan(34);

select has_table('public', 'roof_pricing_rate_cards', 'versioned roof pricing rate cards exist');
select has_table('public', 'roof_pricing_tiers', 'roof pricing tiers exist');
select has_table('public', 'roof_pricing_adjustments', 'roof pricing adjustment disclosures exist');
select has_table('public', 'roof_estimate_packages', 'immutable estimate package snapshots exist');

select has_function(
  'public', 'activate_roof_pricing_rate_card', array['uuid','uuid'],
  'service activation boundary exists'
);
select has_function(
  'public', 'finalize_roof_estimate_packages', array['uuid','uuid','uuid'],
  'atomic package finalization boundary exists'
);
select has_function(
  'public', 'reuse_roof_estimate_packages', array['uuid','uuid','uuid'],
  'atomic package reuse boundary exists'
);

select is((select relrowsecurity from pg_class where oid='public.roof_pricing_rate_cards'::regclass), true, 'rate cards use RLS');
select is((select relrowsecurity from pg_class where oid='public.roof_pricing_tiers'::regclass), true, 'tiers use RLS');
select is((select relrowsecurity from pg_class where oid='public.roof_pricing_adjustments'::regclass), true, 'adjustments use RLS');
select is((select relrowsecurity from pg_class where oid='public.roof_estimate_packages'::regclass), true, 'package snapshots use RLS');

select is(has_table_privilege('anon','public.roof_pricing_rate_cards','select'), false, 'anon cannot enumerate rate cards');
select is(has_table_privilege('anon','public.roof_estimate_packages','select'), false, 'anon cannot enumerate package snapshots');
select is(has_table_privilege('authenticated','public.roof_pricing_rate_cards','insert'), false, 'authenticated users cannot create rate cards');
select is(has_table_privilege('authenticated','public.roof_estimate_packages','update'), false, 'authenticated users cannot mutate package snapshots');

select function_privs_are(
  'public', 'activate_roof_pricing_rate_card', array['uuid','uuid'],
  'anon', array[]::text[], 'anon cannot activate pricing'
);
select function_privs_are(
  'public', 'activate_roof_pricing_rate_card', array['uuid','uuid'],
  'service_role', array['EXECUTE'], 'service role can activate pricing'
);
select function_privs_are(
  'public', 'finalize_roof_estimate_packages', array['uuid','uuid','uuid'],
  'anon', array[]::text[], 'anon cannot finalize estimates'
);
select function_privs_are(
  'public', 'finalize_roof_estimate_packages', array['uuid','uuid','uuid'],
  'service_role', array['EXECUTE'], 'service role can finalize estimates'
);
select function_privs_are(
  'public', 'reuse_roof_estimate_packages', array['uuid','uuid','uuid'],
  'anon', array[]::text[], 'anon cannot reuse estimates'
);
select function_privs_are(
  'public', 'reuse_roof_estimate_packages', array['uuid','uuid','uuid'],
  'service_role', array['EXECUTE'], 'service role can reuse estimates'
);

select is(
  (select count(*) from pg_policies where schemaname='public' and tablename in (
    'roof_pricing_rate_cards','roof_pricing_tiers','roof_pricing_adjustments','roof_estimate_packages'
  ) and roles = array['authenticated']::name[]),
  4::bigint,
  'each pricing table has one tenant-scoped authenticated read policy'
);

insert into public.companies(id, name) values
  ('91000000-0000-4000-8000-000000000001', 'Roof Pricing Test Company'),
  ('91000000-0000-4000-8000-000000000002', 'Other Roof Pricing Company');
insert into public.properties(id, company_id, canonical_address, resolution_status) values
  ('91000000-0000-4000-8000-000000000011', '91000000-0000-4000-8000-000000000001', '25 Pricing Way, Trenton, NJ', 'resolved'),
  ('91000000-0000-4000-8000-000000000012', '91000000-0000-4000-8000-000000000002', '1 Other Way, Trenton, NJ', 'resolved');
insert into public.leads(id, company_id, property_id, name, phone, email, submitted_address) values
  ('91000000-0000-4000-8000-000000000021', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011', 'Pricing Lead', '+16095550101', 'pricing@example.com', '25 Pricing Way, Trenton, NJ'),
  ('91000000-0000-4000-8000-000000000022', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011', 'Reuse Lead', '+16095550102', 'reuse@example.com', '25 Pricing Way, Trenton, NJ');
insert into public.roof_estimates(id, company_id, lead_id, property_id) values
  ('91000000-0000-4000-8000-000000000031', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000021', '91000000-0000-4000-8000-000000000011'),
  ('91000000-0000-4000-8000-000000000032', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000022', '91000000-0000-4000-8000-000000000011');
insert into public.roof_insights(id, company_id, property_id, provider, normalized_address, lookup_status, total_roof_sqft) values
  ('91000000-0000-4000-8000-000000000041', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011', 'google_solar', '25 pricing way trenton nj', 'success', 2500),
  ('91000000-0000-4000-8000-000000000042', '91000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000012', 'google_solar', '1 other way trenton nj', 'success', 1800);

insert into public.roof_pricing_rate_cards(id, company_id, version, name, market, effective_from) values
  ('91000000-0000-4000-8000-000000000051', '91000000-0000-4000-8000-000000000001', 'incomplete-v1', 'Incomplete', 'NJ', '2026-01-01'),
  ('91000000-0000-4000-8000-000000000052', '91000000-0000-4000-8000-000000000001', 'all-season-nj-2026-v1', 'Launch', 'NJ', '2026-01-01');

select throws_ok(
  $$select public.activate_roof_pricing_rate_card('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000051')$$,
  'Roof pricing rate card requires ordered Good, Better, and Best tiers',
  'activation rejects an incomplete tier set'
);

insert into public.roof_pricing_tiers(
  company_id, rate_card_id, tier_key, display_order, internal_scope_code,
  customer_name, customer_description, warranty_summary, differentiators,
  low_cents_per_square, high_cents_per_square
) values
  ('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000052','good',1,'complete_v1','Complete System','Dependable complete roofing system.','Enhanced manufacturer protection.','["Architectural finish"]',80000,97500),
  ('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000052','better',2,'recommended_v1','Recommended','Upgraded protection and appearance.','Extended material and workmanship coverage.','["Upgraded material weight"]',95000,120000),
  ('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000052','best',3,'signature_v1','Signature System','Premium finish and protection.','Extended workmanship coverage.','["Impact protection"]',125000,165000);
insert into public.roof_pricing_adjustments(
  company_id, rate_card_id, adjustment_code, customer_label, customer_explanation,
  calculation_kind, low_value, high_value, display_order
)
select '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000052',
  'adjustment-' || value, 'Adjustment ' || value, 'Confirmed after field inspection.',
  'flat', 100, 200, value
from generate_series(1, 7) value;

select lives_ok(
  $$select public.activate_roof_pricing_rate_card('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000052')$$,
  'a complete ordered card activates'
);
select is(
  (select count(*) from public.finalize_roof_estimate_packages(
    '91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000031','91000000-0000-4000-8000-000000000041'
  )), 3::bigint, 'finalization atomically creates three package snapshots'
);
select is(
  (select string_agg(range_low_cents::text || ':' || range_high_cents::text, ',' order by display_order)
   from public.roof_estimate_packages where estimate_id='91000000-0000-4000-8000-000000000031'),
  '2000000:2437500,2375000:3000000,3125000:4125000',
  '25 measured squares produce the approved Good Better Best bands'
);
select is(
  (select range_low_cents::text || ':' || range_high_cents::text from public.roof_estimates where id='91000000-0000-4000-8000-000000000031'),
  '2375000:3000000', 'Better is the legacy compatibility projection'
);
select is(
  jsonb_array_length((select assumptions->'adjustmentDisclosures' from public.roof_estimates where id='91000000-0000-4000-8000-000000000031')),
  7, 'finalization snapshots every unapplied adjustment disclosure'
);
select is(
  (select count(*) from public.finalize_roof_estimate_packages(
    '91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000031','91000000-0000-4000-8000-000000000041'
  )), 3::bigint, 'a retry returns the original complete snapshot'
);
select throws_ok(
  $$update public.roof_estimate_packages set range_low_cents=1 where estimate_id='91000000-0000-4000-8000-000000000031'$$,
  'Roof estimate package snapshots are immutable',
  'persisted package snapshots cannot be rewritten'
);
select throws_ok(
  $$select * from public.finalize_roof_estimate_packages('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000031','91000000-0000-4000-8000-000000000042')$$,
  'Trusted Google roof geometry is required',
  'cross-tenant geometry is rejected'
);
select is(
  (select count(*) from public.reuse_roof_estimate_packages(
    '91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000032','91000000-0000-4000-8000-000000000031'
  )), 3::bigint, 'reuse clones the original three package snapshots'
);
select is(
  (select range_low_cents::text || ':' || range_high_cents::text from public.roof_estimates where id='91000000-0000-4000-8000-000000000032'),
  '2375000:3000000', 'reused estimate retains the original Better projection'
);
select is(
  (select pricing_version from public.roof_estimates where id='91000000-0000-4000-8000-000000000032'),
  'all-season-nj-2026-v1', 'reused estimate retains the original pricing version'
);

select * from finish();
rollback;

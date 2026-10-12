begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

select has_table('public', 'catalog_manufacturers', 'catalog manufacturers exist');
select has_table('public', 'catalog_product_lines', 'catalog product lines exist');
select has_table('public', 'catalog_products', 'catalog purchase units exist');
select has_table('public', 'catalog_system_components', 'system bills of materials exist');
select has_table('public', 'company_catalog_prices', 'company-scoped distributor prices exist');

select is(
  (select bool_and(relrowsecurity) from pg_class where oid in (
    'public.catalog_manufacturers'::regclass, 'public.catalog_product_lines'::regclass,
    'public.catalog_products'::regclass, 'public.catalog_system_components'::regclass,
    'public.company_catalog_prices'::regclass
  )),
  true, 'every catalog table uses RLS'
);
select is(has_table_privilege('anon','public.catalog_product_lines','select'), false, 'anon cannot read the catalog');
select is(has_table_privilege('authenticated','public.catalog_product_lines','insert'), false, 'signed-in users cannot edit the catalog');
select is(has_table_privilege('authenticated','public.company_catalog_prices','insert'), false, 'signed-in users cannot write prices');

select is(
  (select string_agg(l.code, ',' order by l.code)
   from public.catalog_product_lines l
   join public.catalog_manufacturers m on m.id = l.manufacturer_id
   where m.code = 'certainteed' and l.category = 'shingle'),
  'landmark,landmark_climateflex,landmark_pro,patriot,xt25',
  'CertainTeed shingle lines are seeded'
);
select is(
  (select string_agg(c.code, ',' order by sc.display_order)
   from public.catalog_system_components sc
   join public.catalog_product_lines s on s.id = sc.system_line_id
   join public.catalog_product_lines c on c.id = sc.component_line_id
   where s.code = 'landmark'),
  'swiftstart,shadow_ridge,winterguard_granular,diamonddeck,ridge_vent',
  'Landmark carries the Integrity Roof System bill of materials'
);
select is(
  (select count(*) from public.catalog_system_components sc
   join public.catalog_product_lines c on c.id = sc.component_line_id
   where c.category = 'ventilation' and sc.required_for_warranty),
  0::bigint, 'ridge vent is recommended, not warranty-required'
);
select is(
  (select coverage_quantity::text || ' ' || coverage_unit from public.catalog_products p
   join public.catalog_product_lines l on l.id = p.product_line_id where l.code = 'swiftstart'),
  '116.0000 linear_ft', 'starter coverage is stored per bundle'
);

insert into public.companies(id, name) values
  ('92000000-0000-4000-8000-000000000001', 'Catalog Test Company');
insert into public.properties(id, company_id, canonical_address, resolution_status) values
  ('92000000-0000-4000-8000-000000000011', '92000000-0000-4000-8000-000000000001', '5 Catalog Way, Trenton, NJ', 'resolved');
insert into public.leads(id, company_id, property_id, name, phone, email, submitted_address) values
  ('92000000-0000-4000-8000-000000000021', '92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000011', 'Catalog Lead', '+16095550111', 'catalog@example.com', '5 Catalog Way, Trenton, NJ'),
  ('92000000-0000-4000-8000-000000000022', '92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000011', 'Catalog Reuse', '+16095550112', 'catalog-reuse@example.com', '5 Catalog Way, Trenton, NJ');
insert into public.roof_estimates(id, company_id, lead_id, property_id) values
  ('92000000-0000-4000-8000-000000000031', '92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000021', '92000000-0000-4000-8000-000000000011'),
  ('92000000-0000-4000-8000-000000000032', '92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000022', '92000000-0000-4000-8000-000000000011');
insert into public.roof_insights(id, company_id, property_id, provider, normalized_address, lookup_status, total_roof_sqft) values
  ('92000000-0000-4000-8000-000000000041', '92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000011', 'google_solar', '5 catalog way trenton nj', 'success', 2000);
insert into public.roof_pricing_rate_cards(id, company_id, version, name, market, effective_from) values
  ('92000000-0000-4000-8000-000000000051', '92000000-0000-4000-8000-000000000001', 'catalog-v1', 'Catalog', 'NJ', '2026-01-01');

select throws_ok(
  $$insert into public.roof_pricing_tiers(
      company_id, rate_card_id, tier_key, display_order, internal_scope_code,
      customer_name, customer_description, warranty_summary, differentiators,
      low_cents_per_square, high_cents_per_square, product_line_id)
    select '92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000051','good',1,'x',
      'Bad','Bad.','Bad.','["Bad"]',80000,97500, id
    from public.catalog_product_lines where code = 'swiftstart'$$,
  'Pricing tiers must point at an active shingle product line',
  'a tier cannot point at an accessory line'
);

insert into public.roof_pricing_tiers(
  company_id, rate_card_id, tier_key, display_order, internal_scope_code,
  customer_name, customer_description, warranty_summary, differentiators,
  low_cents_per_square, high_cents_per_square, product_line_id
)
select '92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000051', v.tier_key, v.display_order, v.code || '_v1',
  v.name, 'Description.', 'Warranty.', '["Feature"]', v.low, v.high, l.id
from (values
  ('good', 1, 'patriot', 'CertainTeed Patriot', 80000, 97500),
  ('better', 2, 'landmark', 'CertainTeed Landmark', 95000, 120000),
  ('best', 3, 'landmark_pro', 'CertainTeed Landmark PRO', 125000, 165000)
) as v(tier_key, display_order, code, name, low, high)
join public.catalog_product_lines l on l.code = v.code;

select lives_ok(
  $$select public.activate_roof_pricing_rate_card('92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000051')$$,
  'a catalog-linked card activates'
);
select is(
  (select count(*) from public.finalize_roof_estimate_packages(
    '92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000031','92000000-0000-4000-8000-000000000041'
  )), 3::bigint, 'finalization still writes three packages'
);
select is(
  (select string_agg(manufacturer_name || ' ' || product_line_name, ',' order by display_order)
   from public.roof_estimate_packages where estimate_id = '92000000-0000-4000-8000-000000000031'),
  'CertainTeed Patriot,CertainTeed Landmark,CertainTeed Landmark PRO',
  'finalized packages snapshot the manufacturer and line'
);

-- Re-pointing a tier later must not rewrite a snapshot already sent.
update public.roof_pricing_tiers set product_line_id = (select id from public.catalog_product_lines where code = 'landmark_climateflex')
where rate_card_id = '92000000-0000-4000-8000-000000000051' and tier_key = 'best';
select is(
  (select product_line_name from public.roof_estimate_packages
   where estimate_id = '92000000-0000-4000-8000-000000000031' and tier_key = 'best'),
  'Landmark PRO', 'existing snapshots keep the line they were sent with'
);
select is(
  (select count(*) from public.reuse_roof_estimate_packages(
    '92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000032','92000000-0000-4000-8000-000000000031'
  )), 3::bigint, 'reuse still clones three packages'
);
select is(
  (select string_agg(product_line_name, ',' order by display_order)
   from public.roof_estimate_packages where estimate_id = '92000000-0000-4000-8000-000000000032'),
  'Patriot,Landmark,Landmark PRO',
  'reuse copies the source snapshot, not the re-pointed tier'
);
select throws_ok(
  $$insert into public.roof_estimate_packages(
      company_id, estimate_id, rate_card_id, tier_key, display_order, measured_roof_squares,
      low_cents_per_square, high_cents_per_square, range_low_cents, range_high_cents,
      customer_name, customer_description, warranty_summary, differentiators, pricing_version,
      product_line_id, manufacturer_name, product_line_name)
    select company_id, '92000000-0000-4000-8000-000000000031', rate_card_id, 'good', 9, 1, 1, 1, 1, 1,
      'x', 'x', 'x', '["x"]', 'x', id, null, null
    from public.roof_estimate_packages, public.catalog_product_lines
    where estimate_id = '92000000-0000-4000-8000-000000000031' and tier_key = 'good' and code = 'patriot'$$,
  '23514', null, 'a package cannot carry a line id without its names'
);

insert into public.company_catalog_prices(company_id, product_id, supplier, unit_cost_cents, effective_from, source)
select '92000000-0000-4000-8000-000000000001', p.id, 'SRS', 4200, '2026-10-01', 'test sheet'
from public.catalog_products p join public.catalog_product_lines l on l.id = p.product_line_id where l.code = 'landmark';
select throws_ok(
  $$insert into public.company_catalog_prices(company_id, product_id, supplier, unit_cost_cents, effective_from, source)
    select '92000000-0000-4000-8000-000000000001', p.id, 'SRS', 4300, '2026-11-01', 'overlap'
    from public.catalog_products p join public.catalog_product_lines l on l.id = p.product_line_id where l.code = 'landmark'$$,
  '23P01', null, 'one supplier price per product per date'
);
select lives_ok(
  $$insert into public.company_catalog_prices(company_id, product_id, supplier, unit_cost_cents, effective_from, source)
    select '92000000-0000-4000-8000-000000000001', p.id, 'ABC Supply', 4300, '2026-11-01', 'second supplier'
    from public.catalog_products p join public.catalog_product_lines l on l.id = p.product_line_id where l.code = 'landmark'$$,
  'a second supplier may price the same product'
);
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename like 'catalog_%'),
  4::bigint, 'each global catalog table has one read policy'
);

select * from finish();
rollback;

-- Manufacturer product catalog.
--
-- The catalog is global reference data: what a manufacturer sells, how much a
-- unit covers, and which components make up a warranted roof system. It holds
-- no prices. Distributor costs are company-scoped (company_catalog_prices)
-- because two contractors buying the same SKU pay different amounts.
--
-- Pricing tiers point at a shingle line, and every estimate package snapshots
-- the manufacturer and line names when it is written, so a sent estimate keeps
-- reading "CertainTeed Landmark" even if the tier is later re-pointed.
--
-- Seed figures were compiled 2026-10-12 from manufacturer data sheets and
-- distributor listings. Each line carries verified_on and source notes; confirm
-- coverage and warranty terms against the current CertainTeed documents and
-- the distributor price sheet before using them for material orders.

create table public.catalog_manufacturers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]+$'),
  name text not null check (length(trim(name)) > 0),
  website text,
  created_at timestamptz not null default now()
);

create table public.catalog_product_lines (
  id uuid primary key default gen_random_uuid(),
  manufacturer_id uuid not null references public.catalog_manufacturers(id),
  code text not null check (code ~ '^[a-z0-9_]+$'),
  name text not null check (length(trim(name)) > 0),
  category text not null check (category in (
    'shingle', 'starter', 'hip_ridge', 'ice_water', 'underlayment',
    'ventilation', 'low_slope', 'solar', 'accessory'
  )),
  market_tier text check (market_tier in ('economy', 'standard', 'premium', 'luxury')),
  status text not null default 'active' check (status in ('active', 'discontinued')),
  description text not null check (length(trim(description)) > 0),
  -- Physical and rating facts, e.g. weight, exposure, wind, fire, impact.
  specs jsonb not null default '{}'::jsonb check (jsonb_typeof(specs) = 'object'),
  -- Warranty facts as published, e.g. material, surestart_years, algae_years.
  warranty jsonb not null default '{}'::jsonb check (jsonb_typeof(warranty) = 'object'),
  source_notes text not null check (length(trim(source_notes)) > 0),
  verified_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (manufacturer_id, code)
);

create table public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  product_line_id uuid not null references public.catalog_product_lines(id) on delete cascade,
  -- Distributor or manufacturer SKU. Null until a price sheet supplies one.
  sku text,
  -- Colour or variant; null for single-variant products such as underlayment.
  variant text,
  purchase_unit text not null check (purchase_unit in ('bundle', 'roll', 'piece', 'box', 'each')),
  coverage_quantity numeric(12, 4) not null check (coverage_quantity > 0),
  coverage_unit text not null check (coverage_unit in ('square', 'sq_ft', 'linear_ft', 'each')),
  status text not null default 'active' check (status in ('active', 'discontinued')),
  created_at timestamptz not null default now(),
  unique nulls not distinct (product_line_id, variant)
);

-- Bill of materials for a warranted system: which component lines accompany a
-- shingle line, and which roof measurement drives each quantity.
create table public.catalog_system_components (
  id uuid primary key default gen_random_uuid(),
  system_line_id uuid not null references public.catalog_product_lines(id) on delete cascade,
  component_line_id uuid not null references public.catalog_product_lines(id),
  quantity_basis text not null check (quantity_basis in (
    'roof_squares', 'eave_lf', 'rake_lf', 'eave_and_rake_lf', 'ridge_lf',
    'hip_and_ridge_lf', 'valley_lf', 'eave_and_valley_sq_ft'
  )),
  required_for_warranty boolean not null,
  display_order smallint not null check (display_order > 0),
  notes text,
  unique (system_line_id, component_line_id),
  unique (system_line_id, display_order),
  check (system_line_id <> component_line_id)
);

create table public.company_catalog_prices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.catalog_products(id),
  supplier text not null check (length(trim(supplier)) > 0),
  unit_cost_cents integer not null check (unit_cost_cents > 0),
  effective_from date not null,
  effective_until date,
  source text not null check (length(trim(source)) > 0),
  created_at timestamptz not null default now(),
  check (effective_until is null or effective_until > effective_from),
  exclude using gist (
    company_id with =,
    product_id with =,
    supplier with =,
    daterange(effective_from, effective_until, '[)') with &&
  )
);

create index catalog_product_lines_category_idx
  on public.catalog_product_lines(manufacturer_id, category) where status = 'active';
create index catalog_products_line_idx on public.catalog_products(product_line_id);
create index catalog_system_components_system_idx
  on public.catalog_system_components(system_line_id, display_order);
create index company_catalog_prices_company_product_idx
  on public.company_catalog_prices(company_id, product_id, effective_from desc);

-- Tiers point at the shingle line they sell; packages snapshot its names.
alter table public.roof_pricing_tiers
  add column product_line_id uuid references public.catalog_product_lines(id);

alter table public.roof_estimate_packages
  add column product_line_id uuid references public.catalog_product_lines(id),
  add column manufacturer_name text,
  add column product_line_name text,
  add constraint roof_estimate_packages_product_snapshot_check check (
    (product_line_id is null and manufacturer_name is null and product_line_name is null)
    or (product_line_id is not null and manufacturer_name is not null and product_line_name is not null)
  );

create or replace function public.require_catalog_shingle_line()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.product_line_id is not null and not exists (
    select 1 from public.catalog_product_lines
    where id = new.product_line_id and category = 'shingle' and status = 'active'
  ) then
    raise exception 'Pricing tiers must point at an active shingle product line';
  end if;
  return new;
end;
$$;

create trigger require_catalog_shingle_line
before insert or update of product_line_id on public.roof_pricing_tiers
for each row execute function public.require_catalog_shingle_line();

-- Both package writers now carry the product snapshot. Finalize reads it from
-- the tier; reuse copies the source package's snapshot verbatim, so a reused
-- quote names the same product as the one it was cloned from even if the tier
-- has since been re-pointed. Bodies are otherwise unchanged from
-- 20260831162433_roof_pricing_packages.sql; create or replace keeps grants.
create or replace function public.finalize_roof_estimate_packages(
  p_company_id uuid,
  p_estimate_id uuid,
  p_roof_insight_id uuid
) returns setof public.roof_estimate_packages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_estimate public.roof_estimates%rowtype;
  v_insight public.roof_insights%rowtype;
  v_card public.roof_pricing_rate_cards%rowtype;
  v_roof_squares numeric(12, 4);
  v_better public.roof_estimate_packages%rowtype;
  v_adjustments jsonb;
begin
  select * into v_estimate
  from public.roof_estimates
  where company_id = p_company_id and id = p_estimate_id
  for update;

  if not found then raise exception 'Roof estimate not found'; end if;

  select * into v_insight
  from public.roof_insights
  where company_id=p_company_id
    and id=p_roof_insight_id
    and property_id=v_estimate.property_id
    and provider='google_solar'
    and lookup_status='success'
    and total_roof_sqft > 0;

  if not found then raise exception 'Trusted Google roof geometry is required'; end if;

  if (select count(*) from public.roof_estimate_packages
      where company_id=p_company_id and estimate_id=p_estimate_id) = 3 then
    return query select * from public.roof_estimate_packages
      where company_id=p_company_id and estimate_id=p_estimate_id order by display_order;
    return;
  end if;

  if exists (select 1 from public.roof_estimate_packages where company_id=p_company_id and estimate_id=p_estimate_id) then
    raise exception 'Roof estimate has an incomplete package snapshot';
  end if;

  v_roof_squares := round((v_insight.total_roof_sqft / 100.0)::numeric, 4);

  select * into v_card
  from public.roof_pricing_rate_cards
  where company_id=p_company_id
    and status='active'
    and effective_from <= clock_timestamp()
    and (effective_until is null or effective_until > clock_timestamp())
  order by effective_from desc
  limit 1
  for share;

  if not found then raise exception 'No active roof pricing rate card'; end if;
  if (select count(*) from public.roof_pricing_tiers where company_id=p_company_id and rate_card_id=v_card.id) <> 3 then
    raise exception 'Active roof pricing rate card is incomplete';
  end if;

  insert into public.roof_estimate_packages (
    company_id, estimate_id, rate_card_id, tier_key, display_order,
    measured_roof_squares, low_cents_per_square, high_cents_per_square,
    range_low_cents, range_high_cents, customer_name, customer_description,
    warranty_summary, differentiators, pricing_version, calculated_at,
    product_line_id, manufacturer_name, product_line_name
  )
  select p_company_id, p_estimate_id, v_card.id, tier_key, display_order,
    v_roof_squares, low_cents_per_square, high_cents_per_square,
    round(v_roof_squares * low_cents_per_square)::integer,
    round(v_roof_squares * high_cents_per_square)::integer,
    customer_name, customer_description, warranty_summary, differentiators,
    v_card.version, clock_timestamp(),
    line.id, maker.name, line.name
  from public.roof_pricing_tiers tier
  left join public.catalog_product_lines line on line.id = tier.product_line_id
  left join public.catalog_manufacturers maker on maker.id = line.manufacturer_id
  where tier.company_id=p_company_id and tier.rate_card_id=v_card.id
  order by tier.display_order;

  select * into v_better from public.roof_estimate_packages
  where company_id=p_company_id and estimate_id=p_estimate_id and tier_key='better';

  select coalesce(jsonb_agg(jsonb_build_object(
    'code', adjustment_code,
    'label', customer_label,
    'explanation', customer_explanation,
    'calculationKind', calculation_kind,
    'lowValue', low_value,
    'highValue', high_value,
    'displayOrder', display_order
  ) order by display_order), '[]'::jsonb)
  into v_adjustments
  from public.roof_pricing_adjustments
  where company_id=p_company_id and rate_card_id=v_card.id and active;

  update public.roof_estimates
  set roof_insight_id=p_roof_insight_id,
      status='ready',
      total_roof_sqft=v_insight.total_roof_sqft,
      roof_squares=v_roof_squares,
      price_per_square_low_cents=v_better.low_cents_per_square,
      price_per_square_high_cents=v_better.high_cents_per_square,
      range_low_cents=v_better.range_low_cents,
      range_high_cents=v_better.range_high_cents,
      pricing_version=v_card.version,
      assumptions=jsonb_build_object(
        'preliminary', true,
        'pricingVersion', v_card.version,
        'adjustmentsApplied', false,
        'adjustmentDisclosures', v_adjustments,
        'finalScope', 'Field inspection confirms final scope and pricing.'
      ),
      failure_reason=null,
      updated_at=clock_timestamp()
  where company_id=p_company_id and id=p_estimate_id;

  return query select * from public.roof_estimate_packages
    where company_id=p_company_id and estimate_id=p_estimate_id order by display_order;
end;
$$;

create or replace function public.reuse_roof_estimate_packages(
  p_company_id uuid,
  p_target_estimate_id uuid,
  p_source_estimate_id uuid
) returns setof public.roof_estimate_packages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.roof_estimates%rowtype;
  v_target public.roof_estimates%rowtype;
begin
  perform 1 from public.roof_estimates
  where company_id=p_company_id and id in (p_source_estimate_id, p_target_estimate_id)
  order by id for update;

  select * into v_source from public.roof_estimates
  where company_id=p_company_id and id=p_source_estimate_id and status='ready';
  select * into v_target from public.roof_estimates
  where company_id=p_company_id and id=p_target_estimate_id and status='pending';

  if v_source.id is null or v_target.id is null or v_source.property_id <> v_target.property_id then
    raise exception 'Reusable roof estimate scope mismatch';
  end if;
  if (select count(*) from public.roof_estimate_packages where company_id=p_company_id and estimate_id=p_source_estimate_id) <> 3 then
    raise exception 'Source estimate does not have a complete package snapshot';
  end if;

  insert into public.roof_estimate_packages (
    company_id, estimate_id, rate_card_id, tier_key, display_order,
    measured_roof_squares, low_cents_per_square, high_cents_per_square,
    range_low_cents, range_high_cents, customer_name, customer_description,
    warranty_summary, differentiators, pricing_version, calculated_at,
    product_line_id, manufacturer_name, product_line_name
  )
  select company_id, p_target_estimate_id, rate_card_id, tier_key, display_order,
    measured_roof_squares, low_cents_per_square, high_cents_per_square,
    range_low_cents, range_high_cents, customer_name, customer_description,
    warranty_summary, differentiators, pricing_version, calculated_at,
    product_line_id, manufacturer_name, product_line_name
  from public.roof_estimate_packages
  where company_id=p_company_id and estimate_id=p_source_estimate_id
  on conflict (company_id, estimate_id, tier_key) do nothing;

  update public.roof_estimates
  set reused_from_estimate_id=p_source_estimate_id,
      roof_insight_id=v_source.roof_insight_id,
      status='ready', total_roof_sqft=v_source.total_roof_sqft,
      roof_squares=v_source.roof_squares,
      price_per_square_low_cents=v_source.price_per_square_low_cents,
      price_per_square_high_cents=v_source.price_per_square_high_cents,
      range_low_cents=v_source.range_low_cents,
      range_high_cents=v_source.range_high_cents,
      pricing_version=v_source.pricing_version,
      assumptions=v_source.assumptions || jsonb_build_object(
        'reusedFromEstimateId', p_source_estimate_id,
        'reusedAt', clock_timestamp()
      ),
      failure_reason=null,
      updated_at=clock_timestamp()
  where company_id=p_company_id and id=p_target_estimate_id;

  return query select * from public.roof_estimate_packages
    where company_id=p_company_id and estimate_id=p_target_estimate_id order by display_order;
end;
$$;

alter table public.catalog_manufacturers enable row level security;
alter table public.catalog_product_lines enable row level security;
alter table public.catalog_products enable row level security;
alter table public.catalog_system_components enable row level security;
alter table public.company_catalog_prices enable row level security;

revoke all on public.catalog_manufacturers from anon, authenticated;
revoke all on public.catalog_product_lines from anon, authenticated;
revoke all on public.catalog_products from anon, authenticated;
revoke all on public.catalog_system_components from anon, authenticated;
revoke all on public.company_catalog_prices from anon, authenticated;

grant select on public.catalog_manufacturers to authenticated;
grant select on public.catalog_product_lines to authenticated;
grant select on public.catalog_products to authenticated;
grant select on public.catalog_system_components to authenticated;
grant select on public.company_catalog_prices to authenticated;

grant all on public.catalog_manufacturers to service_role;
grant all on public.catalog_product_lines to service_role;
grant all on public.catalog_products to service_role;
grant all on public.catalog_system_components to service_role;
grant all on public.company_catalog_prices to service_role;

create policy "signed-in users read catalog manufacturers"
  on public.catalog_manufacturers for select to authenticated using (true);
create policy "signed-in users read catalog product lines"
  on public.catalog_product_lines for select to authenticated using (true);
create policy "signed-in users read catalog products"
  on public.catalog_products for select to authenticated using (true);
create policy "signed-in users read catalog system components"
  on public.catalog_system_components for select to authenticated using (true);
create policy "company admins read their catalog prices"
  on public.company_catalog_prices for select to authenticated
  using (company_id = (select public.current_company_id()));

revoke execute on function public.require_catalog_shingle_line() from public, anon, authenticated;

-- CertainTeed seed --------------------------------------------------------

insert into public.catalog_manufacturers (code, name, website)
values ('certainteed', 'CertainTeed', 'https://www.certainteed.com');

with mfr as (select id from public.catalog_manufacturers where code = 'certainteed')
insert into public.catalog_product_lines (
  manufacturer_id, code, name, category, market_tier, status, description, specs, warranty, source_notes, verified_on
)
select mfr.id, v.code, v.name, v.category, v.market_tier, v.status, v.description, v.specs::jsonb, v.warranty::jsonb, v.source_notes, date '2026-10-12'
from mfr, (values
  ('patriot', 'Patriot', 'shingle', 'standard', 'active',
   'Dual-layer laminated shingle with a wood-shake look; entry architectural system.',
   '{"exposure_in": 5.625, "bundles_per_square": 3, "shingles_per_square": 65, "wind_mph": 110, "wind_mph_with_ct_starter_and_ridge": 130, "wind_class": ["ASTM D3161 Class F", "ASTM D7158 Class H"], "fire_class": "UL 790 Class A"}',
   '{"material": "Lifetime limited, transferable", "surestart_years": 10, "wind_years": 15, "algae_years": 10, "requires": "CertainTeed starter and hip & ridge"}',
   'CertainTeed Patriot sell sheet 00-04-3681 (Jan 2024); distributor listings (Cameron Ashley, QXO). Bundle and weight figures conflict between sources; confirm on current data sheet.'),
  ('landmark', 'Landmark', 'shingle', 'standard', 'active',
   'CertainTeed''s baseline dual-layer architectural shingle.',
   '{"exposure_in": 5.625, "bundles_per_square": 3, "weight_lb_per_square": [211, 225], "wind_mph": 110, "wind_mph_with_ct_starter_and_ridge": 130, "fire_class": "UL 790 Class A"}',
   '{"material": "Lifetime limited, transferable", "surestart_years": 10, "wind_years": 15, "algae_years": 10}',
   'Landmark technical data sheet (BuildSite 2899919); Landmark series brochure. Algae term varies by AR/StreakFighter version; confirm.'),
  ('landmark_pro', 'Landmark PRO', 'shingle', 'premium', 'active',
   'Heavier dual-layer architectural shingle with Max Def colour blends.',
   '{"exposure_in": 5.625, "shingles_per_square": 66, "weight_lb_per_square": [234, 240], "wind_mph": 110, "wind_mph_with_ct_starter_and_ridge": 130, "impact_class": "UL 2218 Class 3", "fire_class": "UL 790 Class A"}',
   '{"material": "Lifetime limited, transferable", "surestart_years": 10, "wind_years": 15, "algae_years": 15, "algae_years_with_ct_ar_hip_ridge": 30}',
   'Landmark PRO technical data sheet (BuildSite 2899921, RCABC TDS); Landmark series brochure. Bundles per square not confirmed.'),
  ('landmark_climateflex', 'Landmark ClimateFlex', 'shingle', 'premium', 'active',
   'Polymer-modified, impact-resistant Landmark for hail-prone or insurance-driven jobs.',
   '{"impact_class": "UL 2218 Class 4"}',
   '{"material": "Lifetime limited, transferable", "surestart_years": 10}',
   'CertainTeed_Product_Catalog (Drive, 2026-08-14). Specs not yet verified against a data sheet.'),
  ('xt25', 'XT 25', 'shingle', 'economy', 'active',
   'Three-tab strip shingle for price-sensitive and rental re-roofs.',
   '{"exposure_in": 5, "bundles_per_square": 3}',
   '{"material": "25-year limited"}',
   'Distributor listing (ARL, 29XT25GF).'),
  ('swiftstart', 'SwiftStart', 'starter', null, 'active',
   'Pre-cut starter course matched to the Landmark series; required for enhanced warranties.',
   '{"pieces_per_bundle": 18, "piece_size_in": [38.75, 15.25]}',
   '{}',
   'CertainTeed SwiftStart product page; distributor listings (116 to 116.25 lf per bundle).'),
  ('shadow_ridge', 'Shadow Ridge', 'hip_ridge', null, 'active',
   'Algae-resistant hip and ridge accessory shingle for laminated lines.',
   '{"exposure_in": 5, "pieces_per_bundle": 24, "caps_per_bundle": 72}',
   '{"note": "CertainTeed AR hip & ridge is required for the extended algae term."}',
   'Shadow Ridge spec sheet (Lowe''s 63087817); distributor listings give 30 to 31 lf per bundle.'),
  ('winterguard_granular', 'WinterGuard Granular', 'ice_water', null, 'active',
   'Self-adhering waterproofing underlayment for eaves, valleys and penetrations.',
   '{"roll_size_ft": [3, 65]}',
   '{}',
   'Distributor listings: 3 ft x 65 ft roll, 195 sq ft.'),
  ('diamonddeck', 'DiamondDeck', 'underlayment', null, 'active',
   'Synthetic water-resistant field underlayment.',
   '{"roll_size_ft": [4, 250], "net_coverage_sq_ft": 937.5}',
   '{}',
   'DiamondDeck technical data sheet (RCABC); retailers sell as 10 squares per roll.'),
  ('roofrunner', 'RoofRunner', 'underlayment', null, 'active',
   'Synthetic underlayment sold as an alternate to DiamondDeck in some territories.',
   '{}',
   '{}',
   'CertainTeed_Product_Catalog (Drive, 2026-08-14). Coverage not verified; no products seeded.'),
  ('ridge_vent', 'Ridge Vent', 'ventilation', null, 'active',
   'CertainTeed exhaust ridge vent paired with soffit intake in the Integrity Roof System.',
   '{}',
   '{}',
   'Integrity Roof System brochure 13-00-1916 (2025). Section length not verified; no products seeded.'),
  ('flintlastic_sa', 'Flintlastic SA', 'low_slope', null, 'active',
   'Self-adhering modified bitumen for porches, dormers and other low-slope sections.',
   '{}',
   '{}',
   'CertainTeed_Product_Catalog (Drive, 2026-08-14).'),
  ('solstice_panel', 'Solstice Panel', 'solar', null, 'active',
   'All-black rack-mounted solar panel paired with the Solstice Mounting System.',
   '{}',
   '{"system_years": 25, "note": "System-level term when installed with Solstice mounting; confirm with a rep."}',
   'CertainTeed_Product_Catalog (Drive, 2026-08-14).'),
  ('solstice_shingle', 'Solstice Shingle', 'solar', null, 'active',
   'Building-integrated solar shingle fastened to the deck, flush with the roofline.',
   '{}',
   '{}',
   'CertainTeed_Product_Catalog (Drive, 2026-08-14).')
) as v(code, name, category, market_tier, status, description, specs, warranty, source_notes);

-- Purchase units and coverage. Shingle colours are added from the
-- distributor price sheet; one default row per line lets quantities compute now.
insert into public.catalog_products (product_line_id, variant, purchase_unit, coverage_quantity, coverage_unit)
select l.id, null, v.purchase_unit, v.coverage_quantity, v.coverage_unit
from public.catalog_product_lines l
join public.catalog_manufacturers m on m.id = l.manufacturer_id and m.code = 'certainteed'
join (values
  ('patriot', 'bundle', 0.3333, 'square'),
  ('landmark', 'bundle', 0.3333, 'square'),
  ('landmark_pro', 'bundle', 0.3333, 'square'),
  ('xt25', 'bundle', 0.3333, 'square'),
  ('swiftstart', 'bundle', 116, 'linear_ft'),
  ('shadow_ridge', 'bundle', 30, 'linear_ft'),
  ('winterguard_granular', 'roll', 195, 'sq_ft'),
  ('diamonddeck', 'roll', 10, 'square')
) as v(code, purchase_unit, coverage_quantity, coverage_unit) on v.code = l.code;

-- Integrity Roof System bill of materials for each laminated shingle line.
insert into public.catalog_system_components (
  system_line_id, component_line_id, quantity_basis, required_for_warranty, display_order, notes
)
select sys.id, comp.id, v.quantity_basis, v.required, v.display_order, v.notes
from public.catalog_product_lines sys
join public.catalog_manufacturers m on m.id = sys.manufacturer_id and m.code = 'certainteed'
cross join (values
  ('swiftstart', 'eave_and_rake_lf', true, 1, 'CertainTeed starter is required for the 130 mph wind upgrade and SureStart PLUS.'),
  ('shadow_ridge', 'hip_and_ridge_lf', true, 2, 'CertainTeed AR hip & ridge extends the algae term.'),
  ('winterguard_granular', 'eave_and_valley_sq_ft', true, 3, 'Waterproofing at eaves, valleys and penetrations.'),
  ('diamonddeck', 'roof_squares', true, 4, 'Water-resistant field underlayment.'),
  ('ridge_vent', 'ridge_lf', false, 5, 'Exhaust ventilation; pair with soffit intake.')
) as v(component_code, quantity_basis, required, display_order, notes)
join public.catalog_product_lines comp on comp.manufacturer_id = m.id and comp.code = v.component_code
where sys.code in ('patriot', 'landmark', 'landmark_pro', 'landmark_climateflex');

create extension if not exists btree_gist with schema extensions;

alter table public.roof_insights
  add constraint roof_insights_company_id_id_key unique (company_id, id);

create table public.roof_pricing_rate_cards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  version text not null check (length(trim(version)) > 0),
  name text not null check (length(trim(name)) > 0),
  market text not null check (length(trim(market)) > 0),
  currency_code text not null default 'USD' check (currency_code = 'USD'),
  effective_from timestamptz not null,
  effective_until timestamptz,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, version),
  check (effective_until is null or effective_until > effective_from),
  exclude using gist (
    company_id with =,
    tstzrange(effective_from, coalesce(effective_until, 'infinity'::timestamptz), '[)') with &&
  ) where (status = 'active')
);

create table public.roof_pricing_tiers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  rate_card_id uuid not null,
  tier_key text not null check (tier_key in ('good', 'better', 'best')),
  display_order smallint not null check (display_order between 1 and 3),
  internal_scope_code text not null check (length(trim(internal_scope_code)) > 0),
  customer_name text not null check (length(trim(customer_name)) > 0),
  customer_description text not null check (length(trim(customer_description)) > 0),
  warranty_summary text not null check (length(trim(warranty_summary)) > 0),
  differentiators jsonb not null check (jsonb_typeof(differentiators) = 'array'),
  low_cents_per_square integer not null check (low_cents_per_square > 0),
  high_cents_per_square integer not null check (high_cents_per_square >= low_cents_per_square),
  unique (company_id, rate_card_id, tier_key),
  unique (company_id, rate_card_id, display_order),
  foreign key (company_id, rate_card_id)
    references public.roof_pricing_rate_cards(company_id, id) on delete cascade
);

create table public.roof_pricing_adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  rate_card_id uuid not null,
  adjustment_code text not null check (length(trim(adjustment_code)) > 0),
  customer_label text not null check (length(trim(customer_label)) > 0),
  customer_explanation text not null check (length(trim(customer_explanation)) > 0),
  calculation_kind text not null check (
    calculation_kind in ('percentage', 'flat', 'per_square', 'per_unit')
  ),
  low_value numeric(12, 2) not null check (low_value >= 0),
  high_value numeric(12, 2) not null check (high_value >= low_value),
  display_order smallint not null check (display_order > 0),
  active boolean not null default true,
  unique (company_id, rate_card_id, adjustment_code),
  unique (company_id, rate_card_id, display_order),
  foreign key (company_id, rate_card_id)
    references public.roof_pricing_rate_cards(company_id, id) on delete cascade
);

create table public.roof_estimate_packages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  estimate_id uuid not null,
  rate_card_id uuid not null,
  tier_key text not null check (tier_key in ('good', 'better', 'best')),
  display_order smallint not null check (display_order between 1 and 3),
  measured_roof_squares numeric(12, 4) not null check (measured_roof_squares > 0),
  low_cents_per_square integer not null check (low_cents_per_square > 0),
  high_cents_per_square integer not null check (high_cents_per_square >= low_cents_per_square),
  range_low_cents integer not null check (range_low_cents > 0),
  range_high_cents integer not null check (range_high_cents >= range_low_cents),
  customer_name text not null check (length(trim(customer_name)) > 0),
  customer_description text not null check (length(trim(customer_description)) > 0),
  warranty_summary text not null check (length(trim(warranty_summary)) > 0),
  differentiators jsonb not null check (jsonb_typeof(differentiators) = 'array'),
  pricing_version text not null check (length(trim(pricing_version)) > 0),
  calculated_at timestamptz not null default now(),
  unique (company_id, estimate_id, tier_key),
  unique (company_id, estimate_id, display_order),
  foreign key (company_id, estimate_id)
    references public.roof_estimates(company_id, id) on delete cascade,
  foreign key (company_id, rate_card_id)
    references public.roof_pricing_rate_cards(company_id, id),
  check (range_low_cents = round(measured_roof_squares * low_cents_per_square)),
  check (range_high_cents = round(measured_roof_squares * high_cents_per_square))
);

create index roof_pricing_rate_cards_company_status_idx
  on public.roof_pricing_rate_cards(company_id, status, effective_from desc);
create index roof_pricing_tiers_rate_card_idx
  on public.roof_pricing_tiers(company_id, rate_card_id, display_order);
create index roof_pricing_adjustments_rate_card_idx
  on public.roof_pricing_adjustments(company_id, rate_card_id, display_order)
  where active;
create index roof_estimate_packages_estimate_idx
  on public.roof_estimate_packages(company_id, estimate_id, display_order);

create or replace function public.reject_roof_estimate_package_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Roof estimate package snapshots are immutable';
end;
$$;

create trigger reject_roof_estimate_package_update
before update on public.roof_estimate_packages
for each row execute function public.reject_roof_estimate_package_update();

alter table public.roof_pricing_rate_cards enable row level security;
alter table public.roof_pricing_tiers enable row level security;
alter table public.roof_pricing_adjustments enable row level security;
alter table public.roof_estimate_packages enable row level security;

revoke all on public.roof_pricing_rate_cards from anon, authenticated;
revoke all on public.roof_pricing_tiers from anon, authenticated;
revoke all on public.roof_pricing_adjustments from anon, authenticated;
revoke all on public.roof_estimate_packages from anon, authenticated;

grant select on public.roof_pricing_rate_cards to authenticated;
grant select on public.roof_pricing_tiers to authenticated;
grant select on public.roof_pricing_adjustments to authenticated;
grant select on public.roof_estimate_packages to authenticated;

grant all on public.roof_pricing_rate_cards to service_role;
grant all on public.roof_pricing_tiers to service_role;
grant all on public.roof_pricing_adjustments to service_role;
grant all on public.roof_estimate_packages to service_role;

create policy "company admins read roof pricing rate cards"
  on public.roof_pricing_rate_cards for select to authenticated
  using (company_id = (select public.current_company_id()));
create policy "company admins read roof pricing tiers"
  on public.roof_pricing_tiers for select to authenticated
  using (company_id = (select public.current_company_id()));
create policy "company admins read roof pricing adjustments"
  on public.roof_pricing_adjustments for select to authenticated
  using (company_id = (select public.current_company_id()));
create policy "company admins read roof estimate packages"
  on public.roof_estimate_packages for select to authenticated
  using (company_id = (select public.current_company_id()));

create or replace function public.activate_roof_pricing_rate_card(
  p_company_id uuid,
  p_rate_card_id uuid
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':roof-pricing', 0));

  if not exists (
    select 1 from public.roof_pricing_rate_cards
    where company_id = p_company_id
      and id = p_rate_card_id
      and status in ('draft', 'active')
  ) then
    raise exception 'Roof pricing rate card not found or not activatable';
  end if;

  if (select count(*) from public.roof_pricing_tiers
      where company_id = p_company_id and rate_card_id = p_rate_card_id) <> 3
    or not exists (select 1 from public.roof_pricing_tiers where company_id=p_company_id and rate_card_id=p_rate_card_id and tier_key='good' and display_order=1)
    or not exists (select 1 from public.roof_pricing_tiers where company_id=p_company_id and rate_card_id=p_rate_card_id and tier_key='better' and display_order=2)
    or not exists (select 1 from public.roof_pricing_tiers where company_id=p_company_id and rate_card_id=p_rate_card_id and tier_key='best' and display_order=3)
  then
    raise exception 'Roof pricing rate card requires ordered Good, Better, and Best tiers';
  end if;

  update public.roof_pricing_rate_cards
  set status = 'active', updated_at = clock_timestamp()
  where company_id = p_company_id and id = p_rate_card_id;
end;
$$;

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
    warranty_summary, differentiators, pricing_version, calculated_at
  )
  select p_company_id, p_estimate_id, v_card.id, tier_key, display_order,
    v_roof_squares, low_cents_per_square, high_cents_per_square,
    round(v_roof_squares * low_cents_per_square)::integer,
    round(v_roof_squares * high_cents_per_square)::integer,
    customer_name, customer_description, warranty_summary, differentiators,
    v_card.version, clock_timestamp()
  from public.roof_pricing_tiers
  where company_id=p_company_id and rate_card_id=v_card.id
  order by display_order;

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
    warranty_summary, differentiators, pricing_version, calculated_at
  )
  select company_id, p_target_estimate_id, rate_card_id, tier_key, display_order,
    measured_roof_squares, low_cents_per_square, high_cents_per_square,
    range_low_cents, range_high_cents, customer_name, customer_description,
    warranty_summary, differentiators, pricing_version, calculated_at
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

revoke execute on function public.activate_roof_pricing_rate_card(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.finalize_roof_estimate_packages(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.reuse_roof_estimate_packages(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.reject_roof_estimate_package_update() from public, anon, authenticated;
grant execute on function public.activate_roof_pricing_rate_card(uuid, uuid) to service_role;
grant execute on function public.finalize_roof_estimate_packages(uuid, uuid, uuid) to service_role;
grant execute on function public.reuse_roof_estimate_packages(uuid, uuid, uuid) to service_role;

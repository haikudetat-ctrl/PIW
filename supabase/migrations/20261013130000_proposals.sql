-- Proposals: the firm, itemised offer a rep builds on a lead after the
-- preliminary estimate. Step 2 of merging 2stack-roof-quote into PIW.
--
-- A proposal is a snapshot. It copies the measurement, the Good/Better/Best
-- options (product line, copy, price per square) and the add-ons when it is
-- created, so a proposal re-rendered after the rate card changes reproduces
-- what was offered. Drafts are editable; once sent, pricing is frozen and a
-- change means a new version.

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'void')),
  roof_squares numeric(10, 2) not null check (roof_squares > 0 and roof_squares <= 99999999.99),
  measurement_source text not null check (measurement_source in ('google_solar', 'roofr', 'manual')),
  -- Roofr file jnid or roof estimate id the squares came from.
  measurement_ref text,
  pitch_12 numeric(4, 1) check (pitch_12 is null or pitch_12 between 0 and 30),
  stories smallint check (stories is null or stories between 1 and 6),
  layers_to_remove smallint check (layers_to_remove is null or layers_to_remove between 0 and 4),
  rate_card_id uuid not null,
  pricing_version text not null check (length(trim(pricing_version)) > 0),
  recommended_tier text not null default 'better' check (recommended_tier in ('good', 'better', 'best')),
  valid_until date not null,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (company_id, id),
  unique (company_id, lead_id, version),
  foreign key (company_id, lead_id) references public.leads(company_id, id) on delete cascade,
  foreign key (company_id, rate_card_id) references public.roof_pricing_rate_cards(company_id, id),
  check ((status = 'draft') = (sent_at is null))
);

create table public.proposal_options (
  company_id uuid not null,
  proposal_id uuid not null,
  tier_key text not null check (tier_key in ('good', 'better', 'best')),
  display_order smallint not null check (display_order between 1 and 3),
  product_line_id uuid references public.catalog_product_lines(id),
  manufacturer_name text,
  product_line_name text,
  customer_name text not null check (length(trim(customer_name)) > 0),
  customer_description text not null,
  warranty_summary text not null,
  differentiators jsonb not null default '[]'::jsonb check (jsonb_typeof(differentiators) = 'array'),
  price_per_square_cents integer not null check (price_per_square_cents > 0),
  primary key (proposal_id, tier_key),
  unique (proposal_id, display_order),
  foreign key (company_id, proposal_id) references public.proposals(company_id, id) on delete cascade
);

create table public.proposal_add_ons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  proposal_id uuid not null,
  adjustment_code text,
  label text not null check (length(trim(label)) > 0),
  explanation text,
  -- Same semantics as roof_pricing_adjustments: flat and per_unit in dollars,
  -- per_square in dollars per square, percentage of the chosen option.
  calculation_kind text not null check (calculation_kind in ('flat', 'per_unit', 'per_square', 'percentage')),
  unit_value numeric(12, 2) not null check (unit_value >= 0),
  quantity numeric(10, 2) not null default 1 check (quantity >= 0),
  included boolean not null default false,
  display_order smallint not null check (display_order > 0),
  unique (proposal_id, display_order),
  foreign key (company_id, proposal_id) references public.proposals(company_id, id) on delete cascade
);

create index proposals_lead_idx on public.proposals(company_id, lead_id, version desc);
create index proposal_add_ons_proposal_idx on public.proposal_add_ons(proposal_id, display_order);

-- Pricing is frozen once a proposal leaves draft. Status can still move
-- forward (sent -> accepted / declined / void).
create or replace function public.guard_proposal_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (
    new.roof_squares, new.measurement_source, new.measurement_ref, new.pitch_12, new.stories,
    new.layers_to_remove, new.rate_card_id, new.pricing_version, new.recommended_tier,
    new.valid_until, new.version, new.lead_id, new.company_id, new.sent_at
  ) is distinct from (
    old.roof_squares, old.measurement_source, old.measurement_ref, old.pitch_12, old.stories,
    old.layers_to_remove, old.rate_card_id, old.pricing_version, old.recommended_tier,
    old.valid_until, old.version, old.lead_id, old.company_id, old.sent_at
  ) then
    raise exception 'Sent proposals cannot be repriced; create a new version' using errcode = '55000';
  end if;
  if old.status <> 'draft' and new.status = 'draft' then
    raise exception 'Sent proposals cannot return to draft' using errcode = '55000';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger guard_proposal_snapshot
before update on public.proposals
for each row execute function public.guard_proposal_snapshot();

create or replace function public.guard_proposal_children()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_proposal uuid := coalesce(new.proposal_id, old.proposal_id);
begin
  if exists (select 1 from public.proposals where id = v_proposal and status <> 'draft') then
    raise exception 'Sent proposals cannot be repriced; create a new version' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger guard_proposal_options
before insert or update or delete on public.proposal_options
for each row execute function public.guard_proposal_children();

create trigger guard_proposal_add_ons
before insert or update or delete on public.proposal_add_ons
for each row execute function public.guard_proposal_children();

alter table public.proposals enable row level security;
alter table public.proposal_options enable row level security;
alter table public.proposal_add_ons enable row level security;

revoke all on public.proposals, public.proposal_options, public.proposal_add_ons from anon, authenticated;
grant select, insert, update, delete on public.proposals to authenticated;
grant select, insert, update, delete on public.proposal_options, public.proposal_add_ons to authenticated;
grant all on public.proposals, public.proposal_options, public.proposal_add_ons to service_role;

-- Same tenancy as tasks and interactions on a lead.
create policy "company admins read proposals" on public.proposals
  for select to authenticated using (company_id = (select public.current_company_id()));
create policy "company admins create proposals" on public.proposals
  for insert to authenticated with check (company_id = (select public.current_company_id()));
create policy "company admins update proposals" on public.proposals
  for update to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

-- Only drafts can be deleted; a sent proposal is a record of what was offered.
create policy "company admins delete draft proposals" on public.proposals
  for delete to authenticated
  using (company_id = (select public.current_company_id()) and status = 'draft');

create policy "company admins manage proposal options" on public.proposal_options
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

create policy "company admins manage proposal add-ons" on public.proposal_add_ons
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

revoke execute on function public.guard_proposal_snapshot() from public, anon, authenticated;
revoke execute on function public.guard_proposal_children() from public, anon, authenticated;

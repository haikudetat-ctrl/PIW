-- Calendar-month cost intelligence ledger. These tables are deliberately
-- service-role only: provider billing metadata can reveal account structure,
-- resource identifiers, and commercial terms.

create table public.cost_resource_inventory (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('vercel', 'supabase', 'google_cloud', 'digitalocean', 'application')),
  resource_key text not null check (length(trim(resource_key)) > 0),
  display_name text not null check (length(trim(display_name)) > 0),
  environment text not null default 'shared' check (environment in ('production', 'qa', 'staging', 'preview', 'shared')),
  allocation_bucket text not null default 'shared_platform' check (length(trim(allocation_bucket)) > 0),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, resource_key)
);

create table public.cost_rate_cards (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  service text not null,
  effective_from date not null,
  effective_to date,
  currency text not null default 'USD' check (currency = 'USD'),
  unit text not null,
  unit_price_micros bigint not null default 0 check (unit_price_micros >= 0),
  free_limit numeric,
  source_url text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  unique (provider, service, effective_from)
);

create table public.cost_budget_targets (
  period_start date primary key check (period_start = date_trunc('month', period_start)::date),
  currency text not null default 'USD' check (currency = 'USD'),
  budget_micros bigint not null default 1500000000 check (budget_micros > 0),
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cost_collection_runs (
  id uuid primary key default gen_random_uuid(),
  slot_key text not null unique check (length(trim(slot_key)) > 0),
  scheduled_for timestamptz not null,
  period_start date not null check (period_start = date_trunc('month', period_start)::date),
  status text not null default 'running' check (status in ('running', 'completed', 'partial', 'failed')),
  provider_status jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  slack_status text not null default 'pending' check (slack_status in ('pending', 'sent', 'failed', 'not_configured')),
  slack_error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.cost_line_items (
  id uuid primary key default gen_random_uuid(),
  collection_run_id uuid not null references public.cost_collection_runs(id) on delete cascade,
  provider text not null,
  source_key text not null,
  resource_key text,
  service text not null,
  environment text not null default 'shared' check (environment in ('production', 'qa', 'staging', 'preview', 'shared')),
  allocation_bucket text not null default 'shared_platform',
  cost_kind text not null check (cost_kind in ('actual', 'estimated', 'committed')),
  confidence text not null check (confidence in ('invoice', 'provider_meter', 'rate_card', 'manual')),
  currency text not null default 'USD' check (currency = 'USD'),
  amount_micros bigint not null default 0,
  usage_quantity numeric,
  usage_unit text,
  free_limit numeric,
  source_timestamp timestamptz not null,
  source_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (collection_run_id, provider, source_key)
);

create index cost_inventory_active_idx
  on public.cost_resource_inventory(provider, environment)
  where active;
create index cost_line_items_period_lookup_idx
  on public.cost_line_items(provider, environment, created_at desc);
create index cost_collection_runs_period_idx
  on public.cost_collection_runs(period_start, scheduled_for desc);

alter table public.cost_resource_inventory enable row level security;
alter table public.cost_rate_cards enable row level security;
alter table public.cost_budget_targets enable row level security;
alter table public.cost_collection_runs enable row level security;
alter table public.cost_line_items enable row level security;

revoke all on public.cost_resource_inventory from anon, authenticated;
revoke all on public.cost_rate_cards from anon, authenticated;
revoke all on public.cost_budget_targets from anon, authenticated;
revoke all on public.cost_collection_runs from anon, authenticated;
revoke all on public.cost_line_items from anon, authenticated;

grant all on public.cost_resource_inventory to service_role;
grant all on public.cost_rate_cards to service_role;
grant all on public.cost_budget_targets to service_role;
grant all on public.cost_collection_runs to service_role;
grant all on public.cost_line_items to service_role;

comment on table public.cost_line_items is
  'Point-in-time calendar-month cost and usage facts. amount_micros may be negative for credits.';
comment on column public.cost_line_items.confidence is
  'invoice is authoritative; provider_meter is current provider usage; rate_card and manual are estimates.';

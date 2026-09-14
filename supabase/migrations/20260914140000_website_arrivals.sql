-- Unconditional, pre-consent arrival log: the server-side ground truth for
-- whether an ad click actually reached the origin. This table is written from
-- edge middleware before any consent decision exists, so it deliberately holds
-- no raw IP address and no contact details. visitor_hash is a salted digest
-- rotated daily, which supports unique-visit counting for a single day without
-- retaining an identifier that outlives it.

create table public.website_arrivals (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  occurred_at timestamptz not null default pg_catalog.now(),
  request_path text not null check (pg_catalog.length(request_path) <= 500),
  campaign_slug text check (
    campaign_slug is null or campaign_slug in ('weather-report', 'seasonal-shield', 'for-every-season')
  ),
  visitor_hash text not null check (visitor_hash ~ '^[0-9a-f]{64}$'),
  user_agent text check (user_agent is null or pg_catalog.length(user_agent) <= 1000),
  referrer_host text check (referrer_host is null or pg_catalog.length(referrer_host) <= 255),
  fbclid text check (fbclid is null or pg_catalog.length(fbclid) <= 500),
  utm_source text check (utm_source is null or pg_catalog.length(utm_source) <= 500),
  utm_medium text check (utm_medium is null or pg_catalog.length(utm_medium) <= 500),
  utm_campaign text check (utm_campaign is null or pg_catalog.length(utm_campaign) <= 500),
  utm_content text check (utm_content is null or pg_catalog.length(utm_content) <= 500),
  utm_term text check (utm_term is null or pg_catalog.length(utm_term) <= 500),
  meta_placement text check (meta_placement is null or pg_catalog.length(meta_placement) <= 200),
  meta_site_source text check (meta_site_source is null or pg_catalog.length(meta_site_source) <= 200),
  is_likely_bot boolean not null default false,
  created_at timestamptz not null default pg_catalog.now()
);

comment on table public.website_arrivals is
  'Pre-consent server-side record that a request reached the origin. No raw IP, no contact details.';
comment on column public.website_arrivals.visitor_hash is
  'sha256(daily_salt || client_ip || user_agent). Rotates daily; not reversible and not stable across days.';
comment on column public.website_arrivals.is_likely_bot is
  'Advisory only. Rows are never dropped at write time -- filter at query time so the raw record stays intact.';

create index website_arrivals_occurred_at_idx
  on public.website_arrivals (occurred_at desc);
create index website_arrivals_campaign_idx
  on public.website_arrivals (campaign_slug, occurred_at desc)
  where campaign_slug is not null;
create index website_arrivals_utm_content_idx
  on public.website_arrivals (utm_content, occurred_at desc)
  where utm_content is not null;

alter table public.website_arrivals enable row level security;

-- No policies: this table is written and read only through the service role.
-- Anonymous and authenticated clients get no access by default under RLS.

-- Daily reconciliation surface. Compare paid_arrivals against the day-level
-- Meta link-click export to size the gap between reported clicks and real
-- arrivals; compare distinct_visitors against Vercel Analytics visitors to
-- size how much consent gating is still hiding.
create view public.website_arrivals_daily
with (security_invoker = true) as
select
  company_id,
  (occurred_at at time zone 'America/New_York')::date as arrival_date,
  campaign_slug,
  utm_content as ad_name,
  meta_placement,
  count(*) filter (where not is_likely_bot) as arrivals,
  count(*) filter (where not is_likely_bot and fbclid is not null) as paid_arrivals,
  count(distinct visitor_hash) filter (where not is_likely_bot) as distinct_visitors,
  count(*) filter (where is_likely_bot) as bot_arrivals
from public.website_arrivals
group by 1, 2, 3, 4, 5;

comment on view public.website_arrivals_daily is
  'Day-level arrival rollup in America/New_York, shaped for reconciliation against the Meta ads export.';

-- Check 1: Arrival truth -- did the paid click actually reach the origin?
--
-- Source: public.website_arrivals_daily (grade: LIVE when rows exist).
-- This is the only unbiased population count in the system: written from edge
-- middleware BEFORE any consent decision exists. Use it as the denominator for
-- every rate in the report.
--
-- Substitute {{WINDOW_START}} and {{WINDOW_END}} as America/New_York dates
-- (YYYY-MM-DD). The view already buckets arrival_date in that timezone; using
-- any other timezone misaligns every join downstream.
--
-- CAUTION: distinct_visitors is only meaningful within a single day.
-- visitor_hash rotates daily, so summing it across days double-counts
-- returning visitors. Never present a multi-day sum as unique people.

with bounds as (
  select date '{{WINDOW_START}}' as start_date,
         date '{{WINDOW_END}}'   as end_date
)

-- 1a. Per-ad totals. The primary table for the report.
select
  'per_ad'                              as scope,
  daily.campaign_slug,
  coalesce(daily.ad_name, '(no utm_content)') as ad_name,
  coalesce(daily.meta_placement, '(none)')    as meta_placement,
  sum(daily.arrivals)                   as arrivals,
  sum(daily.paid_arrivals)              as paid_arrivals,
  sum(daily.bot_arrivals)               as bot_arrivals,
  round(
    100.0 * sum(daily.paid_arrivals) / nullif(sum(daily.arrivals), 0), 1
  )                                     as paid_share_pct,
  round(
    100.0 * sum(daily.bot_arrivals)
      / nullif(sum(daily.arrivals) + sum(daily.bot_arrivals), 0), 1
  )                                     as bot_share_pct,
  count(*)                              as days_with_traffic
from public.website_arrivals_daily as daily
cross join bounds
where daily.arrival_date between bounds.start_date and bounds.end_date
group by 1, 2, 3, 4
order by paid_arrivals desc, arrivals desc;

-- 1b. Daily series. Run separately and overlay Vercel deployment timestamps
-- (check 7) before attributing any step-change to ad performance -- a drop
-- that lands on a deploy boundary is almost always the deploy.
--
-- with bounds as (
--   select date '{{WINDOW_START}}' as start_date,
--          date '{{WINDOW_END}}'   as end_date
-- )
-- select
--   daily.arrival_date,
--   sum(daily.arrivals)          as arrivals,
--   sum(daily.paid_arrivals)     as paid_arrivals,
--   sum(daily.distinct_visitors) as distinct_visitors_same_day_only,
--   sum(daily.bot_arrivals)      as bot_arrivals
-- from public.website_arrivals_daily as daily
-- cross join bounds
-- where daily.arrival_date between bounds.start_date and bounds.end_date
-- group by 1
-- order by 1;

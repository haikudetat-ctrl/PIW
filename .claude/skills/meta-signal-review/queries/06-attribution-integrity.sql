-- Check 6: Attribution integrity -- is per-ad analysis even possible?
--
-- Sources: public.website_arrivals, public.leads (grade: LIVE).
--
-- RUN THIS BEFORE ANY PER-AD CLAIM AND BEFORE THE META CSV JOIN.
--
-- Every per-ad number in this report joins on utm_content. If utm_content is
-- missing or inconsistent, per-ad analysis is noise wearing a label, and the
-- report must fall back to campaign-level totals and say so.
--
-- This check also detects the mid-window ad rename, which silently splits one
-- ad's history into two partial rows on both sides of the join and makes both
-- look like underperformers.

with bounds as (
  select timestamptz '{{WINDOW_START}} 00:00:00 America/New_York'   as start_at,
         timestamptz '{{WINDOW_END}} 23:59:59.999 America/New_York' as end_at
),

arrival_integrity as (
  select
    'website_arrivals'                                               as surface,
    count(*)                                                         as rows_total,
    count(*) filter (where arrival.fbclid is not null)               as with_fbclid,
    count(*) filter (where arrival.utm_source is not null)           as with_utm_source,
    count(*) filter (where arrival.utm_campaign is not null)         as with_utm_campaign,
    count(*) filter (where arrival.utm_content is not null)          as with_utm_content,
    count(distinct arrival.utm_content)                              as distinct_ad_names,
    -- Paid arrivals with no ad name: spend that can never be attributed.
    count(*) filter (
      where arrival.fbclid is not null and arrival.utm_content is null
    )                                                                as paid_without_ad_name
  from public.website_arrivals as arrival
  cross join bounds
  where arrival.occurred_at between bounds.start_at and bounds.end_at
    and not arrival.is_likely_bot
),

lead_integrity as (
  select
    'leads'                                                          as surface,
    count(*)                                                         as rows_total,
    count(*) filter (where lead.fbclid is not null)                  as with_fbclid,
    count(*) filter (where lead.utm_source is not null)              as with_utm_source,
    count(*) filter (where lead.utm_campaign is not null)            as with_utm_campaign,
    count(*) filter (where lead.utm_content is not null)             as with_utm_content,
    count(distinct lead.utm_content)                                 as distinct_ad_names,
    count(*) filter (
      where lower(btrim(coalesce(lead.utm_source, ''))) in ('meta', 'facebook', 'instagram')
        and lead.utm_content is null
    )                                                                as paid_without_ad_name
  from public.leads as lead
  cross join bounds
  where lead.created_at between bounds.start_at and bounds.end_at
)

select
  surface,
  rows_total,
  with_utm_content,
  round(100.0 * with_utm_content / nullif(rows_total, 0), 1) as utm_content_coverage_pct,
  with_utm_source,
  with_utm_campaign,
  with_fbclid,
  distinct_ad_names,
  paid_without_ad_name
from (
  select * from arrival_integrity
  union all
  select * from lead_integrity
) as combined
order by surface;

-- 6b. Ad-name first/last seen. A name appearing or disappearing mid-window
-- usually means an ad was renamed, which splits its history on both sides of
-- the Meta join. Check this before calling either half an underperformer.
--
-- with bounds as (
--   select timestamptz '{{WINDOW_START}} 00:00:00 America/New_York'   as start_at,
--          timestamptz '{{WINDOW_END}} 23:59:59.999 America/New_York' as end_at
-- )
-- select
--   arrival.utm_content as ad_name,
--   min(arrival.occurred_at)::date as first_seen,
--   max(arrival.occurred_at)::date as last_seen,
--   count(*) as arrivals
-- from public.website_arrivals as arrival
-- cross join bounds
-- where arrival.occurred_at between bounds.start_at and bounds.end_at
--   and arrival.utm_content is not null
--   and not arrival.is_likely_bot
-- group by 1
-- order by arrivals desc;

-- Thresholds for the report:
--
--   utm_content_coverage_pct >= 95  -> per-ad analysis is sound.
--   utm_content_coverage_pct 80-94  -> per-ad analysis with the gap stated.
--   utm_content_coverage_pct <  80  -> REFUSE per-ad analysis. Report campaign
--                                      totals only and make the broken UTM
--                                      discipline the top finding: nothing
--                                      else in the report can be trusted at ad
--                                      level until it is fixed.

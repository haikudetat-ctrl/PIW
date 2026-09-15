-- Check 3: The real funnel -- arrivals to leads to assessments.
--
-- Sources: public.website_arrivals_daily, public.leads,
--          public.roof_assessments (grade: LIVE).
--
-- Consent-independent on the lead side: a lead is persisted when the server
-- accepts it, whatever the visitor decided about tracking. This is the funnel
-- that actually happened, and it is the denominator for headline C.
--
-- NOTE: ad_key is normalized (trimmed + casefolded) so it joins cleanly to the
-- Meta export per references/meta-export.md. It therefore prints lowercase --
-- restore the display casing from check 1's ad_name when writing the report.
--
-- PII: public.leads holds name, phone, email, submitted_address, phone_e164,
-- email_normalized, client_ip_address, fbp, fbc. Aggregates only -- never
-- select those columns as rows.

with bounds as (
  select date '{{WINDOW_START}}' as start_date,
         date '{{WINDOW_END}}'   as end_date,
         timestamptz '{{WINDOW_START}} 00:00:00 America/New_York'   as start_at,
         timestamptz '{{WINDOW_END}} 23:59:59.999 America/New_York' as end_at
),

arrivals as (
  select
    lower(btrim(coalesce(daily.ad_name, '(no utm_content)'))) as ad_key,
    daily.campaign_slug,
    sum(daily.arrivals)      as arrivals,
    sum(daily.paid_arrivals) as paid_arrivals
  from public.website_arrivals_daily as daily
  cross join bounds
  where daily.arrival_date between bounds.start_date and bounds.end_date
  group by 1, 2
),

lead_rollup as (
  select
    lower(btrim(coalesce(lead.utm_content, '(no utm_content)'))) as ad_key,
    lead.utm_campaign,
    count(*)                                                     as leads,
    count(*) filter (
      where lower(btrim(coalesce(lead.utm_source, ''))) in ('meta', 'facebook', 'instagram')
    )                                                            as meta_leads
  from public.leads as lead
  cross join bounds
  where lead.created_at between bounds.start_at and bounds.end_at
  group by 1, 2
),

assessment_rollup as (
  select
    lower(btrim(coalesce(lead.utm_content, '(no utm_content)'))) as ad_key,
    count(*)                                        as assessments_started,
    count(*) filter (
      where assessment.status = 'completed'
    )                                               as assessments_completed,
    count(*) filter (
      where assessment.property_revealed_at is not null
    )                                               as property_revealed
  from public.roof_assessments as assessment
  join public.leads as lead
    on lead.id = assessment.lead_id
   and lead.company_id = assessment.company_id
  cross join bounds
  where assessment.started_at between bounds.start_at and bounds.end_at
  group by 1
)

select
  coalesce(arrivals.ad_key, lead_rollup.ad_key, assessment_rollup.ad_key) as ad_key,
  arrivals.campaign_slug,
  lead_rollup.utm_campaign,
  coalesce(arrivals.arrivals, 0)                       as arrivals,
  coalesce(arrivals.paid_arrivals, 0)                  as paid_arrivals,
  coalesce(lead_rollup.leads, 0)                       as leads,
  coalesce(lead_rollup.meta_leads, 0)                  as meta_attributed_leads,
  coalesce(assessment_rollup.assessments_started, 0)   as assessments_started,
  coalesce(assessment_rollup.assessments_completed, 0) as assessments_completed,
  coalesce(assessment_rollup.property_revealed, 0)     as property_revealed,
  round(
    100.0 * coalesce(lead_rollup.leads, 0)
      / nullif(coalesce(arrivals.arrivals, 0), 0), 2
  )                                                    as arrival_to_lead_pct
from arrivals
full outer join lead_rollup       on lead_rollup.ad_key       = arrivals.ad_key
full outer join assessment_rollup on assessment_rollup.ad_key = coalesce(arrivals.ad_key, lead_rollup.ad_key)
order by leads desc nulls last, arrivals desc nulls last;

-- Interpretation notes:
--
-- * arrival_to_lead_pct is the honest landing-page conversion rate. Compare it
--   across ads only when check 6 shows utm_content coverage is good.
--
-- * A row with arrivals and zero leads is either a broken form, a mismatched
--   campaign promise, or bot traffic. Cross-check bot_share_pct from check 1
--   and Vercel runtime errors from check 7 before blaming the creative.
--
-- * A row with leads and zero arrivals means attribution is being lost between
--   middleware and intake -- that is a tracking defect, not an organic win.

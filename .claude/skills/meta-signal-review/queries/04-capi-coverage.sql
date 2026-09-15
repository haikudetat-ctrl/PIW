-- Check 4: Conversion coverage -- what fraction of real leads Meta received.
--
-- Source: public.meta_event_deliveries, public.leads (grade: LIVE, or UNKNOWN
-- on permission denied -- the ledger is service-role-only under RLS).
--
-- THIS PRODUCES HEADLINE B, the most important number in the report.
--
-- Meta's optimizer learns from the conversions it is told about. If coverage
-- is 40%, it is learning from 40% of reality and every cost figure in Ads
-- Manager is inflated by roughly 2.5x. Computable from Supabase alone: no
-- CSV export, no consent-gated source, no Meta API.
--
-- A permission denied here is an ACCESS finding, graded UNKNOWN. It is not
-- evidence that zero events were delivered -- do not let it read that way.

with bounds as (
  select timestamptz '{{WINDOW_START}} 00:00:00 America/New_York'   as start_at,
         timestamptz '{{WINDOW_END}} 23:59:59.999 America/New_York' as end_at
),

-- Every lead the server accepted in the window: the true conversion count.
eligible as (
  select
    count(*) as leads_total,
    count(*) filter (
      where lower(btrim(coalesce(lead.utm_source, ''))) in ('meta', 'facebook', 'instagram')
    ) as leads_meta_attributed
  from public.leads as lead
  cross join bounds
  where lead.created_at between bounds.start_at and bounds.end_at
),

-- What the delivery ledger recorded for leads created in that same window.
delivered as (
  select
    delivery.event_name,
    count(*)                                                       as ledger_rows,
    count(*) filter (where delivery.status = 'sent')               as sent,
    count(*) filter (where delivery.status = 'pending')            as pending,
    count(*) filter (where delivery.status = 'sending')            as sending,
    count(*) filter (where delivery.status = 'retryable_failed')   as retryable_failed,
    count(*) filter (where delivery.status = 'permanent_failed')   as permanent_failed,
    round(avg(delivery.attempt_count)::numeric, 2)                 as avg_attempts,
    max(delivery.attempt_count)                                    as max_attempts,
    round(
      extract(epoch from percentile_cont(0.5) within group (
        order by delivery.sent_at - delivery.event_time
      ))::numeric, 1
    )                                                              as median_delivery_lag_seconds
  from public.meta_event_deliveries as delivery
  join public.leads as lead
    on lead.id = delivery.lead_id
   and lead.company_id = delivery.company_id
  cross join bounds
  where lead.created_at between bounds.start_at and bounds.end_at
  group by delivery.event_name
)

select
  delivered.event_name,
  eligible.leads_total,
  eligible.leads_meta_attributed,
  delivered.ledger_rows,
  delivered.sent,
  delivered.pending,
  delivered.sending,
  delivered.retryable_failed,
  delivered.permanent_failed,
  delivered.avg_attempts,
  delivered.max_attempts,
  delivered.median_delivery_lag_seconds,
  -- HEADLINE B: sent events as a share of all real accepted leads.
  round(
    100.0 * delivered.sent / nullif(eligible.leads_total, 0), 1
  ) as coverage_of_all_leads_pct,
  -- The same share against Meta-attributed leads only -- the fairer read when
  -- a large part of intake is organic.
  round(
    100.0 * delivered.sent / nullif(eligible.leads_meta_attributed, 0), 1
  ) as coverage_of_meta_leads_pct
from delivered
cross join eligible
order by delivered.event_name;

-- 4b. Failure categories. Run when sent < ledger_rows. last_error_category is
-- a bounded category string, never a raw Meta response body -- safe to report.
--
-- with bounds as (
--   select timestamptz '{{WINDOW_START}} 00:00:00 America/New_York'   as start_at,
--          timestamptz '{{WINDOW_END}} 23:59:59.999 America/New_York' as end_at
-- )
-- select
--   delivery.event_name,
--   delivery.status,
--   coalesce(delivery.last_error_category, '(none)') as last_error_category,
--   delivery.meta_http_status,
--   count(*) as events
-- from public.meta_event_deliveries as delivery
-- cross join bounds
-- where delivery.updated_at between bounds.start_at and bounds.end_at
--   and delivery.status <> 'sent'
-- group by 1, 2, 3, 4
-- order by events desc;

-- Interpretation notes:
--
-- * Coverage of 0% while META_TRACKING_ENABLED is false is DARK and expected.
--   Coverage of 0% while tracking is ENABLED is a total pipeline failure.
--   These look identical in this query -- always read the flag first.
--
-- * 'retry_exhausted' after a fifth transient failure is terminal by design.
--   A cluster of them is an outage worth dating against Vercel deploys.
--
-- * A large median_delivery_lag_seconds degrades attribution quality even when
--   events eventually land. Meta weights fresh events more heavily.
--
-- * Coverage above 100% means duplicate delivery. The unique partial indexes
--   (meta_event_one_qualified_lead_idx and friends) should make this
--   impossible -- if you see it, the window boundaries are misaligned, not the
--   ledger. Re-check the timezone before reporting it.

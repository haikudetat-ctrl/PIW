-- Check 5: Lead distribution -- did the paid lead reach its buyer?
--
-- Source: public.lead_distribution_deliveries (grade: LIVE, or UNKNOWN on
-- permission denied -- service-role-only under RLS).
--
-- This is the check with the most direct revenue consequence in the report. A
-- rejection at ActiveProspect means money was spent acquiring a lead that
-- never reached the buyer. That is not a measurement problem; it is lost
-- revenue, attributable to a specific campaign bucket.
--
-- source_label is assigned by trigger from lead UTMs:
--   Meta70 <- utm_campaign in ('AS | Campaign 1', 'Meta70')
--   Meta30 <- utm_campaign in ('AS | Campaign 2', 'Meta30')
-- with utm_source in (meta, facebook, instagram). A campaign renamed in Ads
-- Manager without updating that trigger silently stops routing -- check 6
-- catches the symptom.
--
-- The ledger holds routing state only; contact data stays in public.leads.

with bounds as (
  select timestamptz '{{WINDOW_START}} 00:00:00 America/New_York'   as start_at,
         timestamptz '{{WINDOW_END}} 23:59:59.999 America/New_York' as end_at
)
select
  delivery.source_label,
  delivery.destination,
  count(*)                                                     as deliveries,
  count(*) filter (where delivery.status = 'sent')             as sent,
  count(*) filter (where delivery.status = 'pending')          as pending,
  count(*) filter (where delivery.status = 'sending')          as sending,
  count(*) filter (where delivery.status = 'rejected')         as rejected,
  count(*) filter (where delivery.status = 'retryable_failed') as retryable_failed,
  count(*) filter (where delivery.status = 'permanent_failed') as permanent_failed,
  round(
    100.0 * count(*) filter (where delivery.status = 'sent')
      / nullif(count(*), 0), 1
  )                                                            as sent_pct,
  round(avg(delivery.attempt_count)::numeric, 2)               as avg_attempts,
  round(
    extract(epoch from percentile_cont(0.5) within group (
      order by delivery.sent_at - delivery.created_at
    ))::numeric, 1
  )                                                            as median_seconds_to_send
from public.lead_distribution_deliveries as delivery
cross join bounds
where delivery.created_at between bounds.start_at and bounds.end_at
group by rollup (delivery.source_label, delivery.destination)
order by delivery.source_label nulls last, delivery.destination nulls last;

-- 5b. Rejection and failure reasons. `outcome` and `last_error` are bounded
-- text written by the integration. Scan before quoting: do not copy any
-- fragment that echoes a homeowner's contact detail into the report.
--
-- with bounds as (
--   select timestamptz '{{WINDOW_START}} 00:00:00 America/New_York'   as start_at,
--          timestamptz '{{WINDOW_END}} 23:59:59.999 America/New_York' as end_at
-- )
-- select
--   delivery.source_label,
--   delivery.destination,
--   delivery.status,
--   coalesce(delivery.outcome, '(none)') as outcome,
--   count(*) as deliveries
-- from public.lead_distribution_deliveries as delivery
-- cross join bounds
-- where delivery.created_at between bounds.start_at and bounds.end_at
--   and delivery.status in ('rejected', 'permanent_failed', 'retryable_failed')
-- group by 1, 2, 3, 4
-- order by deliveries desc;

-- Interpretation notes:
--
-- * Sustained 'pending' or 'sending' means the worker is not draining. Check
--   Vercel and Inngest before reading anything else here -- a stalled queue
--   makes every rate below it meaningless.
--
-- * Rejections concentrated in one source_label point at lead quality from
--   that campaign bucket. That IS an ads finding, and one of the few this
--   skill can make confidently without any Meta data at all.
--
-- * Zero rows for a source_label that check 3 shows receiving leads means the
--   routing trigger did not match the UTM values. Compare against the literal
--   campaign names above; someone probably renamed a campaign.

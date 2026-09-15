-- Check 2: Consent yield -- how much of reality can any tracker see?
--
-- Source: public.privacy_consent_evidence (grade: LIVE).
--
-- This is the multiplier that bounds every browser-side source in the report.
-- If advertising consent runs at 30%, then Meta can observe at most 30% of
-- conversions no matter how healthy the CAPI pipeline is, and PostHog is
-- biased by the analytics rate the same way.
--
-- Read this BEFORE interpreting checks 4, 8, or 9. A low coverage number in
-- check 4 is a pipeline fault only if consent yield is high; otherwise it is
-- consent, and the fix is a consent-UX change, not a CAPI change.
--
-- NOTE: rows are consent DECISIONS, not visitors. A visitor who never
-- interacts with the notice produces no row at all -- so compare the decision
-- count against arrivals from check 1 to size the silent majority.
--
-- PII: request_ip and user_agent exist on this table. Never select them.

with bounds as (
  select timestamptz '{{WINDOW_START}} 00:00:00 America/New_York' as start_at,
         timestamptz '{{WINDOW_END}} 23:59:59.999 America/New_York' as end_at
)
select
  evidence.source,
  count(*)                                                        as decisions,
  count(*) filter (where evidence.analytics_granted)              as analytics_granted,
  count(*) filter (where evidence.advertising_granted)            as advertising_granted,
  count(*) filter (where evidence.gpc_detected)                   as gpc_detected,
  round(
    100.0 * count(*) filter (where evidence.analytics_granted)
      / nullif(count(*), 0), 1
  )                                                               as analytics_grant_pct,
  round(
    100.0 * count(*) filter (where evidence.advertising_granted)
      / nullif(count(*), 0), 1
  )                                                               as advertising_grant_pct,
  round(
    100.0 * count(*) filter (where evidence.gpc_detected)
      / nullif(count(*), 0), 1
  )                                                               as gpc_pct
from public.privacy_consent_evidence as evidence
cross join bounds
where evidence.occurred_at between bounds.start_at and bounds.end_at
group by rollup (evidence.source)
order by evidence.source nulls last;

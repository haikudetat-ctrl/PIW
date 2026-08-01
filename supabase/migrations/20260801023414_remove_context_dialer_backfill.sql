-- The first production rollout briefly backfilled historical estimates. Keep
-- the QA Slack stream scoped to leads enriched after this feature deploys.
delete from public.context_dialer_deliveries
where status = 'queued'
  and attempt_count = 0
  and sent_at is null;

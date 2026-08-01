-- Keep the customer-facing estimate in sync with terminal address review.
-- Future transitions are handled by the address-validation worker; this
-- backfills requests created before that worker update was deployed.
alter table public.roof_estimates
  drop constraint roof_estimates_status_check;

alter table public.roof_estimates
  add constraint roof_estimates_status_check check (
    status in (
      'pending',
      'review_required',
      'ready',
      'no_coverage',
      'quota_exhausted',
      'failed'
    )
  );

update public.roof_estimates as estimate
set status = 'review_required',
    failure_reason = coalesce(
      estimate.failure_reason,
      'Address match requires manual review'
    ),
    updated_at = now()
from public.pipeline_runs as pipeline
where pipeline.lead_id = estimate.lead_id
  and pipeline.company_id = estimate.company_id
  and pipeline.status = 'review_required'
  and estimate.status = 'pending';

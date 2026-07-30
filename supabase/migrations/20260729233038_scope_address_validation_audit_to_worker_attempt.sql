drop index if exists public.audit_log_address_validation_action_idx;

alter table public.audit_log
  add column worker_run_id uuid references public.worker_runs(id);

create index audit_log_worker_run_id_idx
  on public.audit_log(worker_run_id);

-- Correlation IDs intentionally span retries. The worker-run key identifies
-- one concrete attempt, so replay/concurrency deduplicate without collapsing
-- a later reviewer-requested attempt.
create unique index audit_log_address_validation_worker_attempt_idx
  on public.audit_log(company_id, action, worker_run_id)
  where entity_type = 'property'
    and worker_run_id is not null
    and action in (
      'property.address_validated',
      'property.address_validation_review_required'
    );

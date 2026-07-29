-- Worker retries and concurrent event delivery must not duplicate the audit
-- entry for one action in one worker attempt. This generalizes the
-- address-validation-only guard added in the previous migration so later
-- property workers inherit the same invariant.
drop index if exists public.audit_log_address_validation_worker_attempt_idx;

create unique index audit_log_property_worker_attempt_idx
  on public.audit_log(company_id, action, worker_run_id)
  where worker_run_id is not null;

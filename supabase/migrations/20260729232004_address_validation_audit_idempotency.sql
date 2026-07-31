-- A completed address-validation worker guarantees its audit entry exists.
-- This partial key makes retries and concurrent delivery safe without
-- constraining unrelated audit events.
create unique index audit_log_address_validation_action_idx
  on public.audit_log(company_id, action, entity_id, correlation_id)
  where entity_type = 'property'
    and action in (
      'property.address_validated',
      'property.address_validation_review_required'
    );

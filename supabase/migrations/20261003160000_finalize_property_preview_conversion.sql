-- Finishes converting a property preview into a lead after the canonical
-- intake transaction (start_or_resume_roof_assessment) has accepted the
-- homeowner's contact details for the same submission.
--
-- * estimate_processing evidence is rewritten to the address-step notice the
--   homeowner actually accepted (its disclosure version and time). The contact
--   consents keep the contact-step notice written by intake.
-- * The three pre-contact answers seed the assessment. On a resumed assessment,
--   answers already given there win. The reveal is marked seen and the refine
--   questionnaire starts after the answered questions.
-- * The preview becomes converted and links to the lead.

create function public.finalize_property_preview_conversion(
  p_company_id uuid,
  p_token_hash text,
  p_submission_id uuid
) returns table (lead_id uuid, attempt_kind text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview public.property_previews%rowtype;
  v_attempt public.roof_assessment_access_attempts%rowtype;
begin
  select preview.* into v_preview
  from public.property_previews as preview
  where preview.company_id = p_company_id
    and preview.token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'Preview not found';
  end if;

  select attempt.* into v_attempt
  from public.roof_assessment_access_attempts as attempt
  where attempt.company_id = p_company_id
    and attempt.submission_id = p_submission_id;

  if not found then
    raise exception 'Preview conversion has no accepted intake';
  end if;

  if v_preview.status = 'converted' then
    if v_preview.submission_id = p_submission_id then
      return query select v_preview.converted_lead_id, v_attempt.attempt_kind;
      return;
    end if;
    raise exception 'Preview is already converted';
  end if;
  if v_preview.status <> 'active' or v_preview.expires_at <= pg_catalog.now() then
    raise exception 'Preview is not active';
  end if;

  if v_attempt.attempt_kind = 'new' then
    update public.lead_consent_evidence as evidence
    set disclosure_version = v_preview.processing_disclosure_version,
        granted_at = v_preview.processing_accepted_at
    where evidence.company_id = p_company_id
      and evidence.submission_id = p_submission_id
      and evidence.consent_type = 'estimate_processing';

    update public.lead_consents as consent
    set disclosure_version = v_preview.processing_disclosure_version,
        granted_at = v_preview.processing_accepted_at
    where consent.company_id = p_company_id
      and consent.lead_id = v_attempt.lead_id
      and consent.consent_type = 'estimate_processing';
  end if;

  -- The homeowner already saw the property and answered reason and roof age
  -- on the preview, so the optional refine questionnaire skips the reveal and
  -- starts at the first question they have not answered (step 2).
  update public.roof_assessments as assessment
  set responses = v_preview.responses || assessment.responses,
      property_revealed_at = coalesce(assessment.property_revealed_at, v_preview.revealed_at, pg_catalog.now()),
      current_step = case
        when (v_preview.responses || assessment.responses) ?& array['reason', 'roofAge']
          then greatest(assessment.current_step, 2)
        else assessment.current_step
      end,
      revision = assessment.revision + 1,
      updated_at = pg_catalog.now()
  where assessment.company_id = p_company_id
    and assessment.id = v_attempt.assessment_id
    and assessment.status = 'in_progress';

  update public.property_previews as preview
  set status = 'converted',
      converted_lead_id = v_attempt.lead_id,
      submission_id = p_submission_id,
      updated_at = pg_catalog.now()
  where preview.id = v_preview.id;

  return query select v_attempt.lead_id, v_attempt.attempt_kind;
end;
$$;

revoke all on function public.finalize_property_preview_conversion(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.finalize_property_preview_conversion(uuid, text, uuid) to service_role;

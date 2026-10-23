-- Fast quote booking asks "Do you own this home?" right before the calendar,
-- ahead of the assessment's own order (ownership is its last step). This saves
-- that one answer early without moving the step pointer, the same way the
-- value-first preview already seeds the timeline answer ahead of its step.
-- The ordered questions still finish through save_roof_assessment_progress and
-- complete_roof_assessment; the ownership step then confirms the saved answer.

create function public.save_roof_assessment_ownership(
  p_company_id uuid,
  p_assessment_id uuid,
  p_expected_revision bigint,
  p_ownership text,
  p_scores jsonb,
  p_high_intent boolean
) returns table (
  applied boolean, id uuid, revision bigint, status text, current_step integer,
  property_revealed_at timestamptz, last_answered_at timestamptz,
  responses jsonb, recommendation text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assessment public.roof_assessments%rowtype;
  v_property_id uuid;
  v_pipeline_run_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_event jsonb;
begin
  if p_expected_revision < 0
    or p_ownership is null
    or p_ownership not in ('owner','buying','manager','not_owner')
    or pg_catalog.jsonb_typeof(p_scores) <> 'object'
  then
    raise exception 'Invalid assessment ownership';
  end if;

  select assessment.* into v_assessment
  from public.roof_assessments as assessment
  where assessment.id = p_assessment_id and assessment.company_id = p_company_id
  for update;
  if not found or v_assessment.status <> 'in_progress' then
    raise exception 'Assessment progress is unavailable';
  end if;

  if v_assessment.revision <> p_expected_revision then
    return query select false, v_assessment.id, v_assessment.revision,
      v_assessment.status, v_assessment.current_step,
      v_assessment.property_revealed_at, v_assessment.last_answered_at,
      v_assessment.responses, v_assessment.recommendation;
    return;
  end if;

  update public.roof_assessments as assessment
  set responses = coalesce(assessment.responses, '{}'::jsonb)
        || pg_catalog.jsonb_build_object('ownership', p_ownership),
      scores = p_scores,
      revision = assessment.revision + 1,
      last_answered_at = v_now,
      updated_at = v_now
  where assessment.id = p_assessment_id and assessment.company_id = p_company_id
  returning assessment.* into v_assessment;

  -- Same high-intent signal (and idempotency key) as save_roof_assessment_progress.
  if coalesce(p_high_intent, false) then
    select estimate.property_id
    into v_property_id
    from public.roof_estimates as estimate
    where estimate.id = v_assessment.estimate_id and estimate.company_id = p_company_id;
    select run.id into v_pipeline_run_id
    from public.pipeline_runs as run
    where run.company_id = p_company_id and run.lead_id = v_assessment.lead_id
    order by run.started_at desc, run.id limit 1;
    v_event := pg_catalog.jsonb_build_object(
      'id', extensions.gen_random_uuid(), 'name', 'roof/assessment.high_intent', 'schemaVersion', 1,
      'correlationId', v_assessment.id, 'leadId', v_assessment.lead_id,
      'propertyId', v_property_id, 'pipelineRunId', v_pipeline_run_id,
      'occurredAt', pg_catalog.to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'idempotencyKey', 'roof/assessment.high_intent:' || v_assessment.id::text,
      'data', pg_catalog.jsonb_build_object(
        'assessmentId', v_assessment.id,
        'intent', coalesce((p_scores->>'intent')::integer, 0),
        'urgency', coalesce((p_scores->>'urgency')::integer, 0)
      )
    );
    perform public.enqueue_domain_event(p_company_id, v_event);
  end if;

  return query select true, v_assessment.id, v_assessment.revision,
    v_assessment.status, v_assessment.current_step,
    v_assessment.property_revealed_at, v_assessment.last_answered_at,
    v_assessment.responses, v_assessment.recommendation;
end;
$$;

revoke execute on function public.save_roof_assessment_ownership(
  uuid, uuid, bigint, text, jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.save_roof_assessment_ownership(
  uuid, uuid, bigint, text, jsonb, boolean
) to service_role;

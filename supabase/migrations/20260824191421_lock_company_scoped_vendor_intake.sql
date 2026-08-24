-- Serialize same-tenant vendor retries before the duplicate lookup. The
-- company-scoped unique index remains the final constraint, while this lock
-- lets concurrent callers deterministically replay the first accepted graph.
create or replace function public.submit_lead_intake_from_source(
  p_company_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_submitted_address text,
  p_notes text,
  p_correlation_id uuid,
  p_pipeline_version integer,
  p_source_system text,
  p_external_lead_id text default null,
  p_source_account_id text default null,
  p_source_record_id text default null,
  p_original_lead_source text default null,
  p_campaign text default null,
  p_consent_reference text default null,
  p_trustedform_url text default null,
  p_is_test boolean default false,
  p_phone_e164 text default null,
  p_email_normalized text default null
) returns table (
  lead_id uuid,
  property_id uuid,
  pipeline_run_id uuid,
  is_duplicate boolean
)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_property_id uuid;
  v_lead_id uuid;
  v_pipeline_run_id uuid;
begin
  if p_external_lead_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_company_id::text || ':' || p_source_system || ':' || p_external_lead_id,
        0
      )
    );

    select lead.id, lead.property_id into v_lead_id, v_property_id
    from public.leads as lead
    where lead.company_id = p_company_id
      and lead.source_system = p_source_system
      and lead.external_lead_id = p_external_lead_id;
  end if;

  if v_lead_id is not null then
    select run.id into v_pipeline_run_id
    from public.pipeline_runs as run
    where run.company_id = p_company_id
      and run.lead_id = v_lead_id
    order by run.started_at desc
    limit 1;

    return query select v_lead_id, v_property_id, v_pipeline_run_id, true;
    return;
  end if;

  insert into public.properties (company_id, resolution_status)
  values (p_company_id, 'unresolved')
  returning id into v_property_id;

  insert into public.leads (
    company_id, property_id, name, phone, email, submitted_address, notes,
    source_system, external_lead_id, source_account_id, source_record_id,
    original_lead_source, campaign, consent_reference, trustedform_url,
    is_test, phone_e164, email_normalized
  ) values (
    p_company_id, v_property_id, p_name, p_phone, p_email, p_submitted_address, p_notes,
    p_source_system, p_external_lead_id, p_source_account_id, p_source_record_id,
    p_original_lead_source, p_campaign, p_consent_reference, p_trustedform_url,
    p_is_test, p_phone_e164, p_email_normalized
  )
  returning id into v_lead_id;

  insert into public.pipeline_runs (
    company_id, lead_id, property_id, correlation_id, pipeline_version, status
  ) values (
    p_company_id, v_lead_id, v_property_id, p_correlation_id, p_pipeline_version, 'received'
  )
  returning id into v_pipeline_run_id;

  return query select v_lead_id, v_property_id, v_pipeline_run_id, false;
end;
$$;

revoke all on function public.submit_lead_intake_from_source(
  uuid, text, text, text, text, text, uuid, integer, text, text, text, text,
  text, text, text, text, boolean, text, text
) from public, anon, authenticated;

grant execute on function public.submit_lead_intake_from_source(
  uuid, text, text, text, text, text, uuid, integer, text, text, text, text,
  text, text, text, text, boolean, text, text
) to service_role;

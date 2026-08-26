alter table public.leads
  drop constraint leads_service_requested_check;

alter table public.leads
  add constraint leads_service_requested_check
  check (service_requested in ('roofing', 'solar', 'both')),
  add column source_submitted_at timestamptz;

create or replace function public.submit_all_season_lead(
  p_company_id uuid,
  p_submission_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_submitted_address text,
  p_service_requested text,
  p_submitted_at timestamptz,
  p_attribution jsonb,
  p_disclosure_version text,
  p_ip_address text,
  p_user_agent text,
  p_pipeline_version integer,
  p_phone_e164 text,
  p_email_normalized text
) returns table (
  lead_id uuid,
  property_id uuid,
  pipeline_run_id uuid,
  is_duplicate boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property_id uuid;
  v_lead_id uuid;
  v_pipeline_run_id uuid;
begin
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'All Season intake company does not exist';
  end if;
  if length(trim(p_name)) = 0 or length(trim(p_phone)) = 0
     or length(trim(p_email)) = 0 or length(trim(p_submitted_address)) = 0 then
    raise exception 'All Season contact and address fields are required';
  end if;
  if p_service_requested not in ('roofing', 'solar', 'both') then
    raise exception 'Unsupported All Season service requested';
  end if;
  if length(trim(p_disclosure_version)) = 0 then
    raise exception 'All Season consent disclosure version is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('all-season-website:' || p_submission_id::text, 0)
  );

  select lead.id, lead.property_id
  into v_lead_id, v_property_id
  from public.leads as lead
  where lead.source_system = 'all-season-website'
    and lead.external_lead_id = p_submission_id::text;

  if v_lead_id is not null then
    select run.id
    into v_pipeline_run_id
    from public.pipeline_runs as run
    where run.lead_id = v_lead_id
    order by run.started_at desc
    limit 1;

    return query select v_lead_id, v_property_id, v_pipeline_run_id, true;
    return;
  end if;

  insert into public.properties (company_id, resolution_status)
  values (p_company_id, 'unresolved')
  returning id into v_property_id;

  insert into public.leads (
    company_id, property_id, name, phone, email, submitted_address,
    service_requested, notes, source_system, external_lead_id,
    original_lead_source, campaign, consent_reference, phone_e164,
    email_normalized, fbclid, fbp, fbc, source_submitted_at
  ) values (
    p_company_id, v_property_id, trim(p_name), trim(p_phone), lower(trim(p_email)),
    trim(p_submitted_address), p_service_requested,
    'Submitted through the All Season website quote form.',
    'all-season-website', p_submission_id::text, 'website-quote',
    'all-season-quote', p_disclosure_version, nullif(trim(p_phone_e164), ''),
    lower(nullif(trim(p_email_normalized), '')), p_attribution ->> 'fbclid',
    p_attribution ->> 'fbp', p_attribution ->> 'fbc', p_submitted_at
  ) returning id into v_lead_id;

  insert into public.pipeline_runs (
    company_id, lead_id, property_id, correlation_id, pipeline_version, status
  ) values (
    p_company_id, v_lead_id, v_property_id, p_submission_id,
    p_pipeline_version, 'received'
  ) returning id into v_pipeline_run_id;

  insert into public.lead_consents (
    company_id, lead_id, consent_type, granted, disclosure_version,
    ip_address, user_agent
  )
  select p_company_id, v_lead_id, consent_type, true, p_disclosure_version,
         nullif(trim(coalesce(p_ip_address, '')), '')::inet, p_user_agent
  from unnest(array[
    'estimate_processing', 'email_contact', 'sms_contact'
  ]) as consent_type;

  return query select v_lead_id, v_property_id, v_pipeline_run_id, false;
end;
$$;

revoke all on function public.submit_all_season_lead(
  uuid, uuid, text, text, text, text, text, timestamptz, jsonb, text, text,
  text, integer, text, text
) from public, anon, authenticated;

grant execute on function public.submit_all_season_lead(
  uuid, uuid, text, text, text, text, text, timestamptz, jsonb, text, text,
  text, integer, text, text
) to service_role;

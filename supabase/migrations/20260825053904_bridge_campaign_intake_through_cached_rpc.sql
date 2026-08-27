-- PostgREST in production retained the existing submit_all_season_lead
-- signature but did not discover the newly-created campaign RPC. Keep the
-- cached signature stable and let Postgres dispatch campaign submissions to
-- the atomic campaign transaction internally.
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
  p_email_normalized text,
  p_google_place_id text
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
  v_campaign_slug text;
begin
  v_campaign_slug := nullif(
    pg_catalog.btrim(coalesce(p_attribution ->> '_campaign_slug', '')),
    ''
  );

  if v_campaign_slug is not null then
    return query
      select campaign.lead_id,
             campaign.property_id,
             campaign.pipeline_run_id,
             campaign.is_duplicate
      from public.submit_all_season_campaign_estimate(
        p_company_id,
        p_submission_id,
        p_name,
        p_phone,
        p_email,
        p_submitted_address,
        v_campaign_slug,
        p_submitted_at,
        p_attribution - '_campaign_slug',
        p_disclosure_version,
        p_ip_address,
        p_user_agent,
        p_submission_id,
        p_pipeline_version,
        p_google_place_id
      ) as campaign;
    return;
  end if;

  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'All Season intake company does not exist';
  end if;
  if pg_catalog.length(pg_catalog.btrim(p_name)) = 0
     or pg_catalog.length(pg_catalog.btrim(p_phone)) = 0
     or pg_catalog.length(pg_catalog.btrim(p_email)) = 0
     or pg_catalog.length(pg_catalog.btrim(p_submitted_address)) = 0 then
    raise exception 'All Season contact and address fields are required';
  end if;
  if p_service_requested not in ('roofing', 'solar', 'both') then
    raise exception 'Unsupported All Season service requested';
  end if;
  if pg_catalog.length(pg_catalog.btrim(p_disclosure_version)) = 0 then
    raise exception 'All Season consent disclosure version is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_company_id::text || ':all-season-website:' || p_submission_id::text,
      0
    )
  );

  select lead.id, lead.property_id
  into v_lead_id, v_property_id
  from public.leads as lead
  where lead.company_id = p_company_id
    and lead.source_system = 'all-season-website'
    and lead.external_lead_id = p_submission_id::text;

  if v_lead_id is not null then
    select run.id
    into v_pipeline_run_id
    from public.pipeline_runs as run
    where run.company_id = p_company_id
      and run.lead_id = v_lead_id
    order by run.started_at desc
    limit 1;

    insert into public.roof_estimates (
      company_id, lead_id, property_id, google_place_id
    ) values (
      p_company_id, v_lead_id, v_property_id,
      nullif(pg_catalog.btrim(p_google_place_id), '')
    )
    on conflict on constraint roof_estimates_lead_id_key do nothing;

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
    email_normalized, google_place_id, fbclid, fbp, fbc, source_submitted_at
  ) values (
    p_company_id, v_property_id, pg_catalog.btrim(p_name),
    pg_catalog.btrim(p_phone), pg_catalog.lower(pg_catalog.btrim(p_email)),
    pg_catalog.btrim(p_submitted_address), p_service_requested,
    'Submitted through the All Season website quote form.',
    'all-season-website', p_submission_id::text, 'website-quote',
    'all-season-quote', p_disclosure_version,
    nullif(pg_catalog.btrim(p_phone_e164), ''),
    pg_catalog.lower(nullif(pg_catalog.btrim(p_email_normalized), '')),
    nullif(pg_catalog.btrim(p_google_place_id), ''),
    p_attribution ->> 'fbclid', p_attribution ->> 'fbp',
    p_attribution ->> 'fbc', p_submitted_at
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
  select p_company_id, v_lead_id, consent_type, true,
         p_disclosure_version,
         nullif(pg_catalog.btrim(coalesce(p_ip_address, '')), '')::inet,
         p_user_agent
  from pg_catalog.unnest(array[
    'estimate_processing', 'email_contact', 'sms_contact'
  ]) as consent_type;

  insert into public.roof_estimates (
    company_id, lead_id, property_id, google_place_id
  ) values (
    p_company_id, v_lead_id, v_property_id,
    nullif(pg_catalog.btrim(p_google_place_id), '')
  );

  return query select v_lead_id, v_property_id, v_pipeline_run_id, false;
end;
$$;

revoke all on function public.submit_all_season_lead(
  uuid, uuid, text, text, text, text, text, timestamptz, jsonb, text, text,
  text, integer, text, text, text
) from public, anon, authenticated;

grant execute on function public.submit_all_season_lead(
  uuid, uuid, text, text, text, text, text, timestamptz, jsonb, text, text,
  text, integer, text, text, text
) to service_role;

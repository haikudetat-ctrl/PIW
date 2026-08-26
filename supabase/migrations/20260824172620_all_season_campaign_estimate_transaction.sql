-- Atomic, idempotent intake for the All Season campaign estimate funnel.
-- The server alone may invoke this RPC; it persists attribution and consent
-- evidence in the same transaction as the property, lead, pipeline, and quote.

alter table public.leads
  add column utm_source text,
  add column utm_medium text,
  add column utm_campaign text,
  add column utm_term text,
  add column utm_content text;

-- The former global key prevented one tenant from receiving an external source
-- identifier already used by another tenant. Campaign retries are idempotent
-- within their company only.
drop index public.leads_source_external_id_idx;

create unique index leads_company_source_external_id_idx
  on public.leads(company_id, source_system, external_lead_id)
  where external_lead_id is not null;

create function public.submit_all_season_campaign_estimate(
  p_company_id uuid,
  p_submission_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_submitted_address text,
  p_campaign_slug text,
  p_submitted_at timestamptz,
  p_attribution jsonb,
  p_disclosure_version text,
  p_ip_address text,
  p_user_agent text,
  p_correlation_id uuid,
  p_pipeline_version integer,
  p_google_place_id text default null
) returns table (
  lead_id uuid,
  property_id uuid,
  pipeline_run_id uuid,
  estimate_id uuid,
  public_token uuid,
  event_id uuid,
  event_payload jsonb,
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
  v_estimate_id uuid;
  v_public_token uuid;
  v_event_id uuid;
  v_event_payload jsonb;
  v_event_occurred_at timestamptz;
  v_google_place_id text;
  v_client_ip inet;
  v_client_user_agent text;
begin
  if not exists (
    select 1
    from public.companies as company
    where company.id = p_company_id
  ) then
    raise exception 'All Season campaign company does not exist';
  end if;

  if p_submission_id is null then
    raise exception 'All Season campaign submission ID is required';
  end if;
  if p_correlation_id is null then
    raise exception 'All Season campaign correlation ID is required';
  end if;
  if p_pipeline_version is null or p_pipeline_version < 1 then
    raise exception 'All Season campaign pipeline version must be positive';
  end if;
  if p_submitted_at is null then
    raise exception 'All Season campaign submitted timestamp is required';
  end if;
  if p_attribution is null or pg_catalog.jsonb_typeof(p_attribution) <> 'object' then
    raise exception 'All Season campaign attribution must be a JSON object';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_name, ''))) = 0
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_phone, ''))) = 0
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_email, ''))) = 0
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_submitted_address, ''))) = 0
  then
    raise exception 'All Season campaign contact and address fields are required';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_campaign_slug, ''))) = 0 then
    raise exception 'All Season campaign slug is required';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_disclosure_version, ''))) = 0 then
    raise exception 'All Season campaign consent disclosure version is required';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_ip_address, ''))) = 0 then
    raise exception 'All Season campaign IP address is required';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_user_agent, ''))) = 0 then
    raise exception 'All Season campaign user agent is required';
  end if;

  begin
    v_client_ip := pg_catalog.btrim(p_ip_address)::inet;
  exception
    when invalid_text_representation then
      raise exception 'All Season campaign IP address is invalid';
  end;
  v_client_user_agent := pg_catalog.btrim(p_user_agent);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_company_id::text || ':all-season-campaign:' || p_submission_id::text,
      0
    )
  );

  select lead.id,
         lead.property_id,
         run.id,
         estimate.id,
         estimate.public_token,
         event.id,
         event.payload
  into v_lead_id,
       v_property_id,
       v_pipeline_run_id,
       v_estimate_id,
       v_public_token,
       v_event_id,
       v_event_payload
  from public.leads as lead
  join public.pipeline_runs as run
    on run.lead_id = lead.id
   and run.company_id = lead.company_id
  join public.roof_estimates as estimate
    on estimate.lead_id = lead.id
   and estimate.company_id = lead.company_id
  join public.domain_events as event
    on event.company_id = lead.company_id
   and event.pipeline_run_id = run.id
   and event.idempotency_key = 'crm/lead.submitted:' || run.id::text
  where lead.company_id = p_company_id
    and lead.source_system = 'all-season-campaign'
    and lead.external_lead_id = p_submission_id::text
  order by run.started_at asc, run.id asc
  limit 1;

  if found then
    return query
      select v_lead_id,
             v_property_id,
             v_pipeline_run_id,
             v_estimate_id,
             v_public_token,
             v_event_id,
             v_event_payload,
             true;
    return;
  end if;

  insert into public.properties (company_id, resolution_status)
  values (p_company_id, 'unresolved')
  returning id into v_property_id;

  insert into public.leads (
    company_id,
    property_id,
    name,
    phone,
    email,
    submitted_address,
    service_requested,
    notes,
    source_system,
    external_lead_id,
    original_lead_source,
    campaign,
    consent_reference,
    source_submitted_at,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_term,
    utm_content,
    fbclid,
    fbp,
    fbc,
    client_ip_address,
    client_user_agent
  ) values (
    p_company_id,
    v_property_id,
    pg_catalog.btrim(p_name),
    pg_catalog.btrim(p_phone),
    pg_catalog.lower(pg_catalog.btrim(p_email)),
    pg_catalog.btrim(p_submitted_address),
    'roofing',
    'Submitted through an All Season campaign landing page.',
    'all-season-campaign',
    p_submission_id::text,
    'campaign-landing-page',
    pg_catalog.btrim(p_campaign_slug),
    pg_catalog.btrim(p_disclosure_version),
    p_submitted_at,
    nullif(pg_catalog.btrim(p_attribution ->> 'utm_source'), ''),
    nullif(pg_catalog.btrim(p_attribution ->> 'utm_medium'), ''),
    nullif(pg_catalog.btrim(p_attribution ->> 'utm_campaign'), ''),
    nullif(pg_catalog.btrim(p_attribution ->> 'utm_term'), ''),
    nullif(pg_catalog.btrim(p_attribution ->> 'utm_content'), ''),
    nullif(pg_catalog.btrim(p_attribution ->> 'fbclid'), ''),
    nullif(pg_catalog.btrim(p_attribution ->> 'fbp'), ''),
    nullif(pg_catalog.btrim(p_attribution ->> 'fbc'), ''),
    v_client_ip,
    v_client_user_agent
  )
  returning id into v_lead_id;

  insert into public.pipeline_runs (
    company_id,
    lead_id,
    property_id,
    correlation_id,
    pipeline_version,
    status
  ) values (
    p_company_id,
    v_lead_id,
    v_property_id,
    p_correlation_id,
    p_pipeline_version,
    'received'
  )
  returning id into v_pipeline_run_id;

  insert into public.lead_consents (
    company_id,
    lead_id,
    consent_type,
    granted,
    disclosure_version,
    source,
    ip_address,
    user_agent
  )
  select p_company_id,
         v_lead_id,
         consent_type,
         true,
         pg_catalog.btrim(p_disclosure_version),
         'all_season_campaign',
         v_client_ip,
         v_client_user_agent
  from pg_catalog.unnest(array[
    'estimate_processing',
    'email_contact',
    'sms_contact'
  ]) as consent_type;

  insert into public.roof_estimates as estimate (
    company_id,
    lead_id,
    property_id,
    google_place_id
  ) values (
    p_company_id,
    v_lead_id,
    v_property_id,
    nullif(pg_catalog.btrim(coalesce(p_google_place_id, '')), '')
  )
  returning estimate.id, estimate.public_token
  into v_estimate_id, v_public_token;

  v_google_place_id := nullif(pg_catalog.btrim(coalesce(p_google_place_id, '')), '');
  v_event_id := extensions.gen_random_uuid();
  v_event_occurred_at := pg_catalog.clock_timestamp();
  v_event_payload := pg_catalog.jsonb_strip_nulls(
    pg_catalog.jsonb_build_object(
      'id', v_event_id,
      'name', 'crm/lead.submitted',
      'schemaVersion', 1,
      'correlationId', p_correlation_id,
      'leadId', v_lead_id,
      'propertyId', v_property_id,
      'pipelineRunId', v_pipeline_run_id,
      'occurredAt', pg_catalog.to_char(
        v_event_occurred_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'idempotencyKey', 'crm/lead.submitted:' || v_pipeline_run_id::text,
      'data', pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'leadId', v_lead_id,
          'propertyId', v_property_id,
          'name', pg_catalog.btrim(p_name),
          'phone', pg_catalog.btrim(p_phone),
          'email', pg_catalog.lower(pg_catalog.btrim(p_email)),
          'submittedAddress', pg_catalog.btrim(p_submitted_address),
          'googlePlaceId', v_google_place_id,
          'serviceRequested', 'roofing',
          'notes', 'Submitted through the ' || pg_catalog.btrim(p_campaign_slug)
            || ' All Season campaign.'
        )
      )
    )
  );

  insert into public.domain_events (
    id,
    company_id,
    pipeline_run_id,
    event_name,
    schema_version,
    correlation_id,
    idempotency_key,
    payload,
    occurred_at
  ) values (
    v_event_id,
    p_company_id,
    v_pipeline_run_id,
    'crm/lead.submitted',
    1,
    p_correlation_id,
    'crm/lead.submitted:' || v_pipeline_run_id::text,
    v_event_payload,
    v_event_occurred_at
  );

  insert into public.event_outbox (event_id)
  values (v_event_id);

  return query
    select v_lead_id,
           v_property_id,
           v_pipeline_run_id,
           v_estimate_id,
           v_public_token,
           v_event_id,
           v_event_payload,
           false;
end;
$$;

revoke execute on function public.submit_all_season_campaign_estimate(
  uuid, uuid, text, text, text, text, text, timestamptz, jsonb, text, text,
  text, uuid, integer, text
) from public, anon, authenticated;

grant execute on function public.submit_all_season_campaign_estimate(
  uuid, uuid, text, text, text, text, text, timestamptz, jsonb, text, text,
  text, uuid, integer, text
) to service_role;

-- The company-scoped external-ID key above changes the duplicate boundary for
-- every intake path. Keep the established function signatures and grants, but
-- scope legacy duplicate lookups to their requested tenant as well.
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
    hashtextextended(
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
      p_company_id, v_lead_id, v_property_id, nullif(trim(p_google_place_id), '')
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
    p_company_id, v_property_id, trim(p_name), trim(p_phone), lower(trim(p_email)),
    trim(p_submitted_address), p_service_requested,
    'Submitted through the All Season website quote form.',
    'all-season-website', p_submission_id::text, 'website-quote',
    'all-season-quote', p_disclosure_version, nullif(trim(p_phone_e164), ''),
    lower(nullif(trim(p_email_normalized), '')), nullif(trim(p_google_place_id), ''),
    p_attribution ->> 'fbclid',
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

  insert into public.roof_estimates (
    company_id, lead_id, property_id, google_place_id
  ) values (
    p_company_id, v_lead_id, v_property_id, nullif(trim(p_google_place_id), '')
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

-- Canonical, resumable homeowner assessment journey. Public callers never
-- receive a lead, estimate, assessment, or existing public-token identifier.

alter table public.roof_assessments
  add column presentation_key text not null default 'all-season-main'
    check (pg_catalog.length(pg_catalog.btrim(presentation_key)) > 0),
  add column entry_point text not null default 'roof-estimate'
    check (pg_catalog.length(pg_catalog.btrim(entry_point)) > 0),
  add column last_answered_at timestamptz,
  add column result_viewed_at timestamptz,
  add column abandoned_at timestamptz;

alter table public.roof_assessments
  drop constraint roof_assessments_status_check,
  drop constraint roof_assessments_check,
  add constraint roof_assessments_status_check
    check (status in ('in_progress', 'abandoned', 'completed')),
  add constraint roof_assessments_lifecycle_check check (
    (status = 'in_progress' and completed_at is null and abandoned_at is null)
    or (status = 'abandoned' and completed_at is null and abandoned_at is not null)
    or (
      status = 'completed' and completed_at is not null
      and recommendation is not null and abandoned_at is null
    )
  );

-- Consent evidence is append-only per accepted submission. Legacy rows remain
-- valid with a null submission_id.
alter table public.lead_consents
  add column submission_id uuid;

alter table public.lead_consents
  drop constraint lead_consents_lead_id_consent_type_key;

create unique index lead_consents_company_submission_type_key
  on public.lead_consents(company_id, submission_id, consent_type)
  where submission_id is not null;

create index lead_consents_submission_id_idx
  on public.lead_consents(company_id, submission_id)
  where submission_id is not null;

create table public.lead_attribution_touches (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  estimate_id uuid references public.roof_estimates(id) on delete set null,
  assessment_id uuid references public.roof_assessments(id) on delete set null,
  submission_id uuid not null,
  entry_point text not null check (pg_catalog.length(pg_catalog.btrim(entry_point)) > 0),
  presentation_key text not null check (pg_catalog.length(pg_catalog.btrim(presentation_key)) > 0),
  attribution jsonb not null default '{}'::jsonb
    check (pg_catalog.jsonb_typeof(attribution) = 'object'),
  referrer text,
  occurred_at timestamptz not null default pg_catalog.now(),
  unique (company_id, submission_id)
);

create table public.consultation_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  estimate_id uuid not null references public.roof_estimates(id) on delete cascade,
  assessment_id uuid not null references public.roof_assessments(id) on delete cascade,
  contact_method text not null check (contact_method in ('call', 'text', 'email')),
  call_window text check (call_window in ('asap', 'morning', 'midday', 'afternoon', 'evening')),
  timezone text not null default 'America/New_York'
    check (timezone = 'America/New_York'),
  status text not null default 'requested'
    check (status in ('requested', 'contacted', 'booked', 'closed')),
  booking_reference text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (assessment_id),
  check (
    (contact_method = 'call' and call_window is not null)
    or (contact_method in ('text', 'email') and call_window is null)
  )
);

create table public.roof_assessment_access_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  submission_id uuid not null,
  lead_id uuid not null references public.leads(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  estimate_id uuid not null references public.roof_estimates(id) on delete cascade,
  assessment_id uuid not null references public.roof_assessments(id) on delete cascade,
  attempt_kind text not null check (attempt_kind in ('new', 'resume_candidate')),
  continuation_secret_hash bytea not null
    check (pg_catalog.octet_length(continuation_secret_hash) = 32),
  destination_phone_e164 text not null
    check (destination_phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
  request_ip inet not null,
  provider_attempt_id text,
  provider_attempt_metadata jsonb not null default '{}'::jsonb
    check (pg_catalog.jsonb_typeof(provider_attempt_metadata) = 'object'),
  verification_started_at timestamptz,
  verification_sent_at timestamptz,
  verified_at timestamptz,
  verification_send_count integer not null default 0
    check (verification_send_count between 0 and 5),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  token_rotated_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (company_id, submission_id)
);

create index lead_attribution_touches_lead_occurred_idx
  on public.lead_attribution_touches(company_id, lead_id, occurred_at desc);
create index consultation_requests_company_created_idx
  on public.consultation_requests(company_id, created_at desc);
create index roof_assessment_access_attempts_assessment_idx
  on public.roof_assessment_access_attempts(company_id, assessment_id, created_at desc);
create index roof_assessment_access_attempts_phone_throttle_idx
  on public.roof_assessment_access_attempts(destination_phone_e164, created_at desc);
create index roof_assessment_access_attempts_ip_throttle_idx
  on public.roof_assessment_access_attempts(request_ip, created_at desc);

alter table public.lead_attribution_touches enable row level security;
alter table public.consultation_requests enable row level security;
alter table public.roof_assessment_access_attempts enable row level security;

revoke all on public.lead_attribution_touches from public, anon, authenticated;
revoke all on public.consultation_requests from public, anon, authenticated;
revoke all on public.roof_assessment_access_attempts from public, anon, authenticated;

grant all on public.lead_attribution_touches to service_role;
grant all on public.consultation_requests to service_role;
grant all on public.roof_assessment_access_attempts to service_role;

create function public.start_or_resume_roof_assessment(
  p_company_id uuid,
  p_submission_id uuid,
  p_name text,
  p_phone_e164 text,
  p_email_normalized text,
  p_submitted_address text,
  p_google_place_id text,
  p_presentation_key text,
  p_entry_point text,
  p_attribution jsonb,
  p_referrer text,
  p_disclosure_version text,
  p_consent_granted_at timestamptz,
  p_ip_address text,
  p_user_agent text
) returns table (
  attempt_id uuid,
  continuation_secret text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.roof_assessment_access_attempts%rowtype;
  v_attempt_id uuid;
  v_attempt_kind text;
  v_secret text;
  v_expires_at timestamptz;
  v_request_ip inet;
  v_phone text;
  v_email text;
  v_address text;
  v_normalized_address text;
  v_google_place_id text;
  v_property_id uuid;
  v_lead_id uuid;
  v_pipeline_run_id uuid;
  v_estimate_id uuid;
  v_assessment_id uuid;
  v_event_id uuid;
  v_event_payload jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_company_id is null or not exists (
    select 1 from public.companies as company where company.id = p_company_id
  ) then
    raise exception 'Assessment company does not exist';
  end if;
  if p_submission_id is null then
    raise exception 'Assessment submission ID is required';
  end if;
  if p_attribution is null or pg_catalog.jsonb_typeof(p_attribution) <> 'object' then
    raise exception 'Assessment attribution must be a JSON object';
  end if;
  if p_consent_granted_at is null then
    raise exception 'Assessment consent timestamp is required';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_name, ''))) = 0
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_phone_e164, ''))) = 0
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_email_normalized, ''))) = 0
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_submitted_address, ''))) = 0
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_presentation_key, ''))) = 0
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_entry_point, ''))) = 0
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_disclosure_version, ''))) = 0
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_user_agent, ''))) = 0
  then
    raise exception 'Assessment contact, property, presentation, and consent fields are required';
  end if;

  v_phone := pg_catalog.btrim(p_phone_e164);
  v_email := pg_catalog.lower(pg_catalog.btrim(p_email_normalized));
  v_address := pg_catalog.btrim(p_submitted_address);
  v_normalized_address := public.normalize_property_address(v_address);
  v_google_place_id := nullif(pg_catalog.btrim(coalesce(p_google_place_id, '')), '');

  if v_phone !~ '^[+][1-9][0-9]{7,14}$' then
    raise exception 'Assessment phone must be E.164';
  end if;

  begin
    v_request_ip := pg_catalog.btrim(p_ip_address)::inet;
  exception
    when invalid_text_representation then
      raise exception 'Assessment IP address is invalid';
  end;
  if v_request_ip is null then
    raise exception 'Assessment IP address is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_company_id::text || ':roof-assessment-submission:' || p_submission_id::text,
      0
    )
  );

  select attempt.* into v_attempt
  from public.roof_assessment_access_attempts as attempt
  where attempt.company_id = p_company_id
    and attempt.submission_id = p_submission_id
  for update;

  if found then
    v_secret := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
    v_expires_at := v_now + interval '15 minutes';
    update public.roof_assessment_access_attempts as attempt
    set continuation_secret_hash = extensions.digest(v_secret, 'sha256'),
        expires_at = v_expires_at,
        consumed_at = null,
        updated_at = v_now
    where attempt.id = v_attempt.id;

    return query select v_attempt.id, v_secret, v_expires_at;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_company_id::text || ':roof-assessment-identity:'
      || coalesce(v_google_place_id, v_normalized_address) || ':'
      || v_phone || ':' || v_email,
      0
    )
  );

  select assessment.id, assessment.estimate_id, assessment.lead_id, estimate.property_id
  into v_assessment_id, v_estimate_id, v_lead_id, v_property_id
  from public.roof_assessments as assessment
  join public.roof_estimates as estimate
    on estimate.id = assessment.estimate_id
   and estimate.company_id = assessment.company_id
  join public.leads as lead
    on lead.id = assessment.lead_id
   and lead.company_id = assessment.company_id
  where assessment.company_id = p_company_id
    and assessment.status in ('in_progress', 'abandoned')
    and assessment.updated_at >= v_now - interval '30 days'
    and (
      (v_google_place_id is not null and estimate.google_place_id = v_google_place_id)
      or (
        v_google_place_id is null
        and public.normalize_property_address(lead.submitted_address) = v_normalized_address
      )
    )
    and (
      lead.phone_e164 = v_phone
      or lead.email_normalized = v_email
      or pg_catalog.lower(pg_catalog.btrim(lead.email)) = v_email
    )
  order by assessment.updated_at desc, assessment.id
  limit 1
  for update of assessment;

  if found then
    v_attempt_kind := 'resume_candidate';
    update public.roof_assessments as assessment
    set status = 'in_progress',
        presentation_key = pg_catalog.btrim(p_presentation_key),
        entry_point = pg_catalog.btrim(p_entry_point),
        abandoned_at = null,
        updated_at = v_now
    where assessment.id = v_assessment_id;

    select run.id into v_pipeline_run_id
    from public.pipeline_runs as run
    where run.company_id = p_company_id and run.lead_id = v_lead_id
    order by run.started_at desc, run.id
    limit 1;
  else
    v_attempt_kind := 'new';

    insert into public.properties (company_id, canonical_address, resolution_status)
    values (p_company_id, v_address, 'unresolved')
    returning id into v_property_id;

    insert into public.leads (
      company_id, property_id, name, phone, email, submitted_address,
      service_requested, notes, source_system, external_lead_id,
      original_lead_source, campaign, consent_reference, source_submitted_at,
      phone_e164, email_normalized, utm_source, utm_medium, utm_campaign,
      utm_term, utm_content, fbclid, fbp, fbc, client_ip_address,
      client_user_agent
    ) values (
      p_company_id, v_property_id, pg_catalog.btrim(p_name), v_phone, v_email,
      v_address, 'roofing', 'Submitted through the canonical roof assessment intake.',
      'canonical-roof-assessment', p_submission_id::text,
      pg_catalog.btrim(p_entry_point), pg_catalog.btrim(p_presentation_key),
      pg_catalog.btrim(p_disclosure_version), p_consent_granted_at,
      v_phone, v_email,
      nullif(pg_catalog.btrim(p_attribution ->> 'utm_source'), ''),
      nullif(pg_catalog.btrim(p_attribution ->> 'utm_medium'), ''),
      nullif(pg_catalog.btrim(p_attribution ->> 'utm_campaign'), ''),
      nullif(pg_catalog.btrim(p_attribution ->> 'utm_term'), ''),
      nullif(pg_catalog.btrim(p_attribution ->> 'utm_content'), ''),
      nullif(pg_catalog.btrim(p_attribution ->> 'fbclid'), ''),
      nullif(pg_catalog.btrim(p_attribution ->> 'fbp'), ''),
      nullif(pg_catalog.btrim(p_attribution ->> 'fbc'), ''),
      v_request_ip, pg_catalog.btrim(p_user_agent)
    ) returning id into v_lead_id;

    insert into public.pipeline_runs (
      company_id, lead_id, property_id, correlation_id, pipeline_version, status
    ) values (
      p_company_id, v_lead_id, v_property_id, extensions.gen_random_uuid(), 2, 'received'
    ) returning id into v_pipeline_run_id;

    insert into public.roof_estimates (
      company_id, lead_id, property_id, google_place_id
    ) values (
      p_company_id, v_lead_id, v_property_id, v_google_place_id
    ) returning id into v_estimate_id;

    insert into public.roof_assessments (
      company_id, estimate_id, lead_id, presentation_key, entry_point
    ) values (
      p_company_id, v_estimate_id, v_lead_id,
      pg_catalog.btrim(p_presentation_key), pg_catalog.btrim(p_entry_point)
    ) returning id into v_assessment_id;
  end if;

  insert into public.lead_consents (
    company_id, lead_id, submission_id, consent_type, granted,
    disclosure_version, source, ip_address, user_agent, granted_at
  )
  select p_company_id, v_lead_id, p_submission_id, consent_type, true,
         pg_catalog.btrim(p_disclosure_version), pg_catalog.btrim(p_entry_point),
         v_request_ip, pg_catalog.btrim(p_user_agent), p_consent_granted_at
  from pg_catalog.unnest(array[
    'estimate_processing', 'email_contact', 'sms_contact'
  ]) as consent_type;

  insert into public.lead_attribution_touches (
    company_id, lead_id, estimate_id, assessment_id, submission_id,
    entry_point, presentation_key, attribution, referrer, occurred_at
  ) values (
    p_company_id, v_lead_id, v_estimate_id, v_assessment_id, p_submission_id,
    pg_catalog.btrim(p_entry_point), pg_catalog.btrim(p_presentation_key),
    p_attribution, nullif(pg_catalog.btrim(coalesce(p_referrer, '')), ''),
    p_consent_granted_at
  );

  v_attempt_id := extensions.gen_random_uuid();
  v_secret := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := v_now + interval '15 minutes';

  insert into public.roof_assessment_access_attempts (
    id, company_id, submission_id, lead_id, property_id, estimate_id,
    assessment_id, attempt_kind, continuation_secret_hash,
    destination_phone_e164, request_ip, expires_at
  ) values (
    v_attempt_id, p_company_id, p_submission_id, v_lead_id, v_property_id,
    v_estimate_id, v_assessment_id, v_attempt_kind,
    extensions.digest(v_secret, 'sha256'), v_phone, v_request_ip, v_expires_at
  );

  if v_attempt_kind = 'new' then
    v_event_id := extensions.gen_random_uuid();
    v_event_payload := pg_catalog.jsonb_build_object(
      'id', v_event_id,
      'name', 'roof-assessment/started',
      'schemaVersion', 1,
      'correlationId', p_submission_id,
      'leadId', v_lead_id,
      'propertyId', v_property_id,
      'pipelineRunId', v_pipeline_run_id,
      'occurredAt', pg_catalog.to_char(
        v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'idempotencyKey', 'roof-assessment/started:' || v_assessment_id::text,
      'data', pg_catalog.jsonb_build_object(
        'assessmentId', v_assessment_id,
        'entryPoint', pg_catalog.btrim(p_entry_point),
        'presentationKey', pg_catalog.btrim(p_presentation_key)
      )
    );

    insert into public.domain_events (
      id, company_id, pipeline_run_id, event_name, schema_version,
      correlation_id, idempotency_key, payload, occurred_at
    ) values (
      v_event_id, p_company_id, v_pipeline_run_id,
      'roof-assessment/started', 1, p_submission_id,
      'roof-assessment/started:' || v_assessment_id::text,
      v_event_payload, v_now
    );

    insert into public.event_outbox (event_id) values (v_event_id);
  end if;

  return query select v_attempt_id, v_secret, v_expires_at;
end;
$$;

create function public.rotate_roof_estimate_public_token(
  p_company_id uuid,
  p_attempt_id uuid
) returns table (
  assessment_id uuid,
  public_token uuid,
  token_rotated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.roof_assessment_access_attempts%rowtype;
  v_token uuid;
  v_rotated_at timestamptz;
begin
  select attempt.* into v_attempt
  from public.roof_assessment_access_attempts as attempt
  where attempt.id = p_attempt_id and attempt.company_id = p_company_id
  for update;

  if not found then
    raise exception 'Assessment access attempt not found';
  end if;
  if v_attempt.attempt_kind <> 'resume_candidate' or v_attempt.verified_at is null then
    raise exception 'Assessment access attempt is not verified';
  end if;
  if v_attempt.expires_at <= pg_catalog.now() then
    raise exception 'Assessment access attempt has expired';
  end if;

  if v_attempt.token_rotated_at is null then
    v_token := extensions.gen_random_uuid();
    v_rotated_at := pg_catalog.clock_timestamp();
    update public.roof_estimates as estimate
    set public_token = v_token, updated_at = v_rotated_at
    where estimate.id = v_attempt.estimate_id
      and estimate.company_id = p_company_id;

    update public.roof_assessment_access_attempts as attempt
    set token_rotated_at = v_rotated_at,
        consumed_at = coalesce(attempt.consumed_at, v_rotated_at),
        updated_at = v_rotated_at
    where attempt.id = p_attempt_id;
  else
    select estimate.public_token into v_token
    from public.roof_estimates as estimate
    where estimate.id = v_attempt.estimate_id and estimate.company_id = p_company_id;
    v_rotated_at := v_attempt.token_rotated_at;
  end if;

  return query select v_attempt.assessment_id, v_token, v_rotated_at;
end;
$$;

create function public.request_roof_consultation(
  p_company_id uuid,
  p_assessment_id uuid,
  p_contact_method text,
  p_call_window text default null
) returns table (
  request_id uuid,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead_id uuid;
  v_property_id uuid;
  v_estimate_id uuid;
  v_request public.consultation_requests%rowtype;
  v_method text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_contact_method, '')));
  v_window text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_call_window, ''))), '');
begin
  if v_method not in ('call', 'text', 'email') then
    raise exception 'Unsupported consultation contact method';
  end if;
  if v_method = 'call' and v_window is null then
    raise exception 'Call window is required for phone consultation';
  end if;
  if v_method = 'call' and v_window not in ('asap', 'morning', 'midday', 'afternoon', 'evening') then
    raise exception 'Unsupported consultation call window';
  end if;
  if v_method <> 'call' and v_window is not null then
    raise exception 'Call window is only valid for phone consultation';
  end if;

  select assessment.lead_id, estimate.property_id, assessment.estimate_id
  into v_lead_id, v_property_id, v_estimate_id
  from public.roof_assessments as assessment
  join public.roof_estimates as estimate
    on estimate.id = assessment.estimate_id
   and estimate.company_id = assessment.company_id
  where assessment.id = p_assessment_id
    and assessment.company_id = p_company_id;

  if not found then
    raise exception 'Roof assessment not found for company';
  end if;

  insert into public.consultation_requests as request (
    company_id, lead_id, property_id, estimate_id, assessment_id,
    contact_method, call_window
  ) values (
    p_company_id, v_lead_id, v_property_id, v_estimate_id, p_assessment_id,
    v_method, v_window
  )
  on conflict (assessment_id) do update
  set contact_method = excluded.contact_method,
      call_window = excluded.call_window,
      status = 'requested',
      updated_at = pg_catalog.clock_timestamp()
  where request.company_id = p_company_id
  returning request.* into v_request;

  if not found then
    raise exception 'Consultation request belongs to another company';
  end if;

  return query select v_request.id, v_request.status, v_request.created_at;
end;
$$;

revoke execute on function public.start_or_resume_roof_assessment(
  uuid, uuid, text, text, text, text, text, text, text, jsonb, text, text,
  timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.start_or_resume_roof_assessment(
  uuid, uuid, text, text, text, text, text, text, text, jsonb, text, text,
  timestamptz, text, text
) to service_role;

revoke execute on function public.rotate_roof_estimate_public_token(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.rotate_roof_estimate_public_token(uuid, uuid)
  to service_role;

revoke execute on function public.request_roof_consultation(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.request_roof_consultation(uuid, uuid, text, text)
  to service_role;

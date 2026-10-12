-- Canonical, resumable homeowner assessment journey. Public callers never
-- receive a lead, estimate, assessment, or existing public-token identifier.

alter table public.roof_assessments
  add column presentation_key text not null default 'all-season-main'
    check (pg_catalog.length(pg_catalog.btrim(presentation_key)) > 0),
  add column entry_point text not null default 'roof-estimate'
    check (pg_catalog.length(pg_catalog.btrim(entry_point)) > 0),
  add column revision bigint not null default 0 check (revision >= 0),
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

-- Every tenant-scoped relationship below is enforced by the database rather
-- than relying on service-role callers to keep company_id columns consistent.
alter table public.properties
  add constraint properties_company_id_id_key unique (company_id, id);
alter table public.roof_insights
  add constraint roof_insights_company_property_id_key unique (company_id, property_id, id),
  drop constraint roof_insights_property_id_fkey,
  add constraint roof_insights_company_property_fkey
    foreign key (company_id, property_id)
    references public.properties(company_id, id) on delete cascade;
alter table public.leads
  add constraint leads_company_id_id_key unique (company_id, id),
  drop constraint leads_property_id_fkey,
  add constraint leads_company_property_fkey
    foreign key (company_id, property_id)
    references public.properties(company_id, id);
alter table public.roof_estimates
  add constraint roof_estimates_company_id_id_key unique (company_id, id),
  drop constraint roof_estimates_lead_id_fkey,
  drop constraint roof_estimates_property_id_fkey,
  drop constraint roof_estimates_roof_insight_id_fkey,
  add constraint roof_estimates_company_lead_fkey
    foreign key (company_id, lead_id)
    references public.leads(company_id, id) on delete cascade,
  add constraint roof_estimates_company_property_fkey
    foreign key (company_id, property_id)
    references public.properties(company_id, id) on delete cascade,
  add constraint roof_estimates_company_property_insight_fkey
    foreign key (company_id, property_id, roof_insight_id)
    references public.roof_insights(company_id, property_id, id);
alter table public.roof_assessments
  add constraint roof_assessments_company_id_id_key unique (company_id, id),
  drop constraint roof_assessments_estimate_id_fkey,
  drop constraint roof_assessments_lead_id_fkey,
  add constraint roof_assessments_company_estimate_fkey
    foreign key (company_id, estimate_id)
    references public.roof_estimates(company_id, id) on delete cascade,
  add constraint roof_assessments_company_lead_fkey
    foreign key (company_id, lead_id)
    references public.leads(company_id, id) on delete cascade;
alter table public.lead_consents
  drop constraint lead_consents_lead_id_fkey,
  add constraint lead_consents_company_lead_fkey
    foreign key (company_id, lead_id)
    references public.leads(company_id, id) on delete cascade;

-- lead_consents remains the single-row current projection expected by existing
-- consumers. This table is the immutable, submission-scoped evidence ledger.
create table public.lead_consent_evidence (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null,
  submission_id uuid not null,
  consent_type text not null check (
    consent_type in ('estimate_processing', 'email_contact', 'sms_contact')
  ),
  granted boolean not null,
  disclosure_version text not null
    check (pg_catalog.length(pg_catalog.btrim(disclosure_version)) > 0),
  source text not null check (pg_catalog.length(pg_catalog.btrim(source)) > 0),
  ip_address inet,
  user_agent text,
  granted_at timestamptz not null,
  recorded_at timestamptz not null default pg_catalog.now(),
  unique (company_id, submission_id, consent_type),
  foreign key (company_id, lead_id)
    references public.leads(company_id, id) on delete cascade
);

create index lead_consent_evidence_lead_granted_idx
  on public.lead_consent_evidence(company_id, lead_id, granted_at desc);

create table public.lead_attribution_touches (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null,
  estimate_id uuid,
  assessment_id uuid,
  submission_id uuid not null,
  entry_point text not null check (pg_catalog.length(pg_catalog.btrim(entry_point)) > 0),
  presentation_key text not null check (pg_catalog.length(pg_catalog.btrim(presentation_key)) > 0),
  attribution jsonb not null default '{}'::jsonb
    check (pg_catalog.jsonb_typeof(attribution) = 'object'),
  referrer text,
  occurred_at timestamptz not null default pg_catalog.now(),
  unique (company_id, submission_id),
  foreign key (company_id, lead_id)
    references public.leads(company_id, id) on delete cascade,
  foreign key (company_id, estimate_id)
    references public.roof_estimates(company_id, id),
  foreign key (company_id, assessment_id)
    references public.roof_assessments(company_id, id)
);

create table public.consultation_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null,
  property_id uuid not null,
  estimate_id uuid not null,
  assessment_id uuid not null,
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
  foreign key (company_id, lead_id)
    references public.leads(company_id, id) on delete cascade,
  foreign key (company_id, property_id)
    references public.properties(company_id, id) on delete cascade,
  foreign key (company_id, estimate_id)
    references public.roof_estimates(company_id, id) on delete cascade,
  foreign key (company_id, assessment_id)
    references public.roof_assessments(company_id, id) on delete cascade,
  check (
    (contact_method = 'call' and call_window is not null)
    or (contact_method in ('text', 'email') and call_window is null)
  )
);

-- Durable abuse evidence. Accepted submissions count even when their
-- consultation projection is an idempotent no-op, bounding public RPC load.
-- Policy: at most 6 submissions per assessment and 20 per trusted client IP
-- in a rolling hour; a row exactly one hour old is outside the window.
create table public.roof_assessment_consultation_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  assessment_id uuid not null,
  request_ip inet not null,
  reserved_at timestamptz not null default pg_catalog.now(),
  foreign key (company_id, assessment_id)
    references public.roof_assessments(company_id, id) on delete cascade
);

create table public.roof_assessment_access_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  submission_id uuid not null,
  lead_id uuid not null,
  property_id uuid not null,
  estimate_id uuid not null,
  assessment_id uuid not null,
  attempt_kind text not null check (attempt_kind in ('new', 'resume_candidate')),
  continuation_secret_hash bytea not null
    check (pg_catalog.octet_length(continuation_secret_hash) = 32),
  destination_phone_e164 text not null
    check (destination_phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
  requested_presentation_key text not null
    check (pg_catalog.length(pg_catalog.btrim(requested_presentation_key)) > 0),
  requested_entry_point text not null
    check (pg_catalog.length(pg_catalog.btrim(requested_entry_point)) > 0),
  request_ip inet not null,
  provider_attempt_id text,
  provider_attempt_metadata jsonb not null default '{}'::jsonb
    check (pg_catalog.jsonb_typeof(provider_attempt_metadata) = 'object'),
  verification_started_at timestamptz,
  verification_sent_at timestamptz,
  verified_at timestamptz,
  verification_send_count integer not null default 0
    check (verification_send_count >= 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  token_rotated_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (company_id, submission_id),
  unique (company_id, id),
  foreign key (company_id, lead_id)
    references public.leads(company_id, id) on delete cascade,
  foreign key (company_id, property_id)
    references public.properties(company_id, id) on delete cascade,
  foreign key (company_id, estimate_id)
    references public.roof_estimates(company_id, id) on delete cascade,
  foreign key (company_id, assessment_id)
    references public.roof_assessments(company_id, id) on delete cascade
);

create table public.roof_assessment_verification_sends (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  attempt_id uuid not null,
  destination_phone_e164 text not null
    check (destination_phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
  request_ip inet not null,
  provider_attempt_id text,
  provider_status text not null default 'reserved'
    check (provider_status in ('reserved', 'pending', 'approved')),
  reserved_at timestamptz not null default pg_catalog.now(),
  sent_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (company_id, id),
  foreign key (company_id, attempt_id)
    references public.roof_assessment_access_attempts(company_id, id) on delete cascade,
  check (
    (provider_status = 'reserved' and provider_attempt_id is null and sent_at is null and approved_at is null)
    or (provider_status = 'pending' and provider_attempt_id is not null and sent_at is not null and approved_at is null)
    or (provider_status = 'approved' and provider_attempt_id is not null and sent_at is not null and approved_at is not null)
  )
);

create index lead_attribution_touches_lead_occurred_idx
  on public.lead_attribution_touches(company_id, lead_id, occurred_at desc);
create index consultation_requests_company_created_idx
  on public.consultation_requests(company_id, created_at desc);
create index roof_assessment_consultation_attempts_assessment_idx
  on public.roof_assessment_consultation_attempts(company_id, assessment_id, reserved_at desc);
create index roof_assessment_consultation_attempts_ip_idx
  on public.roof_assessment_consultation_attempts(request_ip, reserved_at desc);
create index roof_assessment_access_attempts_assessment_idx
  on public.roof_assessment_access_attempts(company_id, assessment_id, created_at desc);
create index roof_assessment_access_attempts_submission_idx
  on public.roof_assessment_access_attempts(company_id, submission_id, created_at, id);
create index roof_assessment_access_attempts_phone_throttle_idx
  on public.roof_assessment_access_attempts(destination_phone_e164, created_at desc);
create index roof_assessment_access_attempts_ip_throttle_idx
  on public.roof_assessment_access_attempts(request_ip, created_at desc);
create index roof_assessment_verification_sends_phone_idx
  on public.roof_assessment_verification_sends(company_id, destination_phone_e164, reserved_at desc);
create index roof_assessment_verification_sends_ip_idx
  on public.roof_assessment_verification_sends(company_id, request_ip, reserved_at desc);
create index roof_assessment_verification_sends_attempt_idx
  on public.roof_assessment_verification_sends(company_id, attempt_id, reserved_at desc);

alter table public.lead_consent_evidence enable row level security;
alter table public.lead_attribution_touches enable row level security;
alter table public.consultation_requests enable row level security;
alter table public.roof_assessment_consultation_attempts enable row level security;
alter table public.roof_assessment_access_attempts enable row level security;
alter table public.roof_assessment_verification_sends enable row level security;

revoke all on public.lead_consent_evidence from public, anon, authenticated;
revoke all on public.lead_attribution_touches from public, anon, authenticated;
revoke all on public.consultation_requests from public, anon, authenticated;
revoke all on public.roof_assessment_consultation_attempts from public, anon, authenticated;
revoke all on public.roof_assessment_access_attempts from public, anon, authenticated;
revoke all on public.roof_assessment_verification_sends from public, anon, authenticated;

grant all on public.lead_consent_evidence to service_role;
grant all on public.lead_attribution_touches to service_role;
grant all on public.consultation_requests to service_role;
grant all on public.roof_assessment_consultation_attempts to service_role;
grant all on public.roof_assessment_access_attempts to service_role;
grant all on public.roof_assessment_verification_sends to service_role;

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
  expires_at timestamptz,
  is_replay boolean
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
  v_destination_phone text;
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
  v_now timestamptz := pg_catalog.now();
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
  order by attempt.created_at, attempt.id
  limit 1;

  if found then
    -- Only the first accepted call can issue the raw continuation secret. A
    -- replay returns the canonical attempt identity with an explicit marker
    -- and no credential, without refreshing or mutating any attempt state.
    return query
    select v_attempt.id, null::text, v_attempt.expires_at, true;
    return;
  end if;

  -- The normalized property address is the common boundary for one-sided
  -- Place-ID fallback. The optional Place-ID lock also serializes same-Place
  -- requests whose submitted address formatting differs.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_company_id::text || ':roof-assessment-property-address:'
      || v_normalized_address,
      0
    )
  );
  if v_google_place_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_company_id::text || ':roof-assessment-property-place:'
        || v_google_place_id,
        0
      )
    );
  end if;

  select assessment.id, assessment.estimate_id, assessment.lead_id,
         estimate.property_id, lead.phone_e164
  into v_assessment_id, v_estimate_id, v_lead_id, v_property_id,
       v_destination_phone
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
      (
        v_google_place_id is not null
        and estimate.google_place_id is not null
        and estimate.google_place_id = v_google_place_id
      )
      or (
        (v_google_place_id is null or estimate.google_place_id is null)
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
    if v_destination_phone is null
      or v_destination_phone !~ '^[+][1-9][0-9]{7,14}$'
    then
      raise exception 'Resume candidate has no usable existing phone';
    end if;

    select run.id into v_pipeline_run_id
    from public.pipeline_runs as run
    where run.company_id = p_company_id and run.lead_id = v_lead_id
    order by run.started_at desc, run.id
    limit 1;
  else
    v_attempt_kind := 'new';
    v_destination_phone := v_phone;

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
    company_id, lead_id, consent_type, granted,
    disclosure_version, source, ip_address, user_agent, granted_at
  )
  select p_company_id, v_lead_id, consent_type, true,
         pg_catalog.btrim(p_disclosure_version), pg_catalog.btrim(p_entry_point),
         v_request_ip, pg_catalog.btrim(p_user_agent), p_consent_granted_at
  from pg_catalog.unnest(array[
    'estimate_processing', 'email_contact', 'sms_contact'
  ]) as consent_type
  on conflict (lead_id, consent_type) do update
  set company_id = excluded.company_id,
      granted = excluded.granted,
      disclosure_version = excluded.disclosure_version,
      source = excluded.source,
      ip_address = excluded.ip_address,
      user_agent = excluded.user_agent,
      granted_at = excluded.granted_at;

  insert into public.lead_consent_evidence (
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
    destination_phone_e164, requested_presentation_key,
    requested_entry_point, request_ip, expires_at
  ) values (
    v_attempt_id, p_company_id, p_submission_id, v_lead_id, v_property_id,
    v_estimate_id, v_assessment_id, v_attempt_kind,
    extensions.digest(v_secret, 'sha256'), v_destination_phone,
    pg_catalog.btrim(p_presentation_key), pg_catalog.btrim(p_entry_point),
    v_request_ip, v_expires_at
  );

  if v_attempt_kind = 'new' then
    v_event_id := extensions.gen_random_uuid();
    v_event_payload := pg_catalog.jsonb_build_object(
      'id', v_event_id,
      'name', 'roof/assessment.started',
      'schemaVersion', 1,
      'correlationId', p_submission_id,
      'leadId', v_lead_id,
      'propertyId', v_property_id,
      'pipelineRunId', v_pipeline_run_id,
      'occurredAt', pg_catalog.to_char(
        v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'idempotencyKey', 'roof/assessment.started:' || v_assessment_id::text,
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
      'roof/assessment.started', 1, p_submission_id,
      'roof/assessment.started:' || v_assessment_id::text,
      v_event_payload, v_now
    );

    insert into public.event_outbox (event_id) values (v_event_id);
  end if;

  return query select v_attempt_id, v_secret, v_expires_at, false;
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
  v_was_abandoned boolean;
  v_property_id uuid;
  v_pipeline_run_id uuid;
  v_event_id uuid;
  v_event jsonb;
begin
  select attempt.* into v_attempt
  from public.roof_assessment_access_attempts as attempt
  where attempt.id = p_attempt_id and attempt.company_id = p_company_id
  for update;

  if not found then
    raise exception 'Assessment access attempt not found';
  end if;
  if v_attempt.consumed_at is not null then
    raise exception 'Assessment access attempt has already been consumed';
  end if;
  if v_attempt.attempt_kind <> 'resume_candidate' or v_attempt.verified_at is null then
    raise exception 'Assessment access attempt is not verified';
  end if;
  if v_attempt.expires_at <= pg_catalog.now() then
    raise exception 'Assessment access attempt has expired';
  end if;

  select assessment.status='abandoned' into v_was_abandoned
  from public.roof_assessments assessment
  where assessment.id=v_attempt.assessment_id and assessment.company_id=p_company_id
  for update;
  if not found then raise exception 'Roof assessment authorization failed'; end if;

  if v_attempt.token_rotated_at is null then
    v_token := extensions.gen_random_uuid();
    v_rotated_at := pg_catalog.clock_timestamp();

    update public.roof_assessments as assessment
    set status = 'in_progress',
        revision = assessment.revision + case when v_was_abandoned then 1 else 0 end,
        presentation_key = v_attempt.requested_presentation_key,
        entry_point = v_attempt.requested_entry_point,
        abandoned_at = null,
        updated_at = v_rotated_at
    where assessment.id = v_attempt.assessment_id
      and assessment.company_id = p_company_id;

    update public.roof_estimates as estimate
    set public_token = v_token, updated_at = v_rotated_at
    where estimate.id = v_attempt.estimate_id
      and estimate.company_id = p_company_id;

    update public.roof_assessment_access_attempts as attempt
    set token_rotated_at = v_rotated_at,
        consumed_at = coalesce(attempt.consumed_at, v_rotated_at),
        updated_at = v_rotated_at
    where attempt.id = p_attempt_id;

    if v_was_abandoned then
      select estimate.property_id into v_property_id from public.roof_estimates estimate
      where estimate.id=v_attempt.estimate_id and estimate.company_id=p_company_id;
      select run.id into v_pipeline_run_id from public.pipeline_runs run
      where run.company_id=p_company_id and run.lead_id=v_attempt.lead_id
      order by run.started_at desc,run.id limit 1;
      v_event_id := extensions.gen_random_uuid();
      v_event := pg_catalog.jsonb_build_object(
        'id',v_event_id,'name','roof/assessment.resumed','schemaVersion',1,
        'correlationId',v_attempt.assessment_id,'leadId',v_attempt.lead_id,
        'propertyId',v_property_id,'pipelineRunId',v_pipeline_run_id,
        'occurredAt',pg_catalog.to_char(v_rotated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'idempotencyKey','roof/assessment.resumed:'||v_attempt.assessment_id::text,
        'data',pg_catalog.jsonb_build_object('assessmentId',v_attempt.assessment_id));
      perform public.enqueue_domain_event(p_company_id,v_event);
    end if;
  else
    select estimate.public_token into v_token
    from public.roof_estimates as estimate
    where estimate.id = v_attempt.estimate_id and estimate.company_id = p_company_id;
    v_rotated_at := v_attempt.token_rotated_at;
  end if;

  return query select v_attempt.assessment_id, v_token, v_rotated_at;
end;
$$;

create function public.authorize_same_browser_roof_assessment_resume(
  p_company_id uuid,
  p_attempt_id uuid,
  p_assessment_id uuid,
  p_continuation_secret_hash bytea
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
  v_was_abandoned boolean;
  v_property_id uuid;
  v_pipeline_run_id uuid;
  v_event_id uuid;
  v_event jsonb;
begin
  select attempt.* into v_attempt
  from public.roof_assessment_access_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.company_id = p_company_id
  for update;

  if not found then
    raise exception 'Assessment access attempt not found';
  end if;
  if v_attempt.consumed_at is not null then
    raise exception 'Assessment access attempt has already been consumed';
  end if;
  if v_attempt.attempt_kind <> 'resume_candidate' then
    raise exception 'Assessment access attempt is not a resume candidate';
  end if;
  if v_attempt.verified_at is not null then
    raise exception 'Assessment access attempt has already been verified';
  end if;
  if v_attempt.expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'Assessment access attempt has expired';
  end if;
  if v_attempt.assessment_id <> p_assessment_id then
    raise exception 'Assessment browser session does not match';
  end if;
  if p_continuation_secret_hash is null
    or pg_catalog.octet_length(p_continuation_secret_hash) <> 32
    or v_attempt.continuation_secret_hash <> p_continuation_secret_hash
  then
    raise exception 'Assessment continuation is invalid';
  end if;

  select assessment.status = 'abandoned' into v_was_abandoned
  from public.roof_assessments assessment
  where assessment.id=v_attempt.assessment_id and assessment.company_id=p_company_id
  for update;
  if not found then raise exception 'Roof assessment authorization failed'; end if;

  v_rotated_at := pg_catalog.clock_timestamp();

  update public.roof_assessment_access_attempts as attempt
  set verified_at = v_rotated_at,
      updated_at = v_rotated_at
  where attempt.id = v_attempt.id
    and attempt.company_id = p_company_id;
  if not found then
    raise exception 'Assessment access attempt authorization failed';
  end if;

  update public.roof_assessments as assessment
  set status = 'in_progress',
      revision = assessment.revision + case when v_was_abandoned then 1 else 0 end,
      presentation_key = v_attempt.requested_presentation_key,
      entry_point = v_attempt.requested_entry_point,
      abandoned_at = null,
      updated_at = v_rotated_at
  where assessment.id = v_attempt.assessment_id
    and assessment.company_id = p_company_id;
  if not found then
    raise exception 'Roof assessment authorization failed';
  end if;

  v_token := extensions.gen_random_uuid();
  update public.roof_estimates as estimate
  set public_token = v_token,
      updated_at = v_rotated_at
  where estimate.id = v_attempt.estimate_id
    and estimate.company_id = p_company_id;
  if not found then
    raise exception 'Roof estimate token rotation failed';
  end if;

  update public.roof_assessment_access_attempts as attempt
  set token_rotated_at = v_rotated_at,
      consumed_at = v_rotated_at,
      updated_at = v_rotated_at
  where attempt.id = v_attempt.id
    and attempt.company_id = p_company_id;
  if not found then
    raise exception 'Assessment access attempt consumption failed';
  end if;

  if v_was_abandoned then
    select estimate.property_id into v_property_id from public.roof_estimates estimate
    where estimate.id=v_attempt.estimate_id and estimate.company_id=p_company_id;
    select run.id into v_pipeline_run_id from public.pipeline_runs run
    where run.company_id=p_company_id and run.lead_id=v_attempt.lead_id
    order by run.started_at desc,run.id limit 1;
    v_event_id := extensions.gen_random_uuid();
    v_event := pg_catalog.jsonb_build_object(
      'id',v_event_id,'name','roof/assessment.resumed','schemaVersion',1,
      'correlationId',v_attempt.assessment_id,'leadId',v_attempt.lead_id,
      'propertyId',v_property_id,'pipelineRunId',v_pipeline_run_id,
      'occurredAt',pg_catalog.to_char(v_rotated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'idempotencyKey','roof/assessment.resumed:'||v_attempt.assessment_id::text,
      'data',pg_catalog.jsonb_build_object('assessmentId',v_attempt.assessment_id));
    perform public.enqueue_domain_event(p_company_id,v_event);
  end if;

  return query select v_attempt.assessment_id, v_token, v_rotated_at;
end;
$$;

create function public.reserve_roof_assessment_verification_start(
  p_attempt_id uuid,
  p_request_ip inet
) returns table (
  reservation_id uuid,
  company_id uuid,
  destination_phone_e164 text,
  reserved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.roof_assessment_access_attempts%rowtype;
  v_reservation public.roof_assessment_verification_sends%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_attempt_id is null or p_request_ip is null then
    raise exception 'verification_start_unavailable';
  end if;

  select attempt.* into v_attempt
  from public.roof_assessment_access_attempts as attempt
  where attempt.id = p_attempt_id
  for update;

  if not found
    or v_attempt.attempt_kind <> 'resume_candidate'
    or v_attempt.consumed_at is not null
    or v_attempt.verified_at is not null
    or v_attempt.expires_at <= v_now
  then
    raise exception 'verification_start_unavailable';
  end if;

  -- Serialize destination and IP buckets across different assessment attempts.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'roof-verification-phone:' || v_attempt.company_id::text || ':' || v_attempt.destination_phone_e164,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'roof-verification-ip:' || v_attempt.company_id::text || ':' || p_request_ip::text,
      0
    )
  );

  if exists (
    select 1 from public.roof_assessment_verification_sends as send
    where send.company_id = v_attempt.company_id
      and send.destination_phone_e164 = v_attempt.destination_phone_e164
      and send.reserved_at > v_now - interval '1 minute'
  ) then
    raise exception 'verification_start_cooldown';
  end if;
  if (
    select pg_catalog.count(*)
    from public.roof_assessment_verification_sends as send
    where send.company_id = v_attempt.company_id
      and send.destination_phone_e164 = v_attempt.destination_phone_e164
      and send.reserved_at > v_now - interval '1 hour'
  ) >= 5 then
    raise exception 'verification_phone_hourly_limit';
  end if;
  if (
    select pg_catalog.count(*)
    from public.roof_assessment_verification_sends as send
    where send.company_id = v_attempt.company_id
      and send.request_ip = p_request_ip
      and send.reserved_at > v_now - interval '1 hour'
  ) >= 5 then
    raise exception 'verification_ip_hourly_limit';
  end if;

  insert into public.roof_assessment_verification_sends (
    company_id, attempt_id, destination_phone_e164, request_ip, reserved_at
  ) values (
    v_attempt.company_id, v_attempt.id, v_attempt.destination_phone_e164,
    p_request_ip, v_now
  ) returning * into v_reservation;

  update public.roof_assessment_access_attempts as attempt
  set verification_started_at = v_now,
      verification_send_count = attempt.verification_send_count + 1,
      updated_at = v_now
  where attempt.id = v_attempt.id and attempt.company_id = v_attempt.company_id;
  if not found then
    raise exception 'verification_start_unavailable';
  end if;

  return query select v_reservation.id, v_reservation.company_id,
                      v_reservation.destination_phone_e164, v_reservation.reserved_at;
end;
$$;

create function public.record_roof_assessment_verification_start(
  p_company_id uuid,
  p_attempt_id uuid,
  p_reservation_id uuid,
  p_provider_attempt_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.roof_assessment_access_attempts%rowtype;
  v_reservation public.roof_assessment_verification_sends%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_provider_attempt_id is null
    or p_provider_attempt_id !~ '^VE[0-9a-fA-F]{32}$'
  then
    raise exception 'verification_start_unavailable';
  end if;

  select attempt.* into v_attempt
  from public.roof_assessment_access_attempts as attempt
  where attempt.id = p_attempt_id and attempt.company_id = p_company_id
  for update;
  if not found
    or v_attempt.attempt_kind <> 'resume_candidate'
    or v_attempt.consumed_at is not null
    or v_attempt.verified_at is not null
    or v_attempt.expires_at <= v_now
  then
    raise exception 'verification_start_unavailable';
  end if;

  select send.* into v_reservation
  from public.roof_assessment_verification_sends as send
  where send.id = p_reservation_id
    and send.company_id = p_company_id
    and send.attempt_id = p_attempt_id
  for update;
  if not found or v_reservation.provider_status <> 'reserved' then
    raise exception 'verification_start_unavailable';
  end if;
  if exists (
    select 1
    from public.roof_assessment_verification_sends as newer
    join public.roof_assessment_access_attempts as newer_attempt
      on newer_attempt.id = newer.attempt_id
     and newer_attempt.company_id = newer.company_id
    where newer.company_id = p_company_id
      and newer.destination_phone_e164 = v_attempt.destination_phone_e164
      and newer_attempt.assessment_id = v_attempt.assessment_id
      and newer.id <> v_reservation.id
      and newer.reserved_at >= v_reservation.reserved_at
  ) then
    raise exception 'verification_start_unavailable';
  end if;

  update public.roof_assessment_verification_sends as send
  set provider_attempt_id = p_provider_attempt_id,
      provider_status = 'pending',
      sent_at = v_now,
      updated_at = v_now
  where send.id = v_reservation.id and send.company_id = p_company_id;
  if not found then
    raise exception 'verification_start_unavailable';
  end if;

  update public.roof_assessment_access_attempts as attempt
  set provider_attempt_id = p_provider_attempt_id,
      provider_attempt_metadata = pg_catalog.jsonb_build_object(
        'reservationId', v_reservation.id,
        'provider', 'twilio_verify'
      ),
      verification_sent_at = v_now,
      updated_at = v_now
  where attempt.id = p_attempt_id and attempt.company_id = p_company_id;
  if not found then
    raise exception 'verification_start_unavailable';
  end if;
end;
$$;

create function public.approve_verified_roof_assessment_resume(
  p_company_id uuid,
  p_attempt_id uuid,
  p_provider_attempt_id text
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
  v_send public.roof_assessment_verification_sends%rowtype;
  v_token uuid;
  v_rotated_at timestamptz := pg_catalog.clock_timestamp();
  v_was_abandoned boolean;
  v_property_id uuid;
  v_pipeline_run_id uuid;
  v_event_id uuid;
  v_event jsonb;
begin
  select attempt.* into v_attempt
  from public.roof_assessment_access_attempts as attempt
  where attempt.id = p_attempt_id and attempt.company_id = p_company_id
  for update;

  if not found then
    raise exception 'Assessment access attempt not found';
  end if;
  if v_attempt.consumed_at is not null then
    raise exception 'Assessment access attempt has already been consumed';
  end if;
  if v_attempt.attempt_kind <> 'resume_candidate' then
    raise exception 'Assessment access attempt is not a resume candidate';
  end if;
  if v_attempt.verified_at is not null then
    raise exception 'Assessment access attempt has already been verified';
  end if;
  if v_attempt.expires_at <= v_rotated_at then
    raise exception 'Assessment access attempt has expired';
  end if;
  if p_provider_attempt_id is null
    or v_attempt.provider_attempt_id is null
    or v_attempt.provider_attempt_id <> p_provider_attempt_id
    or v_attempt.verification_sent_at is null
  then
    raise exception 'Assessment verification is invalid';
  end if;

  select send.* into v_send
  from public.roof_assessment_verification_sends as send
  where send.company_id = p_company_id
    and send.attempt_id = p_attempt_id
    and send.provider_attempt_id = p_provider_attempt_id
    and send.provider_status = 'pending'
  order by send.sent_at desc, send.id desc
  limit 1
  for update;
  if not found or v_send.destination_phone_e164 <> v_attempt.destination_phone_e164 then
    raise exception 'Assessment verification is invalid';
  end if;

  select assessment.status = 'abandoned' into v_was_abandoned
  from public.roof_assessments assessment
  where assessment.id=v_attempt.assessment_id and assessment.company_id=p_company_id
  for update;
  if not found then raise exception 'Roof assessment authorization failed'; end if;

  update public.roof_assessments as assessment
  set status = 'in_progress',
      revision = assessment.revision + case when v_was_abandoned then 1 else 0 end,
      presentation_key = v_attempt.requested_presentation_key,
      entry_point = v_attempt.requested_entry_point,
      abandoned_at = null,
      updated_at = v_rotated_at
  where assessment.id = v_attempt.assessment_id
    and assessment.company_id = p_company_id;
  if not found then
    raise exception 'Roof assessment authorization failed';
  end if;

  v_token := extensions.gen_random_uuid();
  update public.roof_estimates as estimate
  set public_token = v_token, updated_at = v_rotated_at
  where estimate.id = v_attempt.estimate_id and estimate.company_id = p_company_id;
  if not found then
    raise exception 'Roof estimate token rotation failed';
  end if;

  update public.roof_assessment_access_attempts as attempt
  set verified_at = v_rotated_at,
      token_rotated_at = v_rotated_at,
      consumed_at = v_rotated_at,
      updated_at = v_rotated_at
  where attempt.id = p_attempt_id and attempt.company_id = p_company_id;
  if not found then
    raise exception 'Assessment access attempt consumption failed';
  end if;

  update public.roof_assessment_verification_sends as send
  set provider_status = 'approved', approved_at = v_rotated_at, updated_at = v_rotated_at
  where send.id = v_send.id and send.company_id = p_company_id;
  if not found then
    raise exception 'Assessment verification evidence update failed';
  end if;

  if v_was_abandoned then
    select estimate.property_id into v_property_id from public.roof_estimates estimate
    where estimate.id=v_attempt.estimate_id and estimate.company_id=p_company_id;
    select run.id into v_pipeline_run_id from public.pipeline_runs run
    where run.company_id=p_company_id and run.lead_id=v_attempt.lead_id
    order by run.started_at desc,run.id limit 1;
    v_event_id := extensions.gen_random_uuid();
    v_event := pg_catalog.jsonb_build_object(
      'id',v_event_id,'name','roof/assessment.resumed','schemaVersion',1,
      'correlationId',v_attempt.assessment_id,'leadId',v_attempt.lead_id,
      'propertyId',v_property_id,'pipelineRunId',v_pipeline_run_id,
      'occurredAt',pg_catalog.to_char(v_rotated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'idempotencyKey','roof/assessment.resumed:'||v_attempt.assessment_id::text,
      'data',pg_catalog.jsonb_build_object('assessmentId',v_attempt.assessment_id));
    perform public.enqueue_domain_event(p_company_id,v_event);
  end if;

  return query select v_attempt.assessment_id, v_token, v_rotated_at;
end;
$$;

create function public.save_roof_assessment_progress(
  p_company_id uuid,
  p_assessment_id uuid,
  p_expected_revision bigint,
  p_current_step integer,
  p_property_revealed_at timestamptz,
  p_response_patch jsonb,
  p_expected_responses jsonb,
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
  v_event_id uuid;
  v_event jsonb;
  v_patch_keys text[];
  v_expected_patch_keys text[];
begin
  if p_expected_revision < 0
    or p_current_step not between 0 and 9
    or pg_catalog.jsonb_typeof(p_response_patch) <> 'object'
    or pg_catalog.jsonb_typeof(p_expected_responses) <> 'object'
    or pg_catalog.jsonb_typeof(p_scores) <> 'object'
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_response_patch) as patch(key)
      where patch.key not in (
        'reason','roofAge','conditionSignals','roofVisible','visibleCondition',
        'stories','complexityFeatures','priority','timeline','ownership'
      )
    )
  then
    raise exception 'Invalid assessment progress';
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

  if p_current_step > v_assessment.current_step + 1 then
    return query select false, v_assessment.id, v_assessment.revision,
      v_assessment.status, v_assessment.current_step,
      v_assessment.property_revealed_at, v_assessment.last_answered_at,
      v_assessment.responses, v_assessment.recommendation;
    return;
  end if;

  select coalesce(pg_catalog.array_agg(patch.key order by patch.key), array[]::text[])
  into v_patch_keys
  from pg_catalog.jsonb_object_keys(p_response_patch) as patch(key);
  v_expected_patch_keys := case p_current_step
    when 0 then array[]::text[]
    when 1 then array['reason']::text[]
    when 2 then array['roofAge']::text[]
    when 3 then array['conditionSignals']::text[]
    when 4 then array['roofVisible','visibleCondition']::text[]
    when 5 then array['stories']::text[]
    when 6 then array['complexityFeatures']::text[]
    when 7 then array['priority']::text[]
    when 8 then array['timeline']::text[]
    when 9 then array['ownership']::text[]
  end;
  select pg_catalog.array_agg(key order by key) into v_expected_patch_keys
  from pg_catalog.unnest(v_expected_patch_keys) as expected(key);
  if v_patch_keys <> v_expected_patch_keys then
    raise exception 'Assessment response patch does not match edited step';
  end if;

  if (coalesce(v_assessment.responses, '{}'::jsonb) || p_response_patch) <> p_expected_responses then
    raise exception 'Assessment response snapshot does not match patch';
  end if;

  update public.roof_assessments as assessment
  set current_step = greatest(assessment.current_step, p_current_step),
      revision = assessment.revision + 1,
      property_revealed_at = coalesce(assessment.property_revealed_at, p_property_revealed_at),
      responses = p_expected_responses,
      scores = p_scores,
      last_answered_at = v_now,
      updated_at = v_now
  where assessment.id = p_assessment_id and assessment.company_id = p_company_id
  returning assessment.* into v_assessment;

  if coalesce(p_high_intent, false) then
    select estimate.property_id
    into v_property_id
    from public.roof_estimates as estimate
    where estimate.id = v_assessment.estimate_id and estimate.company_id = p_company_id;
    select run.id into v_pipeline_run_id
    from public.pipeline_runs as run
    where run.company_id = p_company_id and run.lead_id = v_assessment.lead_id
    order by run.started_at desc, run.id limit 1;
    v_event_id := extensions.gen_random_uuid();
    v_event := pg_catalog.jsonb_build_object(
      'id', v_event_id, 'name', 'roof/assessment.high_intent', 'schemaVersion', 1,
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

create function public.complete_roof_assessment(
  p_company_id uuid,
  p_assessment_id uuid,
  p_expected_revision bigint,
  p_response_patch jsonb,
  p_expected_responses jsonb,
  p_scores jsonb,
  p_recommendation text,
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
  v_event_id uuid;
  v_event jsonb;
begin
  if p_expected_revision < 0
    or pg_catalog.jsonb_typeof(p_response_patch) <> 'object'
    or pg_catalog.jsonb_typeof(p_expected_responses) <> 'object'
    or pg_catalog.jsonb_typeof(p_scores) <> 'object'
    or p_recommendation not in ('monitor_or_repair','professional_inspection','replacement_may_make_sense')
  then
    raise exception 'Invalid assessment completion';
  end if;
  select assessment.* into v_assessment
  from public.roof_assessments as assessment
  where assessment.id = p_assessment_id and assessment.company_id = p_company_id
  for update;
  if not found or v_assessment.status = 'abandoned' then
    raise exception 'Assessment completion is unavailable';
  end if;
  if v_assessment.status = 'completed' then
    return query select false, v_assessment.id, v_assessment.revision,
      v_assessment.status, v_assessment.current_step,
      v_assessment.property_revealed_at, v_assessment.last_answered_at,
      v_assessment.responses, v_assessment.recommendation;
    return;
  end if;

  if v_assessment.revision <> p_expected_revision then
    return query select false, v_assessment.id, v_assessment.revision,
      v_assessment.status, v_assessment.current_step,
      v_assessment.property_revealed_at, v_assessment.last_answered_at,
      v_assessment.responses, v_assessment.recommendation;
    return;
  end if;

  if (coalesce(v_assessment.responses, '{}'::jsonb) || p_response_patch) <> p_expected_responses then
    raise exception 'Assessment response snapshot does not match patch';
  end if;

  update public.roof_assessments as assessment
  set status='completed', current_step=9, revision=assessment.revision+1,
      responses=p_expected_responses, scores=p_scores,
      recommendation=p_recommendation, assessment_version='roof-check-v1',
      completed_at=v_now, abandoned_at=null, updated_at=v_now
  where assessment.id=p_assessment_id and assessment.company_id=p_company_id
  returning assessment.* into v_assessment;

  select estimate.property_id into v_property_id
  from public.roof_estimates estimate
  where estimate.id=v_assessment.estimate_id and estimate.company_id=p_company_id;
  select run.id into v_pipeline_run_id
  from public.pipeline_runs run
  where run.company_id=p_company_id and run.lead_id=v_assessment.lead_id
  order by run.started_at desc,run.id limit 1;

  if coalesce(p_high_intent,false) then
    v_event_id := extensions.gen_random_uuid();
    v_event := pg_catalog.jsonb_build_object(
      'id',v_event_id,'name','roof/assessment.high_intent','schemaVersion',1,
      'correlationId',v_assessment.id,'leadId',v_assessment.lead_id,
      'propertyId',v_property_id,'pipelineRunId',v_pipeline_run_id,
      'occurredAt',pg_catalog.to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'idempotencyKey','roof/assessment.high_intent:'||v_assessment.id::text,
      'data',pg_catalog.jsonb_build_object('assessmentId',v_assessment.id,'intent',coalesce((p_scores->>'intent')::integer,0),'urgency',coalesce((p_scores->>'urgency')::integer,0)));
    perform public.enqueue_domain_event(p_company_id,v_event);
  end if;
  v_event_id := extensions.gen_random_uuid();
  v_event := pg_catalog.jsonb_build_object(
    'id',v_event_id,'name','roof/assessment.completed','schemaVersion',1,
    'correlationId',v_assessment.id,'leadId',v_assessment.lead_id,
    'propertyId',v_property_id,'pipelineRunId',v_pipeline_run_id,
    'occurredAt',pg_catalog.to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'idempotencyKey','roof/assessment.completed:'||v_assessment.id::text,
    'data',pg_catalog.jsonb_build_object('assessmentId',v_assessment.id,'recommendation',p_recommendation));
  perform public.enqueue_domain_event(p_company_id,v_event);

  return query select true, v_assessment.id, v_assessment.revision,
    v_assessment.status, v_assessment.current_step,
    v_assessment.property_revealed_at, v_assessment.last_answered_at,
    v_assessment.responses, v_assessment.recommendation;
end;
$$;

create function public.abandon_inactive_roof_assessments(p_batch_size integer default 100)
returns table (assessment_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record record;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_limit integer := least(greatest(coalesce(p_batch_size,100),1),500);
  v_event_id uuid;
  v_event jsonb;
begin
  for v_record in
    select assessment.id,assessment.company_id,assessment.lead_id,
           estimate.property_id,run.id as pipeline_run_id
    from public.roof_assessments assessment
    join public.roof_estimates estimate
      on estimate.id=assessment.estimate_id and estimate.company_id=assessment.company_id
    join lateral (
      select pipeline.id
      from public.pipeline_runs pipeline
      where pipeline.company_id=assessment.company_id and pipeline.lead_id=assessment.lead_id
      order by pipeline.started_at desc,pipeline.id limit 1
    ) run on true
    where assessment.status='in_progress'
      and coalesce(assessment.last_answered_at,assessment.updated_at,assessment.started_at)
        <= v_now - interval '24 hours'
    order by coalesce(assessment.last_answered_at,assessment.updated_at,assessment.started_at),assessment.id
    for update of assessment skip locked
    limit v_limit
  loop
    update public.roof_assessments assessment
    set status='abandoned',revision=assessment.revision+1,abandoned_at=v_now,updated_at=v_now
    where assessment.id=v_record.id and assessment.company_id=v_record.company_id
      and assessment.status='in_progress';
    if found then
      v_event_id := extensions.gen_random_uuid();
      v_event := pg_catalog.jsonb_build_object(
        'id',v_event_id,'name','roof/assessment.abandoned','schemaVersion',1,
        'correlationId',v_record.id,'leadId',v_record.lead_id,
        'propertyId',v_record.property_id,'pipelineRunId',v_record.pipeline_run_id,
        'occurredAt',pg_catalog.to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'idempotencyKey','roof/assessment.abandoned:'||v_record.id::text,
        'data',pg_catalog.jsonb_build_object('assessmentId',v_record.id));
      perform public.enqueue_domain_event(v_record.company_id,v_event);
      assessment_id := v_record.id;
      return next;
    end if;
  end loop;
end;
$$;

create function public.request_roof_consultation(
  p_company_id uuid,p_assessment_id uuid,p_estimate_id uuid,
  p_contact_method text,p_call_window text,p_timezone text,p_request_ip inet
) returns table (
  request_id uuid,status text,created_at timestamptz,
  contact_method text,call_window text,timezone text
)
language plpgsql security definer set search_path = '' as $$
declare
  v_assessment public.roof_assessments%rowtype;
  v_property_id uuid; v_pipeline_run_id uuid;
  v_request public.consultation_requests%rowtype;
  v_method text:=pg_catalog.lower(pg_catalog.btrim(coalesce(p_contact_method,'')));
  v_window text:=nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_call_window,''))),'');
  v_timezone text:=pg_catalog.btrim(coalesce(p_timezone,''));
  v_first boolean:=false; v_now timestamptz:=pg_catalog.clock_timestamp();
  v_event_id uuid; v_event jsonb;
begin
  if v_method not in ('call','text','email') then raise exception 'Unsupported consultation contact method'; end if;
  if v_method='call' and v_window is null then raise exception 'Call window is required for phone consultation'; end if;
  if v_method='call' and v_window not in ('asap','morning','midday','afternoon','evening') then raise exception 'Unsupported consultation call window'; end if;
  if v_method<>'call' and v_window is not null then raise exception 'Call window is only valid for phone consultation'; end if;
  if v_timezone<>'America/New_York' then raise exception 'Unsupported consultation timezone'; end if;
  if p_request_ip is null then raise exception 'Consultation request IP is required'; end if;

  select assessment.* into v_assessment from public.roof_assessments assessment
  where assessment.id=p_assessment_id and assessment.company_id=p_company_id
    and assessment.estimate_id=p_estimate_id for update;
  if not found then raise exception 'Roof assessment not found for company'; end if;
  if v_assessment.status<>'completed' then raise exception 'Roof assessment is not complete'; end if;

  -- The assessment row lock serializes the per-assessment boundary. The
  -- transaction advisory lock serializes the cross-assessment IP boundary.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('roof-consultation-ip:' || p_request_ip::text, 0)
  );
  if (select pg_catalog.count(*) from public.roof_assessment_consultation_attempts attempt
      where attempt.company_id=p_company_id and attempt.assessment_id=p_assessment_id
        and attempt.reserved_at > v_now - interval '1 hour') >= 6 then
    raise exception 'Consultation rate limit exceeded';
  end if;
  if (select pg_catalog.count(*) from public.roof_assessment_consultation_attempts attempt
      where attempt.request_ip=p_request_ip
        and attempt.reserved_at > v_now - interval '1 hour') >= 20 then
    raise exception 'Consultation rate limit exceeded';
  end if;
  insert into public.roof_assessment_consultation_attempts(
    company_id,assessment_id,request_ip,reserved_at
  ) values (p_company_id,p_assessment_id,p_request_ip,v_now);
  select estimate.property_id into v_property_id from public.roof_estimates estimate
  where estimate.id=p_estimate_id and estimate.company_id=p_company_id
    and estimate.lead_id=v_assessment.lead_id;
  if not found then raise exception 'Roof assessment not found for company'; end if;
  select run.id into v_pipeline_run_id from public.pipeline_runs run
  where run.company_id=p_company_id and run.lead_id=v_assessment.lead_id
  order by run.started_at desc,run.id limit 1;
  if v_pipeline_run_id is null then raise exception 'Roof assessment pipeline not found'; end if;

  select request.* into v_request from public.consultation_requests request
  where request.assessment_id=p_assessment_id and request.company_id=p_company_id for update;
  if not found then
    insert into public.consultation_requests(
      company_id,lead_id,property_id,estimate_id,assessment_id,contact_method,call_window,timezone,created_at,updated_at
    ) values (
      p_company_id,v_assessment.lead_id,v_property_id,p_estimate_id,p_assessment_id,v_method,v_window,v_timezone,v_now,v_now
    ) returning * into v_request;
    v_first:=true;
  elsif v_request.contact_method is distinct from v_method
     or v_request.call_window is distinct from v_window
     or v_request.timezone is distinct from v_timezone then
    update public.consultation_requests request set
      contact_method=v_method,call_window=v_window,timezone=v_timezone,updated_at=v_now
    where request.id=v_request.id and request.company_id=p_company_id returning request.* into v_request;
  end if;

  if v_first then
    v_event_id:=extensions.gen_random_uuid();
    v_event:=pg_catalog.jsonb_build_object(
      'id',v_event_id,'name','roof/assessment.consultation_requested','schemaVersion',1,
      'correlationId',p_assessment_id,'leadId',v_assessment.lead_id,'propertyId',v_property_id,
      'pipelineRunId',v_pipeline_run_id,'occurredAt',pg_catalog.to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'idempotencyKey','roof/assessment.consultation_requested:'||p_assessment_id::text,
      'data',pg_catalog.jsonb_build_object('assessmentId',p_assessment_id,'consultationRequestId',v_request.id));
    perform public.enqueue_domain_event(p_company_id,v_event);
  end if;
  return query select v_request.id,v_request.status,v_request.created_at,v_request.contact_method,v_request.call_window,v_request.timezone;
end;
$$;

create function public.mark_roof_assessment_result_viewed(
  p_company_id uuid,p_assessment_id uuid,p_estimate_id uuid
) returns table(result_viewed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_assessment public.roof_assessments%rowtype;
  v_property_id uuid; v_pipeline_run_id uuid;
  v_now timestamptz:=pg_catalog.clock_timestamp(); v_event_id uuid; v_event jsonb;
begin
  select assessment.* into v_assessment from public.roof_assessments assessment
  where assessment.id=p_assessment_id and assessment.company_id=p_company_id
    and assessment.estimate_id=p_estimate_id for update;
  if not found then raise exception 'Roof assessment not found for company'; end if;
  if v_assessment.status<>'completed' then raise exception 'Roof assessment is not complete'; end if;
  select estimate.property_id into v_property_id from public.roof_estimates estimate
  where estimate.id=p_estimate_id and estimate.company_id=p_company_id
    and estimate.lead_id=v_assessment.lead_id;
  if not found then raise exception 'Roof assessment not found for company'; end if;
  if v_assessment.result_viewed_at is null then
    select run.id into v_pipeline_run_id from public.pipeline_runs run
    where run.company_id=p_company_id and run.lead_id=v_assessment.lead_id
    order by run.started_at desc,run.id limit 1;
    if v_pipeline_run_id is null then raise exception 'Roof assessment pipeline not found'; end if;
    update public.roof_assessments assessment set result_viewed_at=v_now,updated_at=v_now
    where assessment.id=p_assessment_id and assessment.company_id=p_company_id;
    v_assessment.result_viewed_at:=v_now;
    v_event_id:=extensions.gen_random_uuid();
    v_event:=pg_catalog.jsonb_build_object(
      'id',v_event_id,'name','roof/assessment.result_viewed','schemaVersion',1,
      'correlationId',p_assessment_id,'leadId',v_assessment.lead_id,'propertyId',v_property_id,
      'pipelineRunId',v_pipeline_run_id,'occurredAt',pg_catalog.to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'idempotencyKey','roof/assessment.result_viewed:'||p_assessment_id::text,
      'data',pg_catalog.jsonb_build_object('assessmentId',p_assessment_id));
    perform public.enqueue_domain_event(p_company_id,v_event);
  end if;
  return query select v_assessment.result_viewed_at;
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

revoke execute on function public.authorize_same_browser_roof_assessment_resume(
  uuid, uuid, uuid, bytea
) from public, anon, authenticated;
grant execute on function public.authorize_same_browser_roof_assessment_resume(
  uuid, uuid, uuid, bytea
) to service_role;

revoke execute on function public.reserve_roof_assessment_verification_start(uuid, inet)
  from public, anon, authenticated;
grant execute on function public.reserve_roof_assessment_verification_start(uuid, inet)
  to service_role;

revoke execute on function public.record_roof_assessment_verification_start(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_roof_assessment_verification_start(uuid, uuid, uuid, text)
  to service_role;

revoke execute on function public.approve_verified_roof_assessment_resume(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.approve_verified_roof_assessment_resume(uuid, uuid, text)
  to service_role;

revoke execute on function public.request_roof_consultation(uuid, uuid, uuid, text, text, text, inet)
  from public, anon, authenticated;
grant execute on function public.request_roof_consultation(uuid, uuid, uuid, text, text, text, inet)
  to service_role;

revoke execute on function public.mark_roof_assessment_result_viewed(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_roof_assessment_result_viewed(uuid, uuid, uuid)
  to service_role;

revoke execute on function public.save_roof_assessment_progress(
  uuid, uuid, bigint, integer, timestamptz, jsonb, jsonb, jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.save_roof_assessment_progress(
  uuid, uuid, bigint, integer, timestamptz, jsonb, jsonb, jsonb, boolean
) to service_role;

revoke execute on function public.complete_roof_assessment(
  uuid, uuid, bigint, jsonb, jsonb, jsonb, text, boolean
) from public, anon, authenticated;
grant execute on function public.complete_roof_assessment(
  uuid, uuid, bigint, jsonb, jsonb, jsonb, text, boolean
) to service_role;

revoke execute on function public.abandon_inactive_roof_assessments(integer)
  from public, anon, authenticated;
grant execute on function public.abandon_inactive_roof_assessments(integer)
  to service_role;

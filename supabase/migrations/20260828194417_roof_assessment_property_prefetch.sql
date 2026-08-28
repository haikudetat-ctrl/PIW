-- Persist trusted post-consent Place Details evidence against the exact
-- assessment access attempt that authorized the provider call. Legacy worker
-- observations remain valid and retain their original uniqueness boundary.

alter table public.property_addresses
  alter column worker_run_id drop not null,
  add column assessment_access_attempt_id uuid,
  add column evidence_source text,
  add column source_identifier text,
  add column retrieved_at timestamptz,
  add column provider_duration_ms integer,
  add constraint property_addresses_company_access_attempt_fkey
    foreign key (company_id, assessment_access_attempt_id)
    references public.roof_assessment_access_attempts(company_id, id)
    on delete cascade,
  add constraint property_addresses_exactly_one_origin_check
    check (pg_catalog.num_nonnulls(worker_run_id, assessment_access_attempt_id) = 1),
  add constraint property_addresses_prefetch_provenance_check
    check (
      (evidence_source is null
        or pg_catalog.length(pg_catalog.btrim(evidence_source)) > 0)
      and (source_identifier is null
        or pg_catalog.length(pg_catalog.btrim(source_identifier)) > 0)
      and (provider_duration_ms is null or provider_duration_ms >= 0)
      and (
        assessment_access_attempt_id is null
        or (
          evidence_source is not null
          and source_identifier is not null
          and retrieved_at is not null
          and provider_duration_ms is not null
        )
      )
    ),
  add constraint property_addresses_prefetch_evidence_check
    check (
      assessment_access_attempt_id is null
      or (
        canonical_address is not null
        and pg_catalog.length(pg_catalog.btrim(canonical_address)) > 0
        and google_place_id is not null
        and pg_catalog.length(pg_catalog.btrim(google_place_id)) > 0
        and latitude is not null
        and latitude between -90::double precision and 90::double precision
        and longitude is not null
        and longitude between -180::double precision and 180::double precision
        and location is not null
        and state_code = 'NJ'
        and match_method = 'exact_single_match'::public.address_match_method
        and confidence >= 95
      )
    );

create unique index property_addresses_company_access_attempt_key
  on public.property_addresses(company_id, assessment_access_attempt_id)
  where assessment_access_attempt_id is not null;

-- PostgreSQL does not create an index on the referencing side of a foreign
-- key. Keep an unfiltered attempt-leading index for cascade/identity checks;
-- the tenant-leading partial index above remains the write-idempotency key.
create index property_addresses_assessment_access_attempt_idx
  on public.property_addresses(assessment_access_attempt_id);

create function public.resolve_roof_assessment_property_prefetch_scope(
  company_id uuid,
  attempt_id uuid,
  google_place_id text
) returns table (
  eligible boolean,
  assessment_id uuid,
  property_id uuid,
  pipeline_run_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select true,
         attempt.assessment_id,
         attempt.property_id,
         pipeline.id
  from public.roof_assessment_access_attempts as attempt
  join public.roof_assessments as assessment
    on assessment.company_id = attempt.company_id
   and assessment.id = attempt.assessment_id
   and assessment.estimate_id = attempt.estimate_id
   and assessment.lead_id = attempt.lead_id
   and assessment.status = 'in_progress'
  join public.roof_estimates as estimate
    on estimate.company_id = attempt.company_id
   and estimate.id = attempt.estimate_id
   and estimate.lead_id = attempt.lead_id
   and estimate.property_id = attempt.property_id
  join public.leads as lead
    on lead.company_id = attempt.company_id
   and lead.id = attempt.lead_id
   and lead.property_id = attempt.property_id
  join public.properties as property
    on property.company_id = attempt.company_id
   and property.id = attempt.property_id
  join lateral (
    select run.id
    from public.pipeline_runs as run
    where run.company_id = attempt.company_id
      and run.lead_id = attempt.lead_id
      and run.property_id = attempt.property_id
    order by run.started_at desc, run.id
    limit 1
  ) as pipeline on true
  where attempt.company_id = $1
    and attempt.id = $2
    and attempt.attempt_kind = 'new'
    and pg_catalog.length(pg_catalog.btrim(coalesce($3, ''))) > 0
    and estimate.google_place_id is not null
    and pg_catalog.btrim(estimate.google_place_id) = pg_catalog.btrim($3)
  limit 1;

  if not found then
    return query
      select false, null::uuid, null::uuid, null::uuid;
  end if;
end;
$$;

revoke all on function public.resolve_roof_assessment_property_prefetch_scope(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.resolve_roof_assessment_property_prefetch_scope(
  uuid, uuid, text
) to service_role;

create function public.apply_roof_assessment_property_prefetch(
  p_company_id uuid,
  p_attempt_id uuid,
  p_google_place_id text,
  p_submitted_address text,
  p_canonical_address text,
  p_latitude double precision,
  p_longitude double precision,
  p_municipality text,
  p_county text,
  p_state_code text,
  p_zip text,
  p_match_method public.address_match_method,
  p_confidence smallint,
  p_provider text,
  p_source_identifier text,
  p_retrieved_at timestamptz,
  p_provider_duration_ms integer
) returns table (
  assessment_id uuid,
  property_id uuid,
  pipeline_run_id uuid,
  side_effects_applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.roof_assessment_access_attempts%rowtype;
  v_assessment public.roof_assessments%rowtype;
  v_estimate public.roof_estimates%rowtype;
  v_lead public.leads%rowtype;
  v_pipeline public.pipeline_runs%rowtype;
  v_existing public.property_addresses%rowtype;
  v_started_event_id uuid;
  v_candidate_property_ids uuid[] := array[]::uuid[];
  v_canonical_property_id uuid;
  v_submitted_address text;
  v_canonical_address text;
  v_google_place_id text;
  v_municipality text;
  v_county text;
  v_zip text;
  v_provider text;
  v_source_identifier text;
  v_submitted_normalized text;
  v_canonical_normalized text;
  v_location extensions.geography;
  v_event jsonb;
  v_now timestamptz := pg_catalog.now();
begin
  v_google_place_id := nullif(pg_catalog.btrim(coalesce(p_google_place_id, '')), '');
  v_submitted_address := nullif(pg_catalog.btrim(coalesce(p_submitted_address, '')), '');
  v_canonical_address := nullif(pg_catalog.btrim(coalesce(p_canonical_address, '')), '');
  v_municipality := nullif(pg_catalog.btrim(coalesce(p_municipality, '')), '');
  v_county := nullif(pg_catalog.btrim(coalesce(p_county, '')), '');
  v_zip := nullif(pg_catalog.btrim(coalesce(p_zip, '')), '');
  v_provider := nullif(pg_catalog.btrim(coalesce(p_provider, '')), '');
  v_source_identifier := nullif(pg_catalog.btrim(coalesce(p_source_identifier, '')), '');

  if p_latitude is null
    or p_longitude is null
    or not (p_latitude between -90::double precision and 90::double precision)
    or not (p_longitude between -180::double precision and 180::double precision)
  then
    raise exception 'Property prefetch coordinates are invalid';
  end if;
  if p_state_code is distinct from 'NJ'
    or p_match_method is distinct from 'exact_single_match'::public.address_match_method
    or p_confidence is null
    or p_confidence < 95
    or p_confidence > 100
  then
    raise exception 'Property prefetch requires exact New Jersey evidence';
  end if;
  if v_google_place_id is null
    or v_submitted_address is null
    or v_canonical_address is null
    or v_provider is null
    or v_source_identifier is null
    or p_retrieved_at is null
    or p_provider_duration_ms is null
    or p_provider_duration_ms < 0
  then
    raise exception 'Property prefetch evidence provenance is incomplete';
  end if;

  -- The committed access attempt is the idempotency mutex. Concurrent
  -- identical calls block here, then the loser observes the stored evidence.
  select attempt.* into v_attempt
  from public.roof_assessment_access_attempts as attempt
  where attempt.company_id = p_company_id
    and attempt.id = p_attempt_id
  for update;
  if not found then
    raise exception 'Property prefetch access attempt is out of scope';
  end if;

  select assessment.* into v_assessment
  from public.roof_assessments as assessment
  where assessment.company_id = p_company_id
    and assessment.id = v_attempt.assessment_id
  for update;
  if not found then
    raise exception 'Property prefetch identity links are out of scope';
  end if;

  select estimate.* into v_estimate
  from public.roof_estimates as estimate
  where estimate.company_id = p_company_id
    and estimate.id = v_attempt.estimate_id
  for update;
  if not found then
    raise exception 'Property prefetch identity links are out of scope';
  end if;

  select lead.* into v_lead
  from public.leads as lead
  where lead.company_id = p_company_id
    and lead.id = v_attempt.lead_id
  for update;
  if not found then
    raise exception 'Property prefetch identity links are out of scope';
  end if;

  perform 1
  from public.properties as property
  where property.company_id = p_company_id
    and property.id = v_attempt.property_id
  for update;
  if not found then
    raise exception 'Property prefetch identity links are out of scope';
  end if;

  select pipeline.* into v_pipeline
  from public.pipeline_runs as pipeline
  where pipeline.company_id = p_company_id
    and pipeline.lead_id = v_attempt.lead_id
  order by pipeline.started_at desc, pipeline.id
  limit 1
  for update;
  if not found then
    raise exception 'Property prefetch identity links are out of scope';
  end if;

  if v_attempt.attempt_kind <> 'new' then
    raise exception 'Property prefetch access attempt is not eligible';
  end if;

  if v_assessment.estimate_id <> v_attempt.estimate_id
    or v_assessment.lead_id <> v_attempt.lead_id
    or v_assessment.status <> 'in_progress'
    or v_estimate.lead_id <> v_attempt.lead_id
    or v_estimate.property_id <> v_attempt.property_id
    or v_lead.property_id <> v_attempt.property_id
    or v_pipeline.property_id <> v_attempt.property_id
  then
    raise exception 'Property prefetch identity links are out of scope';
  end if;

  if v_estimate.google_place_id is null
    or pg_catalog.btrim(v_estimate.google_place_id) <> v_google_place_id
  then
    raise exception 'Property prefetch Google Place ID does not match the estimate';
  end if;

  select event.id into v_started_event_id
  from public.domain_events as event
  where event.company_id = p_company_id
    and event.pipeline_run_id = v_pipeline.id
    and event.idempotency_key =
      'roof/assessment.started:' || v_attempt.assessment_id::text;
  if not found then
    raise exception 'Property prefetch started event is out of scope';
  end if;

  select address.* into v_existing
  from public.property_addresses as address
  where address.company_id = p_company_id
    and address.assessment_access_attempt_id = p_attempt_id
  for update;

  if found then
    if v_existing.property_id is distinct from v_attempt.property_id
      or v_existing.submitted_address is distinct from v_submitted_address
      or v_existing.canonical_address is distinct from v_canonical_address
      or v_existing.google_place_id is distinct from v_google_place_id
      or v_existing.latitude is distinct from p_latitude
      or v_existing.longitude is distinct from p_longitude
      or v_existing.municipality is distinct from v_municipality
      or v_existing.county is distinct from v_county
      or v_existing.state_code is distinct from p_state_code
      or v_existing.zip is distinct from v_zip
      or v_existing.match_method is distinct from p_match_method
      or v_existing.confidence is distinct from p_confidence
      or v_existing.evidence_source is distinct from v_provider
      or v_existing.source_identifier is distinct from v_source_identifier
      or v_existing.retrieved_at is distinct from p_retrieved_at
      or v_existing.provider_duration_ms is distinct from p_provider_duration_ms
    then
      raise exception 'Conflicting property prefetch evidence';
    end if;

    return query
      select v_attempt.assessment_id, v_attempt.property_id,
             v_pipeline.id, false;
    return;
  end if;

  v_submitted_normalized := public.normalize_property_address(v_submitted_address);
  v_canonical_normalized := public.normalize_property_address(v_canonical_address);
  if v_submitted_normalized is null or v_canonical_normalized is null then
    raise exception 'Property prefetch address identity is invalid';
  end if;

  -- Use the canonical-intake lock namespaces and ordering so a candidate
  -- lookup cannot race a same-tenant Place ID or submitted-address intake.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_company_id::text || ':roof-assessment-property-address:'
      || v_submitted_normalized,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_company_id::text || ':roof-assessment-property-place:'
      || v_google_place_id,
      0
    )
  );

  -- Place identity wins. Only when no Place candidate exists may a recent
  -- exact observation lacking a Place ID participate in address fallback.
  select coalesce(
    pg_catalog.array_agg(distinct address.property_id order by address.property_id),
    array[]::uuid[]
  ) into v_candidate_property_ids
  from public.property_addresses as address
  join public.properties as property
    on property.company_id = address.company_id
   and property.id = address.property_id
  where address.company_id = p_company_id
    and address.google_place_id = v_google_place_id
    and address.match_method = 'exact_single_match'::public.address_match_method
    and address.confidence >= 95
    and address.state_code = 'NJ'
    and address.property_id <> v_attempt.property_id
    and property.resolution_status <> 'duplicate';

  if pg_catalog.cardinality(v_candidate_property_ids) = 0 then
    select coalesce(
      pg_catalog.array_agg(distinct address.property_id order by address.property_id),
      array[]::uuid[]
    ) into v_candidate_property_ids
    from public.property_addresses as address
    join public.properties as property
      on property.company_id = address.company_id
     and property.id = address.property_id
    where address.company_id = p_company_id
      and address.google_place_id is null
      and address.normalized_address = v_canonical_normalized
      and address.created_at >= v_now - interval '180 days'
      and address.match_method = 'exact_single_match'::public.address_match_method
      and address.confidence >= 95
      and address.state_code = 'NJ'
      and address.property_id <> v_attempt.property_id
      and property.resolution_status <> 'duplicate';
  end if;

  if pg_catalog.cardinality(v_candidate_property_ids) > 1 then
    return query
      select v_attempt.assessment_id, v_attempt.property_id,
             v_pipeline.id, false;
    return;
  end if;

  v_location := extensions.st_setsrid(
    extensions.st_point(p_longitude, p_latitude),
    4326
  )::extensions.geography;

  if pg_catalog.cardinality(v_candidate_property_ids) = 1 then
    v_canonical_property_id := v_candidate_property_ids[1];

    perform 1
    from public.properties as property
    where property.company_id = p_company_id
      and property.id = v_canonical_property_id
      and property.resolution_status <> 'duplicate'
    for update;
    if not found then
      raise exception 'Property prefetch canonical property changed during claim';
    end if;

    update public.properties
    set canonical_address = v_canonical_address,
        municipality = v_municipality,
        county = v_county,
        state_code = 'NJ',
        location = v_location,
        updated_at = v_now
    where company_id = p_company_id
      and id = v_canonical_property_id;

    update public.properties
    set resolution_status = 'duplicate',
        merged_into_property_id = v_canonical_property_id,
        updated_at = v_now
    where company_id = p_company_id
      and id = v_attempt.property_id;

    update public.leads
    set property_id = v_canonical_property_id,
        updated_at = v_now
    where company_id = p_company_id
      and id = v_attempt.lead_id;

    update public.pipeline_runs
    set property_id = v_canonical_property_id
    where company_id = p_company_id
      and id = v_pipeline.id;

    update public.roof_estimates
    set property_id = v_canonical_property_id,
        updated_at = v_now
    where company_id = p_company_id
      and id = v_attempt.estimate_id;

    update public.roof_assessment_access_attempts
    set property_id = v_canonical_property_id,
        updated_at = v_now
    where company_id = p_company_id
      and id = v_attempt.id;

    v_attempt.property_id := v_canonical_property_id;
  else
    v_canonical_property_id := v_attempt.property_id;

    update public.properties
    set canonical_address = v_canonical_address,
        municipality = v_municipality,
        county = v_county,
        state_code = 'NJ',
        location = v_location,
        updated_at = v_now
    where company_id = p_company_id
      and id = v_canonical_property_id;
  end if;

  insert into public.property_addresses (
    company_id,
    property_id,
    assessment_access_attempt_id,
    submitted_address,
    canonical_address,
    google_place_id,
    latitude,
    longitude,
    location,
    municipality,
    county,
    state_code,
    zip,
    match_method,
    confidence,
    evidence_source,
    source_identifier,
    retrieved_at,
    provider_duration_ms
  ) values (
    p_company_id,
    v_canonical_property_id,
    v_attempt.id,
    v_submitted_address,
    v_canonical_address,
    v_google_place_id,
    p_latitude,
    p_longitude,
    v_location,
    v_municipality,
    v_county,
    'NJ',
    v_zip,
    p_match_method,
    p_confidence,
    v_provider,
    v_source_identifier,
    p_retrieved_at,
    p_provider_duration_ms
  );

  v_event := jsonb_build_object(
    'id', extensions.gen_random_uuid(),
    'name', 'property/discovery_requested',
    'schemaVersion', 1,
    'correlationId', v_pipeline.correlation_id,
    'causationEventId', v_started_event_id,
    'leadId', v_attempt.lead_id,
    'propertyId', v_attempt.property_id,
    'pipelineRunId', v_pipeline.id,
    'occurredAt', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'idempotencyKey', 'property/discovery_requested:assessment-prefetch:' || v_attempt.assessment_id,
    'data', jsonb_build_object(
      'leadId', v_attempt.lead_id,
      'propertyId', v_attempt.property_id,
      'canonicalAddress', p_canonical_address,
      'latitude', p_latitude,
      'longitude', p_longitude,
      'attempt', 1
    )
  );
  perform public.enqueue_domain_event(p_company_id, v_event);

  return query
    select v_attempt.assessment_id, v_attempt.property_id,
           v_pipeline.id, true;
end;
$$;

revoke all on function public.apply_roof_assessment_property_prefetch(
  uuid, uuid, text, text, text, double precision, double precision,
  text, text, text, text, public.address_match_method, smallint,
  text, text, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.apply_roof_assessment_property_prefetch(
  uuid, uuid, text, text, text, double precision, double precision,
  text, text, text, text, public.address_match_method, smallint,
  text, text, timestamptz, integer
) to service_role;

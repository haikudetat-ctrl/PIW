-- Preserve one provider ledger entry for every concrete domain-worker attempt.
-- Existing Phase 1 rows remain valid with a null worker link; all Phase 3
-- workers use the attempt-scoped link and uniqueness boundary below.
alter table public.provider_requests
  add column worker_run_id uuid references public.worker_runs(id),
  add column attempt integer not null default 1 check (attempt > 0),
  add column error_code text
    check (
      error_code is null
      or (
        length(trim(error_code)) between 1 and 80
        and error_code ~ '^[a-z0-9_.-]+$'
      )
    ),
  add column error_message text
    check (
      error_message is null
      or length(trim(error_message)) between 1 and 500
    ),
  add constraint provider_requests_failure_metadata_check
    check (
      status = 'failed'
      or (error_code is null and error_message is null)
    );

create unique index provider_requests_worker_capability_key
  on public.provider_requests(worker_run_id, capability);

-- Cost entries are a one-to-one ledger projection for a provider request.
create unique index provider_cost_entries_provider_request_key
  on public.provider_cost_entries(provider_request_id);

-- Review idempotency is permanent per worker attempt, not merely while a task
-- is open. Nullable preserves compatibility with review rows created before
-- this migration; the worker RPC below always supplies the foreign key.
alter table public.review_tasks
  add column worker_run_id uuid references public.worker_runs(id);

create unique index review_tasks_worker_run_id_key
  on public.review_tasks(worker_run_id);

create or replace function public.normalize_property_address(p_address text)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select nullif(
    upper(
      regexp_replace(
        regexp_replace(trim(p_address), '[.,#]', '', 'g'),
        '[[:space:]]+',
        ' ',
        'g'
      )
    ),
    ''
  )
$$;

revoke all on function public.normalize_property_address(text)
  from public, anon, authenticated;
grant execute on function public.normalize_property_address(text)
  to service_role;

alter table public.property_addresses
  add column normalized_address text
    generated always as (
      public.normalize_property_address(canonical_address)
    ) stored,
  add column approved_at timestamptz,
  add column approved_by uuid references public.admin_profiles(id),
  add column approval_review_task_id uuid references public.review_tasks(id),
  add constraint property_addresses_approval_metadata_check
    check (
      (approved_at is null and approved_by is null
        and approval_review_task_id is null)
      or (approved_at is not null and approval_review_task_id is not null)
    );

create index property_addresses_normalized_recent_idx
  on public.property_addresses(company_id, normalized_address, created_at desc)
  where normalized_address is not null;
create index property_addresses_approved_by_idx
  on public.property_addresses(approved_by);
create index property_addresses_approval_review_task_id_idx
  on public.property_addresses(approval_review_task_id);

alter table public.parcels
  add constraint parcels_geometry_areal_check
  check (
    geometry is null
    or extensions.st_geometrytype(
      geometry::extensions.geometry
    ) in ('ST_Polygon', 'ST_MultiPolygon')
  );

-- Implemented behavior is added test-first below in this forward migration.
create or replace function public.claim_property_address(
  p_company_id uuid,
  p_pipeline_run_id uuid,
  p_lead_id uuid,
  p_property_id uuid,
  p_worker_run_id uuid,
  p_provider_request_id uuid,
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
  p_attempt integer
) returns table (
  outcome text,
  observation_property_id uuid,
  canonical_property_id uuid,
  candidate_property_ids uuid[],
  side_effects_applied boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_worker public.worker_runs%rowtype;
  v_pipeline public.pipeline_runs%rowtype;
  v_lead public.leads%rowtype;
  v_placeholder public.properties%rowtype;
  v_provider public.provider_requests%rowtype;
  v_claim jsonb;
  v_normalized_address text;
  v_candidate_property_ids uuid[] := array[]::uuid[];
  v_observation_property_id uuid;
  v_canonical_property_id uuid;
  v_outcome text;
  v_location extensions.geography;
  v_now timestamptz := now();
  v_is_high_confidence boolean;
begin
  if p_attempt < 1 then
    raise exception 'Address-validation attempt must be positive';
  end if;
  if p_confidence not between 0 and 100 then
    raise exception 'Address confidence must be between 0 and 100';
  end if;
  if length(trim(p_submitted_address)) = 0 then
    raise exception 'Submitted address must not be blank';
  end if;
  if p_state_code is not null and p_state_code <> 'NJ' then
    raise exception 'Only New Jersey addresses are supported';
  end if;
  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'Address coordinates must be supplied together';
  end if;

  -- The worker row is the attempt mutex. A second delivery blocks here, then
  -- observes addressClaim and returns the committed decision without writes.
  select worker.*
  into v_worker
  from public.worker_runs as worker
  where worker.id = p_worker_run_id
    and worker.pipeline_run_id = p_pipeline_run_id
    and worker.worker_type in ('address_validation', 'address-validation')
  for update;

  if not found then
    raise exception 'Address-validation worker attempt is out of scope';
  end if;

  select run.*
  into v_pipeline
  from public.pipeline_runs as run
  where run.id = p_pipeline_run_id
    and run.company_id = p_company_id
    and run.lead_id = p_lead_id
  for update;
  if not found then
    raise exception 'Address-validation pipeline is out of scope';
  end if;

  select lead.*
  into v_lead
  from public.leads as lead
  where lead.id = p_lead_id
    and lead.company_id = p_company_id
  for update;
  if not found then
    raise exception 'Address-validation lead is out of scope';
  end if;

  select property.*
  into v_placeholder
  from public.properties as property
  where property.id = p_property_id
    and property.company_id = p_company_id
  for update;
  if not found then
    raise exception 'Address-validation property is out of scope';
  end if;

  if v_worker.output is not null
    and jsonb_typeof(v_worker.output) <> 'object'
  then
    raise exception 'Address-validation worker output is invalid';
  end if;

  v_claim := v_worker.output->'addressClaim';
  if v_claim is not null then
    if v_claim->>'sourcePropertyId' <> p_property_id::text then
      raise exception 'Stored address claim is out of scope';
    end if;

    return query
      select
        v_claim->>'outcome',
        (v_claim->>'observationPropertyId')::uuid,
        nullif(v_claim->>'canonicalPropertyId', '')::uuid,
        coalesce(
          array(
            select candidate_id::uuid
            from jsonb_array_elements_text(
              coalesce(v_claim->'candidatePropertyIds', '[]'::jsonb)
            ) as candidate(candidate_id)
          ),
          array[]::uuid[]
        ),
        false;
    return;
  end if;

  -- A fresh attempt must still point at its placeholder. Merge replays return
  -- above before this check because their lead and pipeline now point at the
  -- canonical property.
  if v_pipeline.property_id <> p_property_id
    or v_lead.property_id <> p_property_id
  then
    raise exception 'Address-validation identity links are out of scope';
  end if;

  select request.*
  into v_provider
  from public.provider_requests as request
  where request.id = p_provider_request_id
    and request.company_id = p_company_id
    and request.pipeline_run_id = p_pipeline_run_id
    and request.worker_run_id = p_worker_run_id
    and request.capability = 'address.validate'
    and request.attempt = p_attempt
    and request.status in ('succeeded', 'cache_hit')
  for update;
  if not found then
    raise exception 'Address-validation provider request is out of scope';
  end if;

  if p_latitude is not null then
    v_location := extensions.st_setsrid(
      extensions.st_point(p_longitude, p_latitude),
      4326
    )::extensions.geography;
  end if;

  v_is_high_confidence :=
    p_confidence >= 95
    and p_match_method = 'exact_single_match'
    and p_state_code = 'NJ'
    and p_canonical_address is not null
    and length(trim(p_canonical_address)) > 0;

  if v_is_high_confidence then
    v_normalized_address :=
      public.normalize_property_address(p_canonical_address);

    -- The lock key is tenant + normalized address. Holding it until the RPC
    -- transaction commits makes the candidate recheck and canonical claim one
    -- indivisible operation across two fresh lead submissions.
    perform pg_advisory_xact_lock(
      hashtextextended(
        p_company_id::text || ':' || v_normalized_address,
        0
      )
    );

    select coalesce(
      array_agg(distinct address.property_id order by address.property_id),
      array[]::uuid[]
    )
    into v_candidate_property_ids
    from public.property_addresses as address
    join public.properties as property
      on property.id = address.property_id
     and property.company_id = p_company_id
    where address.company_id = p_company_id
      and address.normalized_address = v_normalized_address
      and address.created_at >= v_now - interval '180 days'
      and address.property_id <> p_property_id
      and property.resolution_status <> 'duplicate';

    if cardinality(v_candidate_property_ids) = 0 then
      v_outcome := 'discovery_requested';
      v_observation_property_id := p_property_id;
      v_canonical_property_id := p_property_id;

      update public.properties
      set canonical_address = p_canonical_address,
          municipality = p_municipality,
          county = p_county,
          state_code = 'NJ',
          location = v_location,
          resolution_status = 'unresolved',
          merged_into_property_id = null,
          updated_at = v_now
      where id = p_property_id
        and company_id = p_company_id;
    elsif cardinality(v_candidate_property_ids) = 1 then
      v_outcome := 'merged';
      v_observation_property_id := v_candidate_property_ids[1];
      v_canonical_property_id := v_candidate_property_ids[1];

      perform 1
      from public.properties as property
      where property.id = v_canonical_property_id
        and property.company_id = p_company_id
        and property.resolution_status <> 'duplicate'
      for update;
      if not found then
        raise exception 'Canonical property changed during address claim';
      end if;

      update public.properties
      set resolution_status = 'duplicate',
          merged_into_property_id = v_canonical_property_id,
          updated_at = v_now
      where id = p_property_id
        and company_id = p_company_id;

      update public.leads
      set property_id = v_canonical_property_id,
          updated_at = v_now
      where id = p_lead_id
        and company_id = p_company_id;

      update public.pipeline_runs
      set property_id = v_canonical_property_id,
          status = 'complete',
          finished_at = v_now
      where id = p_pipeline_run_id
        and company_id = p_company_id;
    else
      v_outcome := 'review_required';
      v_observation_property_id := p_property_id;
      v_canonical_property_id := null;
    end if;
  else
    v_outcome := 'review_required';
    v_observation_property_id := p_property_id;
    v_canonical_property_id := null;
  end if;

  insert into public.property_addresses (
    company_id,
    property_id,
    worker_run_id,
    submitted_address,
    canonical_address,
    latitude,
    longitude,
    location,
    municipality,
    county,
    state_code,
    zip,
    match_method,
    confidence,
    provider_request_id
  ) values (
    p_company_id,
    v_observation_property_id,
    p_worker_run_id,
    p_submitted_address,
    p_canonical_address,
    p_latitude,
    p_longitude,
    v_location,
    p_municipality,
    p_county,
    p_state_code,
    p_zip,
    p_match_method,
    p_confidence,
    p_provider_request_id
  );

  v_claim := jsonb_build_object(
    'schemaVersion', 1,
    'sourcePropertyId', p_property_id,
    'outcome', v_outcome,
    'observationPropertyId', v_observation_property_id,
    'canonicalPropertyId', v_canonical_property_id,
    'candidatePropertyIds', to_jsonb(v_candidate_property_ids),
    'providerRequestId', p_provider_request_id,
    'attempt', p_attempt
  );

  update public.worker_runs
  set output = coalesce(output, '{}'::jsonb)
    || jsonb_build_object('addressClaim', v_claim)
  where id = p_worker_run_id;

  return query
    select
      v_outcome,
      v_observation_property_id,
      v_canonical_property_id,
      v_candidate_property_ids,
      true;
end;
$$;

revoke all on function public.claim_property_address(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, double precision,
  double precision, text, text, text, text,
  public.address_match_method, smallint, integer
) from public, anon, authenticated;
grant execute on function public.claim_property_address(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, double precision,
  double precision, text, text, text, text,
  public.address_match_method, smallint, integer
) to service_role;

create or replace function public.escalate_property_identity_review(
  p_company_id uuid,
  p_pipeline_run_id uuid,
  p_lead_id uuid,
  p_property_id uuid,
  p_worker_run_id uuid,
  p_reason public.review_task_reason,
  p_triggering_event_name text,
  p_candidate_data jsonb,
  p_attempt integer
) returns table (
  review_task_id uuid,
  status public.review_task_status,
  created boolean,
  side_effects_applied boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_worker public.worker_runs%rowtype;
  v_pipeline public.pipeline_runs%rowtype;
  v_lead public.leads%rowtype;
  v_property public.properties%rowtype;
  v_task public.review_tasks%rowtype;
  v_review_task_id uuid;
begin
  if p_attempt < 1 then
    raise exception 'Review escalation attempt must be positive';
  end if;
  if p_triggering_event_name not in (
    'property/address.validation_requested',
    'property/discovery_requested'
  ) then
    raise exception 'Unsupported review triggering event';
  end if;

  select worker.*
  into v_worker
  from public.worker_runs as worker
  where worker.id = p_worker_run_id
    and worker.pipeline_run_id = p_pipeline_run_id
  for update;
  if not found then
    raise exception 'Review worker attempt is out of scope';
  end if;

  select task.*
  into v_task
  from public.review_tasks as task
  where task.worker_run_id = p_worker_run_id
  for update;

  if found then
    if v_task.company_id <> p_company_id
      or v_task.pipeline_run_id <> p_pipeline_run_id
      or v_task.lead_id <> p_lead_id
      or v_task.property_id <> p_property_id
    then
      raise exception 'Existing review task is out of scope';
    end if;

    return query
      select v_task.id, v_task.status, false, false;
    return;
  end if;

  if (
    p_triggering_event_name = 'property/address.validation_requested'
    and (
      v_worker.worker_type not in ('address_validation', 'address-validation')
      or p_reason not in (
        'low_address_confidence',
        'duplicate_candidates'
      )
    )
  ) or (
    p_triggering_event_name = 'property/discovery_requested'
    and (
      v_worker.worker_type not in ('property_discovery', 'property-discovery')
      or p_reason in (
        'low_address_confidence',
        'duplicate_candidates'
      )
    )
  ) then
    raise exception 'Review reason does not match its worker attempt';
  end if;

  select run.*
  into v_pipeline
  from public.pipeline_runs as run
  where run.id = p_pipeline_run_id
    and run.company_id = p_company_id
    and run.lead_id = p_lead_id
    and run.property_id = p_property_id
  for update;
  if not found then
    raise exception 'Review pipeline is out of scope';
  end if;

  select lead.*
  into v_lead
  from public.leads as lead
  where lead.id = p_lead_id
    and lead.company_id = p_company_id
    and lead.property_id = p_property_id
  for update;
  if not found then
    raise exception 'Review lead is out of scope';
  end if;

  select property.*
  into v_property
  from public.properties as property
  where property.id = p_property_id
    and property.company_id = p_company_id
  for update;
  if not found then
    raise exception 'Review property is out of scope';
  end if;

  insert into public.review_tasks (
    company_id,
    pipeline_run_id,
    lead_id,
    property_id,
    worker_run_id,
    reason,
    triggering_event_name,
    candidate_data,
    retry_count
  ) values (
    p_company_id,
    p_pipeline_run_id,
    p_lead_id,
    p_property_id,
    p_worker_run_id,
    p_reason,
    p_triggering_event_name,
    coalesce(p_candidate_data, '{}'::jsonb),
    p_attempt - 1
  )
  returning id into v_review_task_id;

  update public.properties
  set resolution_status = 'review_required',
      updated_at = now()
  where id = p_property_id
    and company_id = p_company_id;

  update public.pipeline_runs
  set status = 'review_required',
      finished_at = null
  where id = p_pipeline_run_id
    and company_id = p_company_id;

  return query
    select
      v_review_task_id,
      'open'::public.review_task_status,
      true,
      true;
end;
$$;

revoke all on function public.escalate_property_identity_review(
  uuid, uuid, uuid, uuid, uuid, public.review_task_reason, text, jsonb, integer
) from public, anon, authenticated;
grant execute on function public.escalate_property_identity_review(
  uuid, uuid, uuid, uuid, uuid, public.review_task_reason, text, jsonb, integer
) to service_role;

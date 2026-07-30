begin;

create extension if not exists pgtap with schema extensions;

select plan(45);

select has_column(
  'public',
  'provider_requests',
  'worker_run_id',
  'provider requests identify their worker attempt'
);
select col_is_fk(
  'public',
  'provider_requests',
  'worker_run_id',
  'provider_requests.worker_run_id references worker_runs'
);
select has_column(
  'public',
  'provider_requests',
  'attempt',
  'provider requests retain retry lineage'
);
select has_column(
  'public',
  'provider_requests',
  'error_code',
  'provider failures retain a safe machine-readable code'
);
select has_column(
  'public',
  'provider_requests',
  'error_message',
  'provider failures retain a bounded safe message'
);
select is(
  (
    select count(*)
    from pg_index
    where indrelid = 'public.provider_requests'::regclass
      and indisunique
      and pg_get_indexdef(indexrelid) like
        '%(worker_run_id, capability)%'
  ),
  1::bigint,
  'provider capability is unique within one worker attempt'
);
select is(
  (
    select count(*)
    from pg_index
    where indrelid = 'public.provider_cost_entries'::regclass
      and indisunique
      and pg_get_indexdef(indexrelid) like '%(provider_request_id)%'
  ),
  1::bigint,
  'one cost-ledger row is retained per provider request'
);

select has_column(
  'public',
  'review_tasks',
  'worker_run_id',
  'review tasks identify the worker attempt that escalated'
);
select col_is_fk(
  'public',
  'review_tasks',
  'worker_run_id',
  'review_tasks.worker_run_id references worker_runs'
);
select is(
  (
    select count(*)
    from pg_index
    where indrelid = 'public.review_tasks'::regclass
      and indisunique
      and pg_get_indexdef(indexrelid) like '%(worker_run_id)%'
  ),
  1::bigint,
  'one permanent review task is retained per worker attempt'
);

select has_column(
  'public',
  'property_addresses',
  'normalized_address',
  'address observations retain their normalized identity key'
);
select has_column(
  'public',
  'property_addresses',
  'approved_at',
  'admin-approved address observations retain approval time'
);
select has_column(
  'public',
  'property_addresses',
  'approved_by',
  'admin-approved address observations retain actor provenance'
);
select col_is_fk(
  'public',
  'property_addresses',
  'approved_by',
  'property_addresses.approved_by references admin_profiles'
);
select has_column(
  'public',
  'property_addresses',
  'approval_review_task_id',
  'admin-approved address observations retain review provenance'
);
select col_is_fk(
  'public',
  'property_addresses',
  'approval_review_task_id',
  'property_addresses.approval_review_task_id references review_tasks'
);

select is(
  (
    select count(*)
    from pg_constraint
    where conrelid = 'public.parcels'::regclass
      and conname = 'parcels_geometry_areal_check'
      and contype = 'c'
  ),
  1::bigint,
  'parcel geometry is constrained to areal types'
);

select has_function(
  'public',
  'claim_property_address',
  array[
    'uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'text', 'text',
    'double precision', 'double precision', 'text', 'text', 'text', 'text',
    'address_match_method', 'smallint', 'integer'
  ],
  'claim_property_address RPC exists'
);
select function_privs_are(
  'public',
  'claim_property_address',
  array[
    'uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'text', 'text',
    'double precision', 'double precision', 'text', 'text', 'text', 'text',
    'address_match_method', 'smallint', 'integer'
  ],
  'service_role',
  array['EXECUTE'],
  'only trusted server code receives address-claim execution'
);
select function_privs_are(
  'public',
  'claim_property_address',
  array[
    'uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'text', 'text',
    'double precision', 'double precision', 'text', 'text', 'text', 'text',
    'address_match_method', 'smallint', 'integer'
  ],
  'authenticated',
  array[]::text[],
  'authenticated admins cannot call the worker address-claim RPC'
);

select has_function(
  'public',
  'escalate_property_identity_review',
  array[
    'uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'review_task_reason',
    'text', 'jsonb', 'integer'
  ],
  'worker review-escalation RPC exists'
);
select function_privs_are(
  'public',
  'escalate_property_identity_review',
  array[
    'uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'review_task_reason',
    'text', 'jsonb', 'integer'
  ],
  'service_role',
  array['EXECUTE'],
  'only trusted server code receives review-escalation execution'
);
select function_privs_are(
  'public',
  'escalate_property_identity_review',
  array[
    'uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'review_task_reason',
    'text', 'jsonb', 'integer'
  ],
  'authenticated',
  array[]::text[],
  'authenticated admins cannot call the worker review-escalation RPC'
);
select is(
  (
    select count(*)
    from pg_proc as proc
    join pg_namespace as namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname in (
        'claim_property_address',
        'escalate_property_identity_review'
      )
      and not proc.prosecdef
  ),
  2::bigint,
  'worker mutation RPCs are SECURITY INVOKER'
);

-- Two independent lead submissions for equivalent addresses begin with
-- independent CRM history and placeholder properties.
insert into public.properties (id, company_id, resolution_status)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'unresolved'
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'unresolved'
  ),
  (
    'a1000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000001',
    'unresolved'
  );

insert into public.leads (
  id, company_id, property_id, name, phone, email, submitted_address
) values
  (
    'a2000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'First Address Lead',
    '555-1001',
    'first-address@example.com',
    '12 Birch St., Trenton, NJ 08608'
  ),
  (
    'a2000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000002',
    'Second Address Lead',
    '555-1002',
    'second-address@example.com',
    '12 BIRCH ST TRENTON NJ 08608'
  ),
  (
    'a2000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000003',
    'Low Confidence Lead',
    '555-1003',
    'low-confidence@example.com',
    'Unknown Place, NJ'
  );

insert into public.pipeline_runs (
  id, company_id, lead_id, property_id, correlation_id, pipeline_version,
  status
) values
  (
    'a3000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001',
    1,
    'validating'
  ),
  (
    'a3000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000002',
    'a4000000-0000-4000-8000-000000000002',
    1,
    'validating'
  ),
  (
    'a3000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000003',
    'a4000000-0000-4000-8000-000000000003',
    1,
    'validating'
  );

insert into public.worker_runs (
  id, pipeline_run_id, worker_type, worker_version, idempotency_key,
  status, started_at
) values
  (
    'a5000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000001',
    'address_validation',
    1,
    'address-validation-worker:a3000000-0000-4000-8000-000000000001:1',
    'running',
    now()
  ),
  (
    'a5000000-0000-4000-8000-000000000002',
    'a3000000-0000-4000-8000-000000000002',
    'address_validation',
    1,
    'address-validation-worker:a3000000-0000-4000-8000-000000000002:1',
    'running',
    now()
  ),
  (
    'a5000000-0000-4000-8000-000000000003',
    'a3000000-0000-4000-8000-000000000003',
    'address_validation',
    1,
    'address-validation-worker:a3000000-0000-4000-8000-000000000003:1',
    'running',
    now()
  );

insert into public.provider_requests (
  id, company_id, pipeline_run_id, worker_run_id, attempt, capability,
  provider, request_key, status, requested_at, completed_at
) values
  (
    'a6000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000001',
    'a5000000-0000-4000-8000-000000000001',
    1,
    'address.validate',
    'census_geocoder',
    'address.validate:a3000000-0000-4000-8000-000000000001:1',
    'succeeded',
    now(),
    now()
  ),
  (
    'a6000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000002',
    'a5000000-0000-4000-8000-000000000002',
    1,
    'address.validate',
    'census_geocoder',
    'address.validate:a3000000-0000-4000-8000-000000000002:1',
    'succeeded',
    now(),
    now()
  ),
  (
    'a6000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000003',
    'a5000000-0000-4000-8000-000000000003',
    1,
    'address.validate',
    'census_geocoder',
    'address.validate:a3000000-0000-4000-8000-000000000003:1',
    'succeeded',
    now(),
    now()
  );

insert into public.lead_stage_history (
  id, company_id, lead_id, from_stage, to_stage
) values
  (
    'a7000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    null,
    'new'
  ),
  (
    'a7000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000002',
    null,
    'new'
  );

select throws_ok(
  $$ insert into public.provider_requests (
       company_id, pipeline_run_id, worker_run_id, attempt, capability,
       provider, request_key, status
     ) values (
       '00000000-0000-4000-8000-000000000001',
       'a3000000-0000-4000-8000-000000000001',
       'a5000000-0000-4000-8000-000000000001',
       1,
       'address.validate',
       'another_provider',
       'duplicate-worker-capability',
       'requested'
     ) $$,
  '23505',
  null,
  'one provider-capability record is stored per worker attempt'
);

insert into public.provider_cost_entries (
  provider_request_id, estimated_cost_micros, actual_cost_micros
) values (
  'a6000000-0000-4000-8000-000000000001',
  0,
  0
);

select throws_ok(
  $$ insert into public.provider_cost_entries (
       provider_request_id, estimated_cost_micros, actual_cost_micros
     ) values (
       'a6000000-0000-4000-8000-000000000001',
       0,
       0
     ) $$,
  '23505',
  null,
  'provider cost replay cannot duplicate the attempt ledger'
);

select throws_ok(
  $$ insert into public.provider_requests (
       company_id, pipeline_run_id, attempt, capability, provider,
       request_key, status, error_code, error_message
     ) values (
       '00000000-0000-4000-8000-000000000001',
       'a3000000-0000-4000-8000-000000000001',
       1,
       'not-a-failure',
       'test_provider',
       'not-a-failure',
       'succeeded',
       'network_error',
       'Provider request failed'
     ) $$,
  '23514',
  null,
  'failure metadata cannot be attached to a successful request'
);

select lives_ok(
  $$ insert into public.provider_requests (
       company_id, pipeline_run_id, attempt, capability, provider,
       request_key, status, error_code, error_message, completed_at
     ) values (
       '00000000-0000-4000-8000-000000000001',
       'a3000000-0000-4000-8000-000000000001',
       1,
       'failure-test',
       'test_provider',
       'safe-failure',
       'failed',
       'network_error',
       'Provider request failed',
       now()
     ) $$,
  'a failed request accepts bounded, generic failure metadata'
);

select is(
  (
    select row(
      outcome,
      observation_property_id,
      canonical_property_id,
      cardinality(candidate_property_ids),
      side_effects_applied
    )
    from public.claim_property_address(
      '00000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'a6000000-0000-4000-8000-000000000001',
      '12 Birch St., Trenton, NJ 08608',
      '12 BIRCH ST, TRENTON, NJ 08608',
      40.2206::double precision,
      -74.7699::double precision,
      'TRENTON',
      'MERCER',
      'NJ',
      '08608',
      'exact_single_match'::public.address_match_method,
      97::smallint,
      1
    )
  ),
  row(
    'discovery_requested'::text,
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a1000000-0000-4000-8000-000000000001'::uuid,
    0,
    true
  ),
  'the first normalized address atomically claims its placeholder property'
);

select is(
  (
    select row(
      canonical_address,
      municipality,
      county,
      resolution_status,
      (select status
       from public.pipeline_runs
       where id = 'a3000000-0000-4000-8000-000000000001')
    )
    from public.properties
    where id = 'a1000000-0000-4000-8000-000000000001'
  ),
  row(
    '12 BIRCH ST, TRENTON, NJ 08608'::text,
    'TRENTON'::text,
    'MERCER'::text,
    'unresolved'::text,
    'validating'::public.pipeline_status
  ),
  'a fresh claim persists canonical property fields without skipping discovery'
);

select is(
  (
    select row(property_id, worker_run_id, normalized_address)
    from public.property_addresses
    where worker_run_id = 'a5000000-0000-4000-8000-000000000001'
  ),
  row(
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a5000000-0000-4000-8000-000000000001'::uuid,
    '12 BIRCH ST TRENTON NJ 08608'::text
  ),
  'a fresh claim records its normalized observation on the canonical property'
);

select is(
  (
    select row(outcome, side_effects_applied)
    from public.claim_property_address(
      '00000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'a6000000-0000-4000-8000-000000000001',
      'ignored replay input',
      'IGNORED REPLAY INPUT',
      null::double precision,
      null::double precision,
      null,
      null,
      null,
      null,
      'no_match'::public.address_match_method,
      0::smallint,
      1
    )
  ),
  row('discovery_requested'::text, false),
  'the same worker attempt replays its persisted address decision'
);

select is(
  (
    select count(*)
    from public.property_addresses
    where worker_run_id = 'a5000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'claim replay retains one address observation for the attempt'
);

select is(
  (
    select row(
      outcome,
      observation_property_id,
      canonical_property_id,
      cardinality(candidate_property_ids),
      side_effects_applied
    )
    from public.claim_property_address(
      '00000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000002',
      'a2000000-0000-4000-8000-000000000002',
      'a1000000-0000-4000-8000-000000000002',
      'a5000000-0000-4000-8000-000000000002',
      'a6000000-0000-4000-8000-000000000002',
      '12 BIRCH ST TRENTON NJ 08608',
      '12 Birch St. Trenton, NJ 08608',
      40.2206::double precision,
      -74.7699::double precision,
      'TRENTON',
      'MERCER',
      'NJ',
      '08608',
      'exact_single_match'::public.address_match_method,
      98::smallint,
      1
    )
  ),
  row(
    'merged'::text,
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a1000000-0000-4000-8000-000000000001'::uuid,
    1,
    true
  ),
  'a second equivalent address merges into the locked canonical property'
);

select is(
  (
    select row(
      placeholder.resolution_status,
      placeholder.merged_into_property_id,
      lead.property_id,
      run.property_id,
      run.status
    )
    from public.properties as placeholder
    join public.leads as lead
      on lead.id = 'a2000000-0000-4000-8000-000000000002'
    join public.pipeline_runs as run
      on run.id = 'a3000000-0000-4000-8000-000000000002'
    where placeholder.id = 'a1000000-0000-4000-8000-000000000002'
  ),
  row(
    'duplicate'::text,
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'complete'::public.pipeline_status
  ),
  'duplicate merge updates only identity links and completes its own pipeline'
);

select is(
  (
    select count(*)
    from public.lead_stage_history
    where lead_id in (
      'a2000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000002'
    )
  ),
  2::bigint,
  'duplicate property merge preserves both leads'' independent CRM histories'
);

select is(
  (
    select count(*)
    from public.property_addresses
    where property_id = 'a1000000-0000-4000-8000-000000000001'
      and worker_run_id in (
        'a5000000-0000-4000-8000-000000000001',
        'a5000000-0000-4000-8000-000000000002'
      )
  ),
  2::bigint,
  'each attempt retains one observation attached to the canonical property'
);

select is(
  (
    select row(outcome, side_effects_applied)
    from public.claim_property_address(
      '00000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000002',
      'a2000000-0000-4000-8000-000000000002',
      'a1000000-0000-4000-8000-000000000002',
      'a5000000-0000-4000-8000-000000000002',
      'a6000000-0000-4000-8000-000000000002',
      'ignored replay input',
      'IGNORED REPLAY INPUT',
      null::double precision,
      null::double precision,
      null,
      null,
      null,
      null,
      'no_match'::public.address_match_method,
      0::smallint,
      1
    )
  ),
  row('merged'::text, false),
  'merged address attempts replay without reapplying identity changes'
);

select is(
  (
    select row(
      outcome,
      observation_property_id,
      side_effects_applied
    )
    from public.claim_property_address(
      '00000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000003',
      'a2000000-0000-4000-8000-000000000003',
      'a1000000-0000-4000-8000-000000000003',
      'a5000000-0000-4000-8000-000000000003',
      'a6000000-0000-4000-8000-000000000003',
      'Unknown Place, NJ',
      null,
      null::double precision,
      null::double precision,
      null,
      null,
      null,
      null,
      'no_match'::public.address_match_method,
      0::smallint,
      1
    )
  ),
  row(
    'review_required'::text,
    'a1000000-0000-4000-8000-000000000003'::uuid,
    true
  ),
  'a low-confidence address records its observation and requests review'
);

select is(
  (
    select row(created, status, side_effects_applied)
    from public.escalate_property_identity_review(
      '00000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000003',
      'a2000000-0000-4000-8000-000000000003',
      'a1000000-0000-4000-8000-000000000003',
      'a5000000-0000-4000-8000-000000000003',
      'low_address_confidence',
      'property/address.validation_requested',
      '{"result":{"canonicalAddress":null,"confidence":0}}',
      1
    )
  ),
  row(true, 'open'::public.review_task_status, true),
  'worker escalation atomically creates the attempt-scoped review task'
);

select is(
  (
    select row(property.resolution_status, run.status)
    from public.properties as property
    join public.pipeline_runs as run
      on run.id = 'a3000000-0000-4000-8000-000000000003'
    where property.id = 'a1000000-0000-4000-8000-000000000003'
  ),
  row('review_required'::text, 'review_required'::public.pipeline_status),
  'review escalation atomically transitions property and pipeline'
);

select is(
  (
    select row(created, status, side_effects_applied)
    from public.escalate_property_identity_review(
      '00000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000003',
      'a2000000-0000-4000-8000-000000000003',
      'a1000000-0000-4000-8000-000000000003',
      'a5000000-0000-4000-8000-000000000003',
      'low_address_confidence',
      'property/address.validation_requested',
      '{}',
      1
    )
  ),
  row(false, 'open'::public.review_task_status, false),
  'an open escalation replay returns the existing task without mutations'
);

update public.review_tasks
set status = 'rejected', resolved_at = now()
where worker_run_id = 'a5000000-0000-4000-8000-000000000003';
update public.properties
set resolution_status = 'unsupported'
where id = 'a1000000-0000-4000-8000-000000000003';
update public.pipeline_runs
set status = 'partial', finished_at = now()
where id = 'a3000000-0000-4000-8000-000000000003';

select is(
  (
    select row(created, status, side_effects_applied)
    from public.escalate_property_identity_review(
      '00000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000003',
      'a2000000-0000-4000-8000-000000000003',
      'a1000000-0000-4000-8000-000000000003',
      'a5000000-0000-4000-8000-000000000003',
      'low_address_confidence',
      'property/address.validation_requested',
      '{}',
      1
    )
  ),
  row(false, 'rejected'::public.review_task_status, false),
  'a stale worker replay returns its closed review task as a no-op'
);

select is(
  (
    select row(property.resolution_status, run.status)
    from public.properties as property
    join public.pipeline_runs as run
      on run.id = 'a3000000-0000-4000-8000-000000000003'
    where property.id = 'a1000000-0000-4000-8000-000000000003'
  ),
  row('unsupported'::text, 'partial'::public.pipeline_status),
  'a stale closed escalation cannot roll terminal state back to review'
);

select throws_ok(
  $$ insert into public.review_tasks (
       company_id, pipeline_run_id, lead_id, property_id, worker_run_id,
       reason, triggering_event_name
     ) values (
       '00000000-0000-4000-8000-000000000001',
       'a3000000-0000-4000-8000-000000000003',
       'a2000000-0000-4000-8000-000000000003',
       'a1000000-0000-4000-8000-000000000003',
       'a5000000-0000-4000-8000-000000000003',
       'low_address_confidence',
       'property/address.validation_requested'
     ) $$,
  '23505',
  null,
  'a worker attempt cannot create a second task after its first task closes'
);

select * from finish();

rollback;

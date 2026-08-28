begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select extensions.no_plan();

select has_column('public', 'property_addresses', 'assessment_access_attempt_id', 'address evidence can be bound to an assessment access attempt');
select col_type_is('public', 'property_addresses', 'assessment_access_attempt_id', 'uuid', 'attempt evidence uses the access-attempt UUID');
select col_is_null('public', 'property_addresses', 'worker_run_id', 'worker provenance is nullable only for attempt-backed evidence');
select has_column('public', 'property_addresses', 'evidence_source', 'fast-path evidence retains its provider');
select has_column('public', 'property_addresses', 'source_identifier', 'fast-path evidence retains the provider source identifier');
select has_column('public', 'property_addresses', 'retrieved_at', 'fast-path evidence retains retrieval time');
select col_type_is('public', 'property_addresses', 'retrieved_at', 'timestamp with time zone', 'retrieval time is timezone-aware');
select has_column('public', 'property_addresses', 'provider_duration_ms', 'fast-path evidence retains provider duration');
select col_type_is('public', 'property_addresses', 'provider_duration_ms', 'integer', 'provider duration uses integer milliseconds');

select is(
  (select count(*) from pg_catalog.pg_constraint
   where conrelid = 'public.property_addresses'::regclass
     and conname = 'property_addresses_exactly_one_origin_check'
     and contype = 'c'),
  1::bigint,
  'address evidence has an exactly-one-origin check'
);
select is(
  (select count(*) from pg_catalog.pg_constraint
   where conrelid = 'public.property_addresses'::regclass
     and conname = 'property_addresses_prefetch_provenance_check'
     and contype = 'c'),
  1::bigint,
  'attempt evidence requires the complete provider provenance tuple'
);
select is(
  (select count(*) from pg_catalog.pg_constraint
   where conrelid = 'public.property_addresses'::regclass
     and conname = 'property_addresses_prefetch_evidence_check'
     and contype = 'c'),
  1::bigint,
  'attempt evidence is constrained to exact NJ coordinates'
);
select is(
  (select count(*) from pg_catalog.pg_constraint
   where conrelid = 'public.property_addresses'::regclass
     and conname = 'property_addresses_company_access_attempt_fkey'
     and contype = 'f'
     and confrelid = 'public.roof_assessment_access_attempts'::regclass
     and pg_catalog.pg_get_constraintdef(oid) like
       'FOREIGN KEY (company_id, assessment_access_attempt_id) REFERENCES roof_assessment_access_attempts(company_id, id)%'),
  1::bigint,
  'attempt evidence has a tenant-bound composite foreign key'
);
select is(
  (select count(*) from pg_catalog.pg_index as idx
   where idx.indrelid = 'public.property_addresses'::regclass
     and idx.indisunique
     and pg_catalog.pg_get_indexdef(idx.indexrelid) like
       '%(company_id, assessment_access_attempt_id)%WHERE (assessment_access_attempt_id IS NOT NULL)%'),
  1::bigint,
  'one attempt-backed address observation exists per tenant attempt'
);

select policies_are(
  'public', 'property_addresses',
  array['company admins read property addresses'],
  'property address RLS policies remain unchanged'
);
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.property_addresses'::regclass), true, 'property address RLS remains enabled');
select is(pg_catalog.has_table_privilege('anon', 'public.property_addresses', 'select'), false, 'anon still cannot read property evidence');
select is(pg_catalog.has_table_privilege('authenticated', 'public.property_addresses', 'select'), true, 'authenticated admins retain tenant-scoped reads');
select is(pg_catalog.has_table_privilege('authenticated', 'public.property_addresses', 'insert'), false, 'authenticated admins still cannot insert property evidence');
select is(pg_catalog.has_table_privilege('service_role', 'public.property_addresses', 'insert'), true, 'service role retains property evidence writes');

select has_function(
  'public', 'resolve_roof_assessment_property_prefetch_scope',
  array['uuid', 'uuid', 'text'],
  'service-only prefetch scope resolver exists'
);
select has_function(
  'public', 'apply_roof_assessment_property_prefetch',
  array[
    'uuid', 'uuid', 'text', 'text', 'text', 'double precision',
    'double precision', 'text', 'text', 'text', 'text',
    'address_match_method', 'smallint', 'text', 'text',
    'timestamp with time zone', 'integer'
  ],
  'atomic property-prefetch RPC exists'
);
select ok(
  (select proc.prosecdef and proc.proconfig = array['search_path=""']
   from pg_catalog.pg_proc as proc
   where proc.oid = 'public.resolve_roof_assessment_property_prefetch_scope(uuid,uuid,text)'::regprocedure),
  'scope resolver is security definer with an empty search path'
);
select ok(
  (select proc.prosecdef and proc.proconfig = array['search_path=""']
   from pg_catalog.pg_proc as proc
   where proc.oid = 'public.apply_roof_assessment_property_prefetch(uuid,uuid,text,text,text,double precision,double precision,text,text,text,text,public.address_match_method,smallint,text,text,timestamp with time zone,integer)'::regprocedure),
  'prefetch apply RPC is security definer with an empty search path'
);
select function_privs_are(
  'public', 'resolve_roof_assessment_property_prefetch_scope',
  array['uuid', 'uuid', 'text'], 'public', array[]::text[],
  'public cannot resolve internal prefetch scope'
);
select function_privs_are(
  'public', 'resolve_roof_assessment_property_prefetch_scope',
  array['uuid', 'uuid', 'text'], 'anon', array[]::text[],
  'anon cannot resolve internal prefetch scope'
);
select function_privs_are(
  'public', 'resolve_roof_assessment_property_prefetch_scope',
  array['uuid', 'uuid', 'text'], 'authenticated', array[]::text[],
  'authenticated callers cannot resolve internal prefetch scope'
);
select function_privs_are(
  'public', 'resolve_roof_assessment_property_prefetch_scope',
  array['uuid', 'uuid', 'text'], 'service_role', array['EXECUTE'],
  'service role alone resolves internal prefetch scope'
);
select function_privs_are(
  'public', 'apply_roof_assessment_property_prefetch',
  array[
    'uuid', 'uuid', 'text', 'text', 'text', 'double precision',
    'double precision', 'text', 'text', 'text', 'text',
    'address_match_method', 'smallint', 'text', 'text',
    'timestamp with time zone', 'integer'
  ], 'public', array[]::text[],
  'public cannot apply property prefetch evidence'
);
select function_privs_are(
  'public', 'apply_roof_assessment_property_prefetch',
  array[
    'uuid', 'uuid', 'text', 'text', 'text', 'double precision',
    'double precision', 'text', 'text', 'text', 'text',
    'address_match_method', 'smallint', 'text', 'text',
    'timestamp with time zone', 'integer'
  ], 'anon', array[]::text[],
  'anon cannot apply property prefetch evidence'
);
select function_privs_are(
  'public', 'apply_roof_assessment_property_prefetch',
  array[
    'uuid', 'uuid', 'text', 'text', 'text', 'double precision',
    'double precision', 'text', 'text', 'text', 'text',
    'address_match_method', 'smallint', 'text', 'text',
    'timestamp with time zone', 'integer'
  ], 'authenticated', array[]::text[],
  'authenticated callers cannot apply property prefetch evidence'
);
select function_privs_are(
  'public', 'apply_roof_assessment_property_prefetch',
  array[
    'uuid', 'uuid', 'text', 'text', 'text', 'double precision',
    'double precision', 'text', 'text', 'text', 'text',
    'address_match_method', 'smallint', 'text', 'text',
    'timestamp with time zone', 'integer'
  ], 'service_role', array['EXECUTE'],
  'service role alone applies property prefetch evidence'
);

insert into public.companies (id, name) values
  ('a1000000-0000-4000-8000-000000000001', 'Prefetch Tenant A'),
  ('a1000000-0000-4000-8000-000000000002', 'Prefetch Tenant B');

create function pg_temp.start_prefetch_fixture(
  p_company_id uuid,
  p_submission_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_google_place_id text
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_result record;
begin
  select * into v_result
  from public.start_or_resume_roof_assessment(
    p_company_id,
    p_submission_id,
    p_name,
    p_phone,
    p_email,
    p_address,
    p_google_place_id,
    'all-season-main',
    'prefetch-pgtap',
    '{}'::jsonb,
    null,
    'all-season-assessment-v1',
    '2026-08-28 15:00:00+00'::timestamptz,
    '127.20.0.1',
    'pgtap'
  );
  return v_result.attempt_id;
end;
$$;

create function pg_temp.prefetch_sql(
  p_company_id uuid,
  p_attempt_id uuid,
  p_google_place_id text,
  p_submitted_address text,
  p_canonical_address text,
  p_latitude double precision default 40.2206,
  p_longitude double precision default -74.7699,
  p_state_code text default 'NJ',
  p_match_method text default 'exact_single_match',
  p_confidence smallint default 100,
  p_provider text default 'google_places',
  p_source_identifier text default 'place-details-v1',
  p_retrieved_at timestamptz default '2026-08-28 15:00:01+00',
  p_provider_duration_ms integer default 137
) returns text
language sql
set search_path = ''
as $$
  select pg_catalog.format(
    $call$select * from public.apply_roof_assessment_property_prefetch(
      %L::uuid, %L::uuid, %L, %L, %L, %L::double precision,
      %L::double precision, 'Trenton', 'Mercer', %L, '08608',
      %L::public.address_match_method, %L::smallint, %L, %L,
      %L::timestamptz, %L::integer
    )$call$,
    p_company_id, p_attempt_id, p_google_place_id, p_submitted_address,
    p_canonical_address, p_latitude, p_longitude, p_state_code,
    p_match_method, p_confidence, p_provider, p_source_identifier,
    p_retrieved_at, p_provider_duration_ms
  )
$$;

create temp table prefetch_attempts (
  fixture text primary key,
  attempt_id uuid not null,
  assessment_id uuid not null,
  estimate_id uuid not null,
  lead_id uuid not null,
  property_id uuid not null,
  pipeline_run_id uuid not null
);

create function pg_temp.capture_prefetch_fixture(
  p_fixture text,
  p_attempt_id uuid
) returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into pg_temp.prefetch_attempts (
    fixture, attempt_id, assessment_id, estimate_id, lead_id, property_id,
    pipeline_run_id
  )
  select p_fixture, attempt.id, attempt.assessment_id, attempt.estimate_id,
         attempt.lead_id, attempt.property_id, pipeline.id
  from public.roof_assessment_access_attempts as attempt
  join public.pipeline_runs as pipeline
    on pipeline.company_id = attempt.company_id
   and pipeline.lead_id = attempt.lead_id
   and pipeline.property_id = attempt.property_id
  where attempt.id = p_attempt_id
  order by pipeline.started_at desc, pipeline.id
  limit 1;
end;
$$;

select pg_temp.capture_prefetch_fixture(
  'zero',
  pg_temp.start_prefetch_fixture(
    'a1000000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000001',
    'Zero Candidate', '+12015551001', 'zero@example.com',
    '10 Zero Way, Trenton, NJ 08608', 'ChIJ-prefetch-zero'
  )
);

select results_eq(
  pg_catalog.format(
    $$select eligible, assessment_id, property_id, pipeline_run_id
      from public.resolve_roof_assessment_property_prefetch_scope(
        'a1000000-0000-4000-8000-000000000001', %L::uuid,
        'ChIJ-prefetch-zero')$$,
    (select attempt_id from prefetch_attempts where fixture = 'zero')
  ),
  $$select true, assessment_id, property_id, pipeline_run_id
    from prefetch_attempts where fixture = 'zero'$$,
  'scope resolver returns the exact committed new-attempt boundary'
);

select lives_ok(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000001',
    (select attempt_id from prefetch_attempts where fixture = 'zero'),
    'ChIJ-prefetch-zero',
    '10 Zero Way, Trenton, NJ 08608',
    '10 Zero Way, Trenton, NJ 08608'
  ),
  'a precise NJ result with zero identity candidates applies atomically'
);

select is(
  (select count(*) from public.property_addresses as address
   where address.assessment_access_attempt_id =
     (select attempt_id from prefetch_attempts where fixture = 'zero')),
  1::bigint,
  'the valid call stores one immutable attempt-backed observation'
);
select results_eq(
  $$select address.company_id, address.property_id, address.worker_run_id,
           address.google_place_id, address.canonical_address,
           address.latitude, address.longitude, address.municipality,
           address.county, address.state_code, address.zip,
           address.match_method, address.confidence,
           address.evidence_source, address.source_identifier,
           address.retrieved_at, address.provider_duration_ms
    from public.property_addresses as address
    where address.assessment_access_attempt_id =
      (select attempt_id from prefetch_attempts where fixture = 'zero')$$,
  $$select 'a1000000-0000-4000-8000-000000000001'::uuid, property_id,
           null::uuid, 'ChIJ-prefetch-zero'::text,
           '10 Zero Way, Trenton, NJ 08608'::text,
           40.2206::double precision, -74.7699::double precision,
           'Trenton'::text, 'Mercer'::text, 'NJ'::text, '08608'::text,
           'exact_single_match'::public.address_match_method, 100::smallint,
           'google_places'::text, 'place-details-v1'::text,
           '2026-08-28 15:00:01+00'::timestamptz, 137::integer
    from prefetch_attempts where fixture = 'zero'$$,
  'the address observation retains exact property identity and provider provenance'
);
select results_eq(
  $$select property.canonical_address, property.municipality, property.county,
           property.state_code,
           extensions.st_y(property.location::extensions.geometry),
           extensions.st_x(property.location::extensions.geometry)
    from public.properties as property
    where property.id = (select property_id from prefetch_attempts where fixture = 'zero')$$,
  $$values ('10 Zero Way, Trenton, NJ 08608'::text, 'Trenton'::text,
            'Mercer'::text, 'NJ'::text, 40.2206::double precision,
            -74.7699::double precision)$$,
  'the valid call stores canonical NJ property coordinates'
);
select is(
  (select count(*) from public.domain_events as event
   where event.idempotency_key = 'property/discovery_requested:assessment-prefetch:' ||
     (select assessment_id::text from prefetch_attempts where fixture = 'zero')),
  1::bigint,
  'the valid call creates one stable discovery event'
);
select is(
  (select count(*) from public.event_outbox as outbox
   join public.domain_events as event on event.id = outbox.event_id
   where event.idempotency_key = 'property/discovery_requested:assessment-prefetch:' ||
     (select assessment_id::text from prefetch_attempts where fixture = 'zero')),
  1::bigint,
  'the discovery event is atomically enqueued once'
);
select results_eq(
  $$select event.pipeline_run_id, event.correlation_id,
           event.causation_event_id,
           event.payload ->> 'name',
           event.payload ->> 'leadId',
           event.payload ->> 'propertyId',
           event.payload ->> 'pipelineRunId',
           event.payload -> 'data' ->> 'canonicalAddress',
           event.payload -> 'data' ->> 'attempt'
    from public.domain_events as event
    where event.idempotency_key = 'property/discovery_requested:assessment-prefetch:' ||
      (select assessment_id::text from prefetch_attempts where fixture = 'zero')$$,
  $$select fixture.pipeline_run_id, pipeline.correlation_id, started.id,
           'property/discovery_requested'::text,
           fixture.lead_id::text, fixture.property_id::text,
           fixture.pipeline_run_id::text,
           '10 Zero Way, Trenton, NJ 08608'::text, '1'::text
    from prefetch_attempts as fixture
    join public.pipeline_runs as pipeline on pipeline.id = fixture.pipeline_run_id
    join public.domain_events as started
      on started.idempotency_key = 'roof/assessment.started:' || fixture.assessment_id::text
    where fixture.fixture = 'zero'$$,
  'the discovery event uses the required correlation and causation envelope'
);

create temp table zero_prefetch_snapshot as
select address.created_at as evidence_created_at,
       property.updated_at as property_updated_at,
       event.created_at as event_created_at,
       outbox.available_at as outbox_available_at
from prefetch_attempts as fixture
join public.property_addresses as address
  on address.assessment_access_attempt_id = fixture.attempt_id
join public.properties as property on property.id = fixture.property_id
join public.domain_events as event
  on event.idempotency_key = 'property/discovery_requested:assessment-prefetch:' || fixture.assessment_id::text
join public.event_outbox as outbox on outbox.event_id = event.id
where fixture.fixture = 'zero';

select results_eq(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000001',
    (select attempt_id from prefetch_attempts where fixture = 'zero'),
    'ChIJ-prefetch-zero',
    '10 Zero Way, Trenton, NJ 08608',
    '10 Zero Way, Trenton, NJ 08608'
  ),
  $$select assessment_id, property_id, pipeline_run_id, false
    from prefetch_attempts where fixture = 'zero'$$,
  'an identical replay returns the canonical no-op result'
);
select results_eq(
  $$select address.created_at, property.updated_at, event.created_at,
           outbox.available_at
    from prefetch_attempts as fixture
    join public.property_addresses as address
      on address.assessment_access_attempt_id = fixture.attempt_id
    join public.properties as property on property.id = fixture.property_id
    join public.domain_events as event
      on event.idempotency_key = 'property/discovery_requested:assessment-prefetch:' || fixture.assessment_id::text
    join public.event_outbox as outbox on outbox.event_id = event.id
    where fixture.fixture = 'zero'$$,
  $$select evidence_created_at, property_updated_at, event_created_at,
           outbox_available_at from zero_prefetch_snapshot$$,
  'an identical replay does not change evidence, property, event, or outbox timestamps'
);
select throws_ok(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000001',
    (select attempt_id from prefetch_attempts where fixture = 'zero'),
    'ChIJ-prefetch-zero',
    '10 Zero Way, Trenton, NJ 08608',
    '10 Conflicting Way, Trenton, NJ 08608',
    40.2207,
    -74.7698
  ),
  null,
  'Conflicting property prefetch evidence',
  'conflicting evidence for the completed attempt fails closed'
);
select results_eq(
  $$select count(*)::bigint,
           count(*) filter (where event.event_name = 'property/discovery_requested')::bigint
    from public.property_addresses as address
    left join public.domain_events as event
      on event.idempotency_key = 'property/discovery_requested:assessment-prefetch:' ||
         (select assessment_id::text from prefetch_attempts where fixture = 'zero')
    where address.assessment_access_attempt_id =
      (select attempt_id from prefetch_attempts where fixture = 'zero')$$,
  $$values (1::bigint, 1::bigint)$$,
  'a conflicting replay leaves the committed evidence and event singular'
);

select pg_temp.capture_prefetch_fixture(
  'mismatch_a',
  pg_temp.start_prefetch_fixture(
    'a1000000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000002',
    'Mismatch A', '+12015551002', 'mismatch-a@example.com',
    '20 Mismatch Way, Trenton, NJ 08608', 'ChIJ-prefetch-mismatch-a'
  )
);
select pg_temp.capture_prefetch_fixture(
  'mismatch_b',
  pg_temp.start_prefetch_fixture(
    'a1000000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000003',
    'Mismatch B', '+12015551003', 'mismatch-b@example.com',
    '21 Mismatch Way, Trenton, NJ 08608', 'ChIJ-prefetch-mismatch-b'
  )
);

select throws_ok(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000002',
    (select attempt_id from prefetch_attempts where fixture = 'mismatch_a'),
    'ChIJ-prefetch-mismatch-a', '20 Mismatch Way, Trenton, NJ 08608',
    '20 Mismatch Way, Trenton, NJ 08608'
  ), null, 'Property prefetch access attempt is out of scope',
  'a foreign tenant cannot apply evidence to another tenant attempt'
);

update public.roof_assessment_access_attempts
set property_id = (select property_id from prefetch_attempts where fixture = 'mismatch_b')
where id = (select attempt_id from prefetch_attempts where fixture = 'mismatch_a');
select throws_ok(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000001',
    (select attempt_id from prefetch_attempts where fixture = 'mismatch_a'),
    'ChIJ-prefetch-mismatch-a', '20 Mismatch Way, Trenton, NJ 08608',
    '20 Mismatch Way, Trenton, NJ 08608'
  ), null, 'Property prefetch identity links are out of scope',
  'a mismatched attempt property is rejected'
);
update public.roof_assessment_access_attempts
set property_id = (select property_id from prefetch_attempts where fixture = 'mismatch_a')
where id = (select attempt_id from prefetch_attempts where fixture = 'mismatch_a');

update public.roof_assessment_access_attempts
set estimate_id = (select estimate_id from prefetch_attempts where fixture = 'mismatch_b')
where id = (select attempt_id from prefetch_attempts where fixture = 'mismatch_a');
select throws_ok(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000001',
    (select attempt_id from prefetch_attempts where fixture = 'mismatch_a'),
    'ChIJ-prefetch-mismatch-a', '20 Mismatch Way, Trenton, NJ 08608',
    '20 Mismatch Way, Trenton, NJ 08608'
  ), null, 'Property prefetch identity links are out of scope',
  'a mismatched attempt estimate is rejected'
);
update public.roof_assessment_access_attempts
set estimate_id = (select estimate_id from prefetch_attempts where fixture = 'mismatch_a')
where id = (select attempt_id from prefetch_attempts where fixture = 'mismatch_a');

update public.roof_assessment_access_attempts
set assessment_id = (select assessment_id from prefetch_attempts where fixture = 'mismatch_b')
where id = (select attempt_id from prefetch_attempts where fixture = 'mismatch_a');
select throws_ok(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000001',
    (select attempt_id from prefetch_attempts where fixture = 'mismatch_a'),
    'ChIJ-prefetch-mismatch-a', '20 Mismatch Way, Trenton, NJ 08608',
    '20 Mismatch Way, Trenton, NJ 08608'
  ), null, 'Property prefetch identity links are out of scope',
  'a mismatched attempt assessment is rejected'
);
update public.roof_assessment_access_attempts
set assessment_id = (select assessment_id from prefetch_attempts where fixture = 'mismatch_a')
where id = (select attempt_id from prefetch_attempts where fixture = 'mismatch_a');

select throws_ok(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000001',
    (select attempt_id from prefetch_attempts where fixture = 'mismatch_a'),
    'ChIJ-wrong-place', '20 Mismatch Way, Trenton, NJ 08608',
    '20 Mismatch Way, Trenton, NJ 08608'
  ), null, 'Property prefetch Google Place ID does not match the estimate',
  'a mismatched provider Place ID is rejected'
);
select throws_ok(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000001',
    (select attempt_id from prefetch_attempts where fixture = 'mismatch_a'),
    'ChIJ-prefetch-mismatch-a', '20 Mismatch Way, Trenton, NJ 08608',
    '20 Mismatch Way, Philadelphia, PA 19103', 39.95, -75.16, 'PA'
  ), null, 'Property prefetch requires exact New Jersey evidence',
  'non-New-Jersey evidence is rejected'
);
select throws_ok(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000001',
    (select attempt_id from prefetch_attempts where fixture = 'mismatch_a'),
    'ChIJ-prefetch-mismatch-a', '20 Mismatch Way, Trenton, NJ 08608',
    '20 Mismatch Way, Trenton, NJ 08608', 40.22, -74.76, 'NJ',
    'multiple_matches'
  ), null, 'Property prefetch requires exact New Jersey evidence',
  'non-exact address evidence is rejected'
);
select throws_ok(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000001',
    (select attempt_id from prefetch_attempts where fixture = 'mismatch_a'),
    'ChIJ-prefetch-mismatch-a', '20 Mismatch Way, Trenton, NJ 08608',
    '20 Mismatch Way, Trenton, NJ 08608', null, -74.76
  ), null, 'Property prefetch coordinates are invalid',
  'a partial coordinate pair is rejected'
);
select throws_ok(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000001',
    (select attempt_id from prefetch_attempts where fixture = 'mismatch_a'),
    'ChIJ-prefetch-mismatch-a', '20 Mismatch Way, Trenton, NJ 08608',
    '20 Mismatch Way, Trenton, NJ 08608', 'NaN'::double precision, -74.76
  ), null, 'Property prefetch coordinates are invalid',
  'non-finite coordinates are rejected'
);
select throws_ok(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-ffffffffffff',
    'ChIJ-prefetch-missing', 'Missing Attempt', 'Missing Attempt'
  ), null, 'Property prefetch access attempt is out of scope',
  'a nonexistent access attempt is rejected'
);

select pg_temp.capture_prefetch_fixture(
  'resume_source',
  pg_temp.start_prefetch_fixture(
    'a1000000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000004',
    'Resume Source', '+12015551004', 'resume@example.com',
    '30 Resume Way, Trenton, NJ 08608', 'ChIJ-prefetch-resume'
  )
);
select pg_temp.capture_prefetch_fixture(
  'resume_candidate',
  pg_temp.start_prefetch_fixture(
    'a1000000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000005',
    'Resume Candidate', '+12015559999', 'resume@example.com',
    '30 Resume Way, Trenton, NJ 08608', 'ChIJ-prefetch-resume'
  )
);
select results_eq(
  pg_catalog.format(
    $$select eligible, assessment_id, property_id, pipeline_run_id
      from public.resolve_roof_assessment_property_prefetch_scope(
        'a1000000-0000-4000-8000-000000000001', %L::uuid,
        'ChIJ-prefetch-resume')$$,
    (select attempt_id from prefetch_attempts where fixture = 'resume_candidate')
  ),
  $$values (false, null::uuid, null::uuid, null::uuid)$$,
  'scope resolver suppresses paid work for resume candidates'
);
select throws_ok(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000001',
    (select attempt_id from prefetch_attempts where fixture = 'resume_candidate'),
    'ChIJ-prefetch-resume', '30 Resume Way, Trenton, NJ 08608',
    '30 Resume Way, Trenton, NJ 08608'
  ), null, 'Property prefetch access attempt is not eligible',
  'apply revalidates and rejects a resume candidate'
);

insert into public.properties (
  id, company_id, canonical_address, municipality, county, state_code,
  location, resolution_status
) values (
  'a1200000-0000-4000-8000-000000000010',
  'a1000000-0000-4000-8000-000000000001',
  '40 Existing Place Road, Trenton, NJ 08608', 'Trenton', 'Mercer', 'NJ',
  extensions.st_setsrid(extensions.st_point(-74.70, 40.20), 4326)::extensions.geography,
  'resolved'
);
insert into public.pipeline_runs (
  id, company_id, property_id, correlation_id, pipeline_version, status
) values (
  'a1300000-0000-4000-8000-000000000010',
  'a1000000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000010',
  'a1400000-0000-4000-8000-000000000010', 1, 'complete'
);
insert into public.worker_runs (
  id, pipeline_run_id, worker_type, worker_version, idempotency_key
) values (
  'a1500000-0000-4000-8000-000000000010',
  'a1300000-0000-4000-8000-000000000010',
  'address-validation', 1, 'prefetch-place-candidate'
);
insert into public.property_addresses (
  company_id, property_id, worker_run_id, submitted_address,
  canonical_address, google_place_id, latitude, longitude, location,
  municipality, county, state_code, zip, match_method, confidence
) values (
  'a1000000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000010',
  'a1500000-0000-4000-8000-000000000010',
  '40 Existing Place Road, Trenton, NJ 08608',
  '40 Existing Place Road, Trenton, NJ 08608', 'ChIJ-prefetch-one-place',
  40.20, -74.70,
  extensions.st_setsrid(extensions.st_point(-74.70, 40.20), 4326)::extensions.geography,
  'Trenton', 'Mercer', 'NJ', '08608', 'exact_single_match', 100
);

select pg_temp.capture_prefetch_fixture(
  'one_place',
  pg_temp.start_prefetch_fixture(
    'a1000000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000010',
    'Place Merge', '+12015551010', 'place-merge@example.com',
    '40 Place Rd, Trenton, NJ 08608', 'ChIJ-prefetch-one-place'
  )
);
select lives_ok(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000001',
    (select attempt_id from prefetch_attempts where fixture = 'one_place'),
    'ChIJ-prefetch-one-place', '40 Place Rd, Trenton, NJ 08608',
    '40 Existing Place Road, Trenton, NJ 08608', 40.2210, -74.7610
  ),
  'one same-tenant Place-ID candidate merges into the canonical property'
);
select results_eq(
  $$select source.resolution_status, source.merged_into_property_id,
           lead.property_id, pipeline.property_id, estimate.property_id,
           attempt.property_id
    from prefetch_attempts as fixture
    join public.properties as source on source.id = fixture.property_id
    join public.leads as lead on lead.id = fixture.lead_id
    join public.pipeline_runs as pipeline on pipeline.id = fixture.pipeline_run_id
    join public.roof_estimates as estimate on estimate.id = fixture.estimate_id
    join public.roof_assessment_access_attempts as attempt
      on attempt.id = fixture.attempt_id
    where fixture.fixture = 'one_place'$$,
  $$values (
      'duplicate'::text,
      'a1200000-0000-4000-8000-000000000010'::uuid,
      'a1200000-0000-4000-8000-000000000010'::uuid,
      'a1200000-0000-4000-8000-000000000010'::uuid,
      'a1200000-0000-4000-8000-000000000010'::uuid,
      'a1200000-0000-4000-8000-000000000010'::uuid
    )$$,
  'Place-ID merge marks the placeholder duplicate and repoints every property link'
);
select results_eq(
  $$select address.property_id, property.canonical_address,
           extensions.st_y(property.location::extensions.geometry),
           extensions.st_x(property.location::extensions.geometry),
           event.payload ->> 'propertyId',
           event.payload -> 'data' ->> 'propertyId'
    from prefetch_attempts as fixture
    join public.property_addresses as address
      on address.assessment_access_attempt_id = fixture.attempt_id
    join public.properties as property on property.id = address.property_id
    join public.domain_events as event
      on event.idempotency_key = 'property/discovery_requested:assessment-prefetch:' || fixture.assessment_id::text
    where fixture.fixture = 'one_place'$$,
  $$values (
      'a1200000-0000-4000-8000-000000000010'::uuid,
      '40 Existing Place Road, Trenton, NJ 08608'::text,
      40.2210::double precision, -74.7610::double precision,
      'a1200000-0000-4000-8000-000000000010'::text,
      'a1200000-0000-4000-8000-000000000010'::text
    )$$,
  'Place-ID merge binds new evidence, coordinates, and discovery to the canonical property'
);

insert into public.properties (
  id, company_id, canonical_address, resolution_status
) values (
  'a1200000-0000-4000-8000-000000000020',
  'a1000000-0000-4000-8000-000000000001',
  '50 Fallback Street, Trenton NJ 08608', 'resolved'
);
insert into public.pipeline_runs (
  id, company_id, property_id, correlation_id, pipeline_version, status
) values (
  'a1300000-0000-4000-8000-000000000020',
  'a1000000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000020',
  'a1400000-0000-4000-8000-000000000020', 1, 'complete'
);
insert into public.worker_runs (
  id, pipeline_run_id, worker_type, worker_version, idempotency_key
) values (
  'a1500000-0000-4000-8000-000000000020',
  'a1300000-0000-4000-8000-000000000020',
  'address-validation', 1, 'prefetch-address-fallback-candidate'
);
insert into public.property_addresses (
  company_id, property_id, worker_run_id, submitted_address,
  canonical_address, google_place_id, latitude, longitude, location,
  state_code, match_method, confidence, created_at
) values (
  'a1000000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000020',
  'a1500000-0000-4000-8000-000000000020',
  '50 Fallback Street, Trenton NJ 08608',
  '50 Fallback Street, Trenton NJ 08608', null, 40.20, -74.70,
  extensions.st_setsrid(extensions.st_point(-74.70, 40.20), 4326)::extensions.geography,
  'NJ', 'exact_single_match', 100, pg_catalog.now() - interval '179 days'
);
select pg_temp.capture_prefetch_fixture(
  'one_address_fallback',
  pg_temp.start_prefetch_fixture(
    'a1000000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000020',
    'Fallback Merge', '+12015551020', 'fallback-merge@example.com',
    '50 Fallback Street, Trenton NJ 08608', 'ChIJ-prefetch-fallback'
  )
);
select lives_ok(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000001',
    (select attempt_id from prefetch_attempts where fixture = 'one_address_fallback'),
    'ChIJ-prefetch-fallback', '50 Fallback Street, Trenton NJ 08608',
    '50 Fallback Street, Trenton NJ 08608', 40.2220, -74.7620
  ),
  'recent normalized address is the fallback when existing evidence lacks a Place ID'
);
select results_eq(
  $$select source.resolution_status, source.merged_into_property_id,
           attempt.property_id, address.property_id
    from prefetch_attempts as fixture
    join public.properties as source on source.id = fixture.property_id
    join public.roof_assessment_access_attempts as attempt
      on attempt.id = fixture.attempt_id
    join public.property_addresses as address
      on address.assessment_access_attempt_id = fixture.attempt_id
    where fixture.fixture = 'one_address_fallback'$$,
  $$values (
      'duplicate'::text,
      'a1200000-0000-4000-8000-000000000020'::uuid,
      'a1200000-0000-4000-8000-000000000020'::uuid,
      'a1200000-0000-4000-8000-000000000020'::uuid
    )$$,
  'normalized fallback retains canonical duplicate semantics'
);

insert into public.properties (id, company_id, canonical_address, resolution_status) values
  ('a1200000-0000-4000-8000-000000000031', 'a1000000-0000-4000-8000-000000000001', '60 Conflict Way A, Trenton, NJ 08608', 'resolved'),
  ('a1200000-0000-4000-8000-000000000032', 'a1000000-0000-4000-8000-000000000001', '60 Conflict Way B, Trenton, NJ 08608', 'resolved');
insert into public.pipeline_runs (id, company_id, property_id, correlation_id, pipeline_version, status) values
  ('a1300000-0000-4000-8000-000000000031', 'a1000000-0000-4000-8000-000000000001', 'a1200000-0000-4000-8000-000000000031', 'a1400000-0000-4000-8000-000000000031', 1, 'complete'),
  ('a1300000-0000-4000-8000-000000000032', 'a1000000-0000-4000-8000-000000000001', 'a1200000-0000-4000-8000-000000000032', 'a1400000-0000-4000-8000-000000000032', 1, 'complete');
insert into public.worker_runs (id, pipeline_run_id, worker_type, worker_version, idempotency_key) values
  ('a1500000-0000-4000-8000-000000000031', 'a1300000-0000-4000-8000-000000000031', 'address-validation', 1, 'prefetch-conflict-candidate-a'),
  ('a1500000-0000-4000-8000-000000000032', 'a1300000-0000-4000-8000-000000000032', 'address-validation', 1, 'prefetch-conflict-candidate-b');
insert into public.property_addresses (
  company_id, property_id, worker_run_id, submitted_address,
  canonical_address, google_place_id, latitude, longitude, location,
  state_code, match_method, confidence
) values
  ('a1000000-0000-4000-8000-000000000001', 'a1200000-0000-4000-8000-000000000031', 'a1500000-0000-4000-8000-000000000031', '60 Conflict Way, Trenton, NJ 08608', '60 Conflict Way, Trenton, NJ 08608', 'ChIJ-prefetch-conflict', 40.20, -74.70, extensions.st_setsrid(extensions.st_point(-74.70, 40.20), 4326)::extensions.geography, 'NJ', 'exact_single_match', 100),
  ('a1000000-0000-4000-8000-000000000001', 'a1200000-0000-4000-8000-000000000032', 'a1500000-0000-4000-8000-000000000032', '60 Conflict Way, Trenton, NJ 08608', '60 Conflict Way, Trenton, NJ 08608', 'ChIJ-prefetch-conflict', 40.20, -74.70, extensions.st_setsrid(extensions.st_point(-74.70, 40.20), 4326)::extensions.geography, 'NJ', 'exact_single_match', 100);
select pg_temp.capture_prefetch_fixture(
  'multiple_candidates',
  pg_temp.start_prefetch_fixture(
    'a1000000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000030',
    'Conflict Candidate', '+12015551030', 'conflict@example.com',
    '60 Conflict Way, Trenton, NJ 08608', 'ChIJ-prefetch-conflict'
  )
);
select results_eq(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000001',
    (select attempt_id from prefetch_attempts where fixture = 'multiple_candidates'),
    'ChIJ-prefetch-conflict', '60 Conflict Way, Trenton, NJ 08608',
    '60 Conflict Way, Trenton, NJ 08608'
  ),
  $$select assessment_id, property_id, pipeline_run_id, false
    from prefetch_attempts where fixture = 'multiple_candidates'$$,
  'multiple same-tenant identity candidates fail closed to asynchronous review'
);
select results_eq(
  $$select source.resolution_status, source.merged_into_property_id,
           attempt.property_id,
           (select count(*) from public.property_addresses as address
            where address.assessment_access_attempt_id = fixture.attempt_id)::bigint,
           (select count(*) from public.domain_events as event
            where event.idempotency_key = 'property/discovery_requested:assessment-prefetch:' || fixture.assessment_id::text)::bigint
    from prefetch_attempts as fixture
    join public.properties as source on source.id = fixture.property_id
    join public.roof_assessment_access_attempts as attempt on attempt.id = fixture.attempt_id
    where fixture.fixture = 'multiple_candidates'$$,
  $$select 'unresolved'::text, null::uuid, property_id, 0::bigint, 0::bigint
    from prefetch_attempts where fixture = 'multiple_candidates'$$,
  'multiple identity candidates leave no partial property, evidence, or event mutation'
);

insert into public.properties (id, company_id, canonical_address, resolution_status)
values ('a1200000-0000-4000-8000-000000000040', 'a1000000-0000-4000-8000-000000000002', '70 Tenant Lookalike, Trenton, NJ 08608', 'resolved');
insert into public.pipeline_runs (id, company_id, property_id, correlation_id, pipeline_version, status)
values ('a1300000-0000-4000-8000-000000000040', 'a1000000-0000-4000-8000-000000000002', 'a1200000-0000-4000-8000-000000000040', 'a1400000-0000-4000-8000-000000000040', 1, 'complete');
insert into public.worker_runs (id, pipeline_run_id, worker_type, worker_version, idempotency_key)
values ('a1500000-0000-4000-8000-000000000040', 'a1300000-0000-4000-8000-000000000040', 'address-validation', 1, 'prefetch-cross-tenant-candidate');
insert into public.property_addresses (
  company_id, property_id, worker_run_id, submitted_address,
  canonical_address, google_place_id, latitude, longitude, location,
  state_code, match_method, confidence
) values (
  'a1000000-0000-4000-8000-000000000002',
  'a1200000-0000-4000-8000-000000000040',
  'a1500000-0000-4000-8000-000000000040',
  '70 Tenant Lookalike, Trenton, NJ 08608',
  '70 Tenant Lookalike, Trenton, NJ 08608', 'ChIJ-prefetch-lookalike',
  40.20, -74.70,
  extensions.st_setsrid(extensions.st_point(-74.70, 40.20), 4326)::extensions.geography,
  'NJ', 'exact_single_match', 100
);
select pg_temp.capture_prefetch_fixture(
  'cross_tenant',
  pg_temp.start_prefetch_fixture(
    'a1000000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000040',
    'Tenant Isolation', '+12015551040', 'tenant-isolation@example.com',
    '70 Tenant Lookalike, Trenton, NJ 08608', 'ChIJ-prefetch-lookalike'
  )
);
select lives_ok(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000001',
    (select attempt_id from prefetch_attempts where fixture = 'cross_tenant'),
    'ChIJ-prefetch-lookalike', '70 Tenant Lookalike, Trenton, NJ 08608',
    '70 Tenant Lookalike, Trenton, NJ 08608', 40.2240, -74.7640
  ),
  'cross-tenant Place-ID and address lookalikes are ignored'
);
select results_eq(
  $$select source.resolution_status, source.merged_into_property_id,
           attempt.property_id, address.property_id
    from prefetch_attempts as fixture
    join public.properties as source on source.id = fixture.property_id
    join public.roof_assessment_access_attempts as attempt on attempt.id = fixture.attempt_id
    join public.property_addresses as address
      on address.assessment_access_attempt_id = fixture.attempt_id
    where fixture.fixture = 'cross_tenant'$$,
  $$select 'unresolved'::text, null::uuid, property_id, property_id
    from prefetch_attempts where fixture = 'cross_tenant'$$,
  'cross-tenant lookalikes cannot merge or repoint the current tenant graph'
);

insert into public.pipeline_runs (
  id, company_id, property_id, correlation_id, pipeline_version, status
) values (
  'a1300000-0000-4000-8000-000000000090',
  'a1000000-0000-4000-8000-000000000001',
  (select property_id from prefetch_attempts where fixture = 'mismatch_a'),
  'a1400000-0000-4000-8000-000000000090', 1, 'complete'
);
insert into public.worker_runs (
  id, pipeline_run_id, worker_type, worker_version, idempotency_key
) values (
  'a1500000-0000-4000-8000-000000000090',
  'a1300000-0000-4000-8000-000000000090',
  'address-validation', 1, 'prefetch-origin-constraint-worker'
);
select throws_ok(
  $$insert into public.property_addresses (
      company_id, property_id, submitted_address, match_method, confidence
    ) select 'a1000000-0000-4000-8000-000000000001', property_id,
             'No provenance', 'exact_single_match', 100
      from prefetch_attempts where fixture = 'mismatch_a'$$,
  '23514', null,
  'property address evidence rejects a row with no provenance origin'
);
select throws_ok(
  $$insert into public.property_addresses (
      company_id, property_id, worker_run_id, assessment_access_attempt_id,
      submitted_address, canonical_address, google_place_id,
      latitude, longitude, location, municipality, county, state_code, zip,
      match_method, confidence, evidence_source, source_identifier,
      retrieved_at, provider_duration_ms
    ) select 'a1000000-0000-4000-8000-000000000001', property_id,
             'a1500000-0000-4000-8000-000000000090', attempt_id,
             'Both provenance origins', 'Both provenance origins',
             'ChIJ-both-origins', 40.22, -74.76,
             extensions.st_setsrid(extensions.st_point(-74.76, 40.22), 4326)::extensions.geography,
             'Trenton', 'Mercer', 'NJ', '08608', 'exact_single_match', 100,
             'google_places', 'both-origins', pg_catalog.now(), 10
      from prefetch_attempts where fixture = 'mismatch_a'$$,
  '23514', null,
  'property address evidence rejects a row with both provenance origins'
);
select throws_ok(
  $$insert into public.property_addresses (
      company_id, property_id, assessment_access_attempt_id,
      submitted_address, canonical_address, google_place_id,
      latitude, longitude, location, state_code, match_method, confidence
    ) select 'a1000000-0000-4000-8000-000000000001', property_id, attempt_id,
             'Missing provider provenance', 'Missing provider provenance',
             'ChIJ-missing-provenance', 40.22, -74.76,
             extensions.st_setsrid(extensions.st_point(-74.76, 40.22), 4326)::extensions.geography,
             'NJ', 'exact_single_match', 100
      from prefetch_attempts where fixture = 'mismatch_a'$$,
  '23514', null,
  'attempt-backed evidence rejects missing provider provenance'
);
select throws_ok(
  $$insert into public.property_addresses (
      company_id, property_id, assessment_access_attempt_id,
      submitted_address, canonical_address, google_place_id,
      latitude, longitude, location, state_code, match_method, confidence,
      evidence_source, source_identifier, retrieved_at, provider_duration_ms
    ) select 'a1000000-0000-4000-8000-000000000001', property_id, attempt_id,
             'Imprecise evidence', 'Imprecise evidence', 'ChIJ-imprecise',
             40.22, -74.76,
             extensions.st_setsrid(extensions.st_point(-74.76, 40.22), 4326)::extensions.geography,
             'NJ', 'multiple_matches', 100, 'google_places', 'imprecise',
             pg_catalog.now(), 10
      from prefetch_attempts where fixture = 'mismatch_a'$$,
  '23514', null,
  'attempt-backed evidence rejects a non-exact address match'
);

select lives_ok(
  $$select extensions.dblink_connect(
      'prefetch_uncommitted_gate',
      'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres'
    )$$,
  'uncommitted-intake gate connects'
);
select lives_ok(
  $$select extensions.dblink_connect(
      'prefetch_uncommitted_probe',
      'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres'
    )$$,
  'uncommitted-intake probe connects'
);
select is(
  extensions.dblink_exec(
    'prefetch_uncommitted_gate',
    $$begin;
      insert into public.companies (id, name)
      values ('a2000000-0000-4000-8000-000000000001', 'Uncommitted Prefetch Company');
      do $remote$
      declare v record;
      begin
        select * into v from public.start_or_resume_roof_assessment(
          'a2000000-0000-4000-8000-000000000001',
          'a2100000-0000-4000-8000-000000000001',
          'Uncommitted Homeowner', '+12015552001', 'uncommitted@example.com',
          '90 Uncommitted Way, Trenton, NJ 08608', 'ChIJ-prefetch-uncommitted',
          'all-season-main', 'prefetch-pgtap', '{}'::jsonb, null,
          'all-season-assessment-v1', clock_timestamp(), '127.21.0.1', 'pgtap'
        );
      end
      $remote$;$$
  ),
  'DO',
  'an intake transaction remains uncommitted in another session'
);
select results_eq(
  $$select eligible, assessment_id, property_id, pipeline_run_id
    from extensions.dblink(
      'prefetch_uncommitted_probe',
      $remote$select *
        from public.resolve_roof_assessment_property_prefetch_scope(
          'a2000000-0000-4000-8000-000000000001',
          (select id from public.roof_assessment_access_attempts
           where submission_id = 'a2100000-0000-4000-8000-000000000001'),
          'ChIJ-prefetch-uncommitted'
        )$remote$
    ) as scope(
      eligible boolean,
      assessment_id uuid,
      property_id uuid,
      pipeline_run_id uuid
    )$$,
  $$values (false, null::uuid, null::uuid, null::uuid)$$,
  'the service preflight cannot resolve an uncommitted consent attempt'
);
select is(extensions.dblink_exec('prefetch_uncommitted_gate', 'rollback'), 'ROLLBACK', 'the uncommitted intake is discarded');
select ok(extensions.dblink_disconnect('prefetch_uncommitted_probe') = 'OK', 'uncommitted-intake probe disconnects');
select ok(extensions.dblink_disconnect('prefetch_uncommitted_gate') = 'OK', 'uncommitted-intake gate disconnects');

select lives_ok(
  $$select extensions.dblink_connect(
      'prefetch_race_gate',
      'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres'
    )$$,
  'prefetch race gate connects'
);
select lives_ok(
  $$select extensions.dblink_connect(
      'prefetch_race_a',
      'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres'
    )$$,
  'first prefetch race worker connects'
);
select lives_ok(
  $$select extensions.dblink_connect(
      'prefetch_race_b',
      'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres'
    )$$,
  'second prefetch race worker connects'
);
select is(
  extensions.dblink_exec(
    'prefetch_race_gate',
    $$insert into public.companies (id, name)
      values ('a3000000-0000-4000-8000-000000000001', 'Prefetch Race Company');
      do $remote$
      declare v record;
      begin
        select * into v from public.start_or_resume_roof_assessment(
          'a3000000-0000-4000-8000-000000000001',
          'a3100000-0000-4000-8000-000000000001',
          'Race Homeowner', '+12015553001', 'race-prefetch@example.com',
          '100 Race Way, Trenton, NJ 08608', 'ChIJ-prefetch-race',
          'all-season-main', 'prefetch-pgtap', '{}'::jsonb, null,
          'all-season-assessment-v1', clock_timestamp(), '127.22.0.1', 'pgtap'
        );
      end
      $remote$;$$
  ),
  'DO',
  'the committed prefetch race fixture is prepared'
);
select is(
  extensions.dblink_exec(
    'prefetch_race_gate',
    $$begin;
      do $lock$
      begin
        perform 1
        from public.roof_assessment_access_attempts
        where company_id = 'a3000000-0000-4000-8000-000000000001'
        for update;
      end
      $lock$;$$
  ),
  'DO',
  'the race gate locks the exact access attempt'
);
select is(
  extensions.dblink_send_query(
    'prefetch_race_a',
    $$select * from public.apply_roof_assessment_property_prefetch(
      'a3000000-0000-4000-8000-000000000001',
      (select id from public.roof_assessment_access_attempts
       where company_id = 'a3000000-0000-4000-8000-000000000001'),
      'ChIJ-prefetch-race', '100 Race Way, Trenton, NJ 08608',
      '100 Race Way, Trenton, NJ 08608',
      40.2301::double precision, -74.7701::double precision,
      'Trenton', 'Mercer', 'NJ', '08608',
      'exact_single_match'::public.address_match_method, 100::smallint,
      'google_places', 'race-place-details',
      '2026-08-28 16:00:00+00'::timestamptz, 181
    )$$
  ),
  1,
  'the first identical prefetch writer is dispatched'
);
select is(
  extensions.dblink_send_query(
    'prefetch_race_b',
    $$select * from public.apply_roof_assessment_property_prefetch(
      'a3000000-0000-4000-8000-000000000001',
      (select id from public.roof_assessment_access_attempts
       where company_id = 'a3000000-0000-4000-8000-000000000001'),
      'ChIJ-prefetch-race', '100 Race Way, Trenton, NJ 08608',
      '100 Race Way, Trenton, NJ 08608',
      40.2301::double precision, -74.7701::double precision,
      'Trenton', 'Mercer', 'NJ', '08608',
      'exact_single_match'::public.address_match_method, 100::smallint,
      'google_places', 'race-place-details',
      '2026-08-28 16:00:00+00'::timestamptz, 181
    )$$
  ),
  1,
  'the second identical prefetch writer is dispatched'
);
select is(extensions.dblink_is_busy('prefetch_race_a'), 1, 'the first writer blocks on the access-attempt mutex');
select is(extensions.dblink_is_busy('prefetch_race_b'), 1, 'the second writer blocks on the access-attempt mutex');
select is(extensions.dblink_exec('prefetch_race_gate', 'commit'), 'COMMIT', 'the race gate releases both writers');

create temp table prefetch_race_results (
  assessment_id uuid,
  property_id uuid,
  pipeline_run_id uuid,
  side_effects_applied boolean
);
insert into prefetch_race_results
select *
from extensions.dblink_get_result('prefetch_race_a') as result(
  assessment_id uuid,
  property_id uuid,
  pipeline_run_id uuid,
  side_effects_applied boolean
);
insert into prefetch_race_results
select *
from extensions.dblink_get_result('prefetch_race_b') as result(
  assessment_id uuid,
  property_id uuid,
  pipeline_run_id uuid,
  side_effects_applied boolean
);
select is((select count(*) from prefetch_race_results where side_effects_applied), 1::bigint, 'exactly one concurrent prefetch writer applies side effects');
select is((select count(*) from prefetch_race_results where not side_effects_applied), 1::bigint, 'the other concurrent writer returns the canonical no-op');
select is((select count(distinct row(assessment_id, property_id, pipeline_run_id)) from prefetch_race_results), 1::bigint, 'concurrent writers return one canonical scope');
select results_eq(
  $$select
      (select count(*) from public.property_addresses
       where company_id = 'a3000000-0000-4000-8000-000000000001')::bigint,
      (select count(*) from public.domain_events
       where company_id = 'a3000000-0000-4000-8000-000000000001'
         and event_name = 'property/discovery_requested')::bigint,
      (select count(*) from public.event_outbox as outbox
       join public.domain_events as event on event.id = outbox.event_id
       where event.company_id = 'a3000000-0000-4000-8000-000000000001'
         and event.event_name = 'property/discovery_requested')::bigint$$,
  $$values (1::bigint, 1::bigint, 1::bigint)$$,
  'the race commits one evidence row, discovery event, and outbox row'
);
select is(
  extensions.dblink_exec(
    'prefetch_race_gate',
    $$do $cleanup$
      begin
        delete from public.event_outbox
        where event_id in (
          select id from public.domain_events
          where company_id = 'a3000000-0000-4000-8000-000000000001'
        );
        delete from public.domain_events
        where company_id = 'a3000000-0000-4000-8000-000000000001';
        delete from public.property_addresses
        where company_id = 'a3000000-0000-4000-8000-000000000001';
        delete from public.roof_assessment_access_attempts
        where company_id = 'a3000000-0000-4000-8000-000000000001';
        delete from public.lead_consent_evidence
        where company_id = 'a3000000-0000-4000-8000-000000000001';
        delete from public.lead_attribution_touches
        where company_id = 'a3000000-0000-4000-8000-000000000001';
        delete from public.roof_assessments
        where company_id = 'a3000000-0000-4000-8000-000000000001';
        delete from public.roof_estimates
        where company_id = 'a3000000-0000-4000-8000-000000000001';
        delete from public.pipeline_runs
        where company_id = 'a3000000-0000-4000-8000-000000000001';
        delete from public.lead_consents
        where company_id = 'a3000000-0000-4000-8000-000000000001';
        delete from public.leads
        where company_id = 'a3000000-0000-4000-8000-000000000001';
        delete from public.properties
        where company_id = 'a3000000-0000-4000-8000-000000000001';
        delete from public.companies
        where id = 'a3000000-0000-4000-8000-000000000001';
      end
      $cleanup$;$$
  ),
  'DO',
  'committed prefetch race fixtures are removed'
);
select ok(extensions.dblink_disconnect('prefetch_race_a') = 'OK', 'first prefetch race worker disconnects');
select ok(extensions.dblink_disconnect('prefetch_race_b') = 'OK', 'second prefetch race worker disconnects');
select ok(extensions.dblink_disconnect('prefetch_race_gate') = 'OK', 'prefetch race gate disconnects');

-- Trigger DDL retains a relation lock until this test transaction ends, so
-- forced rollback coverage intentionally follows all remote-session races.
select pg_temp.capture_prefetch_fixture(
  'rollback',
  pg_temp.start_prefetch_fixture(
    'a1000000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000050',
    'Rollback Fixture', '+12015551050', 'rollback@example.com',
    '80 Rollback Road, Trenton, NJ 08608', 'ChIJ-prefetch-rollback'
  )
);
create temp table rollback_prefetch_snapshot as
select property.canonical_address, property.location, property.updated_at
from public.properties as property
where property.id = (select property_id from prefetch_attempts where fixture = 'rollback');

create function public.pgtap_fail_prefetch_outbox()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.domain_events as event
    where event.id = new.event_id
      and event.company_id = 'a1000000-0000-4000-8000-000000000001'
      and event.event_name = 'property/discovery_requested'
      and event.idempotency_key = 'property/discovery_requested:assessment-prefetch:' ||
        (select assessment_id::text
         from public.roof_assessment_access_attempts
         where id = (select attempt_id from pg_temp.prefetch_attempts where fixture = 'rollback'))
  ) then
    raise exception 'forced property prefetch outbox failure';
  end if;
  return new;
end;
$$;
create trigger pgtap_fail_prefetch_outbox
before insert on public.event_outbox
for each row execute function public.pgtap_fail_prefetch_outbox();

select throws_ok(
  pg_temp.prefetch_sql(
    'a1000000-0000-4000-8000-000000000001',
    (select attempt_id from prefetch_attempts where fixture = 'rollback'),
    'ChIJ-prefetch-rollback', '80 Rollback Road, Trenton, NJ 08608',
    '80 Rollback Road, Trenton, NJ 08608', 40.2250, -74.7650
  ), null, 'forced property prefetch outbox failure',
  'a downstream enqueue failure aborts the complete prefetch transaction'
);
select results_eq(
  $$select property.canonical_address, property.location, property.updated_at
    from public.properties as property
    where property.id = (select property_id from prefetch_attempts where fixture = 'rollback')$$,
  $$select canonical_address, location, updated_at from rollback_prefetch_snapshot$$,
  'failed enqueue rolls back the canonical address, coordinates, and timestamp'
);
select is(
  (select count(*) from public.property_addresses
   where assessment_access_attempt_id =
     (select attempt_id from prefetch_attempts where fixture = 'rollback')),
  0::bigint,
  'failed enqueue rolls back attempt-backed property evidence'
);
select is(
  (select count(*) from public.domain_events
   where idempotency_key = 'property/discovery_requested:assessment-prefetch:' ||
     (select assessment_id::text from prefetch_attempts where fixture = 'rollback')),
  0::bigint,
  'failed enqueue rolls back the discovery event'
);
drop trigger pgtap_fail_prefetch_outbox on public.event_outbox;
drop function public.pgtap_fail_prefetch_outbox();

select * from extensions.finish();
rollback;

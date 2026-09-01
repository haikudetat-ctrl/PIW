begin;

select plan(46);

select has_table('public', 'meta_event_deliveries', 'Meta delivery ledger exists');
select has_column('public', 'meta_event_deliveries', 'consent_id', 'delivery retains the verified consent identifier');
select has_column('public', 'meta_event_deliveries', 'payload_hash', 'delivery retains only a payload hash');
select hasnt_column('public', 'meta_event_deliveries', 'email', 'delivery does not duplicate raw email');
select hasnt_column('public', 'meta_event_deliveries', 'phone', 'delivery does not duplicate raw phone');
select hasnt_column('public', 'meta_event_deliveries', 'payload', 'delivery does not persist the outbound payload');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.meta_event_deliveries'::regclass),
  'delivery ledger has RLS enabled'
);
select table_privs_are('public', 'meta_event_deliveries', 'anon', array[]::text[], 'anonymous clients have no ledger grants');
select table_privs_are('public', 'meta_event_deliveries', 'authenticated', array[]::text[], 'authenticated clients have no ledger grants');
select table_privs_are('public', 'meta_event_deliveries', 'service_role', array['SELECT'], 'service role reads the ledger but cannot mutate it directly');

select has_function(
  'public', 'reserve_meta_lead_delivery',
  array['uuid','uuid','uuid','text','timestamp with time zone'],
  'Lead reservation RPC exists'
);
select has_function(
  'public', 'reserve_meta_assessment_delivery',
  array['uuid','uuid','uuid','text','timestamp with time zone'],
  'assessment reservation RPC exists'
);
select has_function(
  'public', 'claim_meta_delivery', array['uuid','timestamp with time zone'],
  'claim RPC exists'
);
select has_function(
  'public', 'list_pending_meta_deliveries', array['integer','timestamp with time zone'],
  'pending-list RPC exists'
);
select has_function(
  'public', 'complete_meta_delivery',
  array['uuid','text','integer','text','text','timestamp with time zone'],
  'completion RPC preserves its six-argument adapter contract'
);
select ok(
  (select pg_catalog.bool_and(proc.prosecdef and proc.proconfig = array['search_path=""'])
   from pg_catalog.pg_proc as proc
   where proc.oid in (
     'public.reserve_meta_lead_delivery(uuid,uuid,uuid,text,timestamptz)'::regprocedure,
     'public.reserve_meta_assessment_delivery(uuid,uuid,uuid,text,timestamptz)'::regprocedure,
     'public.claim_meta_delivery(uuid,timestamptz)'::regprocedure,
     'public.list_pending_meta_deliveries(integer,timestamptz)'::regprocedure,
     'public.complete_meta_delivery(uuid,text,integer,text,text,timestamptz)'::regprocedure
   )),
  'all delivery RPCs are security definer functions with an empty search path'
);
select ok(
  (select pg_catalog.bool_and(
     pg_catalog.has_function_privilege('service_role', proc.oid, 'EXECUTE')
     and not pg_catalog.has_function_privilege('public', proc.oid, 'EXECUTE')
     and not pg_catalog.has_function_privilege('anon', proc.oid, 'EXECUTE')
     and not pg_catalog.has_function_privilege('authenticated', proc.oid, 'EXECUTE')
   )
   from pg_catalog.pg_proc as proc
   where proc.oid in (
     'public.reserve_meta_lead_delivery(uuid,uuid,uuid,text,timestamptz)'::regprocedure,
     'public.reserve_meta_assessment_delivery(uuid,uuid,uuid,text,timestamptz)'::regprocedure,
     'public.claim_meta_delivery(uuid,timestamptz)'::regprocedure,
     'public.list_pending_meta_deliveries(integer,timestamptz)'::regprocedure,
     'public.complete_meta_delivery(uuid,text,integer,text,text,timestamptz)'::regprocedure
   )),
  'service role alone can execute delivery RPCs'
);

insert into public.companies(id, name) values
  ('92000000-0000-4000-8000-000000000001', 'Meta Delivery Company A'),
  ('92000000-0000-4000-8000-000000000002', 'Meta Delivery Company B');

create temp table incomplete_start as
select * from public.start_or_resume_roof_assessment(
  '92000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000011',
  'Incomplete Lead', '+12015550901', 'incomplete-meta@example.com',
  '901 Meta Way, Newark, NJ 07102', 'ChIJ-meta-incomplete',
  'all-season-main', 'main-home', '{}'::jsonb, null,
  'all-season-assessment-v1', '2026-09-01T12:00:00Z', '127.0.0.1', 'pgtap'
);
create temp table measurement_start as
select * from public.start_or_resume_roof_assessment(
  '92000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000012',
  'Measurement Lead', '+12015550902', 'measurement-meta@example.com',
  '902 Meta Way, Newark, NJ 07102', 'ChIJ-meta-measurement',
  'all-season-main', 'main-home', '{}'::jsonb, null,
  'all-season-assessment-v1', '2026-09-01T12:01:00Z', '127.0.0.1', 'pgtap'
);
create temp table trusted_start as
select * from public.start_or_resume_roof_assessment(
  '92000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000013',
  'Trusted Lead', '+12015550903', 'trusted-meta@example.com',
  '903 Meta Way, Newark, NJ 07102', 'ChIJ-meta-trusted',
  'all-season-main', 'main-home', '{}'::jsonb, null,
  'all-season-assessment-v1', '2026-09-01T12:02:00Z', '127.0.0.1', 'pgtap'
);
create temp table other_start as
select * from public.start_or_resume_roof_assessment(
  '92000000-0000-4000-8000-000000000002',
  '92000000-0000-4000-8000-000000000014',
  'Other Company Lead', '+12015550904', 'other-meta@example.com',
  '904 Meta Way, Newark, NJ 07102', 'ChIJ-meta-other',
  'all-season-main', 'main-home', '{}'::jsonb, null,
  'all-season-assessment-v1', '2026-09-01T12:03:00Z', '127.0.0.1', 'pgtap'
);

create temp view meta_fixture_ids as
select
  (select lead_id from public.roof_assessment_access_attempts where id=(select attempt_id from incomplete_start)) as lead_id,
  (select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from incomplete_start)) as incomplete_assessment_id,
  (select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from measurement_start)) as measurement_assessment_id,
  (select lead_id from public.roof_assessment_access_attempts where id=(select attempt_id from measurement_start)) as measurement_lead_id,
  (select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from trusted_start)) as trusted_assessment_id,
  (select estimate_id from public.roof_assessment_access_attempts where id=(select attempt_id from trusted_start)) as trusted_estimate_id,
  (select property_id from public.roof_assessment_access_attempts where id=(select attempt_id from trusted_start)) as trusted_property_id,
  (select lead_id from public.roof_assessment_access_attempts where id=(select attempt_id from trusted_start)) as trusted_lead_id,
  (select lead_id from public.roof_assessment_access_attempts where id=(select attempt_id from other_start)) as other_lead_id;

-- Privacy evidence evolves under one browser consent identifier. Reservation
-- must use the latest evidence at the requested event time, not an older grant.
select * from public.record_privacy_consent(
  '92000000-0000-4000-8000-000000000101', '92000000-0000-4000-8000-000000000201',
  '92000000-0000-4000-8000-000000000001', (select lead_id from meta_fixture_ids),
  'piw-privacy-v1', false, false, false, 'banner', null, 'pgtap', '2026-09-01T12:10:00Z'
);
select * from public.record_privacy_consent(
  '92000000-0000-4000-8000-000000000102', '92000000-0000-4000-8000-000000000202',
  '92000000-0000-4000-8000-000000000001', (select lead_id from meta_fixture_ids),
  'piw-privacy-v1', false, true, false, 'preferences', null, 'pgtap', '2026-09-01T12:11:00Z'
);
select * from public.record_privacy_consent(
  '92000000-0000-4000-8000-000000000103', '92000000-0000-4000-8000-000000000203',
  '92000000-0000-4000-8000-000000000001', (select lead_id from meta_fixture_ids),
  'piw-privacy-v1', false, true, false, 'preferences', null, 'pgtap', '2026-09-01T12:12:00Z'
);
select * from public.record_privacy_consent(
  '92000000-0000-4000-8000-000000000104', '92000000-0000-4000-8000-000000000203',
  '92000000-0000-4000-8000-000000000001', (select lead_id from meta_fixture_ids),
  'piw-privacy-v1', false, false, false, 'preferences', null, 'pgtap', '2026-09-01T12:13:00Z'
);
select * from public.record_privacy_consent(
  '92000000-0000-4000-8000-000000000105', '92000000-0000-4000-8000-000000000204',
  '92000000-0000-4000-8000-000000000001', (select trusted_lead_id from meta_fixture_ids),
  'piw-privacy-v1', false, true, false, 'preferences', null, 'pgtap', '2026-09-01T12:14:00Z'
);
select * from public.record_privacy_consent(
  '92000000-0000-4000-8000-000000000106', '92000000-0000-4000-8000-000000000205',
  '92000000-0000-4000-8000-000000000001', (select measurement_lead_id from meta_fixture_ids),
  'piw-privacy-v1', false, true, false, 'preferences', null, 'pgtap', '2026-09-01T12:15:00Z'
);
select * from public.record_privacy_consent(
  '92000000-0000-4000-8000-000000000107', '92000000-0000-4000-8000-000000000206',
  '92000000-0000-4000-8000-000000000002', (select other_lead_id from meta_fixture_ids),
  'piw-privacy-v1', false, true, false, 'preferences', null, 'pgtap', '2026-09-01T12:16:00Z'
);

select is(
  (select count(*) from public.reserve_meta_lead_delivery(
    (select lead_id from meta_fixture_ids), '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000201', 'piw-privacy-v1', '2026-09-01T13:00:00Z'
  )), 0::bigint, 'advertising denial reserves nothing'
);
select is(
  (select count(*) from public.reserve_meta_lead_delivery(
    (select lead_id from meta_fixture_ids), '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000203', 'piw-privacy-v1', '2026-09-01T13:00:00Z'
  )), 0::bigint, 'a later advertising revocation overrides an earlier grant'
);

create temp table first_lead_reservation as
select * from public.reserve_meta_lead_delivery(
  (select lead_id from meta_fixture_ids), '92000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000202', 'piw-privacy-v1', '2026-09-01T13:00:00Z'
);
select is((select count(*) from first_lead_reservation), 1::bigint, 'advertising grant reserves Lead');
select is(
  (select count(*) from public.reserve_meta_lead_delivery(
    (select lead_id from meta_fixture_ids), '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000203', 'piw-privacy-v1', '2026-09-01T13:00:00Z'
  )), 0::bigint, 'revocation does not return an already-reserved Lead event'
);
select is(
  (select event_id from public.reserve_meta_lead_delivery(
    (select lead_id from meta_fixture_ids), '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000202', 'piw-privacy-v1', '2026-09-01T13:00:00Z'
  )), (select event_id from first_lead_reservation), 'Lead retry returns the original event ID'
);
select is((select count(*) from public.meta_event_deliveries where event_name='Lead'), 1::bigint, 'one Lead delivery exists');
select is(
  (select count(*) from public.reserve_meta_lead_delivery(
    (select lead_id from meta_fixture_ids), '92000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000206', 'piw-privacy-v1', '2026-09-01T13:00:00Z'
  )), 0::bigint, 'cross-company Lead reservation is rejected'
);

select is(
  (select count(*) from public.reserve_meta_assessment_delivery(
    (select incomplete_assessment_id from meta_fixture_ids), '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000202', 'piw-privacy-v1', '2026-09-01T13:00:00Z'
  )), 0::bigint, 'incomplete assessment reserves nothing'
);

update public.roof_estimates
set status='ready', roof_squares=18, range_low_cents=1700000, range_high_cents=2200000
where id=(select estimate_id from public.roof_assessment_access_attempts where id=(select attempt_id from measurement_start));
update public.roof_assessments
set status='completed', current_step=9, recommendation='professional_inspection', completed_at='2026-09-01T12:30:00Z'
where id=(select measurement_assessment_id from meta_fixture_ids);
select is(
  (select count(*) from public.reserve_meta_assessment_delivery(
    (select measurement_assessment_id from meta_fixture_ids), '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000205', 'piw-privacy-v1', '2026-09-01T13:00:00Z'
  )), 0::bigint, 'measurement ranges without Good Better Best packages reserve nothing'
);

insert into public.roof_insights(
  id, company_id, property_id, provider, normalized_address, lookup_status, total_roof_sqft
) values (
  '92000000-0000-4000-8000-000000000301', '92000000-0000-4000-8000-000000000001',
  (select trusted_property_id from meta_fixture_ids), 'google_solar', '903 meta way newark nj 07102', 'success', 2000
);
insert into public.roof_pricing_rate_cards(
  id, company_id, version, name, market, effective_from
) values (
  '92000000-0000-4000-8000-000000000302', '92000000-0000-4000-8000-000000000001',
  'meta-test-v1', 'Meta Trusted Quote', 'NJ', '2026-01-01T00:00:00Z'
);
insert into public.roof_pricing_tiers(
  company_id, rate_card_id, tier_key, display_order, internal_scope_code,
  customer_name, customer_description, warranty_summary, differentiators,
  low_cents_per_square, high_cents_per_square
) values
  ('92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000302','good',1,'good-v1','Good','Good system','Good warranty','[]',70000,90000),
  ('92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000302','better',2,'better-v1','Better','Better system','Better warranty','[]',90000,110000),
  ('92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000302','best',3,'best-v1','Best','Best system','Best warranty','[]',110000,140000);
select public.activate_roof_pricing_rate_card(
  '92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000302'
);
select * from public.finalize_roof_estimate_packages(
  '92000000-0000-4000-8000-000000000001', (select trusted_estimate_id from meta_fixture_ids),
  '92000000-0000-4000-8000-000000000301'
);
update public.roof_assessments
set status='completed', current_step=9, recommendation='replacement_may_make_sense', completed_at='2026-09-01T12:40:00Z'
where id=(select trusted_assessment_id from meta_fixture_ids);

update public.roof_estimates
set roof_squares=0, range_low_cents=0, range_high_cents=0
where id=(select trusted_estimate_id from meta_fixture_ids);
select is(
  (select count(*) from public.reserve_meta_assessment_delivery(
    (select trusted_assessment_id from meta_fixture_ids), '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000204', 'piw-privacy-v1', '2026-09-01T13:00:00Z'
  )), 0::bigint, 'Good Better Best packages cannot substitute for trusted measurement ranges'
);
update public.roof_estimates
set roof_squares=20, range_low_cents=1, range_high_cents=2
where id=(select trusted_estimate_id from meta_fixture_ids);
select is(
  (select count(*) from public.reserve_meta_assessment_delivery(
    (select trusted_assessment_id from meta_fixture_ids), '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000204', 'piw-privacy-v1', '2026-09-01T13:00:00Z'
  )), 0::bigint, 'legacy estimate range must agree with the Better production package snapshot'
);
update public.roof_estimates as estimate
set roof_squares=package.measured_roof_squares,
    range_low_cents=package.range_low_cents,
    range_high_cents=package.range_high_cents
from public.roof_estimate_packages as package
where estimate.id=(select trusted_estimate_id from meta_fixture_ids)
  and package.company_id=estimate.company_id and package.estimate_id=estimate.id
  and package.tier_key='better';

create temp table first_assessment_reservation as
select * from public.reserve_meta_assessment_delivery(
  (select trusted_assessment_id from meta_fixture_ids), '92000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000204', 'piw-privacy-v1', '2026-09-01T13:00:00Z'
);
select is((select count(*) from first_assessment_reservation), 1::bigint, 'completed trusted priced assessment reserves AssessmentCompleted');
select is(
  (select event_id from public.reserve_meta_assessment_delivery(
    (select trusted_assessment_id from meta_fixture_ids), '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000204', 'piw-privacy-v1', '2026-09-01T13:00:00Z'
  )), (select event_id from first_assessment_reservation), 'assessment retry returns the original event ID'
);
select is(
  (select count(*) from public.reserve_meta_assessment_delivery(
    (select trusted_assessment_id from meta_fixture_ids), '92000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000206', 'piw-privacy-v1', '2026-09-01T13:00:00Z'
  )), 0::bigint, 'cross-company assessment reservation is rejected'
);

select throws_ok(
  $$set local role anon; select * from public.meta_event_deliveries$$,
  '42501', null, 'anonymous cannot read delivery ledger'
);
select throws_ok(
  $$set local role authenticated; insert into public.meta_event_deliveries default values$$,
  '42501', null, 'authenticated cannot write delivery ledger'
);
select throws_ok(
  $$set local role service_role; insert into public.meta_event_deliveries default values$$,
  '42501', null, 'service role writes only through constrained RPCs'
);

create temp table first_claim as
select * from public.claim_meta_delivery((select id from first_lead_reservation), '2026-09-01T13:01:00Z');
select is(
  (select status || ':' || attempt_count::text from first_claim), 'sending:1',
  'claim atomically transitions a pending row and increments its attempt count'
);
select is(
  (select count(*) from public.claim_meta_delivery((select id from first_lead_reservation), '2026-09-01T13:02:00Z')),
  0::bigint, 'a fresh sending row cannot be claimed twice'
);
select is(
  (select status || ':' || coalesce(last_error_category, 'null') || ':' || coalesce(meta_trace_id, 'null')
   from public.complete_meta_delivery(
     (select id from first_lead_reservation), 'retryable_failed', 429,
     repeat('A', 64), E' Network timeout\n429! ', '2026-09-01T13:03:00Z'
   )),
  'retryable_failed:network_timeout_429_:null',
  'retryable completion lowercases and tokenizes its error category and clears trace data'
);
select is(
  (select status || ':' || attempt_count::text
   from public.claim_meta_delivery((select id from first_lead_reservation), '2026-09-01T13:04:00Z')),
  'sending:2', 'retryable failure can be claimed for another bounded attempt'
);
select is(
  (select status || ':' || payload_hash || ':' || coalesce(meta_trace_id, 'null') || ':' || coalesce(last_error_category, 'null')
   from public.complete_meta_delivery(
     (select id from first_lead_reservation), 'sent', 200,
     repeat('B', 64), E' trace ID\n123! ', '2026-09-01T13:05:00Z'
   )),
  'sent:' || repeat('b', 64) || ':trace_ID_123_:null',
  'sent completion normalizes the hash, sanitizes trace metadata, and clears error data'
);
select is(
  (select count(*) from public.claim_meta_delivery((select id from first_lead_reservation), '2026-09-01T13:06:00Z')),
  0::bigint, 'sent delivery cannot be claimed again'
);

select * from public.claim_meta_delivery((select id from first_assessment_reservation), '2026-09-01T13:01:00Z');
select is(
  (select status || ':' || coalesce(last_error_category, 'null') || ':' || coalesce(meta_trace_id, 'null')
   from public.complete_meta_delivery(
     (select id from first_assessment_reservation), 'permanent_failed', 403,
     repeat('c', 64), 'permission_denied', '2026-09-01T13:02:00Z'
   )),
  'permanent_failed:permission_denied:null',
  'permanent failure stores only a sanitized category and clears trace data'
);
select throws_ok(
  $$select * from public.complete_meta_delivery(
    (select id from first_assessment_reservation), 'pending', 200,
    repeat('d',64), 'invalid_status', '2026-09-01T13:03:00Z'
  )$$,
  '22023', null, 'completion rejects statuses outside the outcome allowlist'
);

update public.meta_event_deliveries
set status='retryable_failed', attempt_count=5, updated_at='2026-09-01T12:00:00Z'
where id=(select id from first_assessment_reservation);
select is(
  (select count(*) from public.claim_meta_delivery((select id from first_assessment_reservation), '2026-09-01T13:20:00Z')),
  0::bigint, 'claim enforces the five-attempt retry bound'
);
select is(
  (select count(*) from public.list_pending_meta_deliveries(50, '2026-09-01T13:20:00Z')
   where id=(select id from first_assessment_reservation)),
  0::bigint, 'pending listing excludes deliveries that exhausted retries'
);

with inserted_leads as (
  insert into public.leads(company_id, property_id, name, phone, email, submitted_address)
  select '92000000-0000-4000-8000-000000000001',
         (select property_id from public.roof_assessment_access_attempts where id=(select attempt_id from incomplete_start)),
         'Pending Meta ' || value, '+1201555' || lpad(value::text, 4, '0'),
         'pending-meta-' || value || '@example.com', value || ' Pending Meta Way'
  from pg_catalog.generate_series(1, 51) as value
  returning id, company_id
)
insert into public.meta_event_deliveries(company_id, lead_id, consent_id, policy_version, event_name, event_time)
select company_id, id, extensions.gen_random_uuid(), 'piw-privacy-v1', 'Lead', '2026-09-01T13:10:00Z'
from inserted_leads;
select is(
  (select count(*) from public.list_pending_meta_deliveries(500, '2026-09-01T13:20:00Z')),
  50::bigint, 'pending listing clamps callers to fifty rows'
);

update public.meta_event_deliveries
set status='sending', attempt_count=1, last_attempted_at='2026-09-01T13:00:00Z', updated_at='2026-09-01T13:00:00Z'
where id=(select id from public.meta_event_deliveries where status='pending' order by id limit 1);
select ok(
  exists(
    select 1 from public.list_pending_meta_deliveries(50, '2026-09-01T13:11:00Z') as pending
    join public.meta_event_deliveries as delivery on delivery.id=pending.id
    where delivery.status='sending' and delivery.last_attempted_at='2026-09-01T13:00:00Z'
  ),
  'pending listing treats a sending row older than ten minutes as abandoned'
);

select * from finish();
rollback;

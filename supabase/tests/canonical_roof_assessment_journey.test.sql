begin;

create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

select has_column('public', 'roof_assessments', 'presentation_key', 'assessments retain presentation context');
select has_column('public', 'roof_assessments', 'entry_point', 'assessments retain their entry point');
select has_column('public', 'roof_assessments', 'last_answered_at', 'assessments retain progressive-answer time');
select has_column('public', 'roof_assessments', 'result_viewed_at', 'assessments retain result-view time');
select has_column('public', 'roof_assessments', 'abandoned_at', 'assessments retain abandonment time');
select has_table('public', 'lead_attribution_touches', 'attribution history exists');
select has_table('public', 'lead_consent_evidence', 'append-only consent evidence exists');
select has_table('public', 'consultation_requests', 'consultation intent exists');
select has_table('public', 'roof_assessment_access_attempts', 'continuation access attempts exist');
select hasnt_column('public', 'lead_consents', 'submission_id', 'current consent projection keeps its one-row contract');
select hasnt_column('public', 'roof_assessment_access_attempts', 'continuation_secret', 'raw continuation secrets are never stored');

select has_function(
  'public', 'start_or_resume_roof_assessment',
  array['uuid','uuid','text','text','text','text','text','text','text','jsonb','text','text','timestamp with time zone','text','text'],
  'canonical intake RPC exists'
);
select has_function('public', 'rotate_roof_estimate_public_token', array['uuid','uuid'], 'token rotation RPC exists');
select has_function('public', 'request_roof_consultation', array['uuid','uuid','text','text'], 'consultation RPC exists');

select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.lead_attribution_touches'::regclass), true, 'attribution has RLS');
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.lead_consent_evidence'::regclass), true, 'consent evidence has RLS');
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.consultation_requests'::regclass), true, 'consultation requests have RLS');
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.roof_assessment_access_attempts'::regclass), true, 'access attempts have RLS');

select table_privs_are('public', 'lead_attribution_touches', 'anon', array[]::text[], 'anon cannot access attribution');
select table_privs_are('public', 'lead_attribution_touches', 'authenticated', array[]::text[], 'authenticated cannot access attribution');
select table_privs_are('public', 'lead_consent_evidence', 'anon', array[]::text[], 'anon cannot access consent evidence');
select table_privs_are('public', 'lead_consent_evidence', 'authenticated', array[]::text[], 'authenticated cannot access consent evidence');
select table_privs_are('public', 'consultation_requests', 'anon', array[]::text[], 'anon cannot access consultations');
select table_privs_are('public', 'consultation_requests', 'authenticated', array[]::text[], 'authenticated cannot access consultations');
select table_privs_are('public', 'roof_assessment_access_attempts', 'anon', array[]::text[], 'anon cannot access access attempts');
select table_privs_are('public', 'roof_assessment_access_attempts', 'authenticated', array[]::text[], 'authenticated cannot access access attempts');

select function_privs_are(
  'public', 'start_or_resume_roof_assessment',
  array['uuid','uuid','text','text','text','text','text','text','text','jsonb','text','text','timestamp with time zone','text','text'],
  'public', array[]::text[], 'public cannot invoke canonical intake'
);
select function_privs_are(
  'public', 'start_or_resume_roof_assessment',
  array['uuid','uuid','text','text','text','text','text','text','text','jsonb','text','text','timestamp with time zone','text','text'],
  'service_role', array['EXECUTE'], 'service role alone invokes canonical intake'
);
select function_privs_are('public', 'rotate_roof_estimate_public_token', array['uuid','uuid'], 'public', array[]::text[], 'public cannot rotate tokens');
select function_privs_are('public', 'request_roof_consultation', array['uuid','uuid','text','text'], 'public', array[]::text[], 'public cannot create consultations');

select ok(
  (select proc.prosecdef and proc.proconfig = array['search_path=""']
   from pg_catalog.pg_proc as proc
   where proc.oid = 'public.start_or_resume_roof_assessment(uuid,uuid,text,text,text,text,text,text,text,jsonb,text,text,timestamptz,text,text)'::regprocedure),
  'canonical intake is security definer with an empty search path'
);
select ok(
  (select proc.prosecdef and proc.proconfig = array['search_path=""']
   from pg_catalog.pg_proc as proc
   where proc.oid = 'public.rotate_roof_estimate_public_token(uuid,uuid)'::regprocedure),
  'token rotation is security definer with an empty search path'
);
select ok(
  (select proc.prosecdef and proc.proconfig = array['search_path=""']
   from pg_catalog.pg_proc as proc
   where proc.oid = 'public.request_roof_consultation(uuid,uuid,text,text)'::regprocedure),
  'consultation RPC is security definer with an empty search path'
);

insert into public.companies (id, name) values
  ('d0000000-0000-4000-8000-000000000001', 'Canonical Journey Company A'),
  ('d0000000-0000-4000-8000-000000000002', 'Canonical Journey Company B');

create temp table first_start as
select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000010',
  'Alex Rivera', '+12015550100', 'alex@example.com',
  '1 Main St, Newark, NJ 07102', 'ChIJ-canonical-one',
  'all-season-main', 'main-home',
  '{"utm_source":"google","fbclid":"click-one"}'::jsonb,
  'https://example.com/', 'all-season-assessment-v1',
  '2026-08-26T14:00:00Z', '127.0.0.1', 'pgtap'
);

select ok((select attempt_id is not null and continuation_secret ~ '^[0-9a-f]{64}$' and expires_at > now() from first_start), 'new intake returns only an attempt, opaque secret, and expiry');
select is((select attempt_kind from public.roof_assessment_access_attempts where id = (select attempt_id from first_start)), 'new', 'first intake is a new journey');
select ok(
  (select continuation_secret_hash = extensions.digest((select continuation_secret from first_start), 'sha256')
   from public.roof_assessment_access_attempts where id = (select attempt_id from first_start)),
  'access attempt stores only the continuation secret hash'
);
select is((select count(*) from public.lead_attribution_touches where submission_id = 'd0000000-0000-4000-8000-000000000010'), 1::bigint, 'new intake appends one attribution touch');
select is((select count(*) from public.lead_consents where lead_id = (select lead_id from public.roof_assessment_access_attempts where id = (select attempt_id from first_start))), 3::bigint, 'new intake maintains one current consent projection per type');
select is((select count(*) from public.lead_consent_evidence where submission_id = 'd0000000-0000-4000-8000-000000000010'), 3::bigint, 'new intake appends all consent evidence');
select is(
  (select count(*) from public.domain_events where event_name = 'roof/assessment.started' and correlation_id = 'd0000000-0000-4000-8000-000000000010'),
  1::bigint,
  'new intake atomically publishes one sparse assessment-started event'
);

create temp table duplicate_start as
select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000010',
  'Changed Name', '+12015550999', 'changed@example.com',
  '99 Changed St, Newark, NJ', null,
  'weather-report', 'campaign:weather-report', '{}'::jsonb,
  null, 'changed-disclosure', '2026-08-26T15:00:00Z', '127.0.0.9', 'retry'
);

select isnt((select attempt_id from duplicate_start), (select attempt_id from first_start), 'same company and submission replay creates a fresh immutable attempt');
select is(
  (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from duplicate_start)),
  (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from first_start)),
  'submission replay reuses the original journey graph'
);
select isnt((select continuation_secret from duplicate_start), (select continuation_secret from first_start), 'fresh replay attempt has an independent one-time secret');
select is((select count(*) from public.lead_attribution_touches where submission_id = 'd0000000-0000-4000-8000-000000000010'), 1::bigint, 'submission replay does not duplicate attribution');
select is((select count(*) from public.lead_consent_evidence where submission_id = 'd0000000-0000-4000-8000-000000000010'), 3::bigint, 'submission replay does not duplicate consent evidence');
select ok(
  (select continuation_secret_hash = extensions.digest((select continuation_secret from first_start), 'sha256')
   from public.roof_assessment_access_attempts where id = (select attempt_id from first_start)),
  'submission replay leaves the original continuation valid'
);
select is(
  (select count(*) from public.domain_events where event_name = 'roof/assessment.started' and correlation_id = 'd0000000-0000-4000-8000-000000000010'),
  1::bigint,
  'submission replay leaves the canonical started event idempotent'
);
select is(
  (select count(*) from public.event_outbox where event_id in (select id from public.domain_events where correlation_id = 'd0000000-0000-4000-8000-000000000010')),
  1::bigint,
  'submission replay leaves the started-event outbox idempotent'
);

update public.roof_assessment_access_attempts
set consumed_at = '2026-08-26T17:00:00Z'
where id = (select attempt_id from first_start);
create temp table consumed_attempt_snapshot as
select continuation_secret_hash, expires_at, consumed_at
from public.roof_assessment_access_attempts
where id = (select attempt_id from first_start);
create temp table consumed_replay as
select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000010',
  'Replay After Consumption', '+12015550999', 'changed@example.com',
  '99 Changed St, Newark, NJ', null,
  'weather-report', 'campaign:weather-report', '{}'::jsonb,
  null, 'changed-disclosure', '2026-08-26T17:01:00Z', '127.0.0.10', 'retry'
);
select isnt((select attempt_id from consumed_replay), (select attempt_id from first_start), 'replay after consumption creates another attempt instead of resurrecting the consumed one');
select results_eq(
  $$select continuation_secret_hash, expires_at, consumed_at
    from public.roof_assessment_access_attempts
    where id = (select attempt_id from first_start)$$,
  $$select continuation_secret_hash, expires_at, consumed_at from consumed_attempt_snapshot$$,
  'replay after consumption leaves the original hash, expiry, and consumption immutable'
);
select is((select count(*) from public.roof_assessment_access_attempts where company_id = 'd0000000-0000-4000-8000-000000000001' and submission_id = 'd0000000-0000-4000-8000-000000000010'), 3::bigint, 'each duplicate delivery has an independent access-attempt credential');

update public.roof_assessments
set status = 'abandoned',
    presentation_key = 'all-season-main',
    entry_point = 'main-home',
    abandoned_at = now() - interval '2 hours',
    updated_at = now() - interval '1 day'
where id = (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from first_start));
create temp table abandoned_before_resume as
select status, presentation_key, entry_point, abandoned_at, updated_at
from public.roof_assessments
where id = (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from first_start));

create temp table resume_start as
select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000011',
  'Alex Rivera', '+12015550998', 'alex@example.com',
  '1 MAIN ST NEWARK NJ 07102', 'ChIJ-canonical-one',
  'seasonal-shield', 'campaign:seasonal-shield', '{"utm_source":"meta"}'::jsonb,
  'https://facebook.com/', 'all-season-assessment-v1',
  '2026-08-26T16:00:00Z', '127.0.0.2', 'pgtap'
);

select is((select attempt_kind from public.roof_assessment_access_attempts where id = (select attempt_id from resume_start)), 'resume_candidate', 'matching incomplete journey inside 30 days is a resume candidate');
select is(
  (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from resume_start)),
  (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from first_start)),
  'resume candidate points at the existing assessment'
);
select is(
  (select destination_phone_e164 from public.roof_assessment_access_attempts where id = (select attempt_id from resume_start)),
  '+12015550100',
  'email-only resume verification is sent to the existing lead phone, never the newly submitted phone'
);
select results_eq(
  $$select status, presentation_key, entry_point, abandoned_at, updated_at
    from public.roof_assessments
    where id = (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from first_start))$$,
  $$select status, presentation_key, entry_point, abandoned_at, updated_at from abandoned_before_resume$$,
  'identity matching does not reactivate, reframe, or refresh an abandoned assessment before authorization'
);
select is((select count(*) from public.lead_consent_evidence where submission_id = 'd0000000-0000-4000-8000-000000000011'), 3::bigint, 'resume submission appends new consent evidence');
select is((select count(*) from public.lead_consents where lead_id = (select lead_id from public.roof_assessment_access_attempts where id = (select attempt_id from first_start))), 3::bigint, 'multiple accepted submissions retain one current consent row per type for existence consumers');

create temp table phone_only_resume as
select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000014',
  'Alex Rivera', '+12015550100', 'different@example.com',
  '1 Main St, Newark, NJ 07102', 'ChIJ-canonical-one',
  'all-season-main', 'main-home', '{}'::jsonb,
  null, 'all-season-assessment-v1', now(), '127.0.0.14', 'pgtap'
);
select is((select attempt_kind from public.roof_assessment_access_attempts where id = (select attempt_id from phone_only_resume)), 'resume_candidate', 'same-property phone-only identity branch reuses the existing journey');
select is(
  (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from phone_only_resume)),
  (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from first_start)),
  'phone-only identity branch does not create a duplicate journey'
);

create temp table incoming_place_absent as
select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000015',
  'Alex Rivera', '+12015550100', 'different-2@example.com',
  '1 MAIN ST NEWARK NJ 07102', null,
  'all-season-main', 'main-home', '{}'::jsonb,
  null, 'all-season-assessment-v1', now(), '127.0.0.15', 'pgtap'
);
select is((select attempt_kind from public.roof_assessment_access_attempts where id = (select attempt_id from incoming_place_absent)), 'resume_candidate', 'normalized address is used when the incoming Place ID is absent');

create temp table mismatched_places as
select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000016',
  'Alex Rivera', '+12015550100', 'alex@example.com',
  '1 Main St, Newark, NJ 07102', 'ChIJ-different-place',
  'all-season-main', 'main-home', '{}'::jsonb,
  null, 'all-season-assessment-v1', now(), '127.0.0.16', 'pgtap'
);
select is((select attempt_kind from public.roof_assessment_access_attempts where id = (select attempt_id from mismatched_places)), 'new', 'two different non-null Place IDs never match through the address fallback');

create temp table no_place_start as
select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000017',
  'Morgan Lee', '+12015550200', 'morgan@example.com',
  '2 Oak St, Newark, NJ 07102', null,
  'all-season-main', 'main-home', '{}'::jsonb,
  null, 'all-season-assessment-v1', now(), '127.0.0.17', 'pgtap'
);
create temp table both_places_absent as
select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000018',
  'Morgan Lee', '+12015550200', 'other@example.com',
  '2 OAK ST NEWARK NJ 07102', null,
  'all-season-main', 'main-home', '{}'::jsonb,
  null, 'all-season-assessment-v1', now(), '127.0.0.18', 'pgtap'
);
select is((select attempt_kind from public.roof_assessment_access_attempts where id = (select attempt_id from both_places_absent)), 'resume_candidate', 'normalized address matches when both Place IDs are absent');
create temp table existing_place_absent as
select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000019',
  'Morgan Lee', '+12015550200', 'other-2@example.com',
  '2 OAK ST NEWARK NJ 07102', 'ChIJ-newly-resolved-place',
  'all-season-main', 'main-home', '{}'::jsonb,
  null, 'all-season-assessment-v1', now(), '127.0.0.19', 'pgtap'
);
select is((select attempt_kind from public.roof_assessment_access_attempts where id = (select attempt_id from existing_place_absent)), 'resume_candidate', 'normalized address is used when the existing journey has no Place ID');

update public.roof_assessments
set updated_at = now() - interval '30 days'
where id = (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from no_place_start));
create temp table exact_boundary_resume as
select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000020',
  'Morgan Lee', '+12015550200', 'boundary@example.com',
  '2 Oak St, Newark, NJ 07102', null,
  'all-season-main', 'main-home', '{}'::jsonb,
  null, 'all-season-assessment-v1', now(), '127.0.0.20', 'pgtap'
);
select is((select attempt_kind from public.roof_assessment_access_attempts where id = (select attempt_id from exact_boundary_resume)), 'resume_candidate', 'the exact 30-day boundary remains resumable');

update public.roof_assessments
set updated_at = now() - interval '30 days' - interval '1 microsecond'
where id = (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from no_place_start));
create temp table outside_boundary_start as
select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000021',
  'Morgan Lee', '+12015550200', 'outside@example.com',
  '2 Oak St, Newark, NJ 07102', null,
  'all-season-main', 'main-home', '{}'::jsonb,
  null, 'all-season-assessment-v1', now(), '127.0.0.21', 'pgtap'
);
select is((select attempt_kind from public.roof_assessment_access_attempts where id = (select attempt_id from outside_boundary_start)), 'new', 'a journey even one microsecond outside 30 days starts fresh');

update public.leads
set phone_e164 = null
where id = (select lead_id from public.roof_assessment_access_attempts where id = (select attempt_id from first_start));
update public.roof_assessments
set updated_at = now() - interval '1 day'
where id = (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from first_start));
select throws_ok(
  $$select * from public.start_or_resume_roof_assessment(
    'd0000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000022',
    'Alex Rivera', '+12015550997', 'alex@example.com',
    '1 Main St, Newark, NJ 07102', 'ChIJ-canonical-one',
    'all-season-main', 'main-home', '{}'::jsonb,
    null, 'all-season-assessment-v1', now(), '127.0.0.22', 'pgtap'
  )$$,
  'Resume candidate has no usable existing phone',
  'email-only resume fails closed when the existing lead has no usable OTP destination'
);
update public.leads
set phone_e164 = '+12015550100'
where id = (select lead_id from public.roof_assessment_access_attempts where id = (select attempt_id from first_start));

update public.roof_assessments
set updated_at = now() - interval '31 days'
where id = (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from first_start));

create temp table stale_start as
select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000012',
  'Alex Rivera', '+12015550100', 'alex@example.com',
  '1 Main St, Newark, NJ 07102', 'ChIJ-canonical-one',
  'all-season-main', 'main-contact', '{}'::jsonb,
  null, 'all-season-assessment-v1', now(), '127.0.0.3', 'pgtap'
);

select is((select attempt_kind from public.roof_assessment_access_attempts where id = (select attempt_id from stale_start)), 'new', 'a 31-day-old journey starts fresh');
select isnt(
  (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from stale_start)),
  (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from first_start)),
  'stale journey is not resumed'
);

update public.roof_assessments
set status = 'completed', recommendation = 'professional_inspection', completed_at = now()
where id = (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from stale_start));

create temp table completed_start as
select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000013',
  'Alex Rivera', '+12015550100', 'alex@example.com',
  '1 Main St, Newark, NJ 07102', 'ChIJ-canonical-one',
  'all-season-main', 'main-drawer', '{}'::jsonb,
  null, 'all-season-assessment-v1', now(), '127.0.0.4', 'pgtap'
);

select is((select attempt_kind from public.roof_assessment_access_attempts where id = (select attempt_id from completed_start)), 'new', 'completed journey is never resumed');
select isnt(
  (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from completed_start)),
  (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from stale_start)),
  'completed journey produces a distinct assessment'
);

create temp table tenant_start as
select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000002',
  'd0000000-0000-4000-8000-000000000010',
  'Alex Rivera', '+12015550100', 'alex@example.com',
  '1 Main St, Newark, NJ 07102', 'ChIJ-canonical-one',
  'all-season-main', 'main-home', '{}'::jsonb,
  null, 'all-season-assessment-v1', now(), '127.0.0.5', 'pgtap'
);

select isnt((select attempt_id from tenant_start), (select attempt_id from first_start), 'same submission UUID in another company remains tenant-isolated');
select is((select company_id from public.roof_assessment_access_attempts where id = (select attempt_id from tenant_start)), 'd0000000-0000-4000-8000-000000000002'::uuid, 'tenant owns its access attempt');

select throws_ok(
  $$insert into public.lead_consent_evidence (
      company_id, lead_id, submission_id, consent_type, granted,
      disclosure_version, source, granted_at
    ) values (
      'd0000000-0000-4000-8000-000000000002',
      (select lead_id from public.roof_assessment_access_attempts where id = (select attempt_id from first_start)),
      'd0000000-0000-4000-8000-000000000080', 'estimate_processing', true,
      'v1', 'cross-tenant-test', now()
    )$$,
  '23503', null,
  'consent evidence rejects a lead from another tenant'
);
select throws_ok(
  $$insert into public.lead_attribution_touches (
      company_id, lead_id, submission_id, entry_point, presentation_key
    ) values (
      'd0000000-0000-4000-8000-000000000002',
      (select lead_id from public.roof_assessment_access_attempts where id = (select attempt_id from first_start)),
      'd0000000-0000-4000-8000-000000000081', 'cross-tenant-test', 'all-season-main'
    )$$,
  '23503', null,
  'attribution rejects a lead from another tenant'
);
select throws_ok(
  $$insert into public.consultation_requests (
      company_id, lead_id, property_id, estimate_id, assessment_id,
      contact_method
    ) select
      'd0000000-0000-4000-8000-000000000002', lead_id, property_id,
      estimate_id, assessment_id, 'email'
    from public.roof_assessment_access_attempts
    where id = (select attempt_id from first_start)$$,
  '23503', null,
  'consultation requests reject a cross-tenant assessment graph'
);
select throws_ok(
  $$insert into public.roof_assessment_access_attempts (
      company_id, submission_id, lead_id, property_id, estimate_id,
      assessment_id, attempt_kind, continuation_secret_hash,
      destination_phone_e164, requested_presentation_key,
      requested_entry_point, request_ip, expires_at
    ) select
      'd0000000-0000-4000-8000-000000000002',
      'd0000000-0000-4000-8000-000000000082', lead_id, property_id,
      estimate_id, assessment_id, 'new', extensions.digest('secret', 'sha256'),
      '+12015550100', 'all-season-main', 'cross-tenant-test', '127.0.0.1',
      now() + interval '15 minutes'
    from public.roof_assessment_access_attempts
    where id = (select attempt_id from first_start)$$,
  '23503', null,
  'access attempts reject a cross-tenant assessment graph'
);

select throws_ok(
  $$select * from public.request_roof_consultation('d0000000-0000-4000-8000-000000000001', (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from completed_start)), 'call', null)$$,
  'Call window is required for phone consultation',
  'call consultation requires a call window'
);

create temp table first_consultation as
select * from public.request_roof_consultation(
  'd0000000-0000-4000-8000-000000000001',
  (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from completed_start)),
  'call', 'morning'
);
create temp table duplicate_consultation as
select * from public.request_roof_consultation(
  'd0000000-0000-4000-8000-000000000001',
  (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from completed_start)),
  'call', 'morning'
);
select is((select request_id from duplicate_consultation), (select request_id from first_consultation), 'consultation intent is idempotent by assessment');

update public.roof_assessment_access_attempts
set verified_at = now()
where id = (select attempt_id from resume_start);
create temp table token_before_rotation as
select estimate.public_token
from public.roof_estimates as estimate
where estimate.id = (
  select attempt.estimate_id
  from public.roof_assessment_access_attempts as attempt
  where attempt.id = (select attempt_id from resume_start)
);
create temp table rotated_token as
select * from public.rotate_roof_estimate_public_token(
  'd0000000-0000-4000-8000-000000000001', (select attempt_id from resume_start)
);
select isnt(
  (select public_token from rotated_token),
  (select public_token from token_before_rotation),
  'verified resume rotates the public estimate token'
);
select is((select token_rotated_at is not null and consumed_at is not null from public.roof_assessment_access_attempts where id = (select attempt_id from resume_start)), true, 'verified rotation consumes and timestamps the attempt');
select is(
  (select status from public.roof_assessments where id = (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from resume_start))),
  'in_progress',
  'verified authorization reactivates an abandoned resume candidate'
);
select results_eq(
  $$select presentation_key, entry_point, abandoned_at is null
    from public.roof_assessments
    where id = (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from resume_start))$$,
  $$values ('seasonal-shield'::text, 'campaign:seasonal-shield'::text, true)$$,
  'verified authorization applies the requested presentation and clears abandonment'
);

select * from extensions.finish();
rollback;

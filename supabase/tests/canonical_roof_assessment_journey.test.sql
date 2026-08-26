begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select extensions.no_plan();

select has_column('public', 'roof_assessments', 'presentation_key', 'assessments retain presentation context');
select has_column('public', 'roof_assessments', 'entry_point', 'assessments retain their entry point');
select has_column('public', 'roof_assessments', 'last_answered_at', 'assessments retain progressive-answer time');
select has_column('public', 'roof_assessments', 'revision', 'assessments retain a monotonic persistence revision');
select has_column('public', 'roof_assessments', 'result_viewed_at', 'assessments retain result-view time');
select has_column('public', 'roof_assessments', 'abandoned_at', 'assessments retain abandonment time');
select has_table('public', 'lead_attribution_touches', 'attribution history exists');
select has_table('public', 'lead_consent_evidence', 'append-only consent evidence exists');
select has_table('public', 'consultation_requests', 'consultation intent exists');
select has_table('public', 'roof_assessment_access_attempts', 'continuation access attempts exist');
select has_table('public', 'roof_assessment_verification_sends', 'verification send evidence exists');
select hasnt_column('public', 'lead_consents', 'submission_id', 'current consent projection keeps its one-row contract');
select hasnt_column('public', 'roof_assessment_access_attempts', 'continuation_secret', 'raw continuation secrets are never stored');

select has_function(
  'public', 'start_or_resume_roof_assessment',
  array['uuid','uuid','text','text','text','text','text','text','text','jsonb','text','text','timestamp with time zone','text','text'],
  'canonical intake RPC exists'
);
select has_function('public', 'rotate_roof_estimate_public_token', array['uuid','uuid'], 'token rotation RPC exists');
select has_function(
  'public', 'authorize_same_browser_roof_assessment_resume',
  array['uuid','uuid','uuid','bytea'],
  'atomic same-browser resume RPC exists'
);
select has_function('public', 'request_roof_consultation', array['uuid','uuid','uuid','text','text','text'], 'bound consultation RPC exists');
select has_function('public', 'mark_roof_assessment_result_viewed', array['uuid','uuid','uuid'], 'atomic result-view RPC exists');
select has_function(
  'public', 'reserve_roof_assessment_verification_start', array['uuid','inet'],
  'atomic verification reservation RPC exists'
);
select has_function(
  'public', 'record_roof_assessment_verification_start', array['uuid','uuid','uuid','text'],
  'provider start evidence RPC exists'
);
select has_function(
  'public', 'approve_verified_roof_assessment_resume', array['uuid','uuid','text'],
  'atomic verified resume approval RPC exists'
);
select has_function('public', 'save_roof_assessment_progress', array['uuid','uuid','bigint','integer','timestamp with time zone','jsonb','jsonb','jsonb','boolean'], 'revision-safe atomic progressive assessment save RPC exists');
select has_function('public', 'complete_roof_assessment', array['uuid','uuid','bigint','jsonb','jsonb','jsonb','text','boolean'], 'revision-safe atomic assessment completion RPC exists');
select has_function('public', 'abandon_inactive_roof_assessments', array['integer'], 'atomic bounded abandonment RPC exists');

select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.lead_attribution_touches'::regclass), true, 'attribution has RLS');
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.lead_consent_evidence'::regclass), true, 'consent evidence has RLS');
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.consultation_requests'::regclass), true, 'consultation requests have RLS');
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.roof_assessment_access_attempts'::regclass), true, 'access attempts have RLS');
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.roof_assessment_verification_sends'::regclass), true, 'verification evidence has RLS');

select table_privs_are('public', 'lead_attribution_touches', 'anon', array[]::text[], 'anon cannot access attribution');
select table_privs_are('public', 'lead_attribution_touches', 'authenticated', array[]::text[], 'authenticated cannot access attribution');
select table_privs_are('public', 'lead_consent_evidence', 'anon', array[]::text[], 'anon cannot access consent evidence');
select table_privs_are('public', 'lead_consent_evidence', 'authenticated', array[]::text[], 'authenticated cannot access consent evidence');
select table_privs_are('public', 'consultation_requests', 'anon', array[]::text[], 'anon cannot access consultations');
select table_privs_are('public', 'consultation_requests', 'authenticated', array[]::text[], 'authenticated cannot access consultations');
select table_privs_are('public', 'roof_assessment_access_attempts', 'anon', array[]::text[], 'anon cannot access access attempts');
select table_privs_are('public', 'roof_assessment_access_attempts', 'authenticated', array[]::text[], 'authenticated cannot access access attempts');
select table_privs_are('public', 'roof_assessment_verification_sends', 'anon', array[]::text[], 'anon cannot access verification evidence');
select table_privs_are('public', 'roof_assessment_verification_sends', 'authenticated', array[]::text[], 'authenticated cannot access verification evidence');

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
select function_privs_are(
  'public', 'authorize_same_browser_roof_assessment_resume',
  array['uuid','uuid','uuid','bytea'],
  'public', array[]::text[], 'public cannot authorize same-browser resume'
);
select function_privs_are(
  'public', 'authorize_same_browser_roof_assessment_resume',
  array['uuid','uuid','uuid','bytea'],
  'service_role', array['EXECUTE'], 'service role alone authorizes same-browser resume'
);
select function_privs_are('public', 'request_roof_consultation', array['uuid','uuid','uuid','text','text','text'], 'public', array[]::text[], 'public cannot create consultations');
select function_privs_are('public', 'request_roof_consultation', array['uuid','uuid','uuid','text','text','text'], 'service_role', array['EXECUTE'], 'service role alone creates consultations');
select function_privs_are('public', 'mark_roof_assessment_result_viewed', array['uuid','uuid','uuid'], 'public', array[]::text[], 'public cannot mark result views');
select function_privs_are('public', 'mark_roof_assessment_result_viewed', array['uuid','uuid','uuid'], 'service_role', array['EXECUTE'], 'service role alone marks result views');
select function_privs_are(
  'public', 'reserve_roof_assessment_verification_start', array['uuid','inet'],
  'public', array[]::text[], 'public cannot reserve verification starts'
);
select function_privs_are(
  'public', 'reserve_roof_assessment_verification_start', array['uuid','inet'],
  'service_role', array['EXECUTE'], 'service role alone reserves verification starts'
);
select function_privs_are(
  'public', 'record_roof_assessment_verification_start', array['uuid','uuid','uuid','text'],
  'public', array[]::text[], 'public cannot record provider starts'
);
select function_privs_are(
  'public', 'approve_verified_roof_assessment_resume', array['uuid','uuid','text'],
  'public', array[]::text[], 'public cannot approve verified resumes'
);
select function_privs_are(
  'public', 'approve_verified_roof_assessment_resume', array['uuid','uuid','text'],
  'service_role', array['EXECUTE'], 'service role alone approves verified resumes'
);
select function_privs_are('public', 'save_roof_assessment_progress', array['uuid','uuid','bigint','integer','timestamp with time zone','jsonb','jsonb','jsonb','boolean'], 'public', array[]::text[], 'public cannot save assessment progress');
select function_privs_are('public', 'save_roof_assessment_progress', array['uuid','uuid','bigint','integer','timestamp with time zone','jsonb','jsonb','jsonb','boolean'], 'anon', array[]::text[], 'anon cannot save assessment progress');
select function_privs_are('public', 'save_roof_assessment_progress', array['uuid','uuid','bigint','integer','timestamp with time zone','jsonb','jsonb','jsonb','boolean'], 'authenticated', array[]::text[], 'authenticated cannot save assessment progress');
select function_privs_are('public', 'save_roof_assessment_progress', array['uuid','uuid','bigint','integer','timestamp with time zone','jsonb','jsonb','jsonb','boolean'], 'service_role', array['EXECUTE'], 'service role alone saves assessment progress');
select function_privs_are('public', 'complete_roof_assessment', array['uuid','uuid','bigint','jsonb','jsonb','jsonb','text','boolean'], 'public', array[]::text[], 'public cannot complete assessments');
select function_privs_are('public', 'complete_roof_assessment', array['uuid','uuid','bigint','jsonb','jsonb','jsonb','text','boolean'], 'anon', array[]::text[], 'anon cannot complete assessments');
select function_privs_are('public', 'complete_roof_assessment', array['uuid','uuid','bigint','jsonb','jsonb','jsonb','text','boolean'], 'authenticated', array[]::text[], 'authenticated cannot complete assessments');
select function_privs_are('public', 'complete_roof_assessment', array['uuid','uuid','bigint','jsonb','jsonb','jsonb','text','boolean'], 'service_role', array['EXECUTE'], 'service role alone completes assessments');
select function_privs_are('public', 'abandon_inactive_roof_assessments', array['integer'], 'public', array[]::text[], 'public cannot sweep assessment lifecycle state');
select function_privs_are('public', 'abandon_inactive_roof_assessments', array['integer'], 'anon', array[]::text[], 'anon cannot sweep assessment lifecycle state');
select function_privs_are('public', 'abandon_inactive_roof_assessments', array['integer'], 'authenticated', array[]::text[], 'authenticated cannot sweep assessment lifecycle state');
select function_privs_are('public', 'abandon_inactive_roof_assessments', array['integer'], 'service_role', array['EXECUTE'], 'service role alone sweeps assessment lifecycle state');

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
   where proc.oid = 'public.authorize_same_browser_roof_assessment_resume(uuid,uuid,uuid,bytea)'::regprocedure),
  'same-browser authorization is security definer with an empty search path'
);
select ok(
  (select proc.prosecdef and proc.proconfig = array['search_path=""']
   from pg_catalog.pg_proc as proc
   where proc.oid = 'public.request_roof_consultation(uuid,uuid,uuid,text,text,text)'::regprocedure),
  'consultation RPC is security definer with an empty search path'
);
select ok(
  (select proc.prosecdef and proc.proconfig = array['search_path=""']
   from pg_catalog.pg_proc as proc
   where proc.oid = 'public.mark_roof_assessment_result_viewed(uuid,uuid,uuid)'::regprocedure),
  'result-view RPC is security definer with an empty search path'
);
select ok(
  (select proc.prosecdef and proc.proconfig = array['search_path=""']
   from pg_catalog.pg_proc as proc
   where proc.oid = 'public.reserve_roof_assessment_verification_start(uuid,inet)'::regprocedure),
  'verification reservation is security definer with an empty search path'
);
select ok(
  (select proc.prosecdef and proc.proconfig = array['search_path=""']
   from pg_catalog.pg_proc as proc
   where proc.oid = 'public.record_roof_assessment_verification_start(uuid,uuid,uuid,text)'::regprocedure),
  'provider evidence recording is security definer with an empty search path'
);
select ok(
  (select proc.prosecdef and proc.proconfig = array['search_path=""']
   from pg_catalog.pg_proc as proc
   where proc.oid = 'public.approve_verified_roof_assessment_resume(uuid,uuid,text)'::regprocedure),
  'verified resume approval is security definer with an empty search path'
);
select ok(
  (select proc.prosecdef and proc.proconfig = array['search_path=""']
   from pg_catalog.pg_proc as proc
   where proc.oid = 'public.save_roof_assessment_progress(uuid,uuid,bigint,integer,timestamptz,jsonb,jsonb,jsonb,boolean)'::regprocedure),
  'progress CAS is security definer with an empty search path'
);
select ok(
  (select proc.prosecdef and proc.proconfig = array['search_path=""']
   from pg_catalog.pg_proc as proc
   where proc.oid = 'public.complete_roof_assessment(uuid,uuid,bigint,jsonb,jsonb,jsonb,text,boolean)'::regprocedure),
  'completion CAS is security definer with an empty search path'
);
select ok(
  (select proc.prosecdef and proc.proconfig = array['search_path=""']
   from pg_catalog.pg_proc as proc
   where proc.oid = 'public.abandon_inactive_roof_assessments(integer)'::regprocedure),
  'abandonment RPC is security definer with an empty search path'
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

select ok((select attempt_id is not null and continuation_secret ~ '^[0-9a-f]{64}$' and expires_at > now() and not is_replay from first_start), 'new intake returns one canonical attempt, its only raw secret issuance, and expiry');
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

select is((select attempt_id from duplicate_start), (select attempt_id from first_start), 'same company and submission replay returns the canonical attempt');
select is(
  (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from duplicate_start)),
  (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from first_start)),
  'submission replay reuses the original journey graph'
);
select ok((select is_replay and continuation_secret is null from duplicate_start), 'submission replay explicitly returns no new raw credential');
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
select is((select attempt_id from consumed_replay), (select attempt_id from first_start), 'replay after consumption remains bound to the canonical attempt');
select ok((select is_replay and continuation_secret is null from consumed_replay), 'replay after consumption cannot reissue a usable credential');
select results_eq(
  $$select continuation_secret_hash, expires_at, consumed_at
    from public.roof_assessment_access_attempts
    where id = (select attempt_id from first_start)$$,
  $$select continuation_secret_hash, expires_at, consumed_at from consumed_attempt_snapshot$$,
  'replay after consumption leaves the original hash, expiry, and consumption immutable'
);
select is((select count(*) from public.roof_assessment_access_attempts where company_id = 'd0000000-0000-4000-8000-000000000001' and submission_id = 'd0000000-0000-4000-8000-000000000010'), 1::bigint, 'duplicate delivery never creates another access attempt');

update public.roof_assessment_access_attempts
set consumed_at = null,
    expires_at = now() - interval '1 minute'
where id = (select attempt_id from first_start);
create temp table expired_attempt_snapshot as
select continuation_secret_hash, expires_at, consumed_at
from public.roof_assessment_access_attempts
where id = (select attempt_id from first_start);
create temp table expired_replay as
select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000010',
  'Expired Replay', '+12015550999', 'changed@example.com',
  '99 Changed St, Newark, NJ', null,
  'weather-report', 'campaign:weather-report', '{}'::jsonb,
  null, 'changed-disclosure', '2026-08-26T17:02:00Z', '127.0.0.11', 'retry'
);
select ok((select is_replay and continuation_secret is null from expired_replay), 'expired submission replay cannot renew or reissue the credential');
select results_eq(
  $$select continuation_secret_hash, expires_at, consumed_at
    from public.roof_assessment_access_attempts
    where id = (select attempt_id from first_start)$$,
  $$select continuation_secret_hash, expires_at, consumed_at from expired_attempt_snapshot$$,
  'expired replay leaves hash, expiry, and consumption unchanged'
);

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
  $$select * from public.request_roof_consultation(
    'd0000000-0000-4000-8000-000000000001',
    (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from completed_start)),
    (select estimate_id from public.roof_assessment_access_attempts where id = (select attempt_id from completed_start)),
    'call', null, 'America/New_York')$$,
  'Call window is required for phone consultation',
  'call consultation requires a call window'
);

select throws_ok(
  $$select * from public.request_roof_consultation(
    'd0000000-0000-4000-8000-000000000001',
    (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from completed_start)),
    (select estimate_id from public.roof_assessment_access_attempts where id = (select attempt_id from completed_start)),
    'text', 'morning', 'America/New_York')$$,
  'Call window is only valid for phone consultation',
  'text consultation rejects a call window'
);

select throws_ok(
  $$select * from public.request_roof_consultation(
    'd0000000-0000-4000-8000-000000000001',
    (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from completed_start)),
    (select estimate_id from public.roof_assessment_access_attempts where id = (select attempt_id from completed_start)),
    'email', null, 'America/Chicago')$$,
  'Unsupported consultation timezone',
  'consultation requests remain in Eastern Time'
);

select throws_ok(
  $$select * from public.request_roof_consultation(
    'd0000000-0000-4000-8000-000000000001',
    (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from completed_start)),
    (select estimate_id from public.roof_assessment_access_attempts where id = (select attempt_id from completed_start)),
    'email', null, 'America/New_York')$$,
  'Roof assessment is not complete',
  'consultation requests require a completed assessment'
);

update public.roof_assessments
set status='completed', recommendation='professional_inspection', completed_at=clock_timestamp()
where id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from completed_start));

create temp table first_consultation as
select * from public.request_roof_consultation(
  'd0000000-0000-4000-8000-000000000001',
  (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from completed_start)),
  (select estimate_id from public.roof_assessment_access_attempts where id = (select attempt_id from completed_start)),
  'call', 'morning', 'America/New_York'
);
create temp table duplicate_consultation as
select * from public.request_roof_consultation(
  'd0000000-0000-4000-8000-000000000001',
  (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from completed_start)),
  (select estimate_id from public.roof_assessment_access_attempts where id = (select attempt_id from completed_start)),
  'text', null, 'America/New_York'
);
select is((select request_id from duplicate_consultation), (select request_id from first_consultation), 'consultation intent is idempotent by assessment');
select is((select contact_method from public.consultation_requests where id=(select request_id from first_consultation)), 'text', 'a retry updates the same request preference');
select is((select count(*) from public.domain_events where idempotency_key='roof/assessment.consultation_requested:'||(select assessment_id::text from public.roof_assessment_access_attempts where id=(select attempt_id from completed_start))),1::bigint,'consultation retry enqueues exactly one event');
select is((select count(*) from public.event_outbox outbox join public.domain_events event on event.id=outbox.event_id where event.idempotency_key='roof/assessment.consultation_requested:'||(select assessment_id::text from public.roof_assessment_access_attempts where id=(select attempt_id from completed_start))),1::bigint,'consultation retry enqueues exactly one outbox row');

create temp table first_result_view as select * from public.mark_roof_assessment_result_viewed(
  'd0000000-0000-4000-8000-000000000001',
  (select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from completed_start)),
  (select estimate_id from public.roof_assessment_access_attempts where id=(select attempt_id from completed_start))
);
create temp table duplicate_result_view as select * from public.mark_roof_assessment_result_viewed(
  'd0000000-0000-4000-8000-000000000001',
  (select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from completed_start)),
  (select estimate_id from public.roof_assessment_access_attempts where id=(select attempt_id from completed_start))
);
select is((select result_viewed_at from duplicate_result_view),(select result_viewed_at from first_result_view),'result-view retry returns the canonical timestamp');
select is((select count(*) from public.domain_events where idempotency_key='roof/assessment.result_viewed:'||(select assessment_id::text from public.roof_assessment_access_attempts where id=(select attempt_id from completed_start))),1::bigint,'result-view retry enqueues exactly one event');
select is((select count(*) from public.event_outbox outbox join public.domain_events event on event.id=outbox.event_id where event.idempotency_key='roof/assessment.result_viewed:'||(select assessment_id::text from public.roof_assessment_access_attempts where id=(select attempt_id from completed_start))),1::bigint,'result-view retry enqueues exactly one outbox row');

update public.roof_assessment_access_attempts
set verified_at = now()
where id = (select attempt_id from resume_start);

create temp table unverified_rotation_before as
select assessment.status, assessment.presentation_key, assessment.entry_point,
       assessment.abandoned_at, assessment.updated_at as assessment_updated_at,
       estimate.public_token, estimate.updated_at as estimate_updated_at,
       attempt.verified_at, attempt.consumed_at, attempt.token_rotated_at,
       attempt.updated_at as attempt_updated_at
from public.roof_assessment_access_attempts as attempt
join public.roof_assessments as assessment on assessment.id = attempt.assessment_id
join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
where attempt.id = (select attempt_id from phone_only_resume);
select throws_ok(
  $$select * from public.rotate_roof_estimate_public_token(
    'd0000000-0000-4000-8000-000000000001', (select attempt_id from phone_only_resume)
  )$$,
  'Assessment access attempt is not verified',
  'an unverified attempt cannot rotate a token'
);
select results_eq(
  $$select assessment.status, assessment.presentation_key, assessment.entry_point,
           assessment.abandoned_at, assessment.updated_at,
           estimate.public_token, estimate.updated_at,
           attempt.verified_at, attempt.consumed_at, attempt.token_rotated_at,
           attempt.updated_at
    from public.roof_assessment_access_attempts as attempt
    join public.roof_assessments as assessment on assessment.id = attempt.assessment_id
    join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
    where attempt.id = (select attempt_id from phone_only_resume)$$,
  $$select * from unverified_rotation_before$$,
  'unverified rotation rejection has no lifecycle, estimate, or attempt side effects'
);

update public.roof_assessment_access_attempts
set verified_at = now(), expires_at = now() - interval '1 minute'
where id = (select attempt_id from incoming_place_absent);
create temp table expired_rotation_before as
select assessment.status, assessment.presentation_key, assessment.entry_point,
       assessment.abandoned_at, assessment.updated_at as assessment_updated_at,
       estimate.public_token, estimate.updated_at as estimate_updated_at,
       attempt.consumed_at, attempt.token_rotated_at, attempt.updated_at as attempt_updated_at
from public.roof_assessment_access_attempts as attempt
join public.roof_assessments as assessment on assessment.id = attempt.assessment_id
join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
where attempt.id = (select attempt_id from incoming_place_absent);
select throws_ok(
  $$select * from public.rotate_roof_estimate_public_token(
    'd0000000-0000-4000-8000-000000000001', (select attempt_id from incoming_place_absent)
  )$$,
  'Assessment access attempt has expired',
  'an expired attempt cannot rotate a token'
);
select results_eq(
  $$select assessment.status, assessment.presentation_key, assessment.entry_point,
           assessment.abandoned_at, assessment.updated_at,
           estimate.public_token, estimate.updated_at,
           attempt.consumed_at, attempt.token_rotated_at, attempt.updated_at
    from public.roof_assessment_access_attempts as attempt
    join public.roof_assessments as assessment on assessment.id = attempt.assessment_id
    join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
    where attempt.id = (select attempt_id from incoming_place_absent)$$,
  $$select * from expired_rotation_before$$,
  'expired rotation rejection has no lifecycle, estimate, or attempt side effects'
);

update public.roof_assessment_access_attempts
set verified_at = now(), consumed_at = now(), expires_at = now() + interval '15 minutes'
where id = (select attempt_id from existing_place_absent);
create temp table consumed_rotation_before as
select assessment.status, assessment.presentation_key, assessment.entry_point,
       assessment.abandoned_at, assessment.updated_at as assessment_updated_at,
       estimate.public_token, estimate.updated_at as estimate_updated_at,
       attempt.consumed_at, attempt.token_rotated_at, attempt.updated_at as attempt_updated_at
from public.roof_assessment_access_attempts as attempt
join public.roof_assessments as assessment on assessment.id = attempt.assessment_id
join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
where attempt.id = (select attempt_id from existing_place_absent);
select throws_ok(
  $$select * from public.rotate_roof_estimate_public_token(
    'd0000000-0000-4000-8000-000000000001', (select attempt_id from existing_place_absent)
  )$$,
  'Assessment access attempt has already been consumed',
  'a consumed unrotated verification artifact fails closed'
);
select results_eq(
  $$select assessment.status, assessment.presentation_key, assessment.entry_point,
           assessment.abandoned_at, assessment.updated_at,
           estimate.public_token, estimate.updated_at,
           attempt.consumed_at, attempt.token_rotated_at, attempt.updated_at
    from public.roof_assessment_access_attempts as attempt
    join public.roof_assessments as assessment on assessment.id = attempt.assessment_id
    join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
    where attempt.id = (select attempt_id from existing_place_absent)$$,
  $$select * from consumed_rotation_before$$,
  'consumed rotation rejection has no lifecycle, estimate, or attempt side effects'
);

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
create temp table completed_rotation_snapshot as
select estimate.public_token, estimate.updated_at as estimate_updated_at,
       attempt.consumed_at, attempt.token_rotated_at,
       attempt.updated_at as attempt_updated_at
from public.roof_assessment_access_attempts as attempt
join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
where attempt.id = (select attempt_id from resume_start);
select throws_ok(
  $$select * from public.rotate_roof_estimate_public_token(
    'd0000000-0000-4000-8000-000000000001', (select attempt_id from resume_start)
  )$$,
  'Assessment access attempt has already been consumed',
  'a successfully consumed rotation artifact cannot be reused'
);
select results_eq(
  $$select estimate.public_token, estimate.updated_at,
           attempt.consumed_at, attempt.token_rotated_at, attempt.updated_at
    from public.roof_assessment_access_attempts as attempt
    join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
    where attempt.id = (select attempt_id from resume_start)$$,
  $$select * from completed_rotation_snapshot$$,
  'reusing a consumed rotated artifact leaves the token and attempt unchanged'
);

-- Real two-session race: hold the shared Place-ID lock in a third connection,
-- dispatch both intake calls asynchronously, verify both are blocked, then
-- release them together. These fixtures use the committed seed company because
-- remote dblink sessions cannot see this test transaction's uncommitted rows.
select lives_ok(
  $$select extensions.dblink_connect('race_email_gate', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,
  'email-branch race gate connects'
);
select lives_ok(
  $$select extensions.dblink_connect('race_email_a', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,
  'email-branch first worker connects'
);
select lives_ok(
  $$select extensions.dblink_connect('race_email_b', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,
  'email-branch second worker connects'
);
select is(
  extensions.dblink_exec(
    'race_email_gate',
    $$begin;
      do $remote$
      begin
        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(
            '00000000-0000-4000-8000-000000000001:roof-assessment-property-place:ChIJ-race-email',
            0
          )
        );
      end
      $remote$;$$
  ),
  'DO',
  'email-branch race gate holds the shared property lock'
);
select is(
  extensions.dblink_send_query(
    'race_email_a',
    $$select count(*) from public.start_or_resume_roof_assessment(
      '00000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000011',
      'Email Race A', '+12015551001', 'email-race@example.com',
      '101 Race Alpha Ave, Newark, NJ 07102', 'ChIJ-race-email',
      'all-season-main', 'race:email-a', '{}'::jsonb,
      null, 'all-season-assessment-v1', now(), '127.0.1.11', 'pgtap-race'
    )$$
  ),
  1,
  'first email-branch intake is dispatched asynchronously'
);
select is(
  extensions.dblink_send_query(
    'race_email_b',
    $$select count(*) from public.start_or_resume_roof_assessment(
      '00000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000012',
      'Email Race B', '+12015551002', 'email-race@example.com',
      '999 Different Beta Blvd, Newark, NJ 07102', 'ChIJ-race-email',
      'all-season-main', 'race:email-b', '{}'::jsonb,
      null, 'all-season-assessment-v1', now(), '127.0.1.12', 'pgtap-race'
    )$$
  ),
  1,
  'second email-branch intake is dispatched asynchronously'
);
select is(extensions.dblink_is_busy('race_email_a'), 1, 'first email-branch session waits on the shared property lock');
select is(extensions.dblink_is_busy('race_email_b'), 1, 'second email-branch session waits on the shared property lock');
select is(extensions.dblink_exec('race_email_gate', 'commit'), 'COMMIT', 'email-branch race gate releases both sessions');
create temp table race_email_result_a as
select * from extensions.dblink_get_result('race_email_a') as result(call_count bigint);
create temp table race_email_result_b as
select * from extensions.dblink_get_result('race_email_b') as result(call_count bigint);
select is((select call_count from race_email_result_a), 1::bigint, 'first email-branch race call completes');
select is((select call_count from race_email_result_b), 1::bigint, 'second email-branch race call completes');
select is(
  (select count(distinct assessment_id) from public.roof_assessment_access_attempts where submission_id in (
    'e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000012'
  )),
  1::bigint,
  'concurrent same-email/different-phone calls create one assessment journey'
);
select is(
  (select count(*) from public.leads where external_lead_id in (
    'e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000012'
  )),
  1::bigint,
  'concurrent email-branch calls create one lead graph'
);
select is(
  (select count(*) from public.domain_events where event_name = 'roof/assessment.started' and correlation_id in (
    'e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000012'
  )),
  1::bigint,
  'concurrent email-branch calls emit one started event'
);
select is(
  (select count(*) from public.event_outbox where event_id in (
    select id from public.domain_events where correlation_id in (
      'e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000012'
    )
  )),
  1::bigint,
  'concurrent email-branch calls enqueue one started event'
);
select ok(extensions.dblink_disconnect('race_email_a') = 'OK', 'first email-branch worker disconnects');
select ok(extensions.dblink_disconnect('race_email_b') = 'OK', 'second email-branch worker disconnects');
select ok(extensions.dblink_disconnect('race_email_gate') = 'OK', 'email-branch gate disconnects');

select lives_ok(
  $$select extensions.dblink_connect('race_phone_gate', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,
  'phone-branch race gate connects'
);
select lives_ok(
  $$select extensions.dblink_connect('race_phone_a', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,
  'phone-branch first worker connects'
);
select lives_ok(
  $$select extensions.dblink_connect('race_phone_b', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,
  'phone-branch second worker connects'
);
select is(
  extensions.dblink_exec(
    'race_phone_gate',
    $$begin;
      do $remote$
      begin
        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(
            '00000000-0000-4000-8000-000000000001:roof-assessment-property-place:ChIJ-race-phone',
            0
          )
        );
      end
      $remote$;$$
  ),
  'DO',
  'phone-branch race gate holds the shared property lock'
);
select is(
  extensions.dblink_send_query(
    'race_phone_a',
    $$select count(*) from public.start_or_resume_roof_assessment(
      '00000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000021',
      'Phone Race A', '+12015551003', 'phone-a@example.com',
      '202 Race Gamma Rd, Newark, NJ 07102', 'ChIJ-race-phone',
      'all-season-main', 'race:phone-a', '{}'::jsonb,
      null, 'all-season-assessment-v1', now(), '127.0.1.21', 'pgtap-race'
    )$$
  ),
  1,
  'first phone-branch intake is dispatched asynchronously'
);
select is(
  extensions.dblink_send_query(
    'race_phone_b',
    $$select count(*) from public.start_or_resume_roof_assessment(
      '00000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000022',
      'Phone Race B', '+12015551003', 'phone-b@example.com',
      '808 Different Delta Ln, Newark, NJ 07102', 'ChIJ-race-phone',
      'all-season-main', 'race:phone-b', '{}'::jsonb,
      null, 'all-season-assessment-v1', now(), '127.0.1.22', 'pgtap-race'
    )$$
  ),
  1,
  'second phone-branch intake is dispatched asynchronously'
);
select is(extensions.dblink_is_busy('race_phone_a'), 1, 'first phone-branch session waits on the shared property lock');
select is(extensions.dblink_is_busy('race_phone_b'), 1, 'second phone-branch session waits on the shared property lock');
select is(extensions.dblink_exec('race_phone_gate', 'commit'), 'COMMIT', 'phone-branch race gate releases both sessions');
create temp table race_phone_result_a as
select * from extensions.dblink_get_result('race_phone_a') as result(call_count bigint);
create temp table race_phone_result_b as
select * from extensions.dblink_get_result('race_phone_b') as result(call_count bigint);
select is((select call_count from race_phone_result_a), 1::bigint, 'first phone-branch race call completes');
select is((select call_count from race_phone_result_b), 1::bigint, 'second phone-branch race call completes');
select is(
  (select count(distinct assessment_id) from public.roof_assessment_access_attempts where submission_id in (
    'e0000000-0000-4000-8000-000000000021', 'e0000000-0000-4000-8000-000000000022'
  )),
  1::bigint,
  'concurrent same-phone/different-email calls create one assessment journey'
);
select is(
  (select count(*) from public.leads where external_lead_id in (
    'e0000000-0000-4000-8000-000000000021', 'e0000000-0000-4000-8000-000000000022'
  )),
  1::bigint,
  'concurrent phone-branch calls create one lead graph'
);
select is(
  (select count(*) from public.domain_events where event_name = 'roof/assessment.started' and correlation_id in (
    'e0000000-0000-4000-8000-000000000021', 'e0000000-0000-4000-8000-000000000022'
  )),
  1::bigint,
  'concurrent phone-branch calls emit one started event'
);
select is(
  (select count(*) from public.event_outbox where event_id in (
    select id from public.domain_events where correlation_id in (
      'e0000000-0000-4000-8000-000000000021', 'e0000000-0000-4000-8000-000000000022'
    )
  )),
  1::bigint,
  'concurrent phone-branch calls enqueue one started event'
);
select ok(extensions.dblink_disconnect('race_phone_a') = 'OK', 'first phone-branch worker disconnects');
select ok(extensions.dblink_disconnect('race_phone_b') = 'OK', 'second phone-branch worker disconnects');

select is(
  extensions.dblink_exec(
    'race_phone_gate',
    $$do $cleanup$
    declare
      v_lead_ids uuid[];
      v_property_ids uuid[];
    begin
      select pg_catalog.array_agg(id), pg_catalog.array_agg(property_id)
      into v_lead_ids, v_property_ids
      from public.leads
      where external_lead_id in (
        'e0000000-0000-4000-8000-000000000011',
        'e0000000-0000-4000-8000-000000000012',
        'e0000000-0000-4000-8000-000000000021',
        'e0000000-0000-4000-8000-000000000022'
      );

      delete from public.event_outbox
      where event_id in (
        select id from public.domain_events
        where correlation_id in (
          'e0000000-0000-4000-8000-000000000011',
          'e0000000-0000-4000-8000-000000000012',
          'e0000000-0000-4000-8000-000000000021',
          'e0000000-0000-4000-8000-000000000022'
        )
      );
      delete from public.domain_events
      where correlation_id in (
        'e0000000-0000-4000-8000-000000000011',
        'e0000000-0000-4000-8000-000000000012',
        'e0000000-0000-4000-8000-000000000021',
        'e0000000-0000-4000-8000-000000000022'
      );
      delete from public.roof_assessment_access_attempts
      where submission_id in (
        'e0000000-0000-4000-8000-000000000011',
        'e0000000-0000-4000-8000-000000000012',
        'e0000000-0000-4000-8000-000000000021',
        'e0000000-0000-4000-8000-000000000022'
      );
      delete from public.lead_consent_evidence
      where submission_id in (
        'e0000000-0000-4000-8000-000000000011',
        'e0000000-0000-4000-8000-000000000012',
        'e0000000-0000-4000-8000-000000000021',
        'e0000000-0000-4000-8000-000000000022'
      );
      delete from public.lead_attribution_touches
      where submission_id in (
        'e0000000-0000-4000-8000-000000000011',
        'e0000000-0000-4000-8000-000000000012',
        'e0000000-0000-4000-8000-000000000021',
        'e0000000-0000-4000-8000-000000000022'
      );
      delete from public.roof_assessments where lead_id = any(v_lead_ids);
      delete from public.roof_estimates where lead_id = any(v_lead_ids);
      delete from public.pipeline_runs where lead_id = any(v_lead_ids);
      delete from public.lead_consents where lead_id = any(v_lead_ids);
      delete from public.leads where id = any(v_lead_ids);
      delete from public.properties where id = any(v_property_ids);
    end
    $cleanup$;$$
  ),
  'DO',
  'concurrency fixtures are removed from the committed test database'
);
select ok(extensions.dblink_disconnect('race_phone_gate') = 'OK', 'phone-branch gate disconnects');

-- Real two-session authorization race. The helper converts the expected
-- loser exception to false so both asynchronous results remain assertable.
select lives_ok(
  $$select extensions.dblink_connect('resume_race_gate', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,
  'same-browser race gate connects'
);
select lives_ok(
  $$select extensions.dblink_connect('resume_race_a', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,
  'same-browser first worker connects'
);
select lives_ok(
  $$select extensions.dblink_connect('resume_race_b', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,
  'same-browser second worker connects'
);
select is(
  extensions.dblink_exec(
    'resume_race_gate',
    $$do $setup$
    declare
      v_new record;
    begin
      select * into v_new from public.start_or_resume_roof_assessment(
        '00000000-0000-4000-8000-000000000001',
        'e0000000-0000-4000-8000-000000000031',
        'Resume Race', '+12015551031', 'resume-race@example.com',
        '303 Resume Race Way, Newark, NJ 07102', 'ChIJ-resume-race',
        'all-season-main', 'race:resume-new', '{}'::jsonb,
        null, 'all-season-assessment-v1', now(), '127.0.1.31', 'pgtap-race'
      );
      update public.roof_assessments
      set status = 'abandoned', abandoned_at = now(), updated_at = now()
      where id = (
        select assessment_id from public.roof_assessment_access_attempts
        where id = v_new.attempt_id
      );
      perform public.start_or_resume_roof_assessment(
        '00000000-0000-4000-8000-000000000001',
        'e0000000-0000-4000-8000-000000000032',
        'Resume Race', '+12015551031', 'resume-race@example.com',
        '303 Resume Race Way, Newark, NJ 07102', 'ChIJ-resume-race',
        'seasonal-shield', 'race:resume-candidate', '{}'::jsonb,
        null, 'all-season-assessment-v1', now(), '127.0.1.32', 'pgtap-race'
      );
      execute $function$
        create function public.pgtap_try_same_browser_resume(
          p_attempt_id uuid, p_assessment_id uuid, p_hash bytea
        ) returns boolean
        language plpgsql
        set search_path = ''
        as $body$
        begin
          perform public.authorize_same_browser_roof_assessment_resume(
            '00000000-0000-4000-8000-000000000001',
            p_attempt_id, p_assessment_id, p_hash
          );
          return true;
        exception when others then
          return false;
        end;
        $body$
      $function$;
    end
    $setup$;$$
  ),
  'DO',
  'same-browser race fixtures are committed'
);
create temp table resume_race_before as
select estimate.public_token
from public.roof_assessment_access_attempts as attempt
join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
where attempt.submission_id = 'e0000000-0000-4000-8000-000000000032';
select is(
  extensions.dblink_exec(
    'resume_race_gate',
    $$begin;
      do $lock$
      begin
        perform 1 from public.roof_assessment_access_attempts
        where submission_id = 'e0000000-0000-4000-8000-000000000032'
        for update;
      end
      $lock$;$$
  ),
  'DO',
  'same-browser race gate locks the exact candidate'
);
select is(
  extensions.dblink_send_query(
    'resume_race_a',
    $$select public.pgtap_try_same_browser_resume(
      attempt.id, attempt.assessment_id, attempt.continuation_secret_hash
    )
    from public.roof_assessment_access_attempts as attempt
    where attempt.submission_id = 'e0000000-0000-4000-8000-000000000032'$$
  ),
  1,
  'first same-browser authorization is dispatched'
);
select is(
  extensions.dblink_send_query(
    'resume_race_b',
    $$select public.pgtap_try_same_browser_resume(
      attempt.id, attempt.assessment_id, attempt.continuation_secret_hash
    )
    from public.roof_assessment_access_attempts as attempt
    where attempt.submission_id = 'e0000000-0000-4000-8000-000000000032'$$
  ),
  1,
  'second same-browser authorization is dispatched'
);
select is(extensions.dblink_is_busy('resume_race_a'), 1, 'first authorization waits on the exact attempt lock');
select is(extensions.dblink_is_busy('resume_race_b'), 1, 'second authorization waits on the exact attempt lock');
select is(extensions.dblink_exec('resume_race_gate', 'commit'), 'COMMIT', 'same-browser gate releases both workers');
create temp table resume_race_result_a as
select * from extensions.dblink_get_result('resume_race_a') as result(succeeded boolean);
create temp table resume_race_result_b as
select * from extensions.dblink_get_result('resume_race_b') as result(succeeded boolean);
select is(
  (select count(*) from (
    select succeeded from resume_race_result_a
    union all
    select succeeded from resume_race_result_b
  ) as results where succeeded),
  1::bigint,
  'exactly one concurrent same-browser authorization wins'
);
select is(
  (select count(*) from (
    select succeeded from resume_race_result_a
    union all
    select succeeded from resume_race_result_b
  ) as results where not succeeded),
  1::bigint,
  'the concurrent replay loses without a result'
);
select isnt(
  (select estimate.public_token
   from public.roof_assessment_access_attempts as attempt
   join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
   where attempt.submission_id = 'e0000000-0000-4000-8000-000000000032'),
  (select public_token from resume_race_before),
  'the concurrent winner rotates the token once'
);
select ok(
  (select attempt.verified_at = attempt.token_rotated_at
          and attempt.consumed_at = attempt.token_rotated_at
          and attempt.updated_at = attempt.token_rotated_at
          and assessment.updated_at = attempt.token_rotated_at
          and estimate.updated_at = attempt.token_rotated_at
   from public.roof_assessment_access_attempts as attempt
   join public.roof_assessments as assessment on assessment.id = attempt.assessment_id
   join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
   where attempt.submission_id = 'e0000000-0000-4000-8000-000000000032'),
  'the concurrent loser cannot add a second mutation after the atomic winner'
);
select ok(extensions.dblink_disconnect('resume_race_a') = 'OK', 'first same-browser worker disconnects');
select ok(extensions.dblink_disconnect('resume_race_b') = 'OK', 'second same-browser worker disconnects');
select is(
  extensions.dblink_exec(
    'resume_race_gate',
    $$do $cleanup$
    declare
      v_lead_id uuid;
      v_property_id uuid;
      v_assessment_id uuid;
    begin
      select lead_id, property_id, assessment_id into v_lead_id, v_property_id, v_assessment_id
      from public.roof_assessment_access_attempts
      where submission_id = 'e0000000-0000-4000-8000-000000000031';
      delete from public.event_outbox where event_id in (
        select id from public.domain_events
        where correlation_id in (
          'e0000000-0000-4000-8000-000000000031',
          'e0000000-0000-4000-8000-000000000032', v_assessment_id
        )
      );
      delete from public.domain_events where correlation_id in (
        'e0000000-0000-4000-8000-000000000031',
        'e0000000-0000-4000-8000-000000000032', v_assessment_id
      );
      delete from public.roof_assessment_access_attempts where submission_id in (
        'e0000000-0000-4000-8000-000000000031',
        'e0000000-0000-4000-8000-000000000032'
      );
      delete from public.lead_consent_evidence where submission_id in (
        'e0000000-0000-4000-8000-000000000031',
        'e0000000-0000-4000-8000-000000000032'
      );
      delete from public.lead_attribution_touches where submission_id in (
        'e0000000-0000-4000-8000-000000000031',
        'e0000000-0000-4000-8000-000000000032'
      );
      delete from public.roof_assessments where lead_id = v_lead_id;
      delete from public.roof_estimates where lead_id = v_lead_id;
      delete from public.pipeline_runs where lead_id = v_lead_id;
      delete from public.lead_consents where lead_id = v_lead_id;
      delete from public.leads where id = v_lead_id;
      delete from public.properties where id = v_property_id;
      drop function public.pgtap_try_same_browser_resume(uuid, uuid, bytea);
    end
    $cleanup$;$$
  ),
  'DO',
  'same-browser concurrency fixtures are removed'
);
select ok(extensions.dblink_disconnect('resume_race_gate') = 'OK', 'same-browser gate disconnects');

-- Real reservation races prove the phone and IP advisory buckets serialize
-- different attempts, rather than relying on one candidate row lock.
select lives_ok(
  $$select extensions.dblink_connect('verification_reserve_gate', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,
  'verification reservation race gate connects'
);
select lives_ok(
  $$select extensions.dblink_connect('verification_reserve_a', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,
  'verification reservation first worker connects'
);
select lives_ok(
  $$select extensions.dblink_connect('verification_reserve_b', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,
  'verification reservation second worker connects'
);
select is(
  extensions.dblink_exec('verification_reserve_gate', $$do $setup$
  declare
    v_new record;
    v_resume record;
  begin
    select * into v_new from public.start_or_resume_roof_assessment(
      '00000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000051',
      'Reservation Race', '+12015551051', 'reservation-race@example.com',
      '505 Reservation Race Way, Newark, NJ 07102', 'ChIJ-reservation-race',
      'all-season-main', 'race:reservation-new', '{}'::jsonb,
      null, 'all-season-assessment-v1', now(), '127.0.1.51', 'pgtap-race'
    );
    update public.roof_assessments set status = 'abandoned', abandoned_at = now()
    where id = (select assessment_id from public.roof_assessment_access_attempts where id = v_new.attempt_id);
    select * into v_resume from public.start_or_resume_roof_assessment(
      '00000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000052',
      'Reservation Race', '+12015551051', 'reservation-race@example.com',
      '505 Reservation Race Way, Newark, NJ 07102', 'ChIJ-reservation-race',
      'all-season-main', 'race:reservation-candidate', '{}'::jsonb,
      null, 'all-season-assessment-v1', now(), '127.0.1.52', 'pgtap-race'
    );
    insert into public.roof_assessment_access_attempts (
      id, company_id, submission_id, lead_id, property_id, estimate_id, assessment_id,
      attempt_kind, continuation_secret_hash, destination_phone_e164,
      requested_presentation_key, requested_entry_point, request_ip, expires_at
    )
    select clone.id, source.company_id, clone.submission_id, source.lead_id,
           source.property_id, source.estimate_id, source.assessment_id,
           'resume_candidate', extensions.digest(clone.id::text, 'sha256'),
           clone.phone, source.requested_presentation_key, source.requested_entry_point,
           clone.ip, now() + interval '15 minutes'
    from public.roof_assessment_access_attempts as source
    cross join (values
      ('a5000000-0000-4000-8000-000000000053'::uuid, 'e0000000-0000-4000-8000-000000000053'::uuid, '+12015551051', '127.0.1.53'::inet),
      ('a5000000-0000-4000-8000-000000000054'::uuid, 'e0000000-0000-4000-8000-000000000054'::uuid, '+12015551054', '127.0.1.99'::inet),
      ('a5000000-0000-4000-8000-000000000055'::uuid, 'e0000000-0000-4000-8000-000000000055'::uuid, '+12015551055', '127.0.1.99'::inet)
    ) as clone(id, submission_id, phone, ip)
    where source.id = v_resume.attempt_id;
    insert into public.roof_assessment_verification_sends (
      company_id, attempt_id, destination_phone_e164, request_ip, reserved_at
    )
    select attempt.company_id, attempt.id, attempt.destination_phone_e164,
           '127.0.1.99'::inet, now() - series.ordinal * interval '5 minutes'
    from pg_catalog.generate_series(1, 4) as series(ordinal)
    join public.roof_assessment_access_attempts as attempt
      on attempt.id = 'a5000000-0000-4000-8000-000000000054';
    execute $function$
      create function public.pgtap_try_verification_reservation(p_attempt_id uuid, p_ip inet)
      returns boolean language plpgsql set search_path = '' as $body$
      begin
        perform public.reserve_roof_assessment_verification_start(p_attempt_id, p_ip);
        return true;
      exception when others then return false;
      end;
      $body$
    $function$;
  end $setup$;$$),
  'DO',
  'verification reservation race fixtures are committed'
);
select is(
  extensions.dblink_exec('verification_reserve_gate', $$begin; do $lock$ begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'roof-verification-phone:00000000-0000-4000-8000-000000000001:+12015551051', 0
    )); end $lock$;$$),
  'DO',
  'phone reservation gate locks the shared destination bucket'
);
select is(extensions.dblink_send_query('verification_reserve_a', $$select public.pgtap_try_verification_reservation(
  (select id from public.roof_assessment_access_attempts where submission_id = 'e0000000-0000-4000-8000-000000000052'), '127.0.1.52')$$), 1, 'first same-phone reservation is dispatched');
select is(extensions.dblink_send_query('verification_reserve_b', $$select public.pgtap_try_verification_reservation(
  'a5000000-0000-4000-8000-000000000053', '127.0.1.53')$$), 1, 'second same-phone reservation is dispatched');
select is(extensions.dblink_is_busy('verification_reserve_a'), 1, 'first same-phone worker waits on the bucket');
select is(extensions.dblink_is_busy('verification_reserve_b'), 1, 'second same-phone worker waits on the bucket');
select is(extensions.dblink_exec('verification_reserve_gate', 'commit'), 'COMMIT', 'phone bucket gate releases both workers');
create temp table reserve_phone_result_a as select * from extensions.dblink_get_result('verification_reserve_a') as result(succeeded boolean);
create temp table reserve_phone_result_b as select * from extensions.dblink_get_result('verification_reserve_b') as result(succeeded boolean);
select is((select count(*) from (select succeeded from reserve_phone_result_a union all select succeeded from reserve_phone_result_b) results where succeeded), 1::bigint, 'same-phone race has exactly one reservation winner');
select is((select count(*) from public.roof_assessment_verification_sends where destination_phone_e164 = '+12015551051'), 1::bigint, 'same-phone race records one evidence row');
select ok(extensions.dblink_disconnect('verification_reserve_a') = 'OK', 'phone-race first worker disconnects');
select ok(extensions.dblink_disconnect('verification_reserve_b') = 'OK', 'phone-race second worker disconnects');
select lives_ok(
  $$select extensions.dblink_connect('verification_reserve_a', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,
  'IP-race first worker reconnects'
);
select lives_ok(
  $$select extensions.dblink_connect('verification_reserve_b', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,
  'IP-race second worker reconnects'
);

select is(
  extensions.dblink_exec('verification_reserve_gate', $$begin; do $lock$ begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'roof-verification-ip:00000000-0000-4000-8000-000000000001:127.0.1.99', 0
    )); end $lock$;$$),
  'DO',
  'IP reservation gate locks the shared request bucket'
);
select is(extensions.dblink_send_query('verification_reserve_a', $$select public.pgtap_try_verification_reservation(
  'a5000000-0000-4000-8000-000000000054', '127.0.1.99')$$), 1, 'first fifth-slot IP reservation is dispatched');
select is(extensions.dblink_send_query('verification_reserve_b', $$select public.pgtap_try_verification_reservation(
  'a5000000-0000-4000-8000-000000000055', '127.0.1.99')$$), 1, 'second fifth-slot IP reservation is dispatched');
select is(extensions.dblink_is_busy('verification_reserve_a'), 1, 'first shared-IP worker waits on the bucket');
select is(extensions.dblink_is_busy('verification_reserve_b'), 1, 'second shared-IP worker waits on the bucket');
select is(extensions.dblink_exec('verification_reserve_gate', 'commit'), 'COMMIT', 'IP bucket gate releases both workers');
create temp table reserve_ip_result_a as select * from extensions.dblink_get_result('verification_reserve_a') as result(succeeded boolean);
create temp table reserve_ip_result_b as select * from extensions.dblink_get_result('verification_reserve_b') as result(succeeded boolean);
select is((select count(*) from (select succeeded from reserve_ip_result_a union all select succeeded from reserve_ip_result_b) results where succeeded), 1::bigint, 'shared-IP fifth-slot race has exactly one winner');
select is((select count(*) from public.roof_assessment_verification_sends where request_ip = '127.0.1.99'), 5::bigint, 'shared-IP race stops at five hourly reservations');
select ok(extensions.dblink_disconnect('verification_reserve_a') = 'OK', 'first reservation worker disconnects');
select ok(extensions.dblink_disconnect('verification_reserve_b') = 'OK', 'second reservation worker disconnects');
select is(extensions.dblink_exec('verification_reserve_gate', $$do $cleanup$
declare v_lead uuid; v_property uuid;
begin
  select lead_id, property_id into v_lead, v_property from public.roof_assessment_access_attempts
  where submission_id = 'e0000000-0000-4000-8000-000000000051';
  delete from public.event_outbox where event_id in (select id from public.domain_events where correlation_id in ('e0000000-0000-4000-8000-000000000051','e0000000-0000-4000-8000-000000000052'));
  delete from public.domain_events where correlation_id in ('e0000000-0000-4000-8000-000000000051','e0000000-0000-4000-8000-000000000052');
  delete from public.roof_assessment_verification_sends where attempt_id in (select id from public.roof_assessment_access_attempts where lead_id = v_lead);
  delete from public.roof_assessment_access_attempts where lead_id = v_lead;
  delete from public.lead_consent_evidence where submission_id in ('e0000000-0000-4000-8000-000000000051','e0000000-0000-4000-8000-000000000052');
  delete from public.lead_attribution_touches where submission_id in ('e0000000-0000-4000-8000-000000000051','e0000000-0000-4000-8000-000000000052');
  delete from public.roof_assessments where lead_id = v_lead;
  delete from public.roof_estimates where lead_id = v_lead;
  delete from public.pipeline_runs where lead_id = v_lead;
  delete from public.lead_consents where lead_id = v_lead;
  delete from public.leads where id = v_lead;
  delete from public.properties where id = v_property;
  drop function public.pgtap_try_verification_reservation(uuid, inet);
end $cleanup$;$$), 'DO', 'verification reservation race fixtures are removed');
select ok(extensions.dblink_disconnect('verification_reserve_gate') = 'OK', 'verification reservation race gate disconnects');

-- Real two-session Twilio approval race. Both workers observe the same
-- provider-approved artifact; the exact candidate row lock permits one winner.
select lives_ok(
  $$select extensions.dblink_connect('verification_race_gate', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,
  'verified resume race gate connects'
);
select lives_ok(
  $$select extensions.dblink_connect('verification_race_a', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,
  'verified resume first worker connects'
);
select lives_ok(
  $$select extensions.dblink_connect('verification_race_b', 'host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,
  'verified resume second worker connects'
);
select is(
  extensions.dblink_exec(
    'verification_race_gate',
    $$do $setup$
    declare
      v_new record;
      v_resume record;
      v_reservation record;
    begin
      select * into v_new from public.start_or_resume_roof_assessment(
        '00000000-0000-4000-8000-000000000001',
        'e0000000-0000-4000-8000-000000000041',
        'Verified Race', '+12015551041', 'verified-race@example.com',
        '404 Verified Race Way, Newark, NJ 07102', 'ChIJ-verified-race',
        'all-season-main', 'race:verified-new', '{}'::jsonb,
        null, 'all-season-assessment-v1', now(), '127.0.1.41', 'pgtap-race'
      );
      update public.roof_assessments
      set status = 'abandoned', abandoned_at = now(), updated_at = now()
      where id = (
        select assessment_id from public.roof_assessment_access_attempts
        where id = v_new.attempt_id
      );
      select * into v_resume from public.start_or_resume_roof_assessment(
        '00000000-0000-4000-8000-000000000001',
        'e0000000-0000-4000-8000-000000000042',
        'Verified Race', '+12015551041', 'verified-race@example.com',
        '404 Verified Race Way, Newark, NJ 07102', 'ChIJ-verified-race',
        'seasonal-shield', 'race:verified-candidate', '{}'::jsonb,
        null, 'all-season-assessment-v1', now(), '127.0.1.42', 'pgtap-race'
      );
      select * into v_reservation
      from public.reserve_roof_assessment_verification_start(
        v_resume.attempt_id, '127.0.1.42'
      );
      perform public.record_roof_assessment_verification_start(
        v_reservation.company_id, v_resume.attempt_id, v_reservation.reservation_id,
        'VEcccccccccccccccccccccccccccccccc'
      );
      execute $function$
        create function public.pgtap_try_verified_resume(p_attempt_id uuid)
        returns boolean
        language plpgsql
        set search_path = ''
        as $body$
        begin
          perform public.approve_verified_roof_assessment_resume(
            '00000000-0000-4000-8000-000000000001',
            p_attempt_id, 'VEcccccccccccccccccccccccccccccccc'
          );
          return true;
        exception when others then
          return false;
        end;
        $body$
      $function$;
    end
    $setup$;$$
  ),
  'DO',
  'verified resume race fixtures are committed'
);
create temp table verification_race_before as
select estimate.public_token
from public.roof_assessment_access_attempts as attempt
join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
where attempt.submission_id = 'e0000000-0000-4000-8000-000000000042';
select is(
  extensions.dblink_exec(
    'verification_race_gate',
    $$begin;
      do $lock$
      begin
        perform 1 from public.roof_assessment_access_attempts
        where submission_id = 'e0000000-0000-4000-8000-000000000042'
        for update;
      end
      $lock$;$$
  ),
  'DO',
  'verified resume race gate locks the exact candidate'
);
select is(
  extensions.dblink_send_query(
    'verification_race_a',
    $$select public.pgtap_try_verified_resume(attempt.id)
      from public.roof_assessment_access_attempts as attempt
      where attempt.submission_id = 'e0000000-0000-4000-8000-000000000042'$$
  ),
  1,
  'first verified approval is dispatched'
);
select is(
  extensions.dblink_send_query(
    'verification_race_b',
    $$select public.pgtap_try_verified_resume(attempt.id)
      from public.roof_assessment_access_attempts as attempt
      where attempt.submission_id = 'e0000000-0000-4000-8000-000000000042'$$
  ),
  1,
  'second verified approval is dispatched'
);
select is(extensions.dblink_is_busy('verification_race_a'), 1, 'first verified approval waits on the candidate lock');
select is(extensions.dblink_is_busy('verification_race_b'), 1, 'second verified approval waits on the candidate lock');
select is(extensions.dblink_exec('verification_race_gate', 'commit'), 'COMMIT', 'verified resume gate releases both workers');
create temp table verification_race_result_a as
select * from extensions.dblink_get_result('verification_race_a') as result(succeeded boolean);
create temp table verification_race_result_b as
select * from extensions.dblink_get_result('verification_race_b') as result(succeeded boolean);
select is(
  (select count(*) from (
    select succeeded from verification_race_result_a
    union all
    select succeeded from verification_race_result_b
  ) as results where succeeded),
  1::bigint,
  'exactly one concurrent verified approval wins'
);
select is(
  (select count(*) from (
    select succeeded from verification_race_result_a
    union all
    select succeeded from verification_race_result_b
  ) as results where not succeeded),
  1::bigint,
  'the concurrent verified approval replay loses'
);
select isnt(
  (select estimate.public_token
   from public.roof_assessment_access_attempts as attempt
   join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
   where attempt.submission_id = 'e0000000-0000-4000-8000-000000000042'),
  (select public_token from verification_race_before),
  'the verified approval race rotates the token once'
);
select ok(
  (select attempt.verified_at = attempt.token_rotated_at
          and attempt.consumed_at = attempt.token_rotated_at
          and send.provider_status = 'approved'
          and send.approved_at = attempt.token_rotated_at
   from public.roof_assessment_access_attempts as attempt
   join public.roof_assessment_verification_sends as send
     on send.attempt_id = attempt.id and send.company_id = attempt.company_id
   where attempt.submission_id = 'e0000000-0000-4000-8000-000000000042'),
  'the concurrent loser cannot add a second verification or token mutation'
);
select ok(extensions.dblink_disconnect('verification_race_a') = 'OK', 'first verified worker disconnects');
select ok(extensions.dblink_disconnect('verification_race_b') = 'OK', 'second verified worker disconnects');
select is(
  extensions.dblink_exec(
    'verification_race_gate',
    $$do $cleanup$
    declare
      v_lead_id uuid;
      v_property_id uuid;
      v_assessment_id uuid;
    begin
      select lead_id, property_id, assessment_id into v_lead_id, v_property_id, v_assessment_id
      from public.roof_assessment_access_attempts
      where submission_id = 'e0000000-0000-4000-8000-000000000041';
      delete from public.event_outbox where event_id in (
        select id from public.domain_events
        where correlation_id in (
          'e0000000-0000-4000-8000-000000000041',
          'e0000000-0000-4000-8000-000000000042', v_assessment_id
        )
      );
      delete from public.domain_events where correlation_id in (
        'e0000000-0000-4000-8000-000000000041',
        'e0000000-0000-4000-8000-000000000042', v_assessment_id
      );
      delete from public.roof_assessment_verification_sends where attempt_id in (
        select id from public.roof_assessment_access_attempts where submission_id in (
          'e0000000-0000-4000-8000-000000000041',
          'e0000000-0000-4000-8000-000000000042'
        )
      );
      delete from public.roof_assessment_access_attempts where submission_id in (
        'e0000000-0000-4000-8000-000000000041',
        'e0000000-0000-4000-8000-000000000042'
      );
      delete from public.lead_consent_evidence where submission_id in (
        'e0000000-0000-4000-8000-000000000041',
        'e0000000-0000-4000-8000-000000000042'
      );
      delete from public.lead_attribution_touches where submission_id in (
        'e0000000-0000-4000-8000-000000000041',
        'e0000000-0000-4000-8000-000000000042'
      );
      delete from public.roof_assessments where lead_id = v_lead_id;
      delete from public.roof_estimates where lead_id = v_lead_id;
      delete from public.pipeline_runs where lead_id = v_lead_id;
      delete from public.lead_consents where lead_id = v_lead_id;
      delete from public.leads where id = v_lead_id;
      delete from public.properties where id = v_property_id;
      drop function public.pgtap_try_verified_resume(uuid);
    end
    $cleanup$;$$
  ),
  'DO',
  'verified resume concurrency fixtures are removed'
);
select ok(extensions.dblink_disconnect('verification_race_gate') = 'OK', 'verified resume gate disconnects');

select lives_ok($$select extensions.dblink_connect('abandonment_race_gate','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,'abandonment race gate connects');
select lives_ok($$select extensions.dblink_connect('abandonment_race_a','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,'first abandonment worker connects');
select lives_ok($$select extensions.dblink_connect('abandonment_race_b','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,'second abandonment worker connects');
select is(extensions.dblink_exec('abandonment_race_gate',$$insert into public.companies(id,name) values('f7000000-0000-4000-8000-000000000001','Abandonment Race Company'); do $remote$ declare v record; begin select * into v from public.start_or_resume_roof_assessment('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000002','Race Homeowner','+12015550700','race-abandon@example.com','700 Race St, Newark, NJ 07102','ChIJ-abandon-race','all-season-main','main-home','{}'::jsonb,null,'all-season-assessment-v1',clock_timestamp(),'127.7.0.1','pgtap'); update public.roof_assessments set updated_at=clock_timestamp()-interval '25 hours' where id=(select assessment_id from public.roof_assessment_access_attempts where id=v.attempt_id); end $remote$;$$),'DO','committed abandonment race fixture is prepared');
select is(extensions.dblink_send_query('abandonment_race_a',$$select count(*)::bigint from public.abandon_inactive_roof_assessments(1)$$),1,'first abandonment worker is dispatched');
select is(extensions.dblink_send_query('abandonment_race_b',$$select count(*)::bigint from public.abandon_inactive_roof_assessments(1)$$),1,'second abandonment worker is dispatched');
create temp table abandonment_race_results(result bigint);
insert into abandonment_race_results select result from extensions.dblink_get_result('abandonment_race_a') as row(result bigint);
insert into abandonment_race_results select result from extensions.dblink_get_result('abandonment_race_b') as row(result bigint);
select is((select sum(result) from abandonment_race_results),1::numeric,'concurrent abandonment workers claim the assessment exactly once');
select is((select count(*) from public.domain_events where company_id='f7000000-0000-4000-8000-000000000001' and event_name='roof/assessment.abandoned'),1::bigint,'concurrent abandonment creates one event');
select is(extensions.dblink_exec('abandonment_race_gate',$$do $cleanup$ begin delete from public.event_outbox where event_id in(select id from public.domain_events where company_id='f7000000-0000-4000-8000-000000000001'); delete from public.domain_events where company_id='f7000000-0000-4000-8000-000000000001'; delete from public.roof_assessment_access_attempts where company_id='f7000000-0000-4000-8000-000000000001'; delete from public.lead_consent_evidence where company_id='f7000000-0000-4000-8000-000000000001'; delete from public.lead_attribution_touches where company_id='f7000000-0000-4000-8000-000000000001'; delete from public.roof_assessments where company_id='f7000000-0000-4000-8000-000000000001'; delete from public.roof_estimates where company_id='f7000000-0000-4000-8000-000000000001'; delete from public.pipeline_runs where company_id='f7000000-0000-4000-8000-000000000001'; delete from public.lead_consents where company_id='f7000000-0000-4000-8000-000000000001'; delete from public.leads where company_id='f7000000-0000-4000-8000-000000000001'; delete from public.properties where company_id='f7000000-0000-4000-8000-000000000001'; delete from public.companies where id='f7000000-0000-4000-8000-000000000001'; end $cleanup$;$$),'DO','abandonment race fixtures are removed');
select ok(extensions.dblink_disconnect('abandonment_race_a')='OK','first abandonment worker disconnects');
select ok(extensions.dblink_disconnect('abandonment_race_b')='OK','second abandonment worker disconnects');
select ok(extensions.dblink_disconnect('abandonment_race_gate')='OK','abandonment race gate disconnects');

select lives_ok($$select extensions.dblink_connect('progress_race_gate','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,'progress race gate connects');
select lives_ok($$select extensions.dblink_connect('progress_race_a','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,'first progress writer connects');
select lives_ok($$select extensions.dblink_connect('progress_race_b','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,'second progress writer connects');
select is(extensions.dblink_exec('progress_race_gate',$$insert into public.companies(id,name) values('f7100000-0000-4000-8000-000000000001','Progress Race Company'); do $remote$ declare v record; begin select * into v from public.start_or_resume_roof_assessment('f7100000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000002','Progress Homeowner','+12015550710','race-progress@example.com','710 Race St, Newark, NJ 07102','ChIJ-progress-race','all-season-main','main-home','{}'::jsonb,null,'all-season-assessment-v1',clock_timestamp(),'127.7.1.1','pgtap'); end $remote$;$$),'DO','committed progress race fixture is prepared');
select is(extensions.dblink_send_query('progress_race_a',$$select applied from public.save_roof_assessment_progress('f7100000-0000-4000-8000-000000000001',(select id from public.roof_assessments where company_id='f7100000-0000-4000-8000-000000000001'),0,1,null,'{"reason":"known_replacement"}'::jsonb,'{"reason":"known_replacement"}'::jsonb,'{"need":4,"intent":3,"urgency":0,"propertyFit":0,"engagement":0}'::jsonb,true)$$),1,'first progress writer is dispatched');
select is(extensions.dblink_send_query('progress_race_b',$$select applied from public.save_roof_assessment_progress('f7100000-0000-4000-8000-000000000001',(select id from public.roof_assessments where company_id='f7100000-0000-4000-8000-000000000001'),0,2,null,'{"roofAge":"20_plus"}'::jsonb,'{"roofAge":"20_plus"}'::jsonb,'{"need":6,"intent":0,"urgency":0,"propertyFit":0,"engagement":1}'::jsonb,false)$$),1,'second progress writer is dispatched');
create temp table progress_race_results(applied boolean);
insert into progress_race_results select applied from extensions.dblink_get_result('progress_race_a') as row(applied boolean);
insert into progress_race_results select applied from extensions.dblink_get_result('progress_race_b') as row(applied boolean);
select is((select count(*) from progress_race_results where applied),1::bigint,'exactly one concurrent writer wins revision zero');
select results_eq(
  $$select revision,current_step,responses from public.roof_assessments where company_id='f7100000-0000-4000-8000-000000000001'$$,
  $$values (1::bigint,1,'{"reason":"known_replacement"}'::jsonb)$$,
  'the concurrent future-step writer cannot beat or erase the valid next step'
);
select is((select scores->>'intent' from public.roof_assessments where company_id='f7100000-0000-4000-8000-000000000001'),'3','scores belong to the valid next-step CAS winner');
select is((select count(*) from public.domain_events where company_id='f7100000-0000-4000-8000-000000000001' and event_name='roof/assessment.high_intent'),1::bigint,'the rejected concurrent jump emits no event');
select is(extensions.dblink_exec('progress_race_gate',$$do $cleanup$ begin delete from public.event_outbox where event_id in(select id from public.domain_events where company_id='f7100000-0000-4000-8000-000000000001'); delete from public.domain_events where company_id='f7100000-0000-4000-8000-000000000001'; delete from public.roof_assessment_access_attempts where company_id='f7100000-0000-4000-8000-000000000001'; delete from public.lead_consent_evidence where company_id='f7100000-0000-4000-8000-000000000001'; delete from public.lead_attribution_touches where company_id='f7100000-0000-4000-8000-000000000001'; delete from public.roof_assessments where company_id='f7100000-0000-4000-8000-000000000001'; delete from public.roof_estimates where company_id='f7100000-0000-4000-8000-000000000001'; delete from public.pipeline_runs where company_id='f7100000-0000-4000-8000-000000000001'; delete from public.lead_consents where company_id='f7100000-0000-4000-8000-000000000001'; delete from public.leads where company_id='f7100000-0000-4000-8000-000000000001'; delete from public.properties where company_id='f7100000-0000-4000-8000-000000000001'; delete from public.companies where id='f7100000-0000-4000-8000-000000000001'; end $cleanup$;$$),'DO','progress race fixtures are removed');
select ok(extensions.dblink_disconnect('progress_race_a')='OK','first progress writer disconnects');
select ok(extensions.dblink_disconnect('progress_race_b')='OK','second progress writer disconnects');
select ok(extensions.dblink_disconnect('progress_race_gate')='OK','progress race gate disconnects');

select lives_ok($$select extensions.dblink_connect('result_view_race_gate','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,'result-view race gate connects');
select lives_ok($$select extensions.dblink_connect('result_view_race_a','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,'first result-view worker connects');
select lives_ok($$select extensions.dblink_connect('result_view_race_b','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres')$$,'second result-view worker connects');
select is(extensions.dblink_exec('result_view_race_gate',$$insert into public.companies(id,name) values('f7200000-0000-4000-8000-000000000001','Result View Race Company'); do $remote$ declare v record; begin select * into v from public.start_or_resume_roof_assessment('f7200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000002','Result Homeowner','+12015550720','race-result@example.com','720 Race St, Newark, NJ 07102','ChIJ-result-race','all-season-main','main-home','{}'::jsonb,null,'all-season-assessment-v1',clock_timestamp(),'127.7.2.1','pgtap'); update public.roof_assessments set status='completed',recommendation='professional_inspection',completed_at=clock_timestamp() where id=(select assessment_id from public.roof_assessment_access_attempts where id=v.attempt_id); end $remote$;$$),'DO','committed result-view fixture is prepared');
select is(extensions.dblink_exec('result_view_race_gate',$$begin; do $lock$ begin perform 1 from public.roof_assessments where company_id='f7200000-0000-4000-8000-000000000001' for update; end $lock$;$$),'DO','result-view race gate locks the completed assessment');
select is(extensions.dblink_send_query('result_view_race_a',$$select result_viewed_at from public.mark_roof_assessment_result_viewed('f7200000-0000-4000-8000-000000000001',(select id from public.roof_assessments where company_id='f7200000-0000-4000-8000-000000000001'),(select id from public.roof_estimates where company_id='f7200000-0000-4000-8000-000000000001'))$$),1,'first result-view worker is dispatched');
select is(extensions.dblink_send_query('result_view_race_b',$$select result_viewed_at from public.mark_roof_assessment_result_viewed('f7200000-0000-4000-8000-000000000001',(select id from public.roof_assessments where company_id='f7200000-0000-4000-8000-000000000001'),(select id from public.roof_estimates where company_id='f7200000-0000-4000-8000-000000000001'))$$),1,'second result-view worker is dispatched');
select is(extensions.dblink_is_busy('result_view_race_a'),1,'first result-view worker waits on the assessment lock');
select is(extensions.dblink_is_busy('result_view_race_b'),1,'second result-view worker waits on the assessment lock');
select is(extensions.dblink_exec('result_view_race_gate','commit'),'COMMIT','result-view gate releases both workers');
create temp table result_view_race_results(result_viewed_at timestamptz);
insert into result_view_race_results select result_viewed_at from extensions.dblink_get_result('result_view_race_a') as row(result_viewed_at timestamptz);
insert into result_view_race_results select result_viewed_at from extensions.dblink_get_result('result_view_race_b') as row(result_viewed_at timestamptz);
select is((select count(distinct result_viewed_at) from result_view_race_results),1::bigint,'concurrent result views return one canonical timestamp');
select is((select count(*) from public.domain_events where company_id='f7200000-0000-4000-8000-000000000001' and event_name='roof/assessment.result_viewed'),1::bigint,'concurrent result views create one event');
select is((select count(*) from public.event_outbox outbox join public.domain_events event on event.id=outbox.event_id where event.company_id='f7200000-0000-4000-8000-000000000001' and event.event_name='roof/assessment.result_viewed'),1::bigint,'concurrent result views enqueue one outbox row');
select is(extensions.dblink_exec('result_view_race_gate',$$do $cleanup$ begin delete from public.event_outbox where event_id in(select id from public.domain_events where company_id='f7200000-0000-4000-8000-000000000001'); delete from public.domain_events where company_id='f7200000-0000-4000-8000-000000000001'; delete from public.roof_assessment_access_attempts where company_id='f7200000-0000-4000-8000-000000000001'; delete from public.lead_consent_evidence where company_id='f7200000-0000-4000-8000-000000000001'; delete from public.lead_attribution_touches where company_id='f7200000-0000-4000-8000-000000000001'; delete from public.roof_assessments where company_id='f7200000-0000-4000-8000-000000000001'; delete from public.roof_estimates where company_id='f7200000-0000-4000-8000-000000000001'; delete from public.pipeline_runs where company_id='f7200000-0000-4000-8000-000000000001'; delete from public.lead_consents where company_id='f7200000-0000-4000-8000-000000000001'; delete from public.leads where company_id='f7200000-0000-4000-8000-000000000001'; delete from public.properties where company_id='f7200000-0000-4000-8000-000000000001'; delete from public.companies where id='f7200000-0000-4000-8000-000000000001'; end $cleanup$;$$),'DO','result-view race fixtures are removed');
select ok(extensions.dblink_disconnect('result_view_race_a')='OK','first result-view worker disconnects');
select ok(extensions.dblink_disconnect('result_view_race_b')='OK','second result-view worker disconnects');
select ok(extensions.dblink_disconnect('result_view_race_gate')='OK','result-view gate disconnects');

-- Run the forced downstream failure after remote concurrency coverage because
-- PostgreSQL retains the trigger DDL relation lock until this test rolls back.
create temp table same_browser_failure_snapshot as
select assessment.status, assessment.presentation_key, assessment.entry_point,
       assessment.abandoned_at, assessment.updated_at as assessment_updated_at,
       estimate.public_token, estimate.updated_at as estimate_updated_at,
       attempt.verified_at, attempt.consumed_at, attempt.token_rotated_at,
       attempt.updated_at as attempt_updated_at
from public.roof_assessment_access_attempts as attempt
join public.roof_assessments as assessment on assessment.id = attempt.assessment_id
join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
where attempt.id = (select attempt_id from phone_only_resume);

create temp table same_browser_failure_estimate as
select estimate_id from public.roof_assessment_access_attempts
where id = (select attempt_id from phone_only_resume);

select throws_ok(
  $$select * from public.authorize_same_browser_roof_assessment_resume(
    'd0000000-0000-4000-8000-000000000001',
    (select attempt_id from phone_only_resume),
    (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from phone_only_resume)),
    extensions.digest('wrong continuation secret', 'sha256')
  )$$,
  'Assessment continuation is invalid',
  'same-browser authorization requires the exact continuation hash'
);
select throws_ok(
  $$select * from public.authorize_same_browser_roof_assessment_resume(
    'd0000000-0000-4000-8000-000000000001',
    (select attempt_id from phone_only_resume),
    '00000000-0000-4000-8000-000000000099',
    extensions.digest((select continuation_secret from phone_only_resume), 'sha256')
  )$$,
  'Assessment browser session does not match',
  'same-browser authorization requires the exact session-bound assessment'
);
select results_eq(
  $$select assessment.status, assessment.presentation_key, assessment.entry_point,
           assessment.abandoned_at, assessment.updated_at,
           estimate.public_token, estimate.updated_at,
           attempt.verified_at, attempt.consumed_at, attempt.token_rotated_at,
           attempt.updated_at
    from public.roof_assessment_access_attempts as attempt
    join public.roof_assessments as assessment on assessment.id = attempt.assessment_id
    join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
    where attempt.id = (select attempt_id from phone_only_resume)$$,
  $$select * from same_browser_failure_snapshot$$,
  'hash and assessment mismatch rejections leave the entire journey unchanged'
);

create function pg_temp.reject_same_browser_estimate_rotation()
returns trigger
language plpgsql
as $$
begin
  if new.id = (select estimate_id from same_browser_failure_estimate) then
    raise exception 'forced estimate rotation failure';
  end if;
  return new;
end;
$$;

create trigger reject_same_browser_estimate_rotation
before update on public.roof_estimates
for each row execute function pg_temp.reject_same_browser_estimate_rotation();

select throws_ok(
  $$select * from public.authorize_same_browser_roof_assessment_resume(
    'd0000000-0000-4000-8000-000000000001',
    (select attempt_id from phone_only_resume),
    (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from phone_only_resume)),
    extensions.digest((select continuation_secret from phone_only_resume), 'sha256')
  )$$,
  'forced estimate rotation failure',
  'a downstream rotation failure rolls back same-browser authorization'
);

select results_eq(
  $$select assessment.status, assessment.presentation_key, assessment.entry_point,
           assessment.abandoned_at, assessment.updated_at,
           estimate.public_token, estimate.updated_at,
           attempt.verified_at, attempt.consumed_at, attempt.token_rotated_at,
           attempt.updated_at
    from public.roof_assessment_access_attempts as attempt
    join public.roof_assessments as assessment on assessment.id = attempt.assessment_id
    join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
    where attempt.id = (select attempt_id from phone_only_resume)$$,
  $$select * from same_browser_failure_snapshot$$,
  'failed atomic resume leaves authorization, lifecycle, estimate, and attempt unchanged'
);

drop trigger reject_same_browser_estimate_rotation on public.roof_estimates;

create temp table same_browser_rotation as
select * from public.authorize_same_browser_roof_assessment_resume(
  'd0000000-0000-4000-8000-000000000001',
  (select attempt_id from phone_only_resume),
  (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from phone_only_resume)),
  extensions.digest((select continuation_secret from phone_only_resume), 'sha256')
);

select isnt(
  (select public_token from same_browser_rotation),
  (select public_token from same_browser_failure_snapshot),
  'atomic same-browser authorization rotates the public token'
);
select ok(
  (select verified_at is not null and consumed_at is not null and token_rotated_at is not null
   from public.roof_assessment_access_attempts
   where id = (select attempt_id from phone_only_resume)),
  'atomic same-browser authorization verifies, rotates, and consumes once'
);
select is(
  (select count(*) from public.domain_events where idempotency_key='roof/assessment.resumed:'||
    (select assessment_id::text from public.roof_assessment_access_attempts where id=(select attempt_id from phone_only_resume))),
  1::bigint,
  'authorized reactivation atomically emits one resumed event'
);
select throws_ok(
  $$select * from public.authorize_same_browser_roof_assessment_resume(
    'd0000000-0000-4000-8000-000000000001',
    (select attempt_id from phone_only_resume),
    (select assessment_id from public.roof_assessment_access_attempts where id = (select attempt_id from phone_only_resume)),
    extensions.digest((select continuation_secret from phone_only_resume), 'sha256')
  )$$,
  'Assessment access attempt has already been consumed',
  'a consumed same-browser resume cannot be replayed'
);

-- Verification start reservations and approvals use isolated access attempts
-- that share only the already-created lead graph.
insert into public.roof_assessment_access_attempts (
  id, company_id, submission_id, lead_id, property_id, estimate_id,
  assessment_id, attempt_kind, continuation_secret_hash,
  destination_phone_e164, requested_presentation_key, requested_entry_point,
  request_ip, expires_at
)
select
  ('a4000000-0000-4000-8000-' || pg_catalog.lpad(series.ordinal::text, 12, '0'))::uuid,
  source.company_id,
  ('b4000000-0000-4000-8000-' || pg_catalog.lpad(series.ordinal::text, 12, '0'))::uuid,
  source.lead_id, source.property_id, source.estimate_id, source.assessment_id,
  'resume_candidate', extensions.digest('verification-' || series.ordinal::text, 'sha256'),
  case
    when series.ordinal between 2 and 7 then '+12015552002'
    when series.ordinal between 16 and 17 then '+12015552016'
    when series.ordinal between 20 and 21 then '+12015552020'
    else '+12015552' || pg_catalog.lpad(series.ordinal::text, 3, '0')
  end,
  'weather-report', 'campaign:weather-report',
  case when series.ordinal between 8 and 13 then '127.2.0.99'::inet
       when series.ordinal between 18 and 19 then '127.2.0.88'::inet
       else ('127.2.0.' || series.ordinal::text)::inet end,
  pg_catalog.now() + interval '15 minutes'
from public.roof_assessment_access_attempts as source
cross join pg_catalog.generate_series(1, 21) as series(ordinal)
where source.id = (select attempt_id from phone_only_resume);

create temp table verification_cooldown_reservation as
select * from public.reserve_roof_assessment_verification_start(
  'a4000000-0000-4000-8000-000000000001', '127.2.0.1'
);
select throws_ok(
  $$select * from public.reserve_roof_assessment_verification_start(
    'a4000000-0000-4000-8000-000000000001', '127.2.0.1'
  )$$,
  'verification_start_cooldown',
  'one destination cannot reserve another send inside one minute'
);
select is(
  (select count(*) from public.roof_assessment_verification_sends
   where attempt_id = 'a4000000-0000-4000-8000-000000000001'),
  1::bigint,
  'a rejected cooldown does not record extra send evidence'
);
update public.roof_assessment_verification_sends
set reserved_at = pg_catalog.clock_timestamp() - interval '60 seconds'
where id = (select reservation_id from verification_cooldown_reservation);
select lives_ok(
  $$select * from public.reserve_roof_assessment_verification_start(
    'a4000000-0000-4000-8000-000000000001', '127.2.0.1'
  )$$,
  'the exact 60-second boundary permits another reservation'
);
update public.roof_assessment_verification_sends
set reserved_at = pg_catalog.clock_timestamp() - interval '60 seconds' + interval '1 millisecond'
where attempt_id = 'a4000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select * from public.reserve_roof_assessment_verification_start(
    'a4000000-0000-4000-8000-000000000001', '127.2.0.1'
  )$$,
  'verification_start_cooldown',
  'one millisecond inside the 60-second boundary remains throttled'
);

insert into public.roof_assessment_verification_sends (
  company_id, attempt_id, destination_phone_e164, request_ip, reserved_at
)
select attempt.company_id, attempt.id, attempt.destination_phone_e164,
       ('127.2.1.' || series.ordinal::text)::inet,
       pg_catalog.now() - interval '10 minutes' - series.ordinal * interval '1 minute'
from pg_catalog.generate_series(2, 6) as series(ordinal)
join public.roof_assessment_access_attempts as attempt
  on attempt.id = ('a4000000-0000-4000-8000-' || pg_catalog.lpad(series.ordinal::text, 12, '0'))::uuid;
select throws_ok(
  $$select * from public.reserve_roof_assessment_verification_start(
    'a4000000-0000-4000-8000-000000000007', '127.2.1.7'
  )$$,
  'verification_phone_hourly_limit',
  'a destination cannot exceed five verification starts per hour'
);

insert into public.roof_assessment_verification_sends (
  company_id, attempt_id, destination_phone_e164, request_ip, reserved_at
)
select attempt.company_id, attempt.id, attempt.destination_phone_e164,
       '127.2.0.99'::inet,
       pg_catalog.now() - interval '10 minutes' - series.ordinal * interval '1 minute'
from pg_catalog.generate_series(8, 12) as series(ordinal)
join public.roof_assessment_access_attempts as attempt
  on attempt.id = ('a4000000-0000-4000-8000-' || pg_catalog.lpad(series.ordinal::text, 12, '0'))::uuid;
select throws_ok(
  $$select * from public.reserve_roof_assessment_verification_start(
    'a4000000-0000-4000-8000-000000000013', '127.2.0.99'
  )$$,
  'verification_ip_hourly_limit',
  'a request address cannot exceed five verification starts per hour'
);

insert into public.roof_assessment_verification_sends (
  company_id, attempt_id, destination_phone_e164, request_ip, reserved_at
)
select attempt.company_id, attempt.id, attempt.destination_phone_e164,
       '127.2.0.88'::inet, pg_catalog.clock_timestamp() - interval '1 hour'
from pg_catalog.generate_series(1, 5) as series(ordinal)
join public.roof_assessment_access_attempts as attempt
  on attempt.id = 'a4000000-0000-4000-8000-000000000018';
select lives_ok(
  $$select * from public.reserve_roof_assessment_verification_start(
    'a4000000-0000-4000-8000-000000000019', '127.2.0.88'
  )$$,
  'the exact one-hour boundary no longer occupies the IP bucket'
);
delete from public.roof_assessment_verification_sends
where attempt_id in (
  'a4000000-0000-4000-8000-000000000018',
  'a4000000-0000-4000-8000-000000000019'
);
insert into public.roof_assessment_verification_sends (
  company_id, attempt_id, destination_phone_e164, request_ip, reserved_at
)
select attempt.company_id, attempt.id, attempt.destination_phone_e164,
       '127.2.0.88'::inet,
       pg_catalog.clock_timestamp() - interval '1 hour' + interval '1 millisecond'
from pg_catalog.generate_series(1, 5) as series(ordinal)
join public.roof_assessment_access_attempts as attempt
  on attempt.id = 'a4000000-0000-4000-8000-000000000018';
select throws_ok(
  $$select * from public.reserve_roof_assessment_verification_start(
    'a4000000-0000-4000-8000-000000000019', '127.2.0.88'
  )$$,
  'verification_ip_hourly_limit',
  'one millisecond inside the one-hour boundary remains in the IP bucket'
);

create temp table stale_cross_attempt_reservation as
select * from public.reserve_roof_assessment_verification_start(
  'a4000000-0000-4000-8000-000000000020', '127.2.0.20'
);
update public.roof_assessment_verification_sends
set reserved_at = pg_catalog.clock_timestamp() - interval '61 seconds'
where id = (select reservation_id from stale_cross_attempt_reservation);
create temp table newest_cross_attempt_reservation as
select * from public.reserve_roof_assessment_verification_start(
  'a4000000-0000-4000-8000-000000000021', '127.2.0.21'
);
select public.record_roof_assessment_verification_start(
  (select company_id from newest_cross_attempt_reservation),
  'a4000000-0000-4000-8000-000000000021',
  (select reservation_id from newest_cross_attempt_reservation),
  'VEdddddddddddddddddddddddddddddddd'
);
select throws_ok(
  $$select public.record_roof_assessment_verification_start(
    (select company_id from stale_cross_attempt_reservation),
    'a4000000-0000-4000-8000-000000000020',
    (select reservation_id from stale_cross_attempt_reservation),
    'VEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  )$$,
  'verification_start_unavailable',
  'a delayed provider response cannot supersede a newer send for the same destination and assessment'
);

create temp table verification_approval_reservation as
select * from public.reserve_roof_assessment_verification_start(
  'a4000000-0000-4000-8000-000000000014', '127.2.0.14'
);
select lives_ok(
  $$select public.record_roof_assessment_verification_start(
    (select company_id from verification_approval_reservation),
    'a4000000-0000-4000-8000-000000000014',
    (select reservation_id from verification_approval_reservation),
    'VEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )$$,
  'provider success is recorded after the external call completes'
);
select ok(
  (select send.provider_attempt_id = 'VEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
          and send.provider_status = 'pending'
          and send.sent_at is not null
          and attempt.provider_attempt_id = send.provider_attempt_id
          and attempt.verification_sent_at = send.sent_at
   from public.roof_assessment_verification_sends as send
   join public.roof_assessment_access_attempts as attempt on attempt.id = send.attempt_id
   where send.id = (select reservation_id from verification_approval_reservation)),
  'provider attempt and sent evidence remain bound to the exact reservation'
);
create temp table verification_token_before as
select estimate.public_token
from public.roof_assessment_access_attempts as attempt
join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
where attempt.id = 'a4000000-0000-4000-8000-000000000014';
select throws_ok(
  $$select * from public.approve_verified_roof_assessment_resume(
    (select company_id from verification_approval_reservation),
    'a4000000-0000-4000-8000-000000000014',
    'VEffffffffffffffffffffffffffffffff'
  )$$,
  'Assessment verification is invalid',
  'atomic approval rejects a provider-approved SID that does not match the stored send'
);
create temp table verification_approval as
select null::uuid as assessment_id, null::uuid as public_token, null::timestamptz as token_rotated_at
where false;
update public.roof_assessments set status='abandoned',abandoned_at=clock_timestamp(),updated_at=clock_timestamp()
where id=(select assessment_id from public.roof_assessment_access_attempts where id='a4000000-0000-4000-8000-000000000014');
insert into verification_approval
select * from public.approve_verified_roof_assessment_resume(
  (select company_id from verification_approval_reservation),
  'a4000000-0000-4000-8000-000000000014',
  'VEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);
select isnt(
  (select public_token from verification_approval),
  (select public_token from verification_token_before),
  'verified approval rotates the public token'
);
select ok(
  (select verified_at = token_rotated_at and consumed_at = token_rotated_at
   from public.roof_assessment_access_attempts
   where id = 'a4000000-0000-4000-8000-000000000014'),
  'verified approval atomically verifies, rotates, and consumes the candidate'
);
select is(
  (select count(*) from public.domain_events where idempotency_key='roof/assessment.resumed:'||
    (select assessment_id::text from public.roof_assessment_access_attempts where id='a4000000-0000-4000-8000-000000000014')),
  1::bigint,
  'authorized verified reactivation atomically emits one resumed event'
);
select throws_ok(
  $$select * from public.approve_verified_roof_assessment_resume(
    (select company_id from verification_approval_reservation),
    'a4000000-0000-4000-8000-000000000014',
    'VEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )$$,
  'Assessment access attempt has already been consumed',
  'verified approval is terminal and cannot replay'
);

create temp table verification_rollback_reservation as
select * from public.reserve_roof_assessment_verification_start(
  'a4000000-0000-4000-8000-000000000015', '127.2.0.15'
);
select public.record_roof_assessment_verification_start(
  (select company_id from verification_rollback_reservation),
  'a4000000-0000-4000-8000-000000000015',
  (select reservation_id from verification_rollback_reservation),
  'VEbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
);
create temp table verification_rollback_before as
select attempt.verified_at, attempt.consumed_at, attempt.token_rotated_at,
       attempt.updated_at, estimate.public_token, estimate.updated_at as estimate_updated_at
from public.roof_assessment_access_attempts as attempt
join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
where attempt.id = 'a4000000-0000-4000-8000-000000000015';
create function pg_temp.reject_verified_estimate_rotation()
returns trigger language plpgsql as $$
begin
  if new.id = (select estimate_id from public.roof_assessment_access_attempts
               where id = 'a4000000-0000-4000-8000-000000000015') then
    raise exception 'forced verified rotation failure';
  end if;
  return new;
end;
$$;
create trigger reject_verified_estimate_rotation
before update on public.roof_estimates
for each row execute function pg_temp.reject_verified_estimate_rotation();
select throws_ok(
  $$select * from public.approve_verified_roof_assessment_resume(
    (select company_id from verification_rollback_reservation),
    'a4000000-0000-4000-8000-000000000015',
    'VEbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )$$,
  'forced verified rotation failure',
  'a downstream failure aborts verified approval'
);
select results_eq(
  $$select attempt.verified_at, attempt.consumed_at, attempt.token_rotated_at,
           attempt.updated_at, estimate.public_token, estimate.updated_at
    from public.roof_assessment_access_attempts as attempt
    join public.roof_estimates as estimate on estimate.id = attempt.estimate_id
    where attempt.id = 'a4000000-0000-4000-8000-000000000015'$$,
  $$select * from verification_rollback_before$$,
  'failed verified approval rolls back every attempt and estimate mutation'
);
drop trigger reject_verified_estimate_rotation on public.roof_estimates;

create temp table lifecycle_old as select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000001','f6000000-0000-4000-8000-000000000001',
  'Lifecycle Old','+12015550601','lifecycle-old@example.com','601 Old St, Newark, NJ 07102','ChIJ-lifecycle-old',
  'all-season-main','main-home','{}'::jsonb,null,'all-season-assessment-v1',clock_timestamp(),'127.6.0.1','pgtap');
create temp table lifecycle_new as select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000001','f6000000-0000-4000-8000-000000000002',
  'Lifecycle New','+12015550602','lifecycle-new@example.com','602 New St, Newark, NJ 07102','ChIJ-lifecycle-new',
  'weather-report','campaign:weather-report','{}'::jsonb,null,'all-season-assessment-v1',clock_timestamp(),'127.6.0.2','pgtap');

create temp table lifecycle_jump_before as
select revision,current_step,responses,scores,last_answered_at,updated_at
from public.roof_assessments
where id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_new));
create temp table lifecycle_jump_result as
select applied from public.save_roof_assessment_progress(
  'd0000000-0000-4000-8000-000000000001',
  (select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_new)),
  0,2,null,'{"roofAge":"20_plus"}'::jsonb,'{"roofAge":"20_plus"}'::jsonb,
  '{"need":6,"intent":0,"urgency":0,"propertyFit":0,"engagement":1}'::jsonb,false);
select is((select applied from lifecycle_jump_result),false,'revision zero cannot jump ahead to progress step two');
select results_eq(
  $$select revision,current_step,responses,scores,last_answered_at,updated_at from public.roof_assessments where id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_new))$$,
  $$select * from lifecycle_jump_before$$,
  'a rejected forward jump changes no revision, step, answers, scores, or timestamps'
);
select is((select count(*) from public.domain_events where correlation_id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_new)) and event_name='roof/assessment.high_intent'),0::bigint,'a rejected forward jump emits no lifecycle event');

select * from public.save_roof_assessment_progress(
  'd0000000-0000-4000-8000-000000000001',
  (select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_old)),
  0,1,null,'{"reason":"known_replacement"}'::jsonb,'{"reason":"known_replacement"}'::jsonb,
  '{"need":4,"intent":3,"urgency":0,"propertyFit":0,"engagement":0}'::jsonb,true);
select ok((select last_answered_at is not null and current_step=1 from public.roof_assessments where id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_old))), 'successful progressive save stamps last answered time');
select is((select count(*) from public.domain_events where idempotency_key='roof/assessment.high_intent:'||(select assessment_id::text from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_old))),1::bigint,'first progressive threshold emits high intent once');
create temp table lifecycle_progress_winner as
select revision,current_step,responses,scores,property_revealed_at,last_answered_at,updated_at
from public.roof_assessments
where id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_old));
select throws_ok(
  $$select * from public.save_roof_assessment_progress(
    'd0000000-0000-4000-8000-000000000002',
    (select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_old)),
    1,2,null,'{"roofAge":"20_plus"}'::jsonb,
    '{"reason":"known_replacement","roofAge":"20_plus"}'::jsonb,
    '{"need":10,"intent":3,"urgency":0,"propertyFit":0,"engagement":1}'::jsonb,true
  )$$,
  'Assessment progress is unavailable',
  'a different tenant cannot spend or inspect an assessment revision'
);
select * from public.save_roof_assessment_progress(
  'd0000000-0000-4000-8000-000000000001',
  (select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_old)),
  0,0,null,'{"reason":"planning"}'::jsonb,'{"reason":"planning"}'::jsonb,
  '{"need":0,"intent":0,"urgency":0,"propertyFit":0,"engagement":0}'::jsonb,false);
select results_eq(
  $$select revision,current_step,responses,scores,property_revealed_at,last_answered_at,updated_at from public.roof_assessments where id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_old))$$,
  $$select * from lifecycle_progress_winner$$,
  'a delayed stale save changes no revision, step, answers, scores, or timestamps'
);
select is((select count(*) from public.domain_events where idempotency_key='roof/assessment.high_intent:'||(select assessment_id::text from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_old))),1::bigint,'progress retry does not duplicate high intent');
select is((select count(*) from public.event_outbox outbox join public.domain_events event on event.id=outbox.event_id where event.idempotency_key='roof/assessment.high_intent:'||(select assessment_id::text from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_old))),1::bigint,'stale progress creates no duplicate outbox work');
select * from public.save_roof_assessment_progress(
  'd0000000-0000-4000-8000-000000000001',
  (select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_old)),
  1,2,null,'{"roofAge":"20_plus"}'::jsonb,
  '{"reason":"known_replacement","roofAge":"20_plus"}'::jsonb,
  '{"need":10,"intent":3,"urgency":0,"propertyFit":0,"engagement":1}'::jsonb,true);
select * from public.save_roof_assessment_progress(
  'd0000000-0000-4000-8000-000000000001',
  (select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_old)),
  2,1,null,'{"reason":"planning"}'::jsonb,
  '{"reason":"planning","roofAge":"20_plus"}'::jsonb,
  '{"need":6,"intent":0,"urgency":0,"propertyFit":0,"engagement":1}'::jsonb,false);
select results_eq(
  $$select revision,current_step,responses from public.roof_assessments where id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_old))$$,
  $$values (3::bigint,2,'{"reason":"planning","roofAge":"20_plus"}'::jsonb)$$,
  'an explicit back edit succeeds without regressing canonical progress'
);

update public.roof_assessments set last_answered_at=clock_timestamp(),updated_at=clock_timestamp() where status='in_progress';
update public.roof_assessments set last_answered_at=clock_timestamp()-interval '24 hours 1 second',updated_at=clock_timestamp()-interval '24 hours 1 second' where id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_old));
update public.roof_assessments set last_answered_at=clock_timestamp()-interval '23 hours 59 minutes 59 seconds',updated_at=clock_timestamp()-interval '23 hours 59 minutes 59 seconds' where id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_new));
select is((select count(*) from public.abandon_inactive_roof_assessments(100)),1::bigint,'24-hour sweep abandons only the inactive boundary record');
select is((select status from public.roof_assessments where id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_old))),'abandoned','inactive assessment becomes abandoned');
select is((select status from public.roof_assessments where id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_new))),'in_progress','active boundary assessment stays in progress');
select is((select count(*) from public.domain_events where idempotency_key='roof/assessment.abandoned:'||(select assessment_id::text from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_old))),1::bigint,'abandonment creates one event');
select is((select count(*) from public.abandon_inactive_roof_assessments(100)),0::bigint,'abandonment retry is idempotent');
select ok((select event.company_id=assessment.company_id from public.domain_events event join public.roof_assessments assessment on event.idempotency_key='roof/assessment.abandoned:'||assessment.id::text where assessment.id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_old))),'abandonment event retains assessment tenant');

select * from public.complete_roof_assessment(
  'd0000000-0000-4000-8000-000000000001',
  (select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_new)),
  0,'{"reason":"active_leak"}'::jsonb,'{"reason":"active_leak"}'::jsonb,
  '{"need":3,"intent":0,"urgency":4,"propertyFit":0,"engagement":0}'::jsonb,
  'professional_inspection',true);
select * from public.complete_roof_assessment(
  'd0000000-0000-4000-8000-000000000001',
  (select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_new)),
  0,'{"reason":"planning"}'::jsonb,'{"reason":"planning"}'::jsonb,
  '{"need":3,"intent":0,"urgency":4,"propertyFit":0,"engagement":0}'::jsonb,
  'professional_inspection',true);
select is((select status from public.roof_assessments where id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_new))),'completed','completion persists the terminal lifecycle state');
select is((select responses from public.roof_assessments where id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_new))),'{"reason":"active_leak"}'::jsonb,'a stale completion cannot overwrite the winning completed answers');
select is((select count(*) from public.domain_events where idempotency_key='roof/assessment.completed:'||(select assessment_id::text from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_new))),1::bigint,'completion retry emits one completed event');
select is((select count(*) from public.domain_events where idempotency_key='roof/assessment.high_intent:'||(select assessment_id::text from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_new))),1::bigint,'completion can emit the first high-intent event once');

create temp table lifecycle_rollback as select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000002','f6000000-0000-4000-8000-000000000003',
  'Lifecycle Rollback','+12015550603','lifecycle-rollback@example.com','603 Rollback St, Trenton, NJ 08608','ChIJ-lifecycle-rollback',
  'all-season-main','main-contact','{}'::jsonb,null,'all-season-assessment-v1',clock_timestamp(),'127.6.0.3','pgtap');
update public.roof_assessments set updated_at=clock_timestamp()-interval '25 hours' where id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_rollback));
create function pg_temp.reject_abandonment_outbox() returns trigger language plpgsql as $$ begin
  if exists(select 1 from public.domain_events event where event.id=new.event_id and event.idempotency_key='roof/assessment.abandoned:'||(select assessment_id::text from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_rollback))) then raise exception 'forced abandonment outbox failure'; end if; return new; end $$;
create trigger reject_abandonment_outbox before insert on public.event_outbox for each row execute function pg_temp.reject_abandonment_outbox();
select throws_ok($$select * from public.abandon_inactive_roof_assessments(100)$$,'forced abandonment outbox failure','outbox failure aborts abandonment');
select is((select status from public.roof_assessments where id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from lifecycle_rollback))),'in_progress','failed enqueue rolls back lifecycle update');
drop trigger reject_abandonment_outbox on public.event_outbox;

create function pg_temp.reject_result_view_outbox() returns trigger language plpgsql as $$ begin
  if exists(select 1 from public.domain_events event where event.id=new.event_id and event.idempotency_key='roof/assessment.result_viewed:'||(select assessment_id::text from public.roof_assessment_access_attempts where id=(select attempt_id from stale_start))) then raise exception 'forced result-view outbox failure'; end if; return new; end $$;
create trigger reject_result_view_outbox before insert on public.event_outbox for each row execute function pg_temp.reject_result_view_outbox();
select throws_ok($$select * from public.mark_roof_assessment_result_viewed('d0000000-0000-4000-8000-000000000001',(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from stale_start)),(select estimate_id from public.roof_assessment_access_attempts where id=(select attempt_id from stale_start)))$$,'forced result-view outbox failure','outbox failure aborts result-view mutation');
select is((select result_viewed_at from public.roof_assessments where id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from stale_start))),null::timestamptz,'failed result-view enqueue rolls back the timestamp');
select is((select count(*) from public.domain_events where idempotency_key='roof/assessment.result_viewed:'||(select assessment_id::text from public.roof_assessment_access_attempts where id=(select attempt_id from stale_start))),0::bigint,'failed result-view enqueue rolls back the event');
drop trigger reject_result_view_outbox on public.event_outbox;

create function pg_temp.reject_consultation_outbox() returns trigger language plpgsql as $$ begin
  if exists(select 1 from public.domain_events event where event.id=new.event_id and event.idempotency_key='roof/assessment.consultation_requested:'||(select assessment_id::text from public.roof_assessment_access_attempts where id=(select attempt_id from stale_start))) then raise exception 'forced consultation outbox failure'; end if; return new; end $$;
create trigger reject_consultation_outbox before insert on public.event_outbox for each row execute function pg_temp.reject_consultation_outbox();
select throws_ok($$select * from public.request_roof_consultation('d0000000-0000-4000-8000-000000000001',(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from stale_start)),(select estimate_id from public.roof_assessment_access_attempts where id=(select attempt_id from stale_start)),'email',null,'America/New_York')$$,'forced consultation outbox failure','outbox failure aborts consultation mutation');
select is((select count(*) from public.consultation_requests where assessment_id=(select assessment_id from public.roof_assessment_access_attempts where id=(select attempt_id from stale_start))),0::bigint,'failed consultation enqueue rolls back the request');
select is((select count(*) from public.domain_events where idempotency_key='roof/assessment.consultation_requested:'||(select assessment_id::text from public.roof_assessment_access_attempts where id=(select attempt_id from stale_start))),0::bigint,'failed consultation enqueue rolls back the event');
drop trigger reject_consultation_outbox on public.event_outbox;

select * from extensions.finish();
rollback;

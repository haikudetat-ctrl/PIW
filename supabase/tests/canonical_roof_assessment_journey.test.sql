begin;

create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

select has_column('public', 'roof_assessments', 'presentation_key', 'assessments retain presentation context');
select has_column('public', 'roof_assessments', 'entry_point', 'assessments retain their entry point');
select has_column('public', 'roof_assessments', 'last_answered_at', 'assessments retain progressive-answer time');
select has_column('public', 'roof_assessments', 'result_viewed_at', 'assessments retain result-view time');
select has_column('public', 'roof_assessments', 'abandoned_at', 'assessments retain abandonment time');
select has_table('public', 'lead_attribution_touches', 'attribution history exists');
select has_table('public', 'consultation_requests', 'consultation intent exists');
select has_table('public', 'roof_assessment_access_attempts', 'continuation access attempts exist');
select has_column('public', 'lead_consents', 'submission_id', 'consent evidence is submission-scoped');
select hasnt_column('public', 'roof_assessment_access_attempts', 'continuation_secret', 'raw continuation secrets are never stored');

select has_function(
  'public', 'start_or_resume_roof_assessment',
  array['uuid','uuid','text','text','text','text','text','text','text','jsonb','text','text','timestamp with time zone','text','text'],
  'canonical intake RPC exists'
);
select has_function('public', 'rotate_roof_estimate_public_token', array['uuid','uuid'], 'token rotation RPC exists');
select has_function('public', 'request_roof_consultation', array['uuid','uuid','text','text'], 'consultation RPC exists');

select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.lead_attribution_touches'::regclass), true, 'attribution has RLS');
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.consultation_requests'::regclass), true, 'consultation requests have RLS');
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.roof_assessment_access_attempts'::regclass), true, 'access attempts have RLS');

select table_privs_are('public', 'lead_attribution_touches', 'anon', array[]::text[], 'anon cannot access attribution');
select table_privs_are('public', 'lead_attribution_touches', 'authenticated', array[]::text[], 'authenticated cannot access attribution');
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
select is((select count(*) from public.lead_consents where submission_id = 'd0000000-0000-4000-8000-000000000010'), 3::bigint, 'new intake appends all consent evidence');
select is(
  (select count(*) from public.domain_events where event_name = 'roof-assessment/started' and correlation_id = 'd0000000-0000-4000-8000-000000000010'),
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

select is((select attempt_id from duplicate_start), (select attempt_id from first_start), 'same company and submission replay returns the same attempt');
select isnt((select continuation_secret from duplicate_start), (select continuation_secret from first_start), 'replay rotates the one-time secret instead of persisting raw secret material');
select is((select count(*) from public.lead_attribution_touches where submission_id = 'd0000000-0000-4000-8000-000000000010'), 1::bigint, 'submission replay does not duplicate attribution');
select is((select count(*) from public.lead_consents where submission_id = 'd0000000-0000-4000-8000-000000000010'), 3::bigint, 'submission replay does not duplicate consent evidence');
select ok(
  (select continuation_secret_hash = extensions.digest((select continuation_secret from duplicate_start), 'sha256')
   from public.roof_assessment_access_attempts where id = (select attempt_id from duplicate_start)),
  'submission replay replaces the stored hash with the new one-time secret hash'
);

create temp table resume_start as
select * from public.start_or_resume_roof_assessment(
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000011',
  'Alex Rivera', '+12015550100', 'alex+new@example.com',
  '1 MAIN STREET, NEWARK, NJ 07102', 'ChIJ-canonical-one',
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
select is((select count(*) from public.lead_consents where submission_id = 'd0000000-0000-4000-8000-000000000011'), 3::bigint, 'resume submission appends new consent evidence');

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

select * from extensions.finish();
rollback;

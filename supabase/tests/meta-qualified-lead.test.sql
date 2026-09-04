begin;

select plan(8);

select has_function(
  'public', 'reserve_meta_qualified_lead_delivery',
  array['uuid','uuid','uuid','text','timestamp with time zone'],
  'QualifiedLead reservation RPC exists'
);
select function_privs_are(
  'public', 'reserve_meta_qualified_lead_delivery',
  array['uuid','uuid','uuid','text','timestamp with time zone'],
  'service_role', array['EXECUTE'],
  'service role can reserve QualifiedLead'
);
select function_privs_are(
  'public', 'reserve_meta_qualified_lead_delivery',
  array['uuid','uuid','uuid','text','timestamp with time zone'],
  'anon', array[]::text[],
  'anonymous callers cannot reserve QualifiedLead'
);

insert into public.companies(id, name)
values ('94000000-0000-4000-8000-000000000001', 'Qualified Lead Company');

create temp table qualified_start as
select * from public.start_or_resume_roof_assessment(
  '94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000011',
  'Qualified Lead', '+12015550911', 'qualified@example.com',
  '911 Meta Way, Newark, NJ 07102', 'ChIJ-meta-qualified',
  'all-season-main', 'main-home', '{}'::jsonb, null,
  'all-season-assessment-v1', '2026-09-04T12:00:00Z', '127.0.0.1', 'pgtap'
);

create temp view qualified_fixture as
select lead_id
from public.roof_assessment_access_attempts
where id = (select attempt_id from qualified_start);

select * from public.record_privacy_consent(
  '94000000-0000-4000-8000-000000000101',
  '94000000-0000-4000-8000-000000000201',
  '94000000-0000-4000-8000-000000000001',
  (select lead_id from qualified_fixture),
  'piw-privacy-v1', false, false, false, 'preferences', null, 'pgtap',
  '2026-09-04T12:01:00Z'
);
select is(
  (select count(*) from public.reserve_meta_qualified_lead_delivery(
    (select lead_id from qualified_fixture),
    '94000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000201',
    'piw-privacy-v1', '2026-09-04T12:02:00Z'
  )), 0::bigint,
  'advertising denial does not reserve QualifiedLead'
);

select * from public.record_privacy_consent(
  '94000000-0000-4000-8000-000000000102',
  '94000000-0000-4000-8000-000000000202',
  '94000000-0000-4000-8000-000000000001',
  (select lead_id from qualified_fixture),
  'piw-privacy-v1', false, true, false, 'preferences', null, 'pgtap',
  '2026-09-04T12:01:00Z'
);

create temp table qualified_reservation as
select * from public.reserve_meta_qualified_lead_delivery(
  (select lead_id from qualified_fixture),
  '94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000202',
  'piw-privacy-v1', '2026-09-04T12:02:00Z'
);
select is((select count(*) from qualified_reservation), 1::bigint, 'grant reserves one QualifiedLead');
select is((select event_name from qualified_reservation), 'QualifiedLead', 'reservation uses QualifiedLead');
select is(
  (select event_id from public.reserve_meta_qualified_lead_delivery(
    (select lead_id from qualified_fixture),
    '94000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000202',
    'piw-privacy-v1', '2026-09-04T12:03:00Z'
  )),
  (select event_id from qualified_reservation),
  'QualifiedLead reservation is idempotent'
);
select is(
  (select count(*) from public.meta_event_deliveries where event_name = 'QualifiedLead'),
  1::bigint,
  'only one QualifiedLead exists for the lead'
);

select * from finish();
rollback;

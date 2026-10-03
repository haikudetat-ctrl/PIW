begin;

select plan(12);

select has_function(
  'public', 'finalize_property_preview_conversion', array['uuid','text','uuid'],
  'preview conversion finalizer exists'
);
select ok(
  not has_function_privilege('anon', 'public.finalize_property_preview_conversion(uuid,text,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.finalize_property_preview_conversion(uuid,text,uuid)', 'execute'),
  'only the service role can finalize conversions'
);

insert into public.companies (id, name)
values ('fd000000-0000-4000-8000-000000000001', 'Preview Conversion Company');

create temp table preview_a as select * from public.create_property_preview(
  'fd000000-0000-4000-8000-000000000001', pg_catalog.repeat('a', 64),
  '10 Conversion St, Newark, NJ 07102', 'ChIJ-conversion', 'google',
  'weather-report', 'campaign:weather-report', 'weather-report', '{"utm_source":"facebook"}', null,
  'all-season-property-preview-v1', '2026-10-03 12:00:00+00', '203.0.113.40', 'pgtap'
);
create temp table answers_a as select public.record_property_preview_responses(
  'fd000000-0000-4000-8000-000000000001', pg_catalog.repeat('a', 64),
  '{"reason":"storm_damage","roofAge":"15_20","timeline":"asap"}'
) as recorded;

create temp table intake_a as select * from public.start_or_resume_roof_assessment(
  'fd000000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000011',
  'Preview Homeowner', '+12015550401', 'preview-homeowner@example.com',
  '10 Conversion St, Newark, NJ 07102, USA', 'ChIJ-conversion', 'weather-report', 'campaign:weather-report',
  '{"utm_source":"facebook"}'::jsonb, null, 'all-season-campaign-estimate-v3',
  '2026-10-03 12:05:00+00', '203.0.113.40', 'pgtap'
);

create temp table finalized as
select * from public.finalize_property_preview_conversion(
  'fd000000-0000-4000-8000-000000000001', pg_catalog.repeat('a', 64), 'fd000000-0000-4000-8000-000000000011'
);

select is(
  (select attempt_kind from finalized), 'new',
  'a first conversion is a new intake'
);
select results_eq(
  $$select consent_type, disclosure_version, granted_at
    from public.lead_consent_evidence
    where company_id = 'fd000000-0000-4000-8000-000000000001'
      and submission_id = 'fd000000-0000-4000-8000-000000000011'
    order by consent_type$$,
  $$values
    ('email_contact'::text, 'all-season-campaign-estimate-v3'::text, '2026-10-03 12:05:00+00'::timestamptz),
    ('estimate_processing'::text, 'all-season-property-preview-v1'::text, '2026-10-03 12:00:00+00'::timestamptz),
    ('sms_contact'::text, 'all-season-campaign-estimate-v3'::text, '2026-10-03 12:05:00+00'::timestamptz)$$,
  'property processing keeps the address-step notice; contact consents keep the contact-step notice'
);
select is(
  (select disclosure_version from public.lead_consents
   where lead_id = (select lead_id from finalized) and consent_type = 'estimate_processing'),
  'all-season-property-preview-v1',
  'the current-consent projection matches the evidence'
);
select is(
  (select pg_catalog.count(*)::integer from public.lead_consent_evidence
   where submission_id = 'fd000000-0000-4000-8000-000000000011' and granted),
  3,
  'all three consent rows exist, so downstream pipeline gates are unchanged'
);
select is(
  (select responses from public.roof_assessments
   where id = (select assessment_id from public.roof_assessment_access_attempts
               where submission_id = 'fd000000-0000-4000-8000-000000000011')),
  '{"reason":"storm_damage","roofAge":"15_20","timeline":"asap"}'::jsonb,
  'the pre-contact answers seed the assessment'
);
select ok(
  (select status = 'converted' and converted_lead_id = (select lead_id from finalized)
          and submission_id = 'fd000000-0000-4000-8000-000000000011'
   from public.property_previews where token_hash = pg_catalog.repeat('a', 64)),
  'the preview is converted and linked to the lead'
);
select is(
  (select lead_id from public.finalize_property_preview_conversion(
    'fd000000-0000-4000-8000-000000000001', pg_catalog.repeat('a', 64), 'fd000000-0000-4000-8000-000000000011')),
  (select lead_id from finalized),
  'a replay of the same submission returns the same lead'
);

create temp table intake_b as select * from public.start_or_resume_roof_assessment(
  'fd000000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000012',
  'Other Homeowner', '+12015550402', 'other-homeowner@example.com',
  '11 Conversion St, Newark, NJ 07102', '', 'all-season-main', 'main-home',
  '{}'::jsonb, null, 'all-season-campaign-estimate-v3',
  '2026-10-03 12:06:00+00', '203.0.113.41', 'pgtap'
);
select throws_ok(
  $$select * from public.finalize_property_preview_conversion(
    'fd000000-0000-4000-8000-000000000001', pg_catalog.repeat('a', 64), 'fd000000-0000-4000-8000-000000000012')$$,
  'P0001', 'Preview is already converted',
  'a converted preview cannot be converted again by another submission'
);

create temp table preview_b as select * from public.create_property_preview(
  'fd000000-0000-4000-8000-000000000001', pg_catalog.repeat('b', 64),
  '11 Conversion St, Newark, NJ 07102', null, 'manual',
  null, 'main-home', 'all-season-main', '{}', null,
  'all-season-property-preview-v1', pg_catalog.now(), '203.0.113.42', 'pgtap'
);
update public.property_previews set expires_at = pg_catalog.now() - interval '1 minute'
where token_hash = pg_catalog.repeat('b', 64);
select throws_ok(
  $$select * from public.finalize_property_preview_conversion(
    'fd000000-0000-4000-8000-000000000001', pg_catalog.repeat('b', 64), 'fd000000-0000-4000-8000-000000000012')$$,
  'P0001', 'Preview is not active',
  'an expired preview cannot be converted'
);
select throws_ok(
  $$select * from public.finalize_property_preview_conversion(
    'fd000000-0000-4000-8000-000000000001', pg_catalog.repeat('c', 64), 'fd000000-0000-4000-8000-000000000012')$$,
  'P0001', 'Preview not found',
  'an unknown preview cannot be converted'
);

select * from finish();
rollback;

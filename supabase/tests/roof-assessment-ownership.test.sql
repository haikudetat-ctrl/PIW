begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

select is(has_function_privilege('anon', 'public.save_roof_assessment_ownership(uuid, uuid, bigint, text, jsonb, boolean)', 'execute'), false, 'anon cannot save ownership directly');
select is(has_function_privilege('authenticated', 'public.save_roof_assessment_ownership(uuid, uuid, bigint, text, jsonb, boolean)', 'execute'), false, 'members cannot save ownership directly');
select is(has_function_privilege('service_role', 'public.save_roof_assessment_ownership(uuid, uuid, bigint, text, jsonb, boolean)', 'execute'), true, 'the server saves ownership through the service role');

insert into public.companies(id, name) values ('98100000-0000-4000-8000-000000000001', 'Ownership Company');
insert into public.properties(id, company_id, canonical_address, resolution_status) values
  ('98100000-0000-4000-8000-000000000011', '98100000-0000-4000-8000-000000000001', '4 Owner Ln, Haddonfield, NJ 08033', 'resolved');
insert into public.leads(id, company_id, property_id, name, phone, email, submitted_address, stage) values
  ('98100000-0000-4000-8000-000000000021', '98100000-0000-4000-8000-000000000001', '98100000-0000-4000-8000-000000000011',
   'Riley Owner', '+16095550123', 'riley@example.com', '4 Owner Ln, Haddonfield, NJ 08033', 'new');
insert into public.roof_estimates(id, company_id, lead_id, property_id, public_token) values
  ('98100000-0000-4000-8000-000000000031', '98100000-0000-4000-8000-000000000001', '98100000-0000-4000-8000-000000000021',
   '98100000-0000-4000-8000-000000000011', '98100000-0000-4000-8000-0000000000aa');
-- A value-first lead after conversion: three preview answers seeded, pointer after the first two.
insert into public.roof_assessments(id, company_id, estimate_id, lead_id, current_step, revision, responses) values
  ('98100000-0000-4000-8000-000000000041', '98100000-0000-4000-8000-000000000001', '98100000-0000-4000-8000-000000000031',
   '98100000-0000-4000-8000-000000000021', 2, 1,
   '{"reason":"roof_age","roofAge":"15_20","timeline":"this_season"}');

select throws_ok(
  $$select * from public.save_roof_assessment_ownership('98100000-0000-4000-8000-000000000001', '98100000-0000-4000-8000-000000000041', 1, 'renter', '{}', false)$$,
  'P0001', 'Invalid assessment ownership', 'an unknown answer is refused'
);
select throws_ok(
  $$select * from public.save_roof_assessment_ownership('98100000-0000-4000-8000-000000000002', '98100000-0000-4000-8000-000000000041', 1, 'owner', '{}', false)$$,
  'P0001', 'Assessment progress is unavailable', 'another company cannot answer for this assessment'
);

select is(
  (select applied from public.save_roof_assessment_ownership('98100000-0000-4000-8000-000000000001', '98100000-0000-4000-8000-000000000041', 1, 'owner', '{"intent":1,"urgency":1}', false)),
  true, 'the gate answer is saved'
);
select is(
  (select responses from public.roof_assessments where id = '98100000-0000-4000-8000-000000000041'),
  '{"reason":"roof_age","roofAge":"15_20","timeline":"this_season","ownership":"owner"}'::jsonb,
  'the answer joins the seeded responses'
);
select is(
  (select current_step from public.roof_assessments where id = '98100000-0000-4000-8000-000000000041'),
  2, 'the step pointer does not move'
);
select is(
  (select revision from public.roof_assessments where id = '98100000-0000-4000-8000-000000000041'),
  2::bigint, 'the revision moves forward'
);
select is(
  (select applied from public.save_roof_assessment_ownership('98100000-0000-4000-8000-000000000001', '98100000-0000-4000-8000-000000000041', 1, 'buying', '{}', false)),
  false, 'a stale revision is not applied'
);
select is(
  (select responses->>'ownership' from public.roof_assessments where id = '98100000-0000-4000-8000-000000000041'),
  'owner', 'and leaves the saved answer alone'
);

-- The ordered questions still run, and the last one confirms the early answer.
select is(
  (select applied from public.save_roof_assessment_progress(
    '98100000-0000-4000-8000-000000000001', '98100000-0000-4000-8000-000000000041', 2, 3, null,
    '{"conditionSignals":["unsure"]}',
    '{"reason":"roof_age","roofAge":"15_20","timeline":"this_season","ownership":"owner","conditionSignals":["unsure"]}',
    '{}', false)),
  true, 'the next ordered question saves after the early answer'
);
select is(
  (select current_step from public.roof_assessments where id = '98100000-0000-4000-8000-000000000041'),
  3, 'the pointer moves only with the ordered questions'
);

update public.roof_assessments
set responses = responses || '{"roofVisible":"no","visibleCondition":"not_answered","stories":"one","complexityFeatures":["none_or_unsure"],"priority":"reasonable_cost"}',
    current_step = 8, revision = 9
where id = '98100000-0000-4000-8000-000000000041';
select is(
  (select applied from public.complete_roof_assessment(
    '98100000-0000-4000-8000-000000000001', '98100000-0000-4000-8000-000000000041', 9,
    '{"ownership":"owner"}',
    '{"reason":"roof_age","roofAge":"15_20","timeline":"this_season","ownership":"owner","conditionSignals":["unsure"],"roofVisible":"no","visibleCondition":"not_answered","stories":"one","complexityFeatures":["none_or_unsure"],"priority":"reasonable_cost"}',
    '{"need":1,"intent":1,"urgency":1,"propertyFit":1,"engagement":1}', 'professional_inspection', false)),
  true, 'the assessment completes with the early answer'
);
select is(
  (select status from public.roof_assessments where id = '98100000-0000-4000-8000-000000000041'),
  'completed', 'the assessment is complete'
);
select throws_ok(
  $$select * from public.save_roof_assessment_ownership('98100000-0000-4000-8000-000000000001', '98100000-0000-4000-8000-000000000041', 10, 'not_owner', '{}', false)$$,
  'P0001', 'Assessment progress is unavailable', 'a completed assessment keeps its answer'
);

select * from finish();
rollback;

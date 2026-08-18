begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

select has_column('public', 'leads', 'source_submitted_at', 'leads retain source submission time');
select has_function(
  'public', 'submit_all_season_lead',
  array['uuid','uuid','text','text','text','text','text','timestamp with time zone','jsonb','text','text','text','integer','text','text','text'],
  'atomic All Season intake function exists'
);
select function_privs_are(
  'public', 'submit_all_season_lead',
  array['uuid','uuid','text','text','text','text','text','timestamp with time zone','jsonb','text','text','text','integer','text','text','text'],
  'anon', array[]::text[], 'anonymous clients cannot call All Season intake directly'
);
select function_privs_are(
  'public', 'submit_all_season_lead',
  array['uuid','uuid','text','text','text','text','text','timestamp with time zone','jsonb','text','text','text','integer','text','text','text'],
  'service_role', array['EXECUTE'], 'service role owns All Season intake'
);

insert into public.companies (id, name)
values ('a0000000-0000-4000-8000-000000000001', 'All Season Intake Test');

create temp table first_submission as
select * from public.submit_all_season_lead(
  'a0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000002',
  'Alex Rivera', '(201) 555-0100', 'alex@example.com',
  '1 Main St, Newark, NJ', 'solar', '2026-08-18T14:00:00Z',
  '{"fbclid":"click-123","fbp":"fb.1.100.200","fbc":null}'::jsonb,
  'all-season-quote-v1', '127.0.0.1', 'pgtap', 2,
  '+12015550100', 'alex@example.com', 'ChIJ-selected'
);

select is((select is_duplicate from first_submission), false, 'first submission is new');
select is(
  (select google_place_id from public.leads where id = (select lead_id from first_submission)),
  'ChIJ-selected', 'selected Google Place ID is persisted'
);
select is(
  (select service_requested from public.leads where id = (select lead_id from first_submission)),
  'solar', 'solar service interest is persisted'
);
select is(
  (select concat_ws('|', fbclid, fbp, coalesce(fbc, 'null'))
   from public.leads where id = (select lead_id from first_submission)),
  'click-123|fb.1.100.200|null',
  'Meta attribution is persisted'
);
select is(
  (select source_system from public.leads where id = (select lead_id from first_submission)),
  'all-season-website', 'website source is persisted'
);
select is(
  (select count(*) from public.lead_consents where lead_id = (select lead_id from first_submission)),
  3::bigint, 'processing, email, and SMS consents are recorded'
);
select is(
  (select count(*) from public.pipeline_runs where id = (select pipeline_run_id from first_submission)),
  1::bigint, 'submission starts one PIW pipeline run'
);
select is(
  (select count(*) from public.roof_estimates where lead_id = (select lead_id from first_submission)),
  1::bigint, 'submission starts one roof estimate for Solar enrichment'
);
select is(
  (select google_place_id from public.roof_estimates where lead_id = (select lead_id from first_submission)),
  'ChIJ-selected', 'roof estimate retains the selected Google Place ID'
);

create temp table duplicate_submission as
select * from public.submit_all_season_lead(
  'a0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000002',
  'Alex Rivera', '(201) 555-0100', 'alex@example.com',
  '1 Main St, Newark, NJ', 'solar', '2026-08-18T14:00:00Z',
  '{}'::jsonb, 'all-season-quote-v1', '127.0.0.1', 'pgtap', 2,
  '+12015550100', 'alex@example.com', 'ChIJ-selected'
);

select is((select is_duplicate from duplicate_submission), true, 'retry is identified as duplicate');
select is(
  (select count(*) from public.leads
   where source_system = 'all-season-website'
     and external_lead_id = 'a0000000-0000-4000-8000-000000000002'),
  1::bigint, 'retry creates only one lead'
);

select lives_ok(
  $$select * from public.submit_all_season_lead(
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000003',
    'Jamie Chen', '201-555-0101', 'jamie@example.com',
    '2 Main St, Newark, NJ', 'both', '2026-08-18T14:01:00Z',
    '{}'::jsonb, 'all-season-quote-v1', '127.0.0.1', 'pgtap', 2,
    '+12015550101', 'jamie@example.com', 'ChIJ-second'
  )$$,
  'combined roofing and solar interest is accepted'
);

select * from finish();
rollback;

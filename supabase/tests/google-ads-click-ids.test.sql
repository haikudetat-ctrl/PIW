begin;

select plan(13);

select has_column('public', 'leads', 'gclid', 'leads capture gclid');
select has_column('public', 'leads', 'gbraid', 'leads capture gbraid');
select has_column('public', 'leads', 'wbraid', 'leads capture wbraid');
select has_column('public', 'website_arrivals', 'gclid', 'arrivals capture gclid');
select has_column('public', 'website_arrivals_daily', 'google_paid_arrivals', 'daily rollup counts Google paid arrivals');

insert into public.companies (id, name) values
  ('9a000000-0000-4000-8000-000000000001', 'Google Click Company');

select * from public.start_or_resume_roof_assessment(
  '9a000000-0000-4000-8000-000000000001',
  '9a000000-0000-4000-8000-000000000010',
  'Alex Rivera', '+12015550190', 'google-click@example.com',
  '1 Main St, Newark, NJ 07102', 'ChIJ-google-click',
  'roof-replacement', 'campaign:roof-replacement',
  '{"utm_source":"google","utm_medium":"cpc","gclid":" Cj0KCQ-first ","gbraid":""}'::jsonb,
  'https://allseasonroofingquote.com/campaigns/roof-replacement', 'all-season-campaign-estimate-v2',
  '2026-10-06T14:00:00Z', '127.0.0.1', 'pgtap'
);

select is(
  (select gclid from public.leads where company_id = '9a000000-0000-4000-8000-000000000001'),
  'Cj0KCQ-first',
  'intake copies the trimmed gclid from the attribution touch onto the lead'
);
select ok(
  (select gbraid is null and wbraid is null from public.leads
   where company_id = '9a000000-0000-4000-8000-000000000001'),
  'blank and absent click IDs stay null'
);
select is(
  (select attribution ->> 'gclid' from public.lead_attribution_touches
   where submission_id = '9a000000-0000-4000-8000-000000000010'),
  ' Cj0KCQ-first ',
  'the raw attribution touch is kept unchanged'
);

-- A second visit by the same homeowner resumes the lead. First touch wins.
select * from public.start_or_resume_roof_assessment(
  '9a000000-0000-4000-8000-000000000001',
  '9a000000-0000-4000-8000-000000000011',
  'Alex Rivera', '+12015550190', 'google-click@example.com',
  '1 Main St, Newark, NJ 07102', 'ChIJ-google-click',
  'roof-replacement', 'campaign:roof-replacement',
  '{"gclid":"Cj0KCQ-second","wbraid":"w-second"}'::jsonb,
  null, 'all-season-campaign-estimate-v2',
  '2026-10-07T14:00:00Z', '127.0.0.1', 'pgtap'
);

select is(
  (select count(*) from public.lead_attribution_touches
   where company_id = '9a000000-0000-4000-8000-000000000001'),
  2::bigint,
  'the resumed visit appends its own attribution touch'
);
select ok(
  (select gclid = 'Cj0KCQ-first' and wbraid is null from public.leads
   where company_id = '9a000000-0000-4000-8000-000000000001'),
  'a later touch never overwrites the first-touch click IDs'
);

select throws_ok(
  $$insert into public.website_arrivals (company_id, request_path, campaign_slug, visitor_hash, is_likely_bot)
    values ('9a000000-0000-4000-8000-000000000001', '/campaigns/nope', 'not-a-campaign', repeat('a', 64), false)$$,
  '23514',
  null,
  'arrivals still reject unknown campaign slugs'
);

insert into public.website_arrivals (
  company_id, occurred_at, request_path, campaign_slug, visitor_hash, gclid, fbclid, is_likely_bot
) values
  ('9a000000-0000-4000-8000-000000000001', '2026-10-06 14:00:00+00', '/campaigns/roof-replacement',
   'roof-replacement', repeat('b', 64), 'Cj0KCQ', null, false),
  ('9a000000-0000-4000-8000-000000000001', '2026-10-06 14:01:00+00', '/campaigns/roof-replacement',
   'roof-replacement', repeat('c', 64), null, 'IwAR', false);

select is(
  (select google_paid_arrivals from public.website_arrivals_daily
   where company_id = '9a000000-0000-4000-8000-000000000001' and campaign_slug = 'roof-replacement'),
  1::bigint,
  'daily rollup counts Google paid arrivals separately'
);
select is(
  (select paid_arrivals from public.website_arrivals_daily
   where company_id = '9a000000-0000-4000-8000-000000000001' and campaign_slug = 'roof-replacement'),
  1::bigint,
  'paid_arrivals keeps counting Meta clicks only'
);

select * from finish();
rollback;

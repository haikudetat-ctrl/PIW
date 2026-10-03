begin;

select plan(17);

select has_function(
  'public', 'is_scanner_request_path', array['text'],
  'scanner path classifier exists'
);
select ok(public.is_scanner_request_path('/wp-admin/install.php'), 'wp-admin is a scanner path');
select ok(public.is_scanner_request_path('/xmlrpc.php'), 'any .php path is a scanner path');
select ok(public.is_scanner_request_path('/.env'), 'dotenv is a scanner path');
select ok(public.is_scanner_request_path('/.git/config'), 'git metadata is a scanner path');
select ok(not public.is_scanner_request_path('/'), 'the homepage is not a scanner path');
select ok(not public.is_scanner_request_path('/campaigns/for-every-season'), 'campaign pages are not scanner paths');
select ok(not public.is_scanner_request_path('/services/roofing.html'), 'site pages are not scanner paths');

insert into public.companies (id, name)
values ('fa000000-0000-4000-8000-000000000001', 'Quote Funnel Company');

insert into public.website_arrivals (
  company_id, occurred_at, request_path, campaign_slug, visitor_hash, user_agent, is_likely_bot
) values
  ('fa000000-0000-4000-8000-000000000001', '2026-10-01 14:00:00+00', '/wp-admin/install.php', null,
   repeat('a', 64), 'Mozilla/5.0', false),
  ('fa000000-0000-4000-8000-000000000001', '2026-10-01 14:01:00+00', '/', null,
   repeat('b', 64), 'Mozilla/5.0', false),
  ('fa000000-0000-4000-8000-000000000001', '2026-10-01 14:02:00+00', '/contact.html', null,
   repeat('b', 64), 'Mozilla/5.0', false),
  ('fa000000-0000-4000-8000-000000000001', '2026-10-01 14:03:00+00', '/campaigns/weather-report', 'weather-report',
   repeat('c', 64), 'Mozilla/5.0', false),
  ('fa000000-0000-4000-8000-000000000001', '2026-10-01 14:04:00+00', '/campaigns/weather-report', 'weather-report',
   repeat('d', 64), 'facebookexternalhit/1.1', true);

select ok(
  (select is_likely_bot from public.website_arrivals
   where company_id = 'fa000000-0000-4000-8000-000000000001' and request_path = '/wp-admin/install.php'),
  'inserting a scanner path flags the arrival as a bot even when the website did not'
);
select ok(
  not (select is_likely_bot from public.website_arrivals
       where company_id = 'fa000000-0000-4000-8000-000000000001' and request_path = '/'),
  'ordinary arrivals keep the website flag'
);

select throws_ok(
  $$update public.website_arrivals set experiment_arm = 'other'
    where company_id = 'fa000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'experiment_arm only accepts legacy or value_first'
);

insert into public.leads (id, company_id, name, phone, email, submitted_address, source_system, created_at)
values
  ('fa000000-0000-4000-8000-000000000011', 'fa000000-0000-4000-8000-000000000001',
   'Funnel Campaign', '+12015550101', 'funnel-campaign@example.com', '1 Main St, Newark, NJ 07102', 'all-season-website',
   '2026-10-01 15:00:00+00'),
  ('fa000000-0000-4000-8000-000000000012', 'fa000000-0000-4000-8000-000000000001',
   'Funnel Main', '+12015550102', 'funnel-main@example.com', '2 Main St, Newark, NJ 07102', 'all-season-website',
   '2026-10-02 15:00:00+00');

insert into public.lead_attribution_touches (
  company_id, lead_id, submission_id, entry_point, presentation_key
) values
  ('fa000000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000011',
   'fa000000-0000-4000-8000-000000000021', 'campaign:weather-report', 'weather-report'),
  ('fa000000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000012',
   'fa000000-0000-4000-8000-000000000022', 'main-home', 'all-season-main');

select results_eq(
  $$select funnel_date, campaign_visitor_days, main_site_visitor_days, campaign_leads, main_site_leads
    from public.quote_funnel_daily
    where company_id = 'fa000000-0000-4000-8000-000000000001'
    order by funnel_date$$,
  $$values
    ('2026-10-01'::date, 1::bigint, 1::bigint, 1::bigint, 0::bigint),
    ('2026-10-02'::date, 0::bigint, 0::bigint, 0::bigint, 1::bigint)$$,
  'funnel counts non-bot visitor-days per surface and leads by entry point, including lead-only days'
);

create temp table funnel_preview as select * from public.create_property_preview(
  'fa000000-0000-4000-8000-000000000001', pg_catalog.repeat('9', 64),
  '9 Funnel St, Newark, NJ 07102', null, 'manual', null, 'main-home', 'all-season-main',
  '{}', null, 'all-season-property-preview-v1', pg_catalog.now(), '203.0.113.90', 'pgtap'
);
create temp table funnel_progress as select 1 as marked from public.mark_property_preview_progress(
  'fa000000-0000-4000-8000-000000000001', pg_catalog.repeat('9', 64), 'revealed'
);

select results_eq(
  $$select previews_created, previews_revealed, previews_contact_viewed, reports_saved, previews_converted
    from public.quote_funnel_daily
    where company_id = 'fa000000-0000-4000-8000-000000000001'
      and funnel_date = (pg_catalog.now() at time zone 'America/New_York')::date$$,
  $$values (1::bigint, 1::bigint, 0::bigint, 0::bigint, 0::bigint)$$,
  'previews are counted by creation day through each funnel step'
);

select table_privs_are(
  'public', 'quote_funnel_daily', 'anon', array[]::text[],
  'anonymous clients cannot read the funnel'
);
select table_privs_are(
  'public', 'quote_funnel_daily', 'authenticated', array[]::text[],
  'authenticated clients cannot read the funnel'
);
select ok(
  has_table_privilege('service_role', 'public.quote_funnel_daily', 'select'),
  'the service role reads the funnel'
);
select ok(
  not has_function_privilege('anon', 'public.is_scanner_request_path(text)', 'execute'),
  'anonymous clients cannot execute the classifier'
);

select * from finish();
rollback;

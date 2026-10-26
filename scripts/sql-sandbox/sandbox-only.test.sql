-- Checks that need fixtures the shared pgTAP test cannot build cheaply
-- against the full schema (roof assessments need estimates; admin profiles
-- need auth users). Runs only in the sandbox.
begin;
select plan(13);

insert into public.companies(id, name) values ('9b000000-0000-4000-8000-000000000001', 'Sandbox Co');
insert into public.company_google_ads_settings (company_id, customer_id, uploads_enabled, dry_run, qualified_lead_action_id, monthly_budget_usd)
values ('9b000000-0000-4000-8000-000000000001', '1234567890', true, false, '111', 2500);
insert into public.admin_profiles (id, company_id, role) values
  ('9b000000-0000-4000-8000-000000000901', '9b000000-0000-4000-8000-000000000001', 'manager'),
  ('9b000000-0000-4000-8000-000000000902', '9b000000-0000-4000-8000-000000000001', 'employee');

insert into public.leads (id, company_id, submitted_address, phone_e164, email_normalized, created_at) values
  ('9b000000-0000-4000-8000-000000000101', '9b000000-0000-4000-8000-000000000001', '1 A St, Trenton, NJ', '+16095550201', 'a@x.invalid', '2026-10-24T13:00:00Z'),
  ('9b000000-0000-4000-8000-000000000102', '9b000000-0000-4000-8000-000000000001', '2 B St, Trenton, NJ', '+16095550202', 'b@x.invalid', '2026-10-24T13:00:00Z'),
  ('9b000000-0000-4000-8000-000000000103', '9b000000-0000-4000-8000-000000000001', '3 C St, Trenton, NJ', '+16095550203', 'c@x.invalid', '2026-10-01T13:00:00Z');
insert into public.lead_ad_attribution (company_id, lead_id, channel, click_id_type, gclid, clicked_at, token_verified, google_ad_group_id, google_target_id, google_keyword)
values
  ('9b000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000101', 'google_ads', 'gclid', 'g-a', '2026-10-24T12:59:00Z', true, '555', 'kwd-777', 'roof replacement'),
  ('9b000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000102', 'google_ads', 'gclid', 'g-b', '2026-10-24T12:59:00Z', true, '555', 'kwd-777', 'roof replacement'),
  ('9b000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000103', 'google_ads', 'gclid', 'g-c', '2026-10-01T12:59:00Z', true, '555', 'kwd-777', 'roof replacement');
insert into public.roof_assessments (company_id, lead_id, responses) values
  ('9b000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000101', '{"ownership": "owner"}'),
  ('9b000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000102', '{"ownership": "not_owner"}');

-- Sold before the click: an existing customer's job.
insert into public.customers (id, company_id) values ('9b000000-0000-4000-8000-000000000501', '9b000000-0000-4000-8000-000000000001');
insert into public.customer_identities values ('9b000000-0000-4000-8000-000000000001', 'piw_lead', '9b000000-0000-4000-8000-000000000103', '9b000000-0000-4000-8000-000000000501');
insert into public.customer_journey_events values
  ('9b000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000501', 'sold', '2026-09-20T00:00:00Z', 'jobnimbus_job', 'jn-1', false);
insert into public.jn_jobs values ('9b000000-0000-4000-8000-000000000001', 'jn-1', 14250);

insert into public.ad_spend_daily (company_id, spend_date, grain, campaign_id, ad_group_id, criterion_id, keyword_text, cost_micros, clicks, impressions)
values ('9b000000-0000-4000-8000-000000000001', '2026-10-24', 'campaign', '42', '', '', null, 85000000, 7, 210),
       ('9b000000-0000-4000-8000-000000000001', '2026-10-24', 'keyword', '42', '555', '777', 'roof replacement', 60000000, 5, 150);

select public.enqueue_google_ads_conversions('9b000000-0000-4000-8000-000000000001', '2026-10-24T14:00:00Z');

select is((select status from public.ad_conversion_deliveries where lead_id = '9b000000-0000-4000-8000-000000000101' and event_name = 'qualified_lead'),
  'pending', 'an owner qualifies right away, without the 24 hour wait');
select is((select skip_reason from public.ad_conversion_deliveries where lead_id = '9b000000-0000-4000-8000-000000000102' and event_name = 'qualified_lead'),
  'not_homeowner', 'a non-owner is skipped');
select is((select skip_reason from public.ad_conversion_deliveries where lead_id = '9b000000-0000-4000-8000-000000000103' and event_name = 'sold'),
  'before_click', 'a sale before the click is not credited to the ad');
select is((select skip_reason from public.ad_conversion_deliveries where lead_id = '9b000000-0000-4000-8000-000000000103' and event_name = 'qualified_lead'),
  'existing_customer', 'a lead from someone who already bought is not a new qualified lead');
select is((select conversion_value from public.ad_conversion_deliveries where lead_id = '9b000000-0000-4000-8000-000000000103' and event_name = 'sold'),
  14250.00::numeric, 'the sold row keeps the approved total for reporting');

-- Flagging is manager-only.
select set_config('test.uid', '9b000000-0000-4000-8000-000000000902', true);
select throws_ok($$ select public.flag_lead_quality('9b000000-0000-4000-8000-000000000101', 'spam') $$, '42501', null, 'employees cannot flag leads');
select throws_ok($$ select public.report_paid_search('2026-10-01', '2026-10-26') $$, '42501', null, 'employees cannot read the paid search report');
select set_config('test.uid', '9b000000-0000-4000-8000-000000000901', true);
select is((public.flag_lead_quality('9b000000-0000-4000-8000-000000000102', 'spam', ' junk ')).note, 'junk', 'managers can flag a lead');
select throws_ok($$ select public.flag_lead_quality('9b000000-0000-4000-8000-000000000102', 'bogus') $$, '23514', null, 'unknown flags are rejected');

create temp table report as select public.report_paid_search('2026-10-01T04:00:00Z', '2026-10-26T04:00:00Z') as r;
select is(((select r from report) ->> 'leads')::integer, 3, 'the report counts Google leads in range');
select is(((select r from report) ->> 'spend')::numeric, 85.0, 'the report totals campaign spend only');
select is(((select r from report) -> 'keywords' -> 0 ->> 'leads')::integer, 3, 'keyword rows join leads by ad group and criterion');

create temp table health as select public.paid_search_health('9b000000-0000-4000-8000-000000000001', '2026-10-25T14:00:00Z') as h;
select is(((select h from health) ->> 'monthly_budget_usd')::numeric, 2500.00, 'health reports the budget');

select * from finish();
rollback;

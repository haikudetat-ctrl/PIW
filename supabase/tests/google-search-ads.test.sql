begin;

select plan(40);

-- Fixture: one company with Google Ads settings, one control company.
insert into public.companies(id, name) values
  ('9a000000-0000-4000-8000-000000000001', 'Google Ads Company'),
  ('9a000000-0000-4000-8000-000000000002', 'Google Ads Control');

insert into public.company_google_ads_settings (
  company_id, customer_id, uploads_enabled, dry_run, qualified_lead_action_id,
  appointment_set_action_id, appointment_ran_action_id, sold_action_id
) values (
  '9a000000-0000-4000-8000-000000000001', '1234567890', true, false, '111', '222', '333', '444'
);

-- Leads (created 2 days before the reference time unless noted).
insert into public.leads (id, company_id, name, phone, email, submitted_address, phone_e164, email_normalized, created_at, is_test)
values
  -- qualifies
  ('9a000000-0000-4000-8000-000000000101', '9a000000-0000-4000-8000-000000000001', 'Ann', '609-555-0101', 'ann@example.invalid',
   '1 Main St, Cherry Hill, NJ 08002', '+16095550101', 'ann@example.invalid', '2026-10-20T14:00:00Z', false),
  -- invalid phone
  ('9a000000-0000-4000-8000-000000000102', '9a000000-0000-4000-8000-000000000001', 'Bo', '555', 'bo@example.invalid',
   '2 Main St, Camden, NJ 08101', '+11235550102', 'bo@example.invalid', '2026-10-20T14:00:00Z', false),
  -- out of area
  ('9a000000-0000-4000-8000-000000000103', '9a000000-0000-4000-8000-000000000001', 'Cy', '215-555-0103', 'cy@example.invalid',
   '3 Main St, Philadelphia, PA 19103', '+12155550103', 'cy@example.invalid', '2026-10-20T14:00:00Z', false),
  -- earlier lead with the same phone as the duplicate below
  ('9a000000-0000-4000-8000-000000000104', '9a000000-0000-4000-8000-000000000001', 'Di', '856-555-0104', 'di@example.invalid',
   '4 Main St, Voorhees, NJ 08043', '+18565550104', 'di@example.invalid', '2026-10-10T14:00:00Z', false),
  -- duplicate within 30 days
  ('9a000000-0000-4000-8000-000000000105', '9a000000-0000-4000-8000-000000000001', 'Di again', '856-555-0104', 'di2@example.invalid',
   '4 Main St, Voorhees, NJ 08043', '+18565550104', 'di2@example.invalid', '2026-10-20T14:00:00Z', false),
  -- too recent: waits for the ownership answer
  ('9a000000-0000-4000-8000-000000000106', '9a000000-0000-4000-8000-000000000001', 'Ed', '609-555-0106', 'ed@example.invalid',
   '6 Main St, Marlton, NJ 08053', '+16095550106', 'ed@example.invalid', '2026-10-22T13:00:00Z', false),
  -- test lead: never a candidate
  ('9a000000-0000-4000-8000-000000000107', '9a000000-0000-4000-8000-000000000001', 'Test', '609-555-0107', 'test@example.invalid',
   '7 Main St, Marlton, NJ 08053', '+16095550107', 'test@example.invalid', '2026-10-20T14:00:00Z', true),
  -- flagged as spam
  ('9a000000-0000-4000-8000-000000000108', '9a000000-0000-4000-8000-000000000001', 'Spam', '609-555-0108', 'spam@example.invalid',
   '8 Main St, Marlton, NJ 08053', '+16095550108', 'spam@example.invalid', '2026-10-20T14:00:00Z', false),
  -- Meta lead: not a Google candidate
  ('9a000000-0000-4000-8000-000000000109', '9a000000-0000-4000-8000-000000000001', 'Fay', '609-555-0109', 'fay@example.invalid',
   '9 Main St, Marlton, NJ 08053', '+16095550109', 'fay@example.invalid', '2026-10-20T14:00:00Z', false);

insert into public.lead_ad_attribution (company_id, lead_id, channel, click_id_type, gclid, clicked_at, token_verified, google_ad_group_id, google_keyword, google_target_id)
select '9a000000-0000-4000-8000-000000000001', lead_id::uuid, channel, click_id_type, gclid, clicked_at::timestamptz, true, '555', 'roof replacement', 'kwd-777'
from (values
  ('9a000000-0000-4000-8000-000000000101', 'google_ads', 'gclid', 'gclid-ann', '2026-10-20T13:55:00Z'),
  ('9a000000-0000-4000-8000-000000000102', 'google_ads', 'gclid', 'gclid-bo', '2026-10-20T13:55:00Z'),
  ('9a000000-0000-4000-8000-000000000103', 'google_ads', 'gclid', 'gclid-cy', '2026-10-20T13:55:00Z'),
  ('9a000000-0000-4000-8000-000000000105', 'google_ads', 'gclid', 'gclid-di2', '2026-10-20T13:55:00Z'),
  ('9a000000-0000-4000-8000-000000000106', 'google_ads', 'gclid', 'gclid-ed', '2026-10-22T12:55:00Z'),
  ('9a000000-0000-4000-8000-000000000107', 'google_ads', 'gclid', 'gclid-test', '2026-10-20T13:55:00Z'),
  ('9a000000-0000-4000-8000-000000000108', 'google_ads', 'gclid', 'gclid-spam', '2026-10-20T13:55:00Z'),
  ('9a000000-0000-4000-8000-000000000109', 'meta_ads', null, null, '2026-10-20T13:55:00Z')
) as fixture(lead_id, channel, click_id_type, gclid, clicked_at);

insert into public.lead_quality_flags (company_id, lead_id, flag, flagged_at)
values ('9a000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000108', 'spam', '2026-10-21T00:00:00Z');

-- Ann booked and kept an appointment.
insert into public.appointments (company_id, lead_id, scheduled_at, status, created_at)
values ('9a000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000101',
  '2026-10-21T15:00:00Z', 'completed', '2026-10-20T15:00:00Z');

-- 1. Arrival slugs ------------------------------------------------------------

select lives_ok(
  $$ insert into public.website_arrivals (company_id, request_path, campaign_slug, visitor_hash, gclid, google_campaign_id)
     values ('9a000000-0000-4000-8000-000000000001', '/roof-replacement', 'roof-replacement', repeat('a', 64), 'g1', '123') $$,
  'arrivals accept a Google search landing slug and click ID'
);
select throws_ok(
  $$ insert into public.website_arrivals (company_id, request_path, campaign_slug, visitor_hash)
     values ('9a000000-0000-4000-8000-000000000001', '/x', 'not-a-page', repeat('a', 64)) $$,
  '23514', null,
  'arrivals still reject an unknown landing slug'
);

-- 2. Order IDs ----------------------------------------------------------------

select is(
  public.ad_conversion_order_id('qualified_lead', '9a000000-0000-4000-8000-000000000101'),
  'ql-9a000000000040008000000000000101',
  'order IDs are deterministic per event and lead'
);
select isnt(
  public.ad_conversion_order_id('sold', '9a000000-0000-4000-8000-000000000101'),
  public.ad_conversion_order_id('qualified_lead', '9a000000-0000-4000-8000-000000000101'),
  'order IDs differ by event'
);

-- 3. Enqueue ------------------------------------------------------------------

select is(
  (public.enqueue_google_ads_conversions('9a000000-0000-4000-8000-000000000002', '2026-10-22T14:00:00Z') ->> 'configured')::boolean,
  false,
  'a company without settings enqueues nothing'
);

create temp table first_run as
select public.enqueue_google_ads_conversions('9a000000-0000-4000-8000-000000000001', '2026-10-22T14:00:00Z') as result;

select is(
  (select status from public.ad_conversion_deliveries where lead_id = '9a000000-0000-4000-8000-000000000101' and event_name = 'qualified_lead'),
  'pending', 'a valid NJ lead past the ownership wait is queued as qualified'
);
select is(
  (select conversion_time from public.ad_conversion_deliveries where lead_id = '9a000000-0000-4000-8000-000000000101' and event_name = 'qualified_lead'),
  '2026-10-20T14:00:00Z'::timestamptz, 'the qualified conversion is timed at lead submission'
);
select is(
  (select skip_reason from public.ad_conversion_deliveries where lead_id = '9a000000-0000-4000-8000-000000000102' and event_name = 'qualified_lead'),
  'invalid_phone', 'an invalid phone is recorded as skipped'
);
select is(
  (select skip_reason from public.ad_conversion_deliveries where lead_id = '9a000000-0000-4000-8000-000000000103' and event_name = 'qualified_lead'),
  'out_of_area', 'a non-NJ address is recorded as skipped'
);
select is(
  (select skip_reason from public.ad_conversion_deliveries where lead_id = '9a000000-0000-4000-8000-000000000105' and event_name = 'qualified_lead'),
  'duplicate_30_days', 'a repeat phone within 30 days is a duplicate'
);
select is(
  (select count(*)::integer from public.ad_conversion_deliveries where lead_id = '9a000000-0000-4000-8000-000000000106'),
  0, 'a lead under 24 hours old with no ownership answer waits'
);
select is(
  (select count(*)::integer from public.ad_conversion_deliveries where lead_id = '9a000000-0000-4000-8000-000000000107'),
  0, 'test leads are never candidates'
);
select is(
  (select skip_reason from public.ad_conversion_deliveries where lead_id = '9a000000-0000-4000-8000-000000000108' and event_name = 'qualified_lead'),
  'lead_flagged', 'a flagged lead is skipped'
);
select is(
  (select count(*)::integer from public.ad_conversion_deliveries where lead_id = '9a000000-0000-4000-8000-000000000109'),
  0, 'Meta-attributed leads are not uploaded to Google'
);
select is(
  (select status from public.ad_conversion_deliveries where lead_id = '9a000000-0000-4000-8000-000000000101' and event_name = 'appointment_set'),
  'pending', 'a PIW appointment queues appointment_set'
);
select is(
  (select conversion_time from public.ad_conversion_deliveries where lead_id = '9a000000-0000-4000-8000-000000000101' and event_name = 'appointment_ran'),
  '2026-10-21T15:00:00Z'::timestamptz, 'a completed appointment queues appointment_ran at its scheduled time'
);

select is(
  (public.enqueue_google_ads_conversions('9a000000-0000-4000-8000-000000000001', '2026-10-22T14:00:00Z') ->> 'enqueued')::integer,
  0, 'enqueue is idempotent'
);

-- After 24 hours Ed qualifies without an ownership answer.
select public.enqueue_google_ads_conversions('9a000000-0000-4000-8000-000000000001', '2026-10-23T14:00:00Z');
select is(
  (select status from public.ad_conversion_deliveries where lead_id = '9a000000-0000-4000-8000-000000000106' and event_name = 'qualified_lead'),
  'pending', 'an unanswered lead qualifies after the 24 hour wait'
);

-- 4. Consent ------------------------------------------------------------------

select is(
  public.ad_conversion_consent_state('9a000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000101', '2026-10-22T14:00:00Z'),
  'unknown', 'no evidence means unknown consent'
);
insert into public.privacy_consent_evidence (evidence_id, consent_id, company_id, lead_id, policy_version, analytics_granted, advertising_granted, gpc_detected, source, occurred_at)
values (
  '9a000000-0000-4000-8000-000000000301', '9a000000-0000-4000-8000-000000000401',
  '9a000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000101',
  'piw-privacy-v1', true, true, false, 'banner', '2026-10-20T14:00:00Z'
);
select is(
  public.ad_conversion_consent_state('9a000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000101', '2026-10-22T14:00:00Z'),
  'granted', 'recorded Advertising consent is granted'
);
-- A later revocation from the banner, recorded without the lead, still wins.
insert into public.privacy_consent_evidence (evidence_id, consent_id, company_id, lead_id, policy_version, analytics_granted, advertising_granted, gpc_detected, source, occurred_at)
values (
  '9a000000-0000-4000-8000-000000000302', '9a000000-0000-4000-8000-000000000401',
  '9a000000-0000-4000-8000-000000000001', null,
  'piw-privacy-v1', true, false, false, 'preferences', '2026-10-21T14:00:00Z'
);
select is(
  public.ad_conversion_consent_state('9a000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000101', '2026-10-22T14:00:00Z'),
  'denied', 'a later revocation for the same consent ID denies the upload'
);
select is(
  public.ad_conversion_consent_state('9a000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000101', '2026-10-20T20:00:00Z'),
  'granted', 'consent is evaluated as of the given time'
);

-- 5. Claim and complete -------------------------------------------------------

create temp table due as
select id from public.list_due_ad_conversions(50, '2026-10-23T14:00:00Z');
select ok((select count(*) from due) >= 3, 'due deliveries are listed');

create temp table claimed as
select * from public.claim_ad_conversion(
  (select id from public.ad_conversion_deliveries where lead_id = '9a000000-0000-4000-8000-000000000101' and event_name = 'qualified_lead'),
  '2026-10-23T14:00:00Z'
);
select is((select click_id from claimed), 'gclid-ann', 'the claim returns the click ID');
select is((select conversion_action_id from claimed), '111', 'the claim returns the event''s conversion action');
select is((select customer_id from claimed), '1234567890', 'the claim returns the customer ID');
select is((select consent_state from claimed), 'denied', 'the claim reports consent at send time');
select is(
  (select count(*)::integer from public.claim_ad_conversion((select id from claimed), '2026-10-23T14:01:00Z')),
  0, 'a claimed delivery cannot be claimed twice'
);

select is(
  (select status from public.complete_ad_conversion((select id from claimed), 'skipped', '2026-10-23T14:00:05Z', null, null, null, null, 'advertising_consent_denied')),
  'skipped', 'denied consent completes as skipped'
);

create temp table claimed_set as
select * from public.claim_ad_conversion(
  (select id from public.ad_conversion_deliveries where lead_id = '9a000000-0000-4000-8000-000000000101' and event_name = 'appointment_set'),
  '2026-10-23T14:00:00Z'
);
select is(
  (select status from public.complete_ad_conversion((select id from claimed_set), 'retryable_failed', '2026-10-23T14:00:05Z', 503, 'http_503')),
  'retryable_failed', 'a retryable failure is recorded'
);
select is(
  (select next_attempt_at from public.ad_conversion_deliveries where id = (select id from claimed_set)),
  '2026-10-23T14:05:05Z'::timestamptz, 'the first retry backs off five minutes'
);
select is(
  (select count(*)::integer from public.list_due_ad_conversions(50, '2026-10-23T14:01:00Z') where id = (select id from claimed_set)),
  0, 'a backed-off delivery is not due yet'
);

create temp table claimed_ran as
select * from public.claim_ad_conversion(
  (select id from public.ad_conversion_deliveries where lead_id = '9a000000-0000-4000-8000-000000000101' and event_name = 'appointment_ran'),
  '2026-10-23T14:00:00Z'
);
select is(
  (select status from public.complete_ad_conversion((select id from claimed_ran), 'sent', '2026-10-23T14:00:05Z', 200, null, repeat('b', 64), 'req-1', null, false, true)),
  'sent', 'a successful upload is recorded as sent'
);

-- 6. Retraction ---------------------------------------------------------------

insert into public.lead_quality_flags (company_id, lead_id, flag, flagged_at)
values ('9a000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000101', 'invalid', '2026-10-24T00:00:00Z');
select public.enqueue_google_ads_conversions('9a000000-0000-4000-8000-000000000001', '2026-10-24T01:00:00Z');
select is(
  (select retraction_status from public.ad_conversion_deliveries where id = (select id from claimed_ran)),
  'pending', 'a sent conversion for a lead flagged within 14 days is queued for retraction'
);
select is(
  (select skip_reason from public.ad_conversion_deliveries where id = (select id from claimed_set)),
  'lead_flagged', 'an unsent conversion for a newly flagged lead is skipped'
);
select is(
  (select count(*)::integer from public.list_due_ad_conversion_retractions(10, '2026-10-24T01:00:00Z')),
  1, 'the retraction is listed with its conversion action'
);
select public.complete_ad_conversion_retraction((select id from claimed_ran), true, '2026-10-24T01:00:05Z');
select is(
  (select retraction_status from public.ad_conversion_deliveries where id = (select id from claimed_ran)),
  'sent', 'a completed retraction is recorded'
);

-- 7. Access -------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.ad_conversion_deliveries', 'select'),
  'signed-in users cannot read the delivery ledger directly'
);
select ok(
  not has_function_privilege('authenticated', 'public.claim_ad_conversion(uuid, timestamptz)', 'execute'),
  'signed-in users cannot claim deliveries'
);

-- 8. Retention ----------------------------------------------------------------

update public.lead_ad_attribution set recorded_at = '2025-01-01T00:00:00Z', last_touch = '{"gclid": "x", "utm_source": "google"}'
where lead_id = '9a000000-0000-4000-8000-000000000102';
select public.purge_expired_click_ids('2026-10-25T00:00:00Z');
select is(
  (select last_touch from public.lead_ad_attribution where lead_id = '9a000000-0000-4000-8000-000000000102'),
  '{"utm_source": "google"}'::jsonb, 'click IDs older than 13 months are purged, campaign tags kept'
);

select * from finish();
rollback;

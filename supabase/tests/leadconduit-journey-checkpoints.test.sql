begin;

select plan(11);

insert into public.companies(id, name)
values ('97000000-0000-4000-8000-000000000001', 'Checkpoint Company');

-- flow:
--   lead-delivered: intake → corelogic → delivered (old enough to redact at 30d)
--   lead-early:     intake only (filtered before CoreLogic)
--   lead-late:      intake → corelogic candidate, never delivered
--   lead-fresh:     intake only, still inside the in-flight grace period
--   bookend-*:      deliveries either side of lead-late, proving the delivered
--                   recipient was live when it entered
-- flow-unwired: intake only; the delivered recipient never fired, so PIW cannot
--   tell filtered from delivered
-- flow-no-corelogic: deliveries either side of an undelivered lead, but no
--   CoreLogic recipient, so where it stopped is unknown
insert into public.leadconduit_events(
  company_id, event_id, flow_id, lead_id, event_type, occurred_at, raw_payload,
  lead_name, submitted_phone, submitted_email, submitted_address, phone_normalized,
  reason_category, source_name, attribution,
  ingestion_channels, first_observed_at, webhook_received_at, processing_status
)
select
  '97000000-0000-4000-8000-000000000001', fixture.event_id, fixture.flow_id, fixture.lead_id,
  fixture.event_type, now() - fixture.age, '{}'::jsonb,
  fixture.lead_name, fixture.submitted_phone, fixture.submitted_email,
  fixture.submitted_address, fixture.phone_normalized, fixture.reason_category,
  fixture.source_name, fixture.attribution::jsonb,
  array['webhook'], now() - fixture.age, now() - fixture.age, 'not_applicable'
from (values
  ('flow', 'e1', 'lead-delivered', 'checkpoint_intake', interval '40 days', 'Delivered Person', '609-555-0101', 'd@example.invalid', '1 Main', '+16095550101', null, 'Source A', '{}'),
  ('flow', 'e2', 'lead-delivered', 'shadow_checkpoint', interval '40 days', null, null, null, null, null, null, 'Source A', '{}'),
  ('flow', 'e3', 'lead-delivered', 'checkpoint_delivered', interval '40 days', null, null, null, null, '+16095550101', null, 'Source A', '{}'),
  ('flow', 'e4', 'lead-early', 'checkpoint_intake', interval '40 days', 'Early Person', '609-555-0102', null, '2 Main', '+16095550102', null, 'Source B', '{"piw_reference": "11111111-1111-4111-8111-111111111111"}'),
  ('flow', 'e5', 'lead-late', 'checkpoint_intake', interval '3 hours', 'Late Person', '609-555-0103', null, '3 Main', '+16095550103', null, 'Source B', '{}'),
  ('flow', 'e6', 'lead-late', 'shadow_checkpoint', interval '3 hours', null, null, null, null, null, 'vacant_property_classification', 'Source B', '{}'),
  ('flow', 'e7', 'lead-fresh', 'checkpoint_intake', interval '10 minutes', 'Fresh Person', null, null, null, null, null, 'Source B', '{}'),
  ('flow', 'e8', 'bookend-before', 'checkpoint_delivered', interval '4 hours', null, null, null, null, '+16095550104', null, 'Source A', '{}'),
  ('flow', 'e9', 'bookend-after', 'checkpoint_delivered', interval '150 minutes', null, null, null, null, '+16095550105', null, 'Source A', '{}'),
  ('flow-unwired', 'e10', 'lead-unwired', 'checkpoint_intake', interval '40 days', 'Unwired Person', '609-555-0106', null, '6 Main', '+16095550106', null, 'Source C', '{}'),
  ('flow-no-corelogic', 'e11', 'nc-before', 'checkpoint_delivered', interval '5 days', null, null, null, null, '+16095550107', null, 'Source C', '{}'),
  ('flow-no-corelogic', 'e12', 'nc-filtered', 'checkpoint_intake', interval '4 days', 'Unknown Stop', '609-555-0108', null, '8 Main', '+16095550108', null, 'Source C', '{}'),
  ('flow-no-corelogic', 'e13', 'nc-after', 'checkpoint_delivered', interval '3 days', null, null, null, null, '+16095550109', null, 'Source C', '{}')
) as fixture(
  flow_id, event_id, lead_id, event_type, age, lead_name, submitted_phone, submitted_email,
  submitted_address, phone_normalized, reason_category, source_name, attribution
);

select is(
  (select array_agg(lead_id order by lead_id) from public.leadconduit_filtered_leads
   where company_id = '97000000-0000-4000-8000-000000000001'),
  array['lead-early', 'lead-late', 'nc-filtered'],
  'filtered leads exclude delivered, still-in-flight and unprovable leads'
);

select is(
  (select count(*) from public.leadconduit_filtered_leads where lead_id = 'lead-unwired'),
  0::bigint,
  'a flow whose delivered recipient never fired calls nothing filtered'
);

select is(
  (select stopped_at from public.leadconduit_filtered_leads where lead_id = 'nc-filtered'),
  'unknown',
  'without a live CoreLogic recipient the stop point is unknown'
);

select is(
  (select stopped_at from public.leadconduit_filtered_leads where lead_id = 'lead-early'),
  'before_corelogic',
  'a lead with no CoreLogic checkpoint stopped before CoreLogic'
);

select is(
  (select stopped_at || ':' || likely_filter_category from public.leadconduit_filtered_leads where lead_id = 'lead-late'),
  'after_corelogic:vacant_property_classification',
  'a lead that passed CoreLogic carries its likely filter category'
);

select is(
  (select piw_reference from public.leadconduit_filtered_leads where lead_id = 'lead-early'),
  '11111111-1111-4111-8111-111111111111',
  'the PIW reference is exposed for matching'
);

select is(
  public.redact_leadconduit_checkpoint_contacts(
    '97000000-0000-4000-8000-000000000001', interval '30 days', interval '90 days'),
  1,
  'only the delivered lead is past its retention age'
);

select is(
  (select row(lead_name, submitted_phone, submitted_email, submitted_address)::text
   from public.leadconduit_events where event_id = 'e1'),
  row(null::text, null::text, null::text, null::text)::text,
  'redaction clears submitted contact details'
);

select is(
  (select phone_normalized from public.leadconduit_events where event_id = 'e1'),
  '+16095550101',
  'redaction keeps the normalized matching key'
);

select is(
  (select lead_name from public.leadconduit_events where event_id = 'e4'),
  'Early Person',
  'a filtered lead keeps contact details until the longer recovery window'
);

set local role authenticated;

select throws_ok(
  $$select count(*) from public.leadconduit_filtered_leads$$,
  '42501',
  null,
  'authenticated users cannot read filtered-lead contact details'
);

reset role;

select * from finish();

rollback;

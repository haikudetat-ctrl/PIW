begin;

select plan(15);

insert into public.companies(id, name) values
  ('99100000-0000-4000-8000-000000000001', 'Quality Company'),
  ('99100000-0000-4000-8000-000000000002', 'Quality Control');

update public.companies set service_states = array['NJ']
where id = '99100000-0000-4000-8000-000000000001';

-- q-first:       complete lead
-- q-repeat:      same phone as q-first, another vendor, 5 days later
-- q-blank:       blank address and missing details; its JobNimbus contact
--                arrived hours before it (its own handoff, not a prior customer)
-- q-known:       out of state; JobNimbus has had this email for 200 days
-- q-old/q-return: same phone 45 days apart, outside the repeat window
-- q-redacted:    contact details cleared by retention
-- q-no-city:     the vendor sent a blank city
-- q-test:        test traffic
-- q-first delivered: not an intake row
insert into public.leadconduit_events(
  company_id, event_id, flow_id, lead_id, event_type, occurred_at, raw_payload,
  lead_name, submitted_phone, submitted_email, submitted_address, trustedform_url,
  phone_normalized, email_normalized, source_name, is_test,
  ingestion_channels, first_observed_at, webhook_received_at, processing_status
)
select
  '99100000-0000-4000-8000-000000000001', fixture.event_id, 'flow-q', fixture.lead_id,
  fixture.event_type, now() - fixture.age, '{}'::jsonb,
  fixture.lead_name, fixture.submitted_phone, fixture.submitted_email, fixture.submitted_address,
  fixture.trustedform_url, fixture.phone_normalized, fixture.email_normalized, fixture.source_name,
  fixture.is_test, array['webhook'], now() - fixture.age, now() - fixture.age, 'not_applicable'
from (values
  ('q1', 'q-first', 'checkpoint_intake', interval '10 days', 'First Person', '609-555-0301', 'first@example.invalid',
   '12 Oak St, Cherry Hill, NJ 08002', 'https://cert.trustedform.com/abc', '+16095550301', 'first@example.invalid', 'Vendor A', false),
  ('q2', 'q-repeat', 'checkpoint_intake', interval '5 days', 'First Person', '609-555-0301', null,
   '12 Oak St, Cherry Hill, NJ 08002', 'https://cert.trustedform.com/def', '+16095550301', null, 'Vendor B', false),
  ('q3', 'q-blank', 'checkpoint_intake', interval '2 days', null, '609-555-0302', null,
   ', ,', null, '+16095550302', null, 'Vendor C', false),
  ('q4', 'q-known', 'checkpoint_intake', interval '1 day', 'Known Person', null, 'known@example.invalid',
   '9 Elm Rd, Boston, MA 02108-1234', 'https://cert.trustedform.com/ghi', null, 'known@example.invalid', 'Vendor A', false),
  ('q5', 'q-old', 'checkpoint_intake', interval '50 days', 'Return Person', '609-555-0303', null,
   '3 Pine Ave, Voorhees, NJ 08043', null, '+16095550303', null, 'Vendor A', false),
  ('q6', 'q-return', 'checkpoint_intake', interval '5 days', 'Return Person', '609-555-0303', null,
   '3 Pine Ave, Voorhees, NJ 08043', null, '+16095550303', null, 'Vendor A', false),
  ('q7', 'q-redacted', 'checkpoint_intake', interval '3 days', null, null, null,
   null, null, '+16095550304', null, 'Vendor B', false),
  ('q8', 'q-test', 'checkpoint_intake', interval '1 day', 'Test Person', '609-555-0305', null,
   '1 Test Way, Camden, NJ 08101', null, '+16095550305', null, 'Vendor A', true),
  ('q9', 'q-first', 'checkpoint_delivered', interval '10 days', null, null, null,
   null, null, '+16095550301', null, 'Vendor A', false),
  ('q10', 'q-no-city', 'checkpoint_intake', interval '6 days', 'No City', '609-555-0307', null,
   '4 Bay Rd, , MA 02108', null, '+16095550307', null, 'Vendor B', false)
) as fixture(
  event_id, lead_id, event_type, age, lead_name, submitted_phone, submitted_email, submitted_address,
  trustedform_url, phone_normalized, email_normalized, source_name, is_test
);

insert into public.leadconduit_events(
  company_id, event_id, flow_id, lead_id, event_type, occurred_at, raw_payload,
  lead_name, phone_normalized, source_name, ingestion_channels, first_observed_at,
  webhook_received_at, processing_status
) values (
  '99100000-0000-4000-8000-000000000002', 'other-1', 'flow-other', 'other-lead', 'checkpoint_intake',
  now() - interval '1 day', '{}'::jsonb, 'Other Tenant', '+16095550306', 'Vendor A',
  array['webhook'], now(), now(), 'not_applicable'
);

insert into public.jn_contacts(company_id, jnid, email_normalized, phone_normalized, jn_created_at) values
  ('99100000-0000-4000-8000-000000000001', 'contact-known', 'known@example.invalid', null, now() - interval '200 days'),
  ('99100000-0000-4000-8000-000000000001', 'contact-handoff', null, '+16095550302', now() - interval '2 days' - interval '3 hours');

select is(
  (select array_agg(lead_id order by lead_id) from public.leadconduit_intake_quality
   where company_id = '99100000-0000-4000-8000-000000000001'),
  array['q-blank', 'q-first', 'q-known', 'q-no-city', 'q-old', 'q-redacted', 'q-repeat', 'q-return'],
  'one row per live intake lead; test traffic and later checkpoints are excluded'
);

select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'leadconduit_intake_quality'
     and column_name in ('submitted_address', 'submitted_phone', 'submitted_email',
       'phone_normalized', 'email_normalized', 'trustedform_url')),
  0::bigint,
  'the street, phone, email and certificate stay out of the view'
);

select is(
  (select city || '|' || state from public.leadconduit_intake_quality where lead_id = 'q-first'),
  'Cherry Hill|NJ',
  'town and state are parsed from the submitted address'
);

select is(
  (select coalesce(city, '-') || '|' || coalesce(state, '-') || '|' || has_address from public.leadconduit_intake_quality
   where lead_id = 'q-known'),
  'Boston|MA|true',
  'a ZIP+4 address still parses'
);

select is(
  (select coalesce(city, '-') || '|' || state from public.leadconduit_intake_quality where lead_id = 'q-no-city'),
  '-|MA',
  'a blank city reads as no city, and the state still parses'
);

select is(
  (select row(has_address, city, has_trustedform, has_email, lead_name)::text
   from public.leadconduit_intake_quality where lead_id = 'q-blank'),
  row(false, null::text, false, false, null::text)::text,
  'a comma-only address counts as blank and missing details are flagged'
);

select is(
  (select repeat_of_source_name from public.leadconduit_intake_quality where lead_id = 'q-repeat'),
  'Vendor A',
  'the same phone through another vendor within 30 days is a repeat'
);

select is(
  (select repeat_of_received_at from public.leadconduit_intake_quality where lead_id = 'q-return'),
  null::timestamptz,
  'a return after more than 30 days is not a repeat'
);

select is(
  (select jobnimbus_contact_since from public.leadconduit_intake_quality where lead_id = 'q-known'),
  (select jn_created_at from public.jn_contacts where jnid = 'contact-known'),
  'a JobNimbus contact that predates the lead is reported with its creation time'
);

select is(
  (select jobnimbus_contact_since from public.leadconduit_intake_quality where lead_id = 'q-blank'),
  null::timestamptz,
  'a contact created within a day of the lead is its own handoff, not a prior customer'
);

select is(
  (select contact_redacted from public.leadconduit_intake_quality where lead_id = 'q-redacted'),
  true,
  'leads whose contact details were cleared are marked redacted'
);

select is(
  (select distinct service_states from public.leadconduit_intake_quality
   where company_id = '99100000-0000-4000-8000-000000000001'),
  array['NJ'],
  'the company''s service states travel with each row'
);

select throws_ok(
  $$update public.companies set service_states = array['nj']
    where id = '99100000-0000-4000-8000-000000000002'$$,
  '23514', null,
  'service states must be two-letter uppercase codes'
);

insert into auth.users(id, email) values
  ('99100000-0000-4000-8000-000000000101', 'quality-manager@example.test'),
  ('99100000-0000-4000-8000-000000000102', 'quality-employee@example.test');
select public.grant_company_membership(
  'quality-manager@example.test', '99100000-0000-4000-8000-000000000001', 'manager', 'Quality Manager');
select public.grant_company_membership(
  'quality-employee@example.test', '99100000-0000-4000-8000-000000000001', 'employee', 'Quality Employee');

select set_config('request.jwt.claims',
  '{"sub":"99100000-0000-4000-8000-000000000101","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select array_agg(distinct company_id) from public.leadconduit_intake_quality),
  array['99100000-0000-4000-8000-000000000001'::uuid],
  'a manager sees only their own company''s leads'
);

reset role;

select set_config('request.jwt.claims',
  '{"sub":"99100000-0000-4000-8000-000000000102","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select count(*) from public.leadconduit_intake_quality),
  0::bigint,
  'an employee sees no intake leads'
);

reset role;

select * from finish();

rollback;

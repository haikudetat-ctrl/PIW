begin;

select plan(18);

insert into public.companies(id, name) values
  ('98000000-0000-4000-8000-000000000001', 'Journey Company'),
  ('98000000-0000-4000-8000-000000000002', 'Journey Control');

-- PIW lead: Jane (phone A).
insert into public.properties(id, company_id, canonical_address)
values ('98000000-0000-4000-8000-000000000101', '98000000-0000-4000-8000-000000000001', '1 Journey Way');
insert into public.leads(id, company_id, property_id, name, phone, email, submitted_address,
  source_system, phone_e164, email_normalized, original_lead_source, created_at)
values
  ('98000000-0000-4000-8000-000000000201', '98000000-0000-4000-8000-000000000001',
   '98000000-0000-4000-8000-000000000101', 'Jane', '609-555-0101', 'jane@example.invalid',
   '1 Journey Way', 'manual', '+16095550101', 'jane@example.invalid', 'Meta70', '2026-09-01T10:00:00Z');
insert into public.leads(id, company_id, property_id, name, phone, email, submitted_address,
  source_system, phone_e164, email_normalized, is_test)
values
  ('98000000-0000-4000-8000-000000000202', '98000000-0000-4000-8000-000000000001',
   '98000000-0000-4000-8000-000000000101', 'Test', '609-555-0199', 'test@example.invalid',
   '1 Journey Way', 'manual', '+16095550199', 'test@example.invalid', true);

-- LeadConduit: Jane's PIW lead comes back (explicit reference) and is delivered;
-- Bob (phone B) enters from another source and is filtered.
insert into public.leadconduit_events(
  company_id, event_id, flow_id, lead_id, event_type, occurred_at, raw_payload, phone_normalized,
  email_normalized, source_name, attribution, ingestion_channels, first_observed_at,
  webhook_received_at, processing_status)
select '98000000-0000-4000-8000-000000000001', fixture.event_id, 'flow-roofing', fixture.lead_id,
  fixture.event_type, fixture.at::timestamptz, '{}', fixture.phone, fixture.email, fixture.source,
  fixture.attribution::jsonb, array['webhook'], fixture.at::timestamptz, fixture.at::timestamptz, 'not_applicable'
from (values
  ('j-in', 'lc-jane', 'checkpoint_intake', '2026-09-01T10:05:00Z', '+16095550101', null, 'PIW', '{"piw_reference": "98000000-0000-4000-8000-000000000201"}'),
  ('j-out', 'lc-jane', 'checkpoint_delivered', '2026-09-01T10:06:00Z', '+16095550101', null, 'PIW', '{}'),
  ('b-in', 'lc-bob', 'checkpoint_intake', '2026-09-02T09:00:00Z', '+17325550102', 'bob@example.invalid', 'Angi', '{}')
) as fixture(event_id, lead_id, event_type, at, phone, email, source, attribution);

-- JobNimbus: Jane's contact (matched by email only) with a sold job and an
-- estimate; Carl's job completed before we ever saw it; an orphan job.
insert into public.jn_contacts(company_id, jnid, email_normalized, phone_normalized, jn_created_at) values
  ('98000000-0000-4000-8000-000000000001', 'contact-jane', 'jane@example.invalid', null, '2026-09-03T12:00:00Z'),
  ('98000000-0000-4000-8000-000000000001', 'contact-carl', null, '+12015550103', '2026-06-01T12:00:00Z');
insert into public.jn_jobs(company_id, jnid, primary_contact_jnid, status_name, status_changed_at, jn_created_at) values
  ('98000000-0000-4000-8000-000000000001', 'job-jane', 'contact-jane', 'Signed Contract', '2026-09-10T15:00:00Z', '2026-09-03T12:30:00Z'),
  ('98000000-0000-4000-8000-000000000001', 'job-carl', 'contact-carl', 'Job Completed', '2026-08-20T15:00:00Z', '2026-06-01T12:30:00Z'),
  ('98000000-0000-4000-8000-000000000001', 'job-orphan', null, 'Lead', null, '2026-09-05T12:30:00Z');
insert into public.jn_estimates(company_id, jnid, related_job_jnid, jn_created_at) values
  ('98000000-0000-4000-8000-000000000001', 'est-jane-1', 'job-jane', '2026-09-05T09:00:00Z'),
  ('98000000-0000-4000-8000-000000000001', 'est-jane-2', 'job-jane', '2026-09-06T09:00:00Z');

select is(
  (public.refresh_customer_journey('98000000-0000-4000-8000-000000000001') ->> 'unmatched')::integer,
  1,
  'only the job without a primary contact is unmatched'
);

select is(
  (select count(*) from public.customers where company_id = '98000000-0000-4000-8000-000000000001'),
  3::bigint,
  'Jane, Bob and Carl are three customers; the test lead is excluded'
);

select is(
  (select count(distinct customer_id) from public.customer_identities
   where company_id = '98000000-0000-4000-8000-000000000001'
     and external_id in ('98000000-0000-4000-8000-000000000201', 'flow-roofing:lc-jane', 'contact-jane', 'job-jane')),
  1::bigint,
  'Jane''s PIW lead, LeadConduit lead, JobNimbus contact and job are one customer'
);

select is(
  (select matched_by from public.customer_identities where external_id = 'flow-roofing:lc-jane'),
  'explicit',
  'the PIW reference carried back through LeadConduit is an explicit link'
);

select is(
  (select matched_by from public.customer_identities where external_id = 'contact-jane'),
  'email',
  'the JobNimbus contact matches by email when it has no phone'
);

select is(
  (select source_name from public.customers
   where id = (select customer_id from public.customer_identities where external_id = 'contact-jane')),
  'Meta70',
  'first-touch attribution comes from the record that created the customer'
);

select is(
  (select array_agg(stage order by occurred_at, stage) from public.customer_journey_events
   where customer_id = (select customer_id from public.customer_identities where external_id = 'job-jane')),
  array['lead_received', 'ap_intake', 'ap_delivered', 'handoff', 'quoted', 'sold'],
  'Jane''s timeline runs from lead to sale in order'
);

select is(
  (select occurred_at from public.customer_journey_events
   where stage = 'quoted' and source_ref = 'job-jane'),
  '2026-09-05T09:00:00Z'::timestamptz,
  'quoted uses the first estimate''s creation time'
);

select is(
  (select array_agg(stage || ':' || is_approximate order by stage) from public.customer_journey_events
   where source_ref = 'job-carl' and stage in ('completed', 'sold')),
  array['completed:false', 'sold:true'],
  'a job first seen completed records an approximate sale'
);

select is(
  (select array_agg(stage order by stage) from public.customer_journey_events
   where customer_id = (select customer_id from public.customer_identities where external_id = 'flow-roofing:lc-bob')),
  array['ap_filtered', 'ap_intake'],
  'an undelivered LeadConduit lead is marked filtered'
);

select is(
  (select reason from public.customer_match_conflicts where external_id = 'job-orphan'),
  'missing_contact',
  'a job without a primary contact is logged for review'
);

-- Idempotence.
select is(
  public.refresh_customer_journey('98000000-0000-4000-8000-000000000001') ->> 'events_added',
  '0',
  'a second refresh adds no events'
);

select is(
  (select count(*) from public.customers where company_id = '98000000-0000-4000-8000-000000000001'),
  3::bigint,
  'a second refresh creates no customers'
);

-- Ambiguity: a LeadConduit lead explicitly tied to Jane but carrying Bob's
-- phone makes that phone point at two customers. A later contact with only
-- that phone must not be merged into either.
insert into public.leadconduit_events(
  company_id, event_id, flow_id, lead_id, event_type, occurred_at, raw_payload, phone_normalized,
  attribution, ingestion_channels, first_observed_at, webhook_received_at, processing_status)
values ('98000000-0000-4000-8000-000000000001', 'x-in', 'flow-roofing', 'lc-shared', 'checkpoint_intake',
  '2026-09-04T09:00:00Z', '{}', '+17325550102', '{"piw_reference": "98000000-0000-4000-8000-000000000201"}',
  array['webhook'], now(), now(), 'not_applicable');
insert into public.jn_contacts(company_id, jnid, phone_normalized)
values ('98000000-0000-4000-8000-000000000001', 'contact-shared-phone', '+17325550102');

select public.refresh_customer_journey('98000000-0000-4000-8000-000000000001');

select is(
  (select reason || ':' || candidate_count from public.customer_match_conflicts where external_id = 'contact-shared-phone'),
  'ambiguous_phone:2',
  'a phone shared by two customers is logged, not merged'
);

select is(
  (select count(*) from public.customer_identities where external_id = 'contact-shared-phone'),
  0::bigint,
  'the ambiguous contact is not attached to any customer'
);

select is(
  (select count(*) from public.customers where company_id = '98000000-0000-4000-8000-000000000002'),
  0::bigint,
  'another company is untouched'
);

select throws_ok(
  $$insert into public.source_costs(company_id, source_name, cost_type, amount, effective_from, effective_to)
    values ('98000000-0000-4000-8000-000000000001', 'Angi', 'per_lead', 45, '2026-09-01', '2026-08-01')$$,
  '23514', null,
  'a cost period cannot end before it starts'
);

set local role authenticated;

select throws_ok(
  $$select public.refresh_customer_journey('98000000-0000-4000-8000-000000000001')$$,
  '42501', null,
  'members cannot run the journey refresh'
);

reset role;

select * from finish();

rollback;

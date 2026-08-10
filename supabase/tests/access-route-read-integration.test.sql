begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select has_table('public', 'leadconduit_events', 'LeadConduit raw events table exists');
select has_table('public', 'leadmaster_records', 'LeadMaster raw records table exists');
select has_table('public', 'jobnimbus_contacts', 'JobNimbus contacts table exists');
select has_table('public', 'jobnimbus_jobs', 'JobNimbus jobs table exists');
select has_table('public', 'integration_sync_runs', 'sync audit table exists');
select has_view('public', 'reconciled_lead_routes', 'reconciled route view exists');
select has_view('public', 'jobnimbus_reengagement_blind_spots', 'blind-spot view exists');

select is(
  (select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.reconciled_lead_routes'::regclass),
  true,
  'reconciliation view uses invoker security'
);
select is(
  (select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.jobnimbus_reengagement_blind_spots'::regclass),
  true,
  'blind-spot view uses invoker security'
);
select is(has_table_privilege('anon', 'public.leadconduit_events', 'select'), false, 'anon cannot read raw LeadConduit PII');
select is(has_table_privilege('authenticated', 'public.leadconduit_events', 'insert'), false, 'authenticated users cannot ingest vendor records');
select is(has_table_privilege('service_role', 'public.leadconduit_events', 'insert'), true, 'service role can ingest vendor records');

insert into public.companies (id, name)
values ('00000000-0000-4000-8000-000000000001', 'PIW Local Roofing')
on conflict (id) do nothing;

insert into public.leadconduit_events (
  company_id, event_id, flow_id, source_id, source_name, lead_id, event_type,
  occurred_at, outcome, phone_normalized, raw_status, raw_payload
) values (
  '00000000-0000-4000-8000-000000000001', 'lc-event-1', 'flow-1', 'source-1',
  'Meta NJ', 'lc-lead-1', 'source', now(), 'success', '+16095550100', 'accepted', '{}'
);

insert into public.leadmaster_records (
  company_id, record_id, record_kind, disposition, entered_at, phone_normalized, raw_payload
) values (
  '00000000-0000-4000-8000-000000000001', 'lm-record-1', 'lead', 'Demo Complete',
  now(), '+16095550100', '{}'
);

insert into public.jobnimbus_contacts (
  company_id, contact_id, display_name, phone_normalized, raw_payload
) values (
  '00000000-0000-4000-8000-000000000001', 'jn-contact-1', 'Test Homeowner',
  '+16095550100', '{}'
);

insert into public.jobnimbus_jobs (
  company_id, job_id, contact_id, status, stage, appointment_status,
  appointment_at, raw_payload
) values (
  '00000000-0000-4000-8000-000000000001', 'jn-job-1', 'jn-contact-1', 'Active',
  'Appointment', 'No-Show', now(), '{}'
);

select is(
  (select leadmaster_record_id from public.reconciled_lead_routes where leadconduit_event_id = 'lc-event-1'),
  'lm-record-1',
  'reconciliation joins LeadConduit to LeadMaster'
);
select is(
  (select leadmaster_match_method from public.reconciled_lead_routes where leadconduit_event_id = 'lc-event-1'),
  'normalized_phone',
  'reconciliation records its LeadMaster match method'
);
select is(
  (select jobnimbus_job_id from public.reconciled_lead_routes where leadconduit_event_id = 'lc-event-1'),
  'jn-job-1',
  'reconciliation joins through JobNimbus contact to job'
);
select is(
  (select jobnimbus_match_method from public.reconciled_lead_routes where leadconduit_event_id = 'lc-event-1'),
  'normalized_phone',
  'reconciliation records its JobNimbus match method'
);
select is(
  (select dashboard_state from public.jobnimbus_reengagement_blind_spots where job_id = 'jn-job-1'),
  'no-show — no re-engagement triggered',
  'no-show without re-engagement is visible as a distinct state'
);
select throws_ok(
  $$insert into public.leadconduit_events (
      company_id, event_id, event_type, occurred_at, raw_payload
    ) values (
      '00000000-0000-4000-8000-000000000001', 'lc-event-1', 'source', now(), '{}'
    )$$,
  '23505',
  'duplicate key value violates unique constraint "leadconduit_events_company_id_event_id_key"',
  'stable vendor event ID prevents duplicate ingestion'
);

select * from finish();

rollback;

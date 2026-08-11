begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_table('public', 'leadconduit_source_metadata', 'LeadConduit source metadata table exists');
select has_table('public', 'leadconduit_flow_steps', 'LeadConduit flow step snapshot table exists');
select has_table('public', 'leadconduit_flow_rules', 'LeadConduit flow rule snapshot table exists');

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.leadconduit_events'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (company_id, event_id)'
  ),
  'LeadConduit event identity remains tenant-scoped'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.leadconduit_events'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (company_id, id)'
  ),
  'LeadConduit events expose a tenant-safe composite key'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.leads'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (company_id, id)'
  ),
  'leads expose a tenant-safe composite key'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.leadconduit_events'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (company_id, piw_lead_id) REFERENCES leads(company_id, id)%'
  ),
  'LeadConduit event-to-lead provenance cannot cross tenants'
);

select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.leadconduit_source_metadata'::regclass),
  true,
  'source metadata has RLS enabled'
);
select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.leadconduit_flow_steps'::regclass),
  true,
  'flow steps have RLS enabled'
);
select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.leadconduit_flow_rules'::regclass),
  true,
  'flow rules have RLS enabled'
);

select is(has_table_privilege('anon', 'public.leadconduit_source_metadata', 'select'), false, 'anonymous callers cannot read source metadata');
select is(has_table_privilege('authenticated', 'public.leadconduit_source_metadata', 'select'), true, 'authenticated callers can read tenant-scoped source metadata');
select is(has_table_privilege('authenticated', 'public.leadconduit_source_metadata', 'insert'), false, 'authenticated callers cannot write source metadata');
select is(has_table_privilege('authenticated', 'public.leadconduit_flow_steps', 'insert'), false, 'authenticated callers cannot write flow steps');
select is(has_table_privilege('authenticated', 'public.leadconduit_flow_rules', 'insert'), false, 'authenticated callers cannot write flow rules');
select is(has_table_privilege('service_role', 'public.leadconduit_source_metadata', 'insert'), true, 'service role can write source metadata');
select is(has_table_privilege('service_role', 'public.leadconduit_flow_steps', 'insert'), true, 'service role can write flow steps');
select is(has_table_privilege('service_role', 'public.leadconduit_flow_rules', 'insert'), true, 'service role can write flow rules');
select function_privs_are(
  'public', 'upsert_leadconduit_event_batch', array['uuid', 'jsonb', 'text', 'timestamp with time zone'],
  'anon', array[]::text[], 'anonymous callers cannot ingest LeadConduit events'
);
select function_privs_are(
  'public', 'upsert_leadconduit_event_batch', array['uuid', 'jsonb', 'text', 'timestamp with time zone'],
  'authenticated', array[]::text[], 'authenticated callers cannot ingest LeadConduit events'
);
select function_privs_are(
  'public', 'upsert_leadconduit_event_batch', array['uuid', 'jsonb', 'text', 'timestamp with time zone'],
  'service_role', array['EXECUTE'], 'only the service role can invoke batch ingestion'
);

insert into public.companies (id, name) values
  ('30000000-0000-4000-8000-000000000003', 'Synthetic Event Tenant A'),
  ('40000000-0000-4000-8000-000000000004', 'Synthetic Event Tenant B');

insert into public.leadconduit_flows (
  company_id, flow_id, name, enabled, raw_payload
) values
  ('30000000-0000-4000-8000-000000000003', 'roofing-flow-exact', 'Roofing', true, '{}'),
  ('30000000-0000-4000-8000-000000000003', 'virtual-quote-flow-exact', 'Roofing Virtual Quote', true, '{}'),
  ('40000000-0000-4000-8000-000000000004', 'roofing-flow-exact', 'Roofing', true, '{}');

insert into public.leadconduit_source_metadata (
  company_id, flow_id, source_id, source_name, field_names,
  acceptance_metadata, raw_payload, observed_at
) values (
  '30000000-0000-4000-8000-000000000003', 'roofing-flow-exact', 'source-exact',
  'Synthetic Source', array['email', 'phone'],
  '{"rules":[{"lhv":"lead.email","authorization":"must-not-land"}]}'::jsonb,
  '{"nested":{"api_key":"must-not-land","diagnostic":"retained"}}'::jsonb,
  '2026-08-11T12:00:00Z'
);

select is(
  (select raw_payload #>> '{nested,api_key}' from public.leadconduit_source_metadata
   where company_id = '30000000-0000-4000-8000-000000000003' and source_id = 'source-exact'),
  '[REDACTED]',
  'source metadata recursively redacts credential-like raw payload values'
);
select is(
  (select acceptance_metadata #>> '{rules,0,authorization}' from public.leadconduit_source_metadata
   where company_id = '30000000-0000-4000-8000-000000000003' and source_id = 'source-exact'),
  '[REDACTED]',
  'source metadata recursively redacts credential-like acceptance values'
);
select is(
  (select raw_payload #>> '{nested,diagnostic}' from public.leadconduit_source_metadata
   where company_id = '30000000-0000-4000-8000-000000000003' and source_id = 'source-exact'),
  'retained',
  'source metadata retains non-credential diagnostic evidence'
);

select throws_ok(
  $$insert into public.leadconduit_source_metadata (
      company_id, flow_id, source_id, source_name, observed_at
    ) values (
      '30000000-0000-4000-8000-000000000003', 'roofing-flow-exact', 'source-exact',
      'Duplicate Synthetic Source', now()
    )$$,
  '23505',
  'duplicate key value violates unique constraint "leadconduit_source_metadata_company_flow_source_key"',
  'source metadata is unique by tenant, flow, and source'
);

select lives_ok(
  $$insert into public.leadconduit_source_metadata (
      company_id, flow_id, source_id, source_name, observed_at
    ) values (
      '40000000-0000-4000-8000-000000000004', 'roofing-flow-exact', 'source-exact',
      'Synthetic Tenant B Source', now()
    )$$,
  'the same flow and source identity can exist in another tenant'
);

insert into public.leadconduit_flow_steps (
  company_id, flow_id, step_id, step_type, step_name, step_order, enabled, outcome, observed_at
) values (
  '30000000-0000-4000-8000-000000000003', 'roofing-flow-exact', 'step-exact',
  'filter', 'Synthetic Eligibility Filter', 2, true, 'continue', '2026-08-11T12:00:00Z'
);

insert into public.leadconduit_flow_rules (
  company_id, flow_id, rule_scope, rule_scope_id, rule_id, rule_name, lhv, operator, observed_at
) values (
  '30000000-0000-4000-8000-000000000003', 'roofing-flow-exact', 'filter_step',
  'step-exact', 'rule-exact', 'Synthetic State Rule', 'lead.state', 'is equal to',
  '2026-08-11T12:00:00Z'
);

select is(
  (select concat_ws('|', step_id, step_type, step_order::text, enabled::text, outcome)
   from public.leadconduit_flow_steps
   where company_id = '30000000-0000-4000-8000-000000000003' and flow_id = 'roofing-flow-exact'),
  'step-exact|filter|2|true|continue',
  'flow step snapshots preserve typed exact identity and behavior fields'
);
select is(
  (select concat_ws('|', rule_scope, rule_scope_id, rule_id, lhv, operator)
   from public.leadconduit_flow_rules
   where company_id = '30000000-0000-4000-8000-000000000003' and flow_id = 'roofing-flow-exact'),
  'filter_step|step-exact|rule-exact|lead.state|is equal to',
  'flow rule snapshots preserve exact scope and typed policy fields'
);

select is(
  public.upsert_leadconduit_event_batch(
    '30000000-0000-4000-8000-000000000003',
    jsonb_build_array(jsonb_build_object(
      'company_id', '40000000-0000-4000-8000-000000000004',
      'event_id', 'webhook-first-event',
      'flow_id', 'roofing-flow-exact',
      'source_id', null,
      'lead_id', 'canonical-lead-id-webhook-first',
      'event_type', 'source',
      'occurred_at', '2026-08-11T11:59:00Z',
      'outcome', 'failure',
      'reason_category', 'invalid_phone',
      'lead_name', 'Synthetic First Evidence',
      'submitted_phone', '555-010-4000',
      'attribution', jsonb_build_object('lead_external_id', 'attribution-first', 'initial', 'webhook'),
      'raw_payload', jsonb_build_object('flow_id', 'payload-flow-must-not-control-identity', 'evidence', 'webhook-original'),
      'processing_status', 'processed',
      'piw_lead_id', 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'processing_error_category', 'customer-value-must-not-land',
      'ingestion_channels', jsonb_build_array('poll')
    )),
    'webhook',
    '2026-08-11T12:05:00Z'
  ),
  1,
  'webhook batch persists one normalized event'
);

select is(
  public.upsert_leadconduit_event_batch(
    '30000000-0000-4000-8000-000000000003',
    jsonb_build_array(jsonb_build_object(
      'event_id', 'webhook-first-event',
      'flow_id', 'replacement-flow-must-not-win',
      'source_id', 'source-exact',
      'source_name', 'Synthetic Poll Source',
      'lead_id', 'replacement-lead-must-not-win',
      'event_type', 'destination',
      'occurred_at', '2026-08-11T12:01:00Z',
      'outcome', 'success',
      'reason_category', 'replacement_reason',
      'lead_name', 'Replacement Name',
      'submitted_email', 'synthetic@example.invalid',
      'attribution', jsonb_build_object('lead_external_id', 'attribution-replacement', 'poll_only', 'retained'),
      'raw_payload', jsonb_build_object('evidence', 'poll-must-not-replace-original')
    )),
    'poll',
    '2026-08-11T12:00:00Z'
  ),
  1,
  'poll convergence updates the existing logical event'
);

select is(
  (select count(*) from public.leadconduit_events
   where company_id = '30000000-0000-4000-8000-000000000003' and event_id = 'webhook-first-event'),
  1::bigint,
  'webhook then poll creates one logical event'
);
select is(
  (select ingestion_channels from public.leadconduit_events
   where company_id = '30000000-0000-4000-8000-000000000003' and event_id = 'webhook-first-event'),
  array['webhook', 'poll']::text[],
  'webhook then poll retains both ingestion channels without duplicates'
);
select is(
  (select first_observed_at from public.leadconduit_events
   where company_id = '30000000-0000-4000-8000-000000000003' and event_id = 'webhook-first-event'),
  '2026-08-11T12:00:00Z'::timestamptz,
  'webhook then poll retains the earliest first observation'
);
select is(
  (select webhook_received_at from public.leadconduit_events
   where company_id = '30000000-0000-4000-8000-000000000003' and event_id = 'webhook-first-event'),
  '2026-08-11T12:05:00Z'::timestamptz,
  'webhook observation time remains separate'
);
select is(
  (select poll_observed_at from public.leadconduit_events
   where company_id = '30000000-0000-4000-8000-000000000003' and event_id = 'webhook-first-event'),
  '2026-08-11T12:00:00Z'::timestamptz,
  'poll observation time remains separate'
);
select is(
  (select concat_ws('|', flow_id, lead_id, event_type, outcome, reason_category, lead_name)
   from public.leadconduit_events
   where company_id = '30000000-0000-4000-8000-000000000003' and event_id = 'webhook-first-event'),
  'roofing-flow-exact|canonical-lead-id-webhook-first|source|failure|invalid_phone|Synthetic First Evidence',
  'convergence preserves original identity and non-null outcome/reason evidence'
);
select is(
  (select raw_payload ->> 'evidence' from public.leadconduit_events
   where company_id = '30000000-0000-4000-8000-000000000003' and event_id = 'webhook-first-event'),
  'webhook-original',
  'convergence preserves the original raw payload'
);
select is(
  (select attribution ->> 'lead_external_id' from public.leadconduit_events
   where company_id = '30000000-0000-4000-8000-000000000003' and event_id = 'webhook-first-event'),
  'attribution-first',
  'convergence never replaces existing attribution evidence'
);
select is(
  (select attribution ->> 'poll_only' from public.leadconduit_events
   where company_id = '30000000-0000-4000-8000-000000000003' and event_id = 'webhook-first-event'),
  'retained',
  'convergence may fill previously absent attribution evidence'
);
select is(
  (select processing_status from public.leadconduit_events
   where company_id = '30000000-0000-4000-8000-000000000003' and event_id = 'webhook-first-event'),
  'observed',
  'batch ingestion ignores payload-supplied processing state'
);
select is(
  (select piw_lead_id from public.leadconduit_events
   where company_id = '30000000-0000-4000-8000-000000000003' and event_id = 'webhook-first-event'),
  null::uuid,
  'batch ingestion ignores payload-supplied PIW lead identity'
);

select is(
  public.upsert_leadconduit_event_batch(
    '30000000-0000-4000-8000-000000000003',
    '[{"event_id":"poll-first-event","flow_id":"virtual-quote-flow-exact","lead_id":"canonical-lead-id-poll-first","event_type":"source","occurred_at":"2026-08-11T12:10:00Z","outcome":"success","raw_payload":{"evidence":"poll-original"}}]'::jsonb,
    'poll',
    '2026-08-11T12:11:00Z'
  ),
  1,
  'poll-first batch persists one normalized event'
);
select is(
  public.upsert_leadconduit_event_batch(
    '30000000-0000-4000-8000-000000000003',
    '[{"event_id":"poll-first-event","flow_id":"replacement-flow","lead_id":"replacement-lead","event_type":"source","occurred_at":"2026-08-11T12:10:00Z","outcome":"failure","raw_payload":{"evidence":"webhook-later"}}]'::jsonb,
    'webhook',
    '2026-08-11T12:12:00Z'
  ),
  1,
  'webhook convergence updates the poll-first logical event'
);
select is(
  (select concat_ws('|', array_to_string(ingestion_channels, ','), flow_id, lead_id, outcome, raw_payload ->> 'evidence')
   from public.leadconduit_events
   where company_id = '30000000-0000-4000-8000-000000000003' and event_id = 'poll-first-event'),
  'webhook,poll|virtual-quote-flow-exact|canonical-lead-id-poll-first|success|poll-original',
  'poll then webhook converges without replacing original identity or evidence'
);

select throws_ok(
  $$insert into public.leadconduit_events (
      company_id, event_id, event_type, occurred_at, raw_payload, ingestion_channels,
      first_observed_at, webhook_received_at
    ) values (
      '30000000-0000-4000-8000-000000000003', 'duplicate-channel-event', 'source', now(), '{}',
      array['webhook', 'webhook'], now(), now()
    )$$,
  '23514',
  'new row for relation "leadconduit_events" violates check constraint "leadconduit_events_ingestion_provenance_check"',
  'ingestion channels cannot contain duplicates'
);
select throws_ok(
  $$insert into public.leadconduit_events (
      company_id, event_id, event_type, occurred_at, raw_payload, ingestion_channels,
      first_observed_at, webhook_received_at
    ) values (
      '30000000-0000-4000-8000-000000000003', 'mismatched-channel-event', 'source', now(), '{}',
      array['poll'], now(), now()
    )$$,
  '23514',
  'new row for relation "leadconduit_events" violates check constraint "leadconduit_events_ingestion_provenance_check"',
  'channel membership and observation timestamps must agree'
);
select throws_ok(
  $$insert into public.leadconduit_events (
      company_id, event_id, event_type, occurred_at, raw_payload, ingestion_channels,
      first_observed_at, processing_status
    ) values (
      '30000000-0000-4000-8000-000000000003', 'processed-without-lead-event', 'source', now(), '{}',
      array[]::text[], now(), 'processed'
    )$$,
  '23514',
  'new row for relation "leadconduit_events" violates check constraint "leadconduit_events_processing_state_check"',
  'processed events require a tenant-safe PIW lead reference'
);
select throws_ok(
  $$insert into public.leadconduit_events (
      company_id, event_id, event_type, occurred_at, raw_payload, ingestion_channels,
      first_observed_at, processing_attempts
    ) values (
      '30000000-0000-4000-8000-000000000003', 'negative-attempt-event', 'source', now(), '{}',
      array[]::text[], now(), -1
    )$$,
  '23514',
  'new row for relation "leadconduit_events" violates check constraint "leadconduit_events_processing_attempts_check"',
  'processing attempts cannot be negative'
);
select throws_ok(
  $$insert into public.leadconduit_events (
      company_id, event_id, event_type, occurred_at, raw_payload, ingestion_channels,
      first_observed_at, processing_status, processing_error_category
    ) values (
      '30000000-0000-4000-8000-000000000003', 'unsafe-error-event', 'source', now(), '{}',
      array[]::text[], now(), 'failed', 'Synthetic customer name and phone 555-0100'
    )$$,
  '23514',
  'new row for relation "leadconduit_events" violates check constraint "leadconduit_events_processing_error_category_check"',
  'failure details are limited to sanitized categories'
);

select * from finish();

rollback;

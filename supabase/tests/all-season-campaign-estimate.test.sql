begin;

create extension if not exists pgtap with schema extensions;

select plan(52);

select has_column('public', 'leads', 'utm_source', 'campaign leads retain UTM source');
select has_column('public', 'leads', 'utm_medium', 'campaign leads retain UTM medium');
select has_column('public', 'leads', 'utm_campaign', 'campaign leads retain UTM campaign');
select has_column('public', 'leads', 'utm_term', 'campaign leads retain UTM term');
select has_column('public', 'leads', 'utm_content', 'campaign leads retain UTM content');
select has_index('public', 'leads', 'leads_company_source_external_id_idx', 'company-scoped source ID index exists');
select is(
  (
    select index_row.indisunique
      and array(
        select attribute.attname
        from pg_catalog.unnest(index_row.indkey) with ordinality as key_column(attribute_number, position)
        join pg_catalog.pg_attribute as attribute
          on attribute.attrelid = index_row.indrelid
         and attribute.attnum = key_column.attribute_number
        order by key_column.position
      ) = array['company_id', 'source_system', 'external_lead_id']::name[]
    from pg_catalog.pg_index as index_row
    where index_row.indexrelid = 'public.leads_company_source_external_id_idx'::regclass
  ), true, 'external IDs are uniquely keyed by company, source system, then external ID'
);
select is(
  (select pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid)
   from pg_catalog.pg_index as index_row
   where index_row.indexrelid = 'public.leads_company_source_external_id_idx'::regclass),
  '(external_lead_id IS NOT NULL)',
  'company-scoped external ID uniqueness applies only when an ID is present'
);
select has_function(
  'public', 'submit_all_season_campaign_estimate',
  array['uuid','uuid','text','text','text','text','text','timestamp with time zone','jsonb','text','text','text','uuid','integer','text'],
  'atomic All Season campaign-estimate function exists'
);
select function_privs_are('public', 'submit_all_season_campaign_estimate', array['uuid','uuid','text','text','text','text','text','timestamp with time zone','jsonb','text','text','text','uuid','integer','text'], 'anon', array[]::text[], 'anonymous clients cannot create campaign estimates');
select function_privs_are('public', 'submit_all_season_campaign_estimate', array['uuid','uuid','text','text','text','text','text','timestamp with time zone','jsonb','text','text','text','uuid','integer','text'], 'authenticated', array[]::text[], 'authenticated clients cannot create campaign estimates');
select function_privs_are('public', 'submit_all_season_campaign_estimate', array['uuid','uuid','text','text','text','text','text','timestamp with time zone','jsonb','text','text','text','uuid','integer','text'], 'service_role', array['EXECUTE'], 'service role owns campaign estimate submission');
select is((select proc.prosecdef from pg_catalog.pg_proc as proc where proc.oid = 'public.submit_all_season_campaign_estimate(uuid,uuid,text,text,text,text,text,timestamptz,jsonb,text,text,text,uuid,integer,text)'::regprocedure), true, 'campaign estimate submission is security definer');
select ok((select proc.proconfig is not null and array_length(proc.proconfig, 1) = 1 and proc.proconfig[1] ~ '^search_path=(|"")$' from pg_catalog.pg_proc as proc where proc.oid = 'public.submit_all_season_campaign_estimate(uuid,uuid,text,text,text,text,text,timestamptz,jsonb,text,text,text,uuid,integer,text)'::regprocedure), 'campaign estimate security-definer function has exactly an empty search path');
select ok((select position('p_company_id::text || '':all-season-campaign:'' || p_submission_id::text' in pg_catalog.pg_get_functiondef('public.submit_all_season_campaign_estimate(uuid,uuid,text,text,text,text,text,timestamptz,jsonb,text,text,text,uuid,integer,text)'::regprocedure)) > 0), 'campaign replay lock is scoped by company, source, and submission');
select has_function('public', 'submit_lead_intake_from_source', array['uuid','text','text','text','text','text','uuid','integer','text','text','text','text','text','text','text','text','boolean','text','text'], 'legacy sourced intake function remains available with its prior signature');
select has_function('public', 'submit_all_season_lead', array['uuid','uuid','text','text','text','text','text','timestamp with time zone','jsonb','text','text','text','integer','text','text','text'], 'legacy All Season function remains available with its active Google Place ID signature');

insert into public.companies (id, name) values
  ('b0000000-0000-4000-8000-000000000001', 'Campaign Estimate Company A'),
  ('b0000000-0000-4000-8000-000000000002', 'Campaign Estimate Company B'),
  ('b0000000-0000-4000-8000-000000000003', 'Legacy Source Company C'),
  ('b0000000-0000-4000-8000-000000000004', 'Legacy Source Company D'),
  ('b0000000-0000-4000-8000-000000000005', 'Legacy All Season Company E'),
  ('b0000000-0000-4000-8000-000000000006', 'Legacy All Season Company F');

create temp table first_submission as select * from public.submit_all_season_campaign_estimate(
  'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000010',
  'Alex Rivera', '(201) 555-0100', 'alex@example.com', '1 Main St, Newark, NJ 07102', 'do-it-right-once', '2026-08-24T14:00:00Z',
  '{"utm_source":"facebook","utm_medium":"paid-social","utm_campaign":"20y","utm_term":"roof replacement","utm_content":"blue-hero","fbclid":"click-123","fbp":"fb.1.100.200","fbc":"fb.1.100.click"}'::jsonb,
  'all-season-campaign-estimate-v1', '127.0.0.1', 'pgtap', 'b0000000-0000-4000-8000-000000000011', 2, 'ChIJ-test-place'
);

select is((select is_duplicate from first_submission), false, 'first campaign submission is new');
select ok((select public_token from first_submission) is not null, 'first submission receives a public token');
select ok(
  (select event_id is not null
     and event_payload ->> 'id' = event_id::text
     and event_payload ->> 'name' = 'crm/lead.submitted'
   from first_submission),
  'first submission returns its persisted lead-submitted event'
);
select is((select company_id from public.properties where id = (select property_id from first_submission)), 'b0000000-0000-4000-8000-000000000001'::uuid, 'created property belongs to the submitting company');
select is(
  (select concat_ws('|', company_id::text, property_id::text, service_requested, source_system, external_lead_id, original_lead_source, campaign, consent_reference) from public.leads where id = (select lead_id from first_submission)),
  'b0000000-0000-4000-8000-000000000001|' || (select property_id::text from first_submission) || '|roofing|all-season-campaign|b0000000-0000-4000-8000-000000000010|campaign-landing-page|do-it-right-once|all-season-campaign-estimate-v1',
  'lead is tenant-owned, linked to the property, and retains campaign submission evidence'
);
select is((select concat_ws('|', utm_source, utm_medium, utm_campaign, utm_term, utm_content, fbclid, fbp, fbc) from public.leads where id = (select lead_id from first_submission)), 'facebook|paid-social|20y|roof replacement|blue-hero|click-123|fb.1.100.200|fb.1.100.click', 'structured UTM and Meta attribution is persisted');
select is((select concat_ws('|', source_submitted_at::text, client_ip_address::text, client_user_agent) from public.leads where id = (select lead_id from first_submission)), '2026-08-24 14:00:00+00|127.0.0.1/32|pgtap', 'source time, IP address, and user agent are persisted');
select is(
  (select concat_ws('|', company_id::text, lead_id::text, property_id::text, correlation_id::text, pipeline_version::text, status::text) from public.pipeline_runs where id = (select pipeline_run_id from first_submission)),
  'b0000000-0000-4000-8000-000000000001|' || (select lead_id::text from first_submission) || '|' || (select property_id::text from first_submission) || '|b0000000-0000-4000-8000-000000000011|2|received',
  'pipeline run is tenant-owned, linked, and retains correlation/version/status'
);
select is(
  (select string_agg(concat_ws('|', consent_type, granted::text, disclosure_version, source, ip_address::text, user_agent), ',' order by consent_type) from public.lead_consents where lead_id = (select lead_id from first_submission)),
  'email_contact|true|all-season-campaign-estimate-v1|all_season_campaign|127.0.0.1/32|pgtap,estimate_processing|true|all-season-campaign-estimate-v1|all_season_campaign|127.0.0.1/32|pgtap,sms_contact|true|all-season-campaign-estimate-v1|all_season_campaign|127.0.0.1/32|pgtap',
  'all three granted consent rows retain the disclosure and request evidence'
);
select is(
  (select concat_ws('|', company_id::text, lead_id::text, property_id::text, google_place_id, public_token::text) from public.roof_estimates where id = (select estimate_id from first_submission)),
  'b0000000-0000-4000-8000-000000000001|' || (select lead_id::text from first_submission) || '|' || (select property_id::text from first_submission) || '|ChIJ-test-place|' || (select public_token::text from first_submission),
  'estimate is tenant-owned, linked, has the Place ID, and retains the returned token'
);
select is(
  (select concat_ws('|', event.company_id::text, event.pipeline_run_id::text, event.event_name,
                    event.schema_version::text, event.correlation_id::text, event.idempotency_key,
                    event.payload ->> 'id', event.payload ->> 'name',
                    event.payload ->> 'schemaVersion', event.payload ->> 'correlationId',
                    event.payload ->> 'leadId', event.payload ->> 'propertyId',
                    event.payload ->> 'pipelineRunId', event.payload ->> 'idempotencyKey',
                    event.payload #>> '{data,leadId}', event.payload #>> '{data,propertyId}',
                    event.payload #>> '{data,name}', event.payload #>> '{data,phone}',
                    event.payload #>> '{data,email}', event.payload #>> '{data,submittedAddress}',
                    event.payload #>> '{data,googlePlaceId}', event.payload #>> '{data,serviceRequested}',
                    event.payload #>> '{data,notes}')
   from public.domain_events as event
   where event.id = (select event_id from first_submission)),
  'b0000000-0000-4000-8000-000000000001|' || (select pipeline_run_id::text from first_submission) ||
  '|crm/lead.submitted|1|b0000000-0000-4000-8000-000000000011|crm/lead.submitted:' ||
  (select pipeline_run_id::text from first_submission) || '|' || (select event_id::text from first_submission) ||
  '|crm/lead.submitted|1|b0000000-0000-4000-8000-000000000011|' ||
  (select lead_id::text from first_submission) || '|' || (select property_id::text from first_submission) || '|' ||
  (select pipeline_run_id::text from first_submission) || '|crm/lead.submitted:' ||
  (select pipeline_run_id::text from first_submission) || '|' || (select lead_id::text from first_submission) || '|' ||
  (select property_id::text from first_submission) || '|Alex Rivera|(201) 555-0100|alex@example.com|' ||
  '1 Main St, Newark, NJ 07102|ChIJ-test-place|roofing|Submitted through the do-it-right-once All Season campaign.',
  'lead-submitted event columns and payload conform to the persisted campaign graph'
);
select is(
  (select count(*) from public.event_outbox as outbox
   where outbox.event_id = (select event_id from first_submission)),
  1::bigint,
  'first submission creates the matching event outbox row'
);

create temp table cached_bridge_submission as select * from public.submit_all_season_lead(
  'b0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000060',
  'Bridge Homeowner',
  '201-555-0160',
  'bridge@example.com',
  '60 Main St, Newark, NJ 07102',
  'roofing',
  '2026-08-25T05:00:00Z',
  '{"_campaign_slug":"weather-report","utm_source":"facebook","utm_medium":"paid-social","utm_campaign":"weather"}'::jsonb,
  'all-season-campaign-estimate-v1',
  '127.0.0.60',
  'cached-rpc-pgtap',
  2,
  '',
  'bridge@example.com',
  'ChIJ-cached-bridge'
);
select is(
  (select concat_ws('|', source_system, campaign, original_lead_source, utm_source, utm_medium, utm_campaign)
   from public.leads where id = (select lead_id from cached_bridge_submission)),
  'all-season-campaign|weather-report|campaign-landing-page|facebook|paid-social|weather',
  'cached All Season RPC routes marked submissions into the attributed campaign transaction'
);
select ok(
  (select count(*) = 1
   from public.roof_estimates as estimate
   join public.domain_events as event
     on event.pipeline_run_id = (select pipeline_run_id from cached_bridge_submission)
    and event.idempotency_key = 'crm/lead.submitted:' || (select pipeline_run_id::text from cached_bridge_submission)
   join public.event_outbox as outbox on outbox.event_id = event.id
   where estimate.lead_id = (select lead_id from cached_bridge_submission)
     and estimate.public_token is not null
     and event.event_name = 'crm/lead.submitted'),
  'cached campaign bridge atomically creates the estimate token, event, and outbox row'
);
select is(
  (select is_duplicate from public.submit_all_season_lead(
    'b0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000060',
    'Changed Bridge Homeowner',
    '201-555-0161',
    'changed-bridge@example.com',
    '61 Main St, Newark, NJ 07102',
    'roofing',
    '2026-08-25T05:01:00Z',
    '{"_campaign_slug":"weather-report"}'::jsonb,
    'all-season-campaign-estimate-v1',
    '127.0.0.61',
    'cached-rpc-retry',
    2,
    '',
    'changed-bridge@example.com',
    null
  )),
  true,
  'cached campaign bridge preserves campaign submission deduplication'
);

create temp table campaign_counts_before_invalid as select
  (select count(*) from public.properties where company_id = 'b0000000-0000-4000-8000-000000000001') as properties_count,
  (select count(*) from public.leads where company_id = 'b0000000-0000-4000-8000-000000000001') as leads_count,
  (select count(*) from public.pipeline_runs where company_id = 'b0000000-0000-4000-8000-000000000001') as pipeline_runs_count,
  (select count(*) from public.lead_consents where company_id = 'b0000000-0000-4000-8000-000000000001') as consents_count,
  (select count(*) from public.roof_estimates where company_id = 'b0000000-0000-4000-8000-000000000001') as estimates_count,
  (select count(*) from public.domain_events where company_id = 'b0000000-0000-4000-8000-000000000001') as events_count,
  (select count(*) from public.event_outbox as outbox join public.domain_events as event on event.id = outbox.event_id where event.company_id = 'b0000000-0000-4000-8000-000000000001') as outbox_count;
select throws_ok($$select * from public.submit_all_season_campaign_estimate('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000020', 'Invalid IP', '201-555-0190', 'invalid-ip@example.com', '20 Main St, Newark, NJ', 'weather-report', '2026-08-24T15:00:00Z', '{}'::jsonb, 'all-season-campaign-estimate-v1', 'not-an-ip', 'pgtap', 'b0000000-0000-4000-8000-000000000021', 2, null)$$, 'All Season campaign IP address is invalid', 'campaign submission rejects an invalid consent-evidence IP address');
select throws_ok($$select * from public.submit_all_season_campaign_estimate('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000022', 'Missing Agent', '201-555-0191', 'missing-agent@example.com', '22 Main St, Newark, NJ', 'weather-report', '2026-08-24T15:00:00Z', '{}'::jsonb, 'all-season-campaign-estimate-v1', '127.0.0.1', '   ', 'b0000000-0000-4000-8000-000000000023', 2, null)$$, 'All Season campaign user agent is required', 'campaign submission rejects missing consent-evidence user agent');
select is(
  (select concat_ws('|', properties_count, leads_count, pipeline_runs_count, consents_count, estimates_count, events_count, outbox_count) from campaign_counts_before_invalid),
  (select concat_ws('|', (select count(*) from public.properties where company_id = 'b0000000-0000-4000-8000-000000000001'), (select count(*) from public.leads where company_id = 'b0000000-0000-4000-8000-000000000001'), (select count(*) from public.pipeline_runs where company_id = 'b0000000-0000-4000-8000-000000000001'), (select count(*) from public.lead_consents where company_id = 'b0000000-0000-4000-8000-000000000001'), (select count(*) from public.roof_estimates where company_id = 'b0000000-0000-4000-8000-000000000001'), (select count(*) from public.domain_events where company_id = 'b0000000-0000-4000-8000-000000000001'), (select count(*) from public.event_outbox as outbox join public.domain_events as event on event.id = outbox.event_id where event.company_id = 'b0000000-0000-4000-8000-000000000001'))),
  'invalid consent evidence leaves no campaign graph records behind'
);

create temp table campaign_counts_before_duplicate as table campaign_counts_before_invalid;
create temp table duplicate_submission as select * from public.submit_all_season_campaign_estimate(
  'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000010', 'Changed Name', '(201) 555-0199', 'changed@example.com', '99 Changed St, Newark, NJ 07102', 'weather-report', '2026-08-24T15:00:00Z', '{}'::jsonb, 'all-season-campaign-estimate-v1', '127.0.0.1', 'retry', 'b0000000-0000-4000-8000-000000000012', 2, null
);
select is((select is_duplicate from duplicate_submission), true, 'same company submission replay is a duplicate');
select is((select row(lead_id, property_id, pipeline_run_id, estimate_id, public_token, event_id, event_payload)::text from duplicate_submission), (select row(lead_id, property_id, pipeline_run_id, estimate_id, public_token, event_id, event_payload)::text from first_submission), 'duplicate replay returns the complete original graph, event, and token');
select is(
  (select concat_ws('|', properties_count, leads_count, pipeline_runs_count, consents_count, estimates_count, events_count, outbox_count) from campaign_counts_before_duplicate),
  (select concat_ws('|', (select count(*) from public.properties where company_id = 'b0000000-0000-4000-8000-000000000001'), (select count(*) from public.leads where company_id = 'b0000000-0000-4000-8000-000000000001'), (select count(*) from public.pipeline_runs where company_id = 'b0000000-0000-4000-8000-000000000001'), (select count(*) from public.lead_consents where company_id = 'b0000000-0000-4000-8000-000000000001'), (select count(*) from public.roof_estimates where company_id = 'b0000000-0000-4000-8000-000000000001'), (select count(*) from public.domain_events where company_id = 'b0000000-0000-4000-8000-000000000001'), (select count(*) from public.event_outbox as outbox join public.domain_events as event on event.id = outbox.event_id where event.company_id = 'b0000000-0000-4000-8000-000000000001'))),
  'duplicate replay creates no property, lead, pipeline, consent, estimate, event, or outbox row'
);

create temp table isolated_submission as select * from public.submit_all_season_campaign_estimate(
  'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000010', 'Casey Morgan', '(201) 555-0102', 'casey@example.com', '2 Main St, Newark, NJ 07102', 'seasonal-shield', '2026-08-24T16:00:00Z', '{}'::jsonb, 'all-season-campaign-estimate-v1', '127.0.0.2', 'pgtap', 'b0000000-0000-4000-8000-000000000013', 2, null
);
select is((select is_duplicate from isolated_submission), false, 'same submission ID in another company is new');
select isnt((select row(lead_id, property_id, pipeline_run_id, estimate_id, public_token)::text from isolated_submission), (select row(lead_id, property_id, pipeline_run_id, estimate_id, public_token)::text from first_submission), 'company isolation creates a distinct returned graph');
select is(
  (select concat_ws('|', (select company_id::text from public.properties where id = isolated.property_id), (select company_id::text from public.leads where id = isolated.lead_id), (select company_id::text from public.pipeline_runs where id = isolated.pipeline_run_id), (select count(*)::text from public.lead_consents where company_id = 'b0000000-0000-4000-8000-000000000002' and lead_id = isolated.lead_id), (select company_id::text from public.roof_estimates where id = isolated.estimate_id)) from isolated_submission as isolated),
  'b0000000-0000-4000-8000-000000000002|b0000000-0000-4000-8000-000000000002|b0000000-0000-4000-8000-000000000002|3|b0000000-0000-4000-8000-000000000002',
  'isolated company owns its property, lead, pipeline, consents, and estimate'
);

create temp table generic_company_c as select * from public.submit_lead_intake_from_source('b0000000-0000-4000-8000-000000000003', 'C Source', '201-555-0300', 'c@example.com', '3 Main St, Newark, NJ', 'review test', 'b0000000-0000-4000-8000-000000000031', 2, 'review-source', 'shared-external-id');
create temp table generic_company_d as select * from public.submit_lead_intake_from_source('b0000000-0000-4000-8000-000000000004', 'D Source', '201-555-0400', 'd@example.com', '4 Main St, Newark, NJ', 'review test', 'b0000000-0000-4000-8000-000000000041', 2, 'review-source', 'shared-external-id');
select is((select is_duplicate from generic_company_c), false, 'legacy sourced intake creates company C external ID');
select is((select is_duplicate from generic_company_d), false, 'legacy sourced intake does not replay company C lead to company D');
select isnt((select lead_id from generic_company_c), (select lead_id from generic_company_d), 'legacy sourced intake returns a tenant-distinct lead');
select is(
  (select concat_ws('|', (select company_id::text from public.leads where id = generic.lead_id), (select company_id::text from public.properties where id = generic.property_id), (select company_id::text from public.pipeline_runs where id = generic.pipeline_run_id)) from generic_company_d as generic),
  'b0000000-0000-4000-8000-000000000004|b0000000-0000-4000-8000-000000000004|b0000000-0000-4000-8000-000000000004',
  'legacy sourced intake company D graph remains tenant-owned'
);

insert into public.properties (id, company_id, resolution_status) values ('b0000000-0000-4000-8000-000000000051', 'b0000000-0000-4000-8000-000000000005', 'unresolved');
insert into public.leads (id, company_id, property_id, name, phone, email, submitted_address, service_requested, source_system, external_lead_id) values ('b0000000-0000-4000-8000-000000000052', 'b0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000051', 'E Website', '201-555-0500', 'e@example.com', '5 Main St, Newark, NJ', 'roofing', 'all-season-website', 'b0000000-0000-4000-8000-000000000050');
insert into public.pipeline_runs (id, company_id, lead_id, property_id, correlation_id, pipeline_version, status) values ('b0000000-0000-4000-8000-000000000053', 'b0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000052', 'b0000000-0000-4000-8000-000000000051', 'b0000000-0000-4000-8000-000000000054', 2, 'received');
create temp table legacy_all_season_company_f as select * from public.submit_all_season_lead('b0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000050', 'F Website', '201-555-0600', 'f@example.com', '6 Main St, Newark, NJ', 'roofing', '2026-08-24T17:00:00Z', '{}'::jsonb, 'all-season-quote-v1', '127.0.0.6', 'pgtap', 2, '+12015550600', 'f@example.com', 'ChIJ-legacy-company-f');
select is((select is_duplicate from legacy_all_season_company_f), false, 'legacy All Season intake does not replay company E lead to company F');
select isnt((select lead_id from legacy_all_season_company_f), 'b0000000-0000-4000-8000-000000000052'::uuid, 'legacy All Season intake returns a tenant-distinct lead');
select is(
  (select concat_ws('|', (select company_id::text from public.leads where id = legacy.lead_id), (select company_id::text from public.properties where id = legacy.property_id), (select company_id::text from public.pipeline_runs where id = legacy.pipeline_run_id), (select count(*)::text from public.lead_consents where company_id = 'b0000000-0000-4000-8000-000000000006' and lead_id = legacy.lead_id)) from legacy_all_season_company_f as legacy),
  'b0000000-0000-4000-8000-000000000006|b0000000-0000-4000-8000-000000000006|b0000000-0000-4000-8000-000000000006|3',
  'legacy All Season company F graph remains tenant-owned'
);
select is(
  (select concat_ws('|', company_id::text, lead_id::text, property_id::text, google_place_id)
   from public.roof_estimates
   where lead_id = (select lead_id from legacy_all_season_company_f)),
  'b0000000-0000-4000-8000-000000000006|' ||
  (select lead_id::text from legacy_all_season_company_f) || '|' ||
  (select property_id::text from legacy_all_season_company_f) || '|ChIJ-legacy-company-f',
  'active legacy All Season signature creates its roof estimate with the supplied Google Place ID'
);
create temp table legacy_all_season_company_e_replay as select * from public.submit_all_season_lead('b0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000050', 'E Website', '201-555-0500', 'e@example.com', '5 Main St, Newark, NJ', 'roofing', '2026-08-24T17:01:00Z', '{}'::jsonb, 'all-season-quote-v1', '127.0.0.5', 'pgtap', 2, '+12015550500', 'e@example.com', 'ChIJ-legacy-company-e');
select is((select is_duplicate from legacy_all_season_company_e_replay), true, 'active legacy All Season replay remains a duplicate within its tenant');
select is(
  (select concat_ws('|', company_id::text, lead_id::text, property_id::text, google_place_id)
   from public.roof_estimates
   where lead_id = 'b0000000-0000-4000-8000-000000000052'::uuid),
  'b0000000-0000-4000-8000-000000000005|b0000000-0000-4000-8000-000000000052|b0000000-0000-4000-8000-000000000051|ChIJ-legacy-company-e',
  'active legacy replay creates a missing roof estimate without changing its returned graph'
);
select ok((select position('p_company_id::text || '':all-season-website:'' || p_submission_id::text' in pg_catalog.pg_get_functiondef('public.submit_all_season_lead(uuid,uuid,text,text,text,text,text,timestamptz,jsonb,text,text,text,integer,text,text,text)'::regprocedure)) > 0), 'active legacy All Season replay lock includes the company');

select * from finish();
rollback;

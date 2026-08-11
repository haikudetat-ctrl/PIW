begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select is(
  (
    select array_agg(attribute.attname order by indexed_column.ordinality)
    from pg_catalog.pg_index as index_metadata
    cross join lateral unnest(index_metadata.indkey) with ordinality as indexed_column(attnum, ordinality)
    join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = index_metadata.indrelid
     and attribute.attnum = indexed_column.attnum
    where index_metadata.indexrelid = 'public.leads_source_external_id_idx'::regclass
      and index_metadata.indisunique
  ),
  array['company_id', 'source_system', 'external_lead_id']::name[],
  'vendor lead identity is unique inside a company, not globally'
);

select matches(
  (
    select pg_get_expr(index_metadata.indpred, index_metadata.indrelid)
    from pg_catalog.pg_index as index_metadata
    where index_metadata.indexrelid = 'public.leads_source_external_id_idx'::regclass
  ),
  'external_lead_id IS NOT NULL',
  'null external ids remain distinct submissions'
);

insert into public.companies (id, name) values
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Roofing Tenant A'),
  ('20000000-0000-4000-8000-000000000002', 'Synthetic Roofing Tenant B');

create temporary table tenant_a_first as
select * from public.submit_lead_intake_from_source(
  p_company_id => '10000000-0000-4000-8000-000000000001',
  p_name => 'Synthetic Homeowner A',
  p_phone => '555-010-1000',
  p_email => 'tenant-a@example.invalid',
  p_submitted_address => '10 Synthetic Way, Trenton, NJ',
  p_notes => null,
  p_correlation_id => '10000000-0000-4000-8000-000000000101',
  p_pipeline_version => 1,
  p_source_system => 'leadconduit',
  p_external_lead_id => 'lc-lead-shared'
);

-- A deliberately inconsistent legacy row makes an unscoped pipeline lookup
-- choose Tenant B's newer run. The replay must still return Tenant A's run.
insert into public.pipeline_runs (
  company_id, lead_id, property_id, correlation_id, pipeline_version, status, started_at
)
select
  '20000000-0000-4000-8000-000000000002', lead_id, property_id,
  '20000000-0000-4000-8000-000000000201', 1, 'received', now() + interval '1 hour'
from tenant_a_first;

create temporary table tenant_a_replay as
select * from public.submit_lead_intake_from_source(
  p_company_id => '10000000-0000-4000-8000-000000000001',
  p_name => 'Ignored Replay Name',
  p_phone => '555-010-9999',
  p_email => 'ignored@example.invalid',
  p_submitted_address => '999 Ignored Road, Trenton, NJ',
  p_notes => null,
  p_correlation_id => '10000000-0000-4000-8000-000000000102',
  p_pipeline_version => 1,
  p_source_system => 'leadconduit',
  p_external_lead_id => 'lc-lead-shared'
);

select is(
  (select lead_id from tenant_a_replay),
  (select lead_id from tenant_a_first),
  'same-tenant replay returns the original lead'
);
select is(
  (select property_id from tenant_a_replay),
  (select property_id from tenant_a_first),
  'same-tenant replay returns the original property'
);
select is(
  (select pipeline_run_id from tenant_a_replay),
  (select pipeline_run_id from tenant_a_first),
  'same-tenant replay returns the original tenant-scoped pipeline run'
);
select is(
  (select is_duplicate from tenant_a_replay),
  true,
  'same-tenant replay is marked duplicate'
);
select is(
  (select count(*) from public.leads
    where company_id = '10000000-0000-4000-8000-000000000001'
      and source_system = 'leadconduit'
      and external_lead_id = 'lc-lead-shared'),
  1::bigint,
  'same-tenant replay creates one lead'
);
select is(
  (select count(*) from public.properties
    where company_id = '10000000-0000-4000-8000-000000000001'),
  1::bigint,
  'same-tenant replay creates no orphan property'
);

create temporary table tenant_b_first as
select * from public.submit_lead_intake_from_source(
  p_company_id => '20000000-0000-4000-8000-000000000002',
  p_name => 'Synthetic Homeowner B',
  p_phone => '555-010-2000',
  p_email => 'tenant-b@example.invalid',
  p_submitted_address => '20 Synthetic Way, Trenton, NJ',
  p_notes => null,
  p_correlation_id => '20000000-0000-4000-8000-000000000202',
  p_pipeline_version => 1,
  p_source_system => 'leadconduit',
  p_external_lead_id => 'lc-lead-shared'
);

select isnt(
  (select lead_id from tenant_b_first),
  (select lead_id from tenant_a_first),
  'the same vendor lead id creates a distinct lead in Tenant B'
);
select is(
  (select count(*) from public.leads
    where source_system = 'leadconduit' and external_lead_id = 'lc-lead-shared'),
  2::bigint,
  'the tenant-scoped identity index admits one matching lead per tenant'
);

create temporary table null_external_first as
select * from public.submit_lead_intake_from_source(
  p_company_id => '10000000-0000-4000-8000-000000000001',
  p_name => 'Synthetic Null Identity One',
  p_phone => '555-010-3001',
  p_email => 'null-one@example.invalid',
  p_submitted_address => '31 Synthetic Way, Trenton, NJ',
  p_notes => null,
  p_correlation_id => '10000000-0000-4000-8000-000000000103',
  p_pipeline_version => 1,
  p_source_system => 'leadconduit',
  p_external_lead_id => null
);

create temporary table null_external_second as
select * from public.submit_lead_intake_from_source(
  p_company_id => '10000000-0000-4000-8000-000000000001',
  p_name => 'Synthetic Null Identity Two',
  p_phone => '555-010-3002',
  p_email => 'null-two@example.invalid',
  p_submitted_address => '32 Synthetic Way, Trenton, NJ',
  p_notes => null,
  p_correlation_id => '10000000-0000-4000-8000-000000000104',
  p_pipeline_version => 1,
  p_source_system => 'leadconduit',
  p_external_lead_id => null
);

select isnt(
  (select lead_id from null_external_first),
  (select lead_id from null_external_second),
  'null vendor ids do not deduplicate independent submissions'
);
select is(
  (select count(*) from public.properties as property
    where property.company_id = '10000000-0000-4000-8000-000000000001'
      and not exists (
        select 1 from public.leads as lead
        where lead.company_id = property.company_id and lead.property_id = property.id
      )),
  0::bigint,
  'all vendor-intake properties are owned by a tenant-matching lead'
);

select * from finish();

rollback;

begin;

create extension if not exists pgtap with schema extensions;

select plan(82);

select has_table('public', 'property_addresses', 'property_addresses exists');
select has_table('public', 'parcels', 'parcels exists');
select has_table('public', 'structures', 'structures exists');
select has_table('public', 'review_tasks', 'review_tasks exists');

select hasnt_column(
  'public', 'property_addresses', 'owner_name',
  'property_addresses never stores owner_name (Daniel''s Law)'
);
select hasnt_column(
  'public', 'parcels', 'owner_name',
  'parcels never stores owner_name (Daniel''s Law)'
);
select hasnt_column(
  'public', 'structures', 'owner_name',
  'structures never stores owner_name (Daniel''s Law)'
);
select hasnt_column(
  'public', 'review_tasks', 'owner_name',
  'review_tasks never stores owner_name (Daniel''s Law)'
);

select has_column(
  'public', 'properties', 'merged_into_property_id',
  'properties gains a merge pointer'
);
select has_column(
  'public', 'property_addresses', 'worker_run_id',
  'property_addresses records the producing worker attempt'
);
select is(
  (select count(*)
   from pg_constraint
   where conrelid = 'public.property_addresses'::regclass
     and conname = 'property_addresses_exactly_one_origin_check'
     and contype = 'c'),
  1::bigint,
  'property_addresses requires exactly one worker or access-attempt origin'
);
select col_is_fk(
  'public', 'property_addresses', 'worker_run_id',
  'property_addresses.worker_run_id references worker_runs'
);
select has_column(
  'public', 'audit_log', 'worker_run_id',
  'audit entries can identify the producing worker attempt'
);

select policies_are(
  'public', 'property_addresses',
  array['company admins read property addresses'],
  'property_addresses has a single read policy'
);
select policies_are(
  'public', 'parcels',
  array['company admins read parcels'],
  'parcels has a single read policy'
);
select policies_are(
  'public', 'structures',
  array['company admins read structures'],
  'structures has a single read policy'
);
select policies_are(
  'public', 'review_tasks',
  array['company admins read review tasks'],
  'review_tasks has a single read policy'
);

select is(
  (select relrowsecurity from pg_class
   where oid = 'public.property_addresses'::regclass),
  true,
  'property_addresses has RLS enabled'
);
select is(
  (select relrowsecurity from pg_class
   where oid = 'public.parcels'::regclass),
  true,
  'parcels has RLS enabled'
);
select is(
  (select relrowsecurity from pg_class
   where oid = 'public.structures'::regclass),
  true,
  'structures has RLS enabled'
);
select is(
  (select relrowsecurity from pg_class
   where oid = 'public.review_tasks'::regclass),
  true,
  'review_tasks has RLS enabled'
);

select is(
  has_table_privilege('anon', 'public.property_addresses', 'select'),
  false,
  'anonymous users cannot select property addresses'
);
select is(
  has_table_privilege('anon', 'public.parcels', 'select'),
  false,
  'anonymous users cannot select parcels'
);
select is(
  has_table_privilege('anon', 'public.structures', 'select'),
  false,
  'anonymous users cannot select structures'
);
select is(
  has_table_privilege('anon', 'public.review_tasks', 'select'),
  false,
  'anonymous users cannot select review tasks'
);

select is(
  has_table_privilege('authenticated', 'public.property_addresses', 'insert'),
  false,
  'authenticated admins cannot directly insert property addresses'
);
select is(
  has_table_privilege('authenticated', 'public.parcels', 'insert'),
  false,
  'authenticated admins cannot directly insert parcels'
);
select is(
  has_table_privilege('authenticated', 'public.structures', 'insert'),
  false,
  'authenticated admins cannot directly insert structures'
);
select is(
  has_table_privilege('authenticated', 'public.review_tasks', 'insert'),
  false,
  'authenticated admins cannot directly insert review tasks'
);

select is(
  has_table_privilege('service_role', 'public.property_addresses', 'insert'),
  true,
  'service role can insert property addresses'
);
select is(
  has_table_privilege('service_role', 'public.parcels', 'insert'),
  true,
  'service role can insert parcels'
);
select is(
  has_table_privilege('service_role', 'public.structures', 'insert'),
  true,
  'service role can insert structures'
);
select is(
  has_table_privilege('service_role', 'public.review_tasks', 'insert'),
  true,
  'service role can insert review tasks'
);

insert into public.companies (id, name)
values ('00000000-0000-4000-8000-000000000001', 'PIW Local Roofing')
on conflict (id) do nothing;

select lives_ok(
  $$ insert into public.properties (id, company_id, resolution_status)
     values (
       '77777777-7777-4777-8777-777777777777',
       '00000000-0000-4000-8000-000000000001',
       'duplicate'
     ) $$,
  'resolution_status accepts the new duplicate value'
);
select throws_ok(
  $$ insert into public.properties (id, company_id, resolution_status)
     values (
       '88888888-8888-4888-8888-888888888888',
       '00000000-0000-4000-8000-000000000001',
       'bogus'
     ) $$,
  '23514',
  null,
  'resolution_status still rejects unknown values'
);

select is(
  'low_address_confidence' = any(enum_range(null::public.review_task_reason)::text[]),
  true,
  'review_task_reason accepts low_address_confidence as a valid enum member'
);
select function_privs_are(
  'public', 'resolve_review_task',
  array['uuid','uuid','text','uuid','integer','text'],
  'authenticated', array[]::text[],
  'authenticated role cannot call resolve_review_task directly'
);
select function_privs_are(
  'public', 'resolve_review_task',
  array['uuid','uuid','text','uuid','integer','text'],
  'anon', array[]::text[],
  'anonymous role cannot call resolve_review_task directly'
);
select function_privs_are(
  'public', 'resolve_review_task',
  array['uuid','uuid','text','uuid','integer','text'],
  'service_role', array['EXECUTE'],
  'only the service role can execute resolve_review_task'
);
select is(
  (select not prosecdef
   from pg_proc
   where oid = 'public.resolve_review_task(uuid,uuid,text,uuid,integer,text)'::regprocedure),
  true,
  'resolve_review_task is SECURITY INVOKER'
);

select is(
  (
    select count(*)
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any(c.conkey)
    where c.contype = 'f'
      and c.conrelid in (
        'public.properties'::regclass,
        'public.property_addresses'::regclass,
        'public.parcels'::regclass,
        'public.structures'::regclass,
        'public.review_tasks'::regclass
      )
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = c.conrelid
          and i.indpred is null
          and i.indkey[0] = a.attnum
      )
  ),
  0::bigint,
  'every property identity foreign key has a non-partial leading index'
);

insert into public.pipeline_runs (
  id, company_id, property_id, correlation_id, pipeline_version, status
) values (
  '22222222-2222-4222-8222-222222222222',
  '00000000-0000-4000-8000-000000000001',
  '77777777-7777-4777-8777-777777777777',
  '11111111-1111-4111-8111-111111111111',
  1,
  'received'
);

insert into public.worker_runs (
  id, pipeline_run_id, worker_type, worker_version, idempotency_key
) values (
  '33333333-3333-4333-8333-333333333333',
  '22222222-2222-4222-8222-222222222222',
  'address-validation',
  1,
  'property-identity-test-address-validation'
);

select lives_ok(
  $$ insert into public.property_addresses (
       company_id, property_id, worker_run_id, submitted_address,
       match_method, confidence
     ) values (
       '00000000-0000-4000-8000-000000000001',
       '77777777-7777-4777-8777-777777777777',
       '33333333-3333-4333-8333-333333333333',
       '12 Birch St, Trenton, NJ',
       'exact_single_match',
       100
     ) $$,
  'legacy worker-backed property address evidence remains valid'
);

select throws_ok(
  $$ insert into public.property_addresses (
       company_id, property_id, worker_run_id, submitted_address,
       match_method, confidence
     ) values (
       '00000000-0000-4000-8000-000000000001',
       '77777777-7777-4777-8777-777777777777',
       '33333333-3333-4333-8333-333333333333',
       '12 Birch Street, Trenton, NJ',
       'exact_single_match',
       99
     ) $$,
  '23505',
  null,
  'one address observation is stored per worker attempt'
);

insert into public.parcels (
  id, company_id, property_id, block, lot
) values (
  '44444444-4444-4444-8444-444444444444',
  '00000000-0000-4000-8000-000000000001',
  '77777777-7777-4777-8777-777777777777',
  '10',
  '20'
);

select throws_ok(
  $$ insert into public.parcels (
       company_id, property_id, block, lot
     ) values (
       '00000000-0000-4000-8000-000000000001',
       '77777777-7777-4777-8777-777777777777',
       '10',
       '21'
     ) $$,
  '23505',
  null,
  'a property can have at most one primary parcel'
);

select lives_ok(
  $$ insert into public.parcels (
       company_id, property_id, is_primary, block, lot, geometry
     ) values (
       '00000000-0000-4000-8000-000000000001',
       '77777777-7777-4777-8777-777777777777',
       false,
       '10',
       '22',
       'SRID=4326;MULTIPOLYGON(((0 0,0 1,1 1,0 0)))'
     ) $$,
  'valid multipart parcel geometry can be persisted'
);

select is(
  (
    select extensions.st_geometrytype(geometry::extensions.geometry)
    from public.parcels
    where property_id = '77777777-7777-4777-8777-777777777777'
      and lot = '22'
  ),
  'ST_MultiPolygon',
  'multipart parcel geometry retains its geometry type'
);

insert into public.structures (
  company_id, property_id, parcel_id, source
) values (
  '00000000-0000-4000-8000-000000000001',
  '77777777-7777-4777-8777-777777777777',
  '44444444-4444-4444-8444-444444444444',
  'NJGIN'
);

select throws_ok(
  $$ insert into public.structures (
       company_id, property_id, parcel_id, source
     ) values (
       '00000000-0000-4000-8000-000000000001',
       '77777777-7777-4777-8777-777777777777',
       '44444444-4444-4444-8444-444444444444',
       'NJGIN duplicate delivery'
     ) $$,
  '23505',
  null,
  'a property can have at most one primary structure'
);

insert into public.audit_log (
  company_id, action, entity_type, entity_id, correlation_id, worker_run_id
) values (
  '00000000-0000-4000-8000-000000000001',
  'property.address_validated',
  'property',
  '77777777-7777-4777-8777-777777777777',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '33333333-3333-4333-8333-333333333333'
);

select throws_ok(
  $$ insert into public.audit_log (
       company_id, action, entity_type, entity_id, correlation_id, worker_run_id
     ) values (
       '00000000-0000-4000-8000-000000000001',
       'property.address_validated',
       'property',
       '77777777-7777-4777-8777-777777777777',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '33333333-3333-4333-8333-333333333333'
     ) $$,
  '23505',
  null,
  'same-attempt address-validation audit actions are idempotent'
);

insert into public.worker_runs (
  id, pipeline_run_id, worker_type, worker_version, idempotency_key
) values (
  '55555555-5555-4555-8555-555555555555',
  '22222222-2222-4222-8222-222222222222',
  'address-validation',
  1,
  'property-identity-test-address-validation-attempt-2'
);

select lives_ok(
  $$ insert into public.audit_log (
       company_id, action, entity_type, entity_id, correlation_id, worker_run_id
     ) values (
       '00000000-0000-4000-8000-000000000001',
       'property.address_validated',
       'property',
       '77777777-7777-4777-8777-777777777777',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '55555555-5555-4555-8555-555555555555'
     ) $$,
  'distinct address-validation attempts retain distinct audits'
);

select lives_ok(
  $$ insert into public.audit_log (
       company_id, action, entity_type, entity_id, correlation_id, worker_run_id
     ) values (
       '00000000-0000-4000-8000-000000000001',
       'property.discovery_resolved',
       'property',
       '77777777-7777-4777-8777-777777777777',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '55555555-5555-4555-8555-555555555555'
     ) $$,
  'a discovery attempt writes its audit entry'
);

select throws_ok(
  $$ insert into public.audit_log (
       company_id, action, entity_type, entity_id, correlation_id, worker_run_id
     ) values (
       '00000000-0000-4000-8000-000000000001',
       'property.discovery_resolved',
       'property',
       '77777777-7777-4777-8777-777777777777',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '55555555-5555-4555-8555-555555555555'
     ) $$,
  '23505',
  null,
  'same-attempt property-discovery audit actions are idempotent'
);

-- Review action fixtures exercise the database boundary directly. The server
-- action uses this service-role-only RPC, so the function is responsible for
-- locking the task and keeping every mutation inside the supplied company.
insert into public.properties (id, company_id, resolution_status)
values
  ('90000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'review_required'),
  ('90000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'resolved'),
  ('90000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'review_required'),
  ('90000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'review_required'),
  ('90000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', 'review_required'),
  ('90000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', 'review_required'),
  ('90000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001', 'review_required'),
  ('90000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000001', 'review_required');

insert into public.leads (
  id, company_id, property_id, name, phone, email, submitted_address
) values
  ('91000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'Resolve Lead', '555-0101', 'resolve@example.com', '1 Resolve Way'),
  ('91000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000003', 'Duplicate Lead', '555-0102', 'duplicate@example.com', '2 Duplicate Way'),
  ('91000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000004', 'Reject Lead', '555-0103', 'reject@example.com', '3 Reject Way'),
  ('91000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000005', 'Unsupported Lead', '555-0104', 'unsupported@example.com', '4 Unsupported Way'),
  ('91000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000006', 'Address Retry Lead', '555-0105', 'address-retry@example.com', '5 Retry Way'),
  ('91000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000007', 'Discovery Retry Lead', '555-0106', 'discovery-retry@example.com', '6 Retry Way'),
  ('91000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000008', 'Parcel Resolve Lead', '555-0107', 'parcel-resolve@example.com', '7 Resolve Way');

insert into public.pipeline_runs (
  id, company_id, lead_id, property_id, correlation_id, pipeline_version,
  status, finished_at
) values
  ('92000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 1, 'review_required', null),
  ('92000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000002', 1, 'review_required', null),
  ('92000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000004', '93000000-0000-4000-8000-000000000003', 1, 'review_required', null),
  ('92000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000004', '90000000-0000-4000-8000-000000000005', '93000000-0000-4000-8000-000000000004', 1, 'review_required', null),
  ('92000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000005', '90000000-0000-4000-8000-000000000006', '93000000-0000-4000-8000-000000000005', 1, 'review_required', now()),
  ('92000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000006', '90000000-0000-4000-8000-000000000007', '93000000-0000-4000-8000-000000000006', 1, 'review_required', now()),
  ('92000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000007', '90000000-0000-4000-8000-000000000008', '93000000-0000-4000-8000-000000000007', 1, 'review_required', null);

insert into public.review_tasks (
  id, company_id, pipeline_run_id, lead_id, property_id, reason,
  triggering_event_name, candidate_data
) values
  ('94000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'low_address_confidence', 'property/address.validation_requested', '{"result":{"canonicalAddress":"1 Resolve Way, NJ"}}'),
  ('94000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000003', 'duplicate_candidates', 'property/address.validation_requested', '{"candidatePropertyIds":["90000000-0000-4000-8000-000000000002"]}'),
  ('94000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000004', 'low_address_confidence', 'property/address.validation_requested', '{}'),
  ('94000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000004', '90000000-0000-4000-8000-000000000005', 'unsupported_property_type', 'property/discovery_requested', '{}'),
  ('94000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000005', '90000000-0000-4000-8000-000000000006', 'low_address_confidence', 'property/address.validation_requested', '{}'),
  ('94000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000006', '91000000-0000-4000-8000-000000000006', '90000000-0000-4000-8000-000000000007', 'multiple_parcels', 'property/discovery_requested', '{"candidates":[{"block":"10","lot":"20","qualifier":null,"pamsPin":"0101_10_20","gisPin":"gis-10-20","municipalityCode":"0101","municipalityName":"Test Township","county":"Mercer","propertyClass":"2","acreage":0.5,"yearBuilt":1998,"landValue":50000.125,"improvementValue":150000.505,"netValue":200000.63,"propertyLocation":"6 Retry Way","streetAddress":"6 Retry Way","buildingDescription":"1 Story","landDescription":"Residential","dwellingUnits":1,"geometry":null}]}'),
  ('94000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000007', '91000000-0000-4000-8000-000000000007', '90000000-0000-4000-8000-000000000008', 'multiple_parcels', 'property/discovery_requested', '{"candidates":[{"block":"11","lot":"21","qualifier":null,"pamsPin":"0101_11_21","gisPin":"gis-11-21","municipalityCode":"0101","municipalityName":"Test Township","county":"Mercer","propertyClass":"2","acreage":0.75,"yearBuilt":2001,"landValue":50000.125,"improvementValue":150000.505,"netValue":200000.63,"propertyLocation":"7 Resolve Way","streetAddress":"7 Resolve Way","buildingDescription":"2 Story","landDescription":"Residential","dwellingUnits":1,"geometry":null}]}');

select is(
  (select new_status from public.resolve_review_task(
    '00000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000001',
    'resolve', null, null, 'accepted as submitted'
  )),
  'resolved'::public.review_task_status,
  'resolve without a candidate closes the review task'
);
select is(
  (select resolution_status from public.properties where id = '90000000-0000-4000-8000-000000000001'),
  'resolved',
  'resolve without a candidate marks the placeholder property resolved'
);
select is(
  (select status from public.pipeline_runs where id = '92000000-0000-4000-8000-000000000001'),
  'complete'::public.pipeline_status,
  'resolve completes the linked pipeline'
);
select throws_ok(
  $$ select public.resolve_review_task(
       '00000000-0000-4000-8000-000000000001',
       '94000000-0000-4000-8000-000000000001',
       'reject', null, null, 'too late') $$,
  null,
  'Review task 94000000-0000-4000-8000-000000000001 is not open',
  'a different second action on a closed task is rejected'
);

select is(
  (select new_status from public.resolve_review_task(
    '00000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000002',
    'resolve', null, 0, 'merge duplicate'
  )),
  'resolved'::public.review_task_status,
  'resolve can select a duplicate candidate'
);
select is(
  (select merged_into_property_id from public.properties where id = '90000000-0000-4000-8000-000000000003'),
  '90000000-0000-4000-8000-000000000002'::uuid,
  'duplicate resolution records the canonical property'
);
select is(
  (select property_id from public.leads where id = '91000000-0000-4000-8000-000000000002'),
  '90000000-0000-4000-8000-000000000002'::uuid,
  'duplicate resolution repoints the lead'
);
select is(
  (select property_id from public.pipeline_runs where id = '92000000-0000-4000-8000-000000000002'),
  '90000000-0000-4000-8000-000000000002'::uuid,
  'duplicate resolution repoints the pipeline'
);

select is(
  (select new_status from public.resolve_review_task(
    '00000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000007',
    'resolve', null, 0, 'select parcel'
  )),
  'resolved'::public.review_task_status,
  'resolve can select a parcel candidate'
);
select is(
  (select row(land_value_cents, improvement_value_cents, net_value_cents)
   from public.parcels where property_id = '90000000-0000-4000-8000-000000000008'),
  row(5000013::bigint, 15000051::bigint, 20000063::bigint),
  'selected parcel dollar values are rounded to integer cents'
);

select is(
  (select new_status from public.resolve_review_task(
    '00000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000003',
    'reject', null, null, 'invalid address'
  )),
  'rejected'::public.review_task_status,
  'reject closes the task as rejected'
);
select is(
  (select status from public.pipeline_runs where id = '92000000-0000-4000-8000-000000000003'),
  'failed'::public.pipeline_status,
  'reject fails the linked pipeline'
);

select is(
  (select new_status from public.resolve_review_task(
    '00000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000004',
    'unsupported', null, null, 'outside supported property types'
  )),
  'unsupported'::public.review_task_status,
  'unsupported closes the task as unsupported'
);
select is(
  (select row(resolution_status, (select status from public.pipeline_runs where id = '92000000-0000-4000-8000-000000000004'))
   from public.properties where id = '90000000-0000-4000-8000-000000000005'),
  row('unsupported'::text, 'partial'::public.pipeline_status),
  'unsupported marks the property unsupported and pipeline partial'
);

select is(
  (select next_attempt from public.resolve_review_task(
    '00000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000005',
    'retry', null, null, 'try address again'
  )),
  2,
  'address retry returns the next attempt'
);
select is(
  (select row(status, retry_count) from public.review_tasks where id = '94000000-0000-4000-8000-000000000005'),
  row('retried'::public.review_task_status, 1),
  'address retry closes the task and increments its retry count once'
);
select is(
  (select row(resolution_status, (select status from public.pipeline_runs where id = '92000000-0000-4000-8000-000000000005'))
   from public.properties where id = '90000000-0000-4000-8000-000000000006'),
  row('unresolved'::text, 'received'::public.pipeline_status),
  'address retry resets property and pipeline before republishing'
);
select is(
  (select next_attempt from public.resolve_review_task(
    '00000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000005',
    'retry', null, null, 'replayed request'
  )),
  2,
  'replaying the same retry returns the same next attempt'
);
select is(
  (select retry_count from public.review_tasks where id = '94000000-0000-4000-8000-000000000005'),
  1,
  'replaying the same retry does not increment again'
);

select is(
  (select count(*) from public.audit_log
   where entity_type = 'review_task'
     and entity_id = '94000000-0000-4000-8000-000000000005'
     and action = 'review.task_retried'),
  1::bigint,
  'replayed retry keeps one durable admin audit row'
);
select is(
  (select count(*)
   from public.event_outbox as outbox
   join public.domain_events as event on event.id = outbox.event_id
   where event.idempotency_key =
     'property/address.validation_requested:92000000-0000-4000-8000-000000000005:2'),
  1::bigint,
  'address retry atomically creates its attempt-2 outbox event'
);

-- A worker can return to review after a retry. Its new review task carries the
-- triggering attempt as retry_count so the next retry advances to attempt 3.
update public.properties
set resolution_status = 'review_required'
where id = '90000000-0000-4000-8000-000000000006';
update public.pipeline_runs
set status = 'review_required'
where id = '92000000-0000-4000-8000-000000000005';
insert into public.review_tasks (
  id, company_id, pipeline_run_id, lead_id, property_id, reason,
  triggering_event_name, candidate_data, retry_count
) values (
  '94000000-0000-4000-8000-000000000008',
  '00000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000005',
  '91000000-0000-4000-8000-000000000005',
  '90000000-0000-4000-8000-000000000006',
  'low_address_confidence',
  'property/address.validation_requested',
  '{}',
  1
);

select is(
  (select next_attempt from public.resolve_review_task(
    '00000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000008',
    'retry', null, null, 'third address attempt'
  )),
  3,
  'a second review cycle advances to attempt 3'
);
select is(
  (select count(*)
   from public.event_outbox as outbox
   join public.domain_events as event on event.id = outbox.event_id
   where event.idempotency_key in (
     'property/address.validation_requested:92000000-0000-4000-8000-000000000005:2',
     'property/address.validation_requested:92000000-0000-4000-8000-000000000005:3'
   )),
  2::bigint,
  'review retry lineage produces distinct attempt-2 and attempt-3 events'
);
select is(
  (select count(*) from public.audit_log
   where entity_type = 'review_task'
     and entity_id = '94000000-0000-4000-8000-000000000008'
     and action = 'review.task_retried'),
  1::bigint,
  'the second review cycle writes one durable admin audit row'
);
select is(
  (
    with replay as (
      select * from public.resolve_review_task(
        '00000000-0000-4000-8000-000000000001',
        '94000000-0000-4000-8000-000000000008',
        'retry', null, null, 'replayed third attempt'
      )
    )
    select row(
      (select next_attempt from replay),
      (select count(*) from public.audit_log
       where entity_type = 'review_task'
         and entity_id = '94000000-0000-4000-8000-000000000008'
         and action = 'review.task_retried'),
      (select count(*)
       from public.event_outbox as outbox
       join public.domain_events as event on event.id = outbox.event_id
       where event.idempotency_key =
         'property/address.validation_requested:92000000-0000-4000-8000-000000000005:3')
    )
  ),
  row(3, 1::bigint, 1::bigint),
  'same-action replay reuses attempt 3 without duplicate audit or outbox rows'
);

insert into public.worker_runs (
  id, pipeline_run_id, worker_type, worker_version, idempotency_key
) values (
  '95000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000006',
  'address-validation',
  1,
  'review-discovery-retry-context'
);
insert into public.property_addresses (
  company_id, property_id, worker_run_id, submitted_address,
  canonical_address, latitude, longitude, state_code, match_method, confidence
) values (
  '00000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000007',
  '95000000-0000-4000-8000-000000000001',
  '6 Retry Way',
  '6 Retry Way, Trenton, NJ 08608',
  40.2206,
  -74.7699,
  'NJ',
  'exact_single_match',
  100
);

select is(
  (select next_attempt from public.resolve_review_task(
    '00000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000006',
    'retry', null, null, 'try parcel discovery again'
  )),
  2,
  'discovery retry returns the next attempt'
);
select is(
  (select status from public.pipeline_runs where id = '92000000-0000-4000-8000-000000000006'),
  'validating'::public.pipeline_status,
  'discovery retry resets the pipeline to the discovery predecessor state'
);

insert into public.properties (id, company_id, resolution_status)
values (
  '90000000-0000-4000-8000-000000000009',
  '00000000-0000-4000-8000-000000000001',
  'review_required'
);
insert into public.leads (
  id, company_id, property_id, name, phone, email, submitted_address
) values (
  '91000000-0000-4000-8000-000000000008',
  '00000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000009',
  'Missing Context Lead',
  '555-0108',
  'missing-context@example.com',
  '8 Missing Context Way'
);
insert into public.pipeline_runs (
  id, company_id, lead_id, property_id, correlation_id, pipeline_version,
  status
) values (
  '92000000-0000-4000-8000-000000000008',
  '00000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000008',
  '90000000-0000-4000-8000-000000000009',
  '93000000-0000-4000-8000-000000000008',
  1,
  'review_required'
);
insert into public.review_tasks (
  id, company_id, pipeline_run_id, lead_id, property_id, reason,
  triggering_event_name
) values (
  '94000000-0000-4000-8000-000000000009',
  '00000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000008',
  '91000000-0000-4000-8000-000000000008',
  '90000000-0000-4000-8000-000000000009',
  'multiple_parcels',
  'property/discovery_requested'
);

select throws_ok(
  $$ select public.resolve_review_task(
       '00000000-0000-4000-8000-000000000001',
       '94000000-0000-4000-8000-000000000009',
       'retry', null, null, 'missing canonical context') $$,
  null,
  'Discovery retry requires a canonical address for review task 94000000-0000-4000-8000-000000000009',
  'retry refuses to close when a durable event cannot be constructed'
);
select is(
  (
    select row(
      task.status,
      task.retry_count,
      property.resolution_status,
      run.status,
      (select count(*) from public.audit_log
       where entity_type = 'review_task'
         and entity_id = task.id),
      (select count(*)
       from public.event_outbox as outbox
       join public.domain_events as event on event.id = outbox.event_id
       where event.pipeline_run_id = run.id)
    )
    from public.review_tasks as task
    join public.properties as property on property.id = task.property_id
    join public.pipeline_runs as run on run.id = task.pipeline_run_id
    where task.id = '94000000-0000-4000-8000-000000000009'
  ),
  row(
    'open'::public.review_task_status,
    0,
    'review_required'::text,
    'review_required'::public.pipeline_status,
    0::bigint,
    0::bigint
  ),
  'failed retry leaves task, property, pipeline, audit, and outbox unchanged'
);

select set_eq(
  $$ select distinct action from public.audit_log
     where entity_type = 'review_task' $$,
  $$ values
       ('review.task_resolved'::text),
       ('review.task_rejected'::text),
       ('review.task_retried'::text),
       ('review.task_unsupported'::text) $$,
  'review actions persist only the exact approved audit verbs'
);

select throws_ok(
  $$ select public.resolve_review_task(
       '00000000-0000-4000-8000-000000000002',
       '94000000-0000-4000-8000-000000000006',
       'resolve', null, 0, 'cross tenant') $$,
  null,
  'Review task 94000000-0000-4000-8000-000000000006 not found for company 00000000-0000-4000-8000-000000000002',
  'review actions cannot cross company scope'
);

select * from finish();

rollback;

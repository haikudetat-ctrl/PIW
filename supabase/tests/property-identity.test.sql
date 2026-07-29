begin;

create extension if not exists pgtap with schema extensions;

select plan(48);

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
select col_not_null(
  'public', 'property_addresses', 'worker_run_id',
  'property_addresses.worker_run_id is required'
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
  (select count(*) from public.review_tasks
   where reason = 'low_address_confidence'),
  0::bigint,
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

insert into public.property_addresses (
  company_id, property_id, worker_run_id, submitted_address,
  match_method, confidence
) values (
  '00000000-0000-4000-8000-000000000001',
  '77777777-7777-4777-8777-777777777777',
  '33333333-3333-4333-8333-333333333333',
  '12 Birch St, Trenton, NJ',
  'exact_single_match',
  100
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

select * from finish();

rollback;

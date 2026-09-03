begin;

select plan(25);

select has_table(
  'public', 'roof_assessment_result_view_attempts',
  'result-view limiter stores only service-side attempts'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.roof_assessment_result_view_attempts'::regclass),
  'result-view limiter has RLS enabled'
);
select table_privs_are(
  'public', 'roof_assessment_result_view_attempts', 'anon', array[]::text[],
  'anonymous clients cannot access the result-view limiter table'
);
select table_privs_are(
  'public', 'roof_assessment_result_view_attempts', 'authenticated', array[]::text[],
  'authenticated clients cannot access the result-view limiter table'
);

select has_function(
  'public', 'record_public_privacy_consent',
  array['uuid','uuid','text','boolean','boolean','boolean','text','inet','text','timestamp with time zone'],
  'atomic public-consent write RPC exists'
);
select has_function(
  'public', 'consume_roof_assessment_result_view_limit', array['uuid','inet'],
  'atomic result-view limiter RPC exists'
);
select has_function(
  'public', 'acknowledge_roof_assessment_result_view',
  array['uuid','uuid','uuid','uuid','text','boolean','boolean','boolean','text','inet','text'],
  'atomic result acknowledgement RPC exists'
);
select ok(
  (select pg_catalog.bool_and(proc.prosecdef and proc.proconfig = array['search_path=""'])
   from pg_catalog.pg_proc as proc
   where proc.oid in (
     'public.record_public_privacy_consent(uuid,uuid,text,boolean,boolean,boolean,text,inet,text,timestamptz)'::regprocedure,
     'public.consume_roof_assessment_result_view_limit(uuid,inet)'::regprocedure,
     'public.acknowledge_roof_assessment_result_view(uuid,uuid,uuid,uuid,text,boolean,boolean,boolean,text,inet,text)'::regprocedure
   )),
  'new public boundaries are security definer functions with an empty search path'
);
select ok(
  (select pg_catalog.bool_and(
    pg_catalog.has_function_privilege('service_role', proc.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('public', proc.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', proc.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', proc.oid, 'EXECUTE')
  )
   from pg_catalog.pg_proc as proc
   where proc.oid in (
     'public.record_public_privacy_consent(uuid,uuid,text,boolean,boolean,boolean,text,inet,text,timestamptz)'::regprocedure,
     'public.consume_roof_assessment_result_view_limit(uuid,inet)'::regprocedure,
     'public.acknowledge_roof_assessment_result_view(uuid,uuid,uuid,uuid,text,boolean,boolean,boolean,text,inet,text)'::regprocedure
   )),
  'only the service role can execute the new public-boundary RPCs'
);
select ok(
  not exists(
    select 1
    from pg_catalog.pg_constraint as cons
    where cons.conrelid = 'public.privacy_consent_evidence'::regclass
      and cons.contype = 'u'
      and pg_catalog.pg_get_constraintdef(cons.oid) like '%consent_id, policy_version, occurred_at, source%'
  ),
  'equal-time consent evidence is no longer discarded by the old broad unique constraint'
);

create temp table release_boundary_fixture as
select
  '9a000000-0000-4000-8000-000000000001'::uuid as consent_id,
  pg_catalog.clock_timestamp() - interval '5 seconds' as occurred_at,
  '203.0.113.71'::inet as request_ip;

select lives_ok($$
  select * from public.record_public_privacy_consent(
    '9a000000-0000-4000-8000-000000000101',
    (select consent_id from release_boundary_fixture),
    'piw-privacy-v1', false, true, false, 'banner',
    (select request_ip from release_boundary_fixture), 'pgTAP',
    (select occurred_at from release_boundary_fixture)
  )
$$, 'the constrained public RPC records an initial grant');
select lives_ok($$
  select * from public.record_public_privacy_consent(
    '9a000000-0000-4000-8000-000000000102',
    (select consent_id from release_boundary_fixture),
    'piw-privacy-v1', false, true, false, 'banner',
    (select request_ip from release_boundary_fixture), 'pgTAP',
    (select occurred_at from release_boundary_fixture)
  )
$$, 'an identical public retry is idempotent even with a fresh evidence id');
select is(
  (select count(*) from public.privacy_consent_evidence
   where consent_id = (select consent_id from release_boundary_fixture)),
  1::bigint,
  'an identical retry consumes no additional consent write slot'
);
select is(
  (select advertising_granted::text from public.record_public_privacy_consent(
    '9a000000-0000-4000-8000-000000000103',
    (select consent_id from release_boundary_fixture),
    'piw-privacy-v1', false, false, false, 'banner',
    (select request_ip from release_boundary_fixture), 'pgTAP',
    (select occurred_at from release_boundary_fixture)
  )),
  'false',
  'a same-time revocation is appended and returned as canonical'
);
select is(
  (select count(*) from public.privacy_consent_evidence
   where consent_id = (select consent_id from release_boundary_fixture)),
  2::bigint,
  'same-time grant and denial evidence both remain append-only'
);
select is(
  (select advertising_granted::text
   from public.privacy_consent_evidence
   where consent_id = (select consent_id from release_boundary_fixture)
   order by occurred_at desc, advertising_granted asc, gpc_detected desc, created_at desc, evidence_id desc
   limit 1),
  'false',
  'same-time denial wins canonical current-consent ordering'
);

create temp table public_limit_fixture as
select '9a000000-0000-4000-8000-000000000002'::uuid as consent_id,
       '203.0.113.72'::inet as request_ip;
select is(
  (select count(*) from (
    select public.record_public_privacy_consent(
      extensions.gen_random_uuid(), (select consent_id from public_limit_fixture),
      'piw-privacy-v1', false, true, false, 'preferences',
      (select request_ip from public_limit_fixture), 'pgTAP',
      pg_catalog.clock_timestamp() - ((13 - value)::text || ' seconds')::interval
    )
    from pg_catalog.generate_series(1, 12) as value
  ) as writes),
  12::bigint,
  'the public RPC permits the bounded twelve-write consent window'
);
select throws_ok($$
  select * from public.record_public_privacy_consent(
    extensions.gen_random_uuid(), (select consent_id from public_limit_fixture),
    'piw-privacy-v1', false, true, false, 'preferences',
    (select request_ip from public_limit_fixture), 'pgTAP', pg_catalog.clock_timestamp()
  )
$$, 'P0001', 'Privacy consent request limit exceeded',
  'the thirteenth fresh public consent write is atomically rejected');

create temp table result_limit_fixture as
select '9a000000-0000-4000-8000-000000000003'::uuid as public_token,
       '203.0.113.73'::inet as request_ip;
select ok(
  (select pg_catalog.bool_and(allowed) from (
    select allowed
    from pg_catalog.generate_series(1, 12) as series(value), lateral public.consume_roof_assessment_result_view_limit(
      ((select public_token::text from result_limit_fixture) || pg_catalog.right(series.value::text, 0))::uuid,
      (select request_ip from result_limit_fixture)
    )
  ) as attempts),
  'the result-view limiter permits the bounded token window'
);
select is(
  (select allowed::text from public.consume_roof_assessment_result_view_limit(
    (select public_token from result_limit_fixture), (select request_ip from result_limit_fixture)
  )),
  'false',
  'the result-view limiter rejects the thirteenth token request before lookup work'
);

-- Historical eligibility remains tied to the originating lead, while the
-- current consent sequence may be updated by unlinked website evidence only.
create temp table delivery_boundary_fixture as
select pg_catalog.clock_timestamp() - interval '10 seconds' as base_at;
insert into public.companies(id, name) values
  ('9a000000-0000-4000-8000-000000000010', 'Consent Delivery Boundary Company');
insert into public.properties(id, company_id, canonical_address) values
  ('9a000000-0000-4000-8000-000000000011',
   '9a000000-0000-4000-8000-000000000010', '100 Consent Lane, Newark, NJ 07102');
insert into public.leads(
  id, company_id, property_id, name, phone, email, submitted_address
) values
  ('9a000000-0000-4000-8000-000000000012',
   '9a000000-0000-4000-8000-000000000010',
   '9a000000-0000-4000-8000-000000000011',
   'Original Consent Lead', '+12015550110', 'original-consent@example.com',
   '100 Consent Lane, Newark, NJ 07102'),
  ('9a000000-0000-4000-8000-000000000013',
   '9a000000-0000-4000-8000-000000000010',
   '9a000000-0000-4000-8000-000000000011',
   'Other Consent Lead', '+12015550111', 'other-consent@example.com',
   '101 Consent Lane, Newark, NJ 07102');
insert into public.privacy_consent_evidence(
  evidence_id, consent_id, company_id, lead_id, policy_version,
  analytics_granted, advertising_granted, gpc_detected, source, occurred_at
) values
  ('9a000000-0000-4000-8000-000000000015',
   '9a000000-0000-4000-8000-000000000014',
   '9a000000-0000-4000-8000-000000000010',
   '9a000000-0000-4000-8000-000000000012',
   'piw-privacy-v1', false, true, false, 'preferences',
   (select base_at from delivery_boundary_fixture)),
  ('9a000000-0000-4000-8000-000000000016',
   '9a000000-0000-4000-8000-000000000014',
   '9a000000-0000-4000-8000-000000000010',
   '9a000000-0000-4000-8000-000000000013',
   'piw-privacy-v1', false, false, false, 'preferences',
   (select base_at + interval '3 seconds' from delivery_boundary_fixture)),
  ('9a000000-0000-4000-8000-000000000019',
   '9a000000-0000-4000-8000-000000000018',
   '9a000000-0000-4000-8000-000000000010',
   '9a000000-0000-4000-8000-000000000013',
   'piw-privacy-v1', false, false, false, 'preferences',
   (select base_at from delivery_boundary_fixture));
insert into public.meta_event_deliveries(
  id, company_id, lead_id, consent_id, policy_version, event_name, event_time
) values
  ('9a000000-0000-4000-8000-000000000017',
   '9a000000-0000-4000-8000-000000000010',
   '9a000000-0000-4000-8000-000000000012',
   '9a000000-0000-4000-8000-000000000014',
   'piw-privacy-v1', 'Lead',
   (select base_at + interval '1 second' from delivery_boundary_fixture)),
  ('9a000000-0000-4000-8000-000000000020',
   '9a000000-0000-4000-8000-000000000010',
   '9a000000-0000-4000-8000-000000000013',
   '9a000000-0000-4000-8000-000000000018',
   'piw-privacy-v1', 'Lead',
   (select base_at + interval '1 second' from delivery_boundary_fixture));
select * from public.record_public_privacy_consent(
  '9a000000-0000-4000-8000-000000000021',
  '9a000000-0000-4000-8000-000000000014',
  'piw-privacy-v1', false, true, false, 'preferences',
  '203.0.113.81', 'pgTAP',
  (select base_at + interval '2 seconds' from delivery_boundary_fixture)
);
select ok(
  exists(
    select 1 from public.list_pending_meta_deliveries(
      50, (select base_at + interval '4 seconds' from delivery_boundary_fixture)
    ) as pending
    where pending.id = '9a000000-0000-4000-8000-000000000017'
  ),
  'a second lead sharing consent cannot suppress an originally granted delivery'
);
select * from public.record_public_privacy_consent(
  '9a000000-0000-4000-8000-000000000022',
  '9a000000-0000-4000-8000-000000000014',
  'piw-privacy-v1', false, false, false, 'preferences',
  '203.0.113.81', 'pgTAP',
  (select base_at + interval '5 seconds' from delivery_boundary_fixture)
);
select ok(
  not exists(
    select 1 from public.list_pending_meta_deliveries(
      50, (select base_at + interval '6 seconds' from delivery_boundary_fixture)
    ) as pending
    where pending.id = '9a000000-0000-4000-8000-000000000017'
  ),
  'a later unlinked revocation suppresses the originally granted delivery'
);
select * from public.record_public_privacy_consent(
  '9a000000-0000-4000-8000-000000000023',
  '9a000000-0000-4000-8000-000000000018',
  'piw-privacy-v1', false, true, false, 'preferences',
  '203.0.113.82', 'pgTAP',
  (select base_at + interval '3 seconds' from delivery_boundary_fixture)
);
select ok(
  not exists(
    select 1 from public.list_pending_meta_deliveries(
      50, (select base_at + interval '4 seconds' from delivery_boundary_fixture)
    ) as pending
    where pending.id = '9a000000-0000-4000-8000-000000000020'
  ),
  'a later current grant cannot list a delivery denied at its event time'
);
select is(
  (select count(*) from public.claim_meta_delivery(
    '9a000000-0000-4000-8000-000000000020',
    (select base_at + interval '4 seconds' from delivery_boundary_fixture)
  )),
  0::bigint,
  'a later current grant cannot claim a delivery denied at its event time'
);

select throws_ok($$
  set local role anon;
  select * from public.record_public_privacy_consent(
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    'piw-privacy-v1', false, false, false, 'banner', '203.0.113.99', 'pgTAP', pg_catalog.clock_timestamp()
  )
$$, '42501', null, 'anonymous clients cannot call the public consent RPC directly');

select * from finish();
rollback;

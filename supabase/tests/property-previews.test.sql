begin;

select plan(27);

select has_table('public', 'property_previews', 'property previews table exists');
select has_table('public', 'property_preview_rate_buckets', 'preview rate buckets table exists');
select has_table('public', 'property_preview_email_sends', 'preview email sends table exists');
select ok(
  (select pg_catalog.bool_and(relrowsecurity) from pg_catalog.pg_class
   where oid in ('public.property_previews'::regclass,
                 'public.property_preview_rate_buckets'::regclass,
                 'public.property_preview_email_sends'::regclass)),
  'preview tables have RLS enabled'
);
select table_privs_are('public', 'property_previews', 'anon', array[]::text[], 'anon cannot access previews');
select table_privs_are('public', 'property_previews', 'authenticated', array[]::text[], 'authenticated cannot access previews');
select ok(
  not has_function_privilege('anon', 'public.create_property_preview(uuid,text,text,text,text,text,text,text,jsonb,text,text,timestamptz,text,text,integer,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.create_property_preview(uuid,text,text,text,text,text,text,text,jsonb,text,text,timestamptz,text,text,integer,integer)', 'execute'),
  'only the service role can create previews'
);
select ok(
  (select pg_catalog.bool_and(proc.prosecdef and proc.proconfig = array['search_path=""'])
   from pg_catalog.pg_proc as proc
   where proc.oid in (
     'public.create_property_preview(uuid,text,text,text,text,text,text,text,jsonb,text,text,timestamptz,text,text,integer,integer)'::regprocedure,
     'public.record_property_preview_responses(uuid,text,jsonb)'::regprocedure,
     'public.mark_property_preview_progress(uuid,text,text)'::regprocedure,
     'public.save_property_preview_email(uuid,text,text,text,timestamptz,integer)'::regprocedure,
     'public.expire_property_previews()'::regprocedure,
     'public.consume_property_preview_rate_limit(text,interval,integer)'::regprocedure
   )),
  'preview functions are security definer with an empty search path'
);

insert into public.companies (id, name) values
  ('fc000000-0000-4000-8000-000000000001', 'Preview Company'),
  ('fc000000-0000-4000-8000-000000000002', 'Other Preview Company');

create temp table first_preview as
select * from public.create_property_preview(
  'fc000000-0000-4000-8000-000000000001', pg_catalog.repeat('1', 64),
  '1 Main St, Newark, NJ 07102', 'ChIJ-preview-one', 'google',
  'weather-report', 'campaign:weather-report', 'weather-report', '{"utm_source":"facebook"}',
  'https://allseasonroofingquote.com/campaigns/weather-report',
  'all-season-property-preview-v1', pg_catalog.now(), '203.0.113.10', 'pgtap'
);

select ok(
  (select preview_id is not null and property_id is not null and not rate_limited and not reused_property
   from first_preview),
  'a first preview creates a new unresolved property'
);
select is(
  (select resolution_status::text from public.properties
   where id = (select property_id from first_preview)),
  'unresolved',
  'the preview property starts unresolved'
);
select ok(
  (select expires_at between pg_catalog.now() + interval '6 days 23 hours' and pg_catalog.now() + interval '7 days 1 minute'
   from public.property_previews where id = (select preview_id from first_preview)),
  'previews expire after seven days'
);

select is(
  (select property_id from public.create_property_preview(
    'fc000000-0000-4000-8000-000000000001', pg_catalog.repeat('2', 64),
    '1 Main Street Newark NJ', 'ChIJ-preview-one', 'google',
    null, 'main-home', 'all-season-main', '{}', null,
    'all-season-property-preview-v1', pg_catalog.now(), '203.0.113.11', 'pgtap'
  )),
  (select property_id from first_preview),
  'a second preview for the same Place ID reuses the property'
);
select isnt(
  (select property_id from public.create_property_preview(
    'fc000000-0000-4000-8000-000000000002', pg_catalog.repeat('3', 64),
    '1 Main St, Newark, NJ 07102', 'ChIJ-preview-one', 'google',
    null, 'main-home', 'all-season-main', '{}', null,
    'all-season-property-preview-v1', pg_catalog.now(), '203.0.113.12', 'pgtap'
  )),
  (select property_id from first_preview),
  'another tenant never shares the property'
);

select throws_ok(
  $$select * from public.create_property_preview(
    'fc000000-0000-4000-8000-000000000001', pg_catalog.repeat('4', 64),
    '2 Main St, Newark, NJ', 'ChIJ-manual', 'manual', null, 'main-home', 'all-season-main',
    '{}', null, 'v1', pg_catalog.now(), '203.0.113.13', 'pgtap')$$,
  'P0001', 'A manual preview must not carry a Place ID',
  'manual previews cannot carry a Place ID'
);

select ok(
  not (select rate_limited from public.create_property_preview(
    'fc000000-0000-4000-8000-000000000001', pg_catalog.repeat('5', 64),
    '5 Main St, Newark, NJ', null, 'manual', null, 'main-home', 'all-season-main',
    '{}', null, 'v1', pg_catalog.now(), '198.51.100.20', 'pgtap', 1, 500)),
  'the first preview from an IP is within the hourly limit'
);
select ok(
  (select rate_limited and preview_id is null from public.create_property_preview(
    'fc000000-0000-4000-8000-000000000001', pg_catalog.repeat('6', 64),
    '6 Main St, Newark, NJ', null, 'manual', null, 'main-home', 'all-season-main',
    '{}', null, 'v1', pg_catalog.now(), '198.51.100.20', 'pgtap', 1, 500)),
  'the next preview from that IP is rate limited and not created'
);
select ok(
  not exists (select 1 from public.property_preview_rate_buckets where bucket_key like '%198.51.100.20%'),
  'rate buckets never store a raw IP address'
);

select lives_ok(
  $$select public.record_property_preview_responses(
    'fc000000-0000-4000-8000-000000000001', pg_catalog.repeat('1', 64),
    '{"reason":"storm_damage","roofAge":"15_20","timeline":"asap"}')$$,
  'the three pre-contact answers are accepted'
);
select throws_ok(
  $$select public.record_property_preview_responses(
    'fc000000-0000-4000-8000-000000000001', pg_catalog.repeat('1', 64), '{"stories":"two"}')$$,
  'P0001', null,
  'questions outside the three pre-contact answers are rejected'
);
select throws_ok(
  $$select public.record_property_preview_responses(
    'fc000000-0000-4000-8000-000000000002', pg_catalog.repeat('1', 64), '{"timeline":"asap"}')$$,
  'P0001', 'Preview is not active',
  'a token cannot be used under another tenant'
);

select is(
  (select pg_catalog.array_agg(allowed order by n)
   from pg_catalog.generate_series(1, 4) as n,
   lateral public.save_property_preview_email(
     'fc000000-0000-4000-8000-000000000001', pg_catalog.repeat('1', 64),
     'Alex@Example.com', 'all-season-preview-email-v1', pg_catalog.now())),
  array[true, true, true, false],
  'a preview can send at most three reports a day'
);
select is(
  (select saved_email_normalized from public.property_previews where token_hash = pg_catalog.repeat('1', 64)),
  'alex@example.com',
  'the saved email is normalized'
);
select ok(
  (select expires_at > pg_catalog.now() + interval '29 days'
   from public.property_previews where token_hash = pg_catalog.repeat('1', 64)),
  'saving a report extends the preview to 30 days'
);
select is(
  (select allowed from public.save_property_preview_email(
    'fc000000-0000-4000-8000-000000000001', pg_catalog.repeat('2', 64),
    'ALEX@example.com', 'all-season-preview-email-v1', pg_catalog.now())),
  false,
  'the same address cannot be emailed more than three times a day across previews'
);

select lives_ok(
  $$select public.mark_property_preview_progress(
    'fc000000-0000-4000-8000-000000000001', pg_catalog.repeat('1', 64), 'revealed')$$,
  'reveal progress is recorded'
);

update public.property_previews
set expires_at = pg_catalog.now() - interval '1 minute'
where token_hash = pg_catalog.repeat('2', 64);
select ok(public.expire_property_previews() >= 1, 'overdue previews are expired');
select is(
  (select status from public.property_previews where token_hash = pg_catalog.repeat('2', 64)),
  'expired',
  'an expired preview is marked expired'
);

select * from finish();
rollback;

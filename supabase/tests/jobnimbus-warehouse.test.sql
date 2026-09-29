begin;

select plan(16);

insert into public.companies(id, name) values
  ('95000000-0000-4000-8000-000000000001', 'JobNimbus Warehouse Company'),
  ('95000000-0000-4000-8000-000000000002', 'JobNimbus Control Company');

-- First landing creates rows, the sync-state row, and reports both as changed.
select is(
  public.land_jobnimbus_batch(
    '95000000-0000-4000-8000-000000000001',
    'job',
    '[
      {"jnid": "job-a", "payload": {"jnid": "job-a", "status_name": "Lead"}, "content_hash": "hash-a1", "jn_updated_at": "2026-09-01T00:00:00Z"},
      {"jnid": "job-b", "payload": {"jnid": "job-b", "status_name": "Quoted"}, "content_hash": "hash-b1", "jn_updated_at": "2026-09-01T00:00:00Z"}
    ]'::jsonb,
    '2026-09-29T12:00:00Z'
  ),
  2,
  'a first landing reports every new record as changed'
);

select is(
  (select watermark from public.jobnimbus_sync_state
   where company_id = '95000000-0000-4000-8000-000000000001' and record_type = 'job'),
  '2026-09-29T12:00:00Z'::timestamptz,
  'landing creates the watermark for the company and record type'
);

-- Replaying identical content changes nothing.
select is(
  public.land_jobnimbus_batch(
    '95000000-0000-4000-8000-000000000001',
    'job',
    '[{"jnid": "job-a", "payload": {"jnid": "job-a", "status_name": "Lead"}, "content_hash": "hash-a1", "jn_updated_at": "2026-09-01T00:00:00Z"}]'::jsonb,
    '2026-09-29T13:00:00Z'
  ),
  0,
  'an identical replay reports no change'
);

-- A newer version with a different hash is counted and stored.
select is(
  public.land_jobnimbus_batch(
    '95000000-0000-4000-8000-000000000001',
    'job',
    '[{"jnid": "job-a", "payload": {"jnid": "job-a", "status_name": "Signed Contract"}, "content_hash": "hash-a2", "jn_updated_at": "2026-09-10T00:00:00Z"}]'::jsonb,
    '2026-09-29T14:00:00Z'
  ),
  1,
  'a newer version is counted as changed'
);

select is(
  (select payload->>'status_name' from public.jobnimbus_records
   where company_id = '95000000-0000-4000-8000-000000000001' and jnid = 'job-a'),
  'Signed Contract',
  'the newer payload is stored'
);

-- An older read must not overwrite the newer stored version.
select is(
  public.land_jobnimbus_batch(
    '95000000-0000-4000-8000-000000000001',
    'job',
    '[{"jnid": "job-a", "payload": {"jnid": "job-a", "status_name": "Lead"}, "content_hash": "hash-a0", "jn_updated_at": "2026-08-01T00:00:00Z"}]'::jsonb,
    '2026-09-29T15:00:00Z'
  ),
  0,
  'a stale read is not counted as a change'
);

select is(
  (select content_hash from public.jobnimbus_records
   where company_id = '95000000-0000-4000-8000-000000000001' and jnid = 'job-a'),
  'hash-a2',
  'a stale read does not overwrite the newer stored version'
);

-- The watermark never moves backwards.
select public.land_jobnimbus_batch(
  '95000000-0000-4000-8000-000000000001', 'job', '[]'::jsonb, '2026-09-01T00:00:00Z'
);

select is(
  (select watermark from public.jobnimbus_sync_state
   where company_id = '95000000-0000-4000-8000-000000000001' and record_type = 'job'),
  '2026-09-29T15:00:00Z'::timestamptz,
  'an older watermark does not move the stored watermark back'
);

-- The same jnid in another company is an independent record.
select is(
  public.land_jobnimbus_batch(
    '95000000-0000-4000-8000-000000000002',
    'job',
    '[{"jnid": "job-a", "payload": {"jnid": "job-a"}, "content_hash": "control", "jn_updated_at": "2026-09-01T00:00:00Z"}]'::jsonb,
    '2026-09-29T12:00:00Z'
  ),
  1,
  'records are keyed per company'
);

select is(
  (select count(*) from public.jobnimbus_records
   where company_id = '95000000-0000-4000-8000-000000000001'),
  2::bigint,
  'another company''s landing does not touch this company''s rows'
);

select throws_ok(
  $$select public.land_jobnimbus_batch(
    '95000000-0000-4000-8000-000000000001', 'job', '{}'::jsonb, now())$$,
  '22023',
  'p_records must be a JSON array',
  'a non-array batch is rejected'
);

select throws_ok(
  $$insert into public.company_integrations(company_id, provider, env_key_name, history_start)
    values ('95000000-0000-4000-8000-000000000001', 'jobnimbus', 'SUPABASE_SERVICE_ROLE_KEY', now())$$,
  '23514',
  null,
  'an integration cannot point at a non-JobNimbus secret'
);

select lives_ok(
  $$insert into public.company_integrations(company_id, provider, env_key_name, history_start)
    values ('95000000-0000-4000-8000-000000000001', 'jobnimbus', 'JOBNIMBUS_API_KEY', '2020-01-01T00:00:00Z')$$,
  'an integration can reference the JobNimbus key'
);

select is(
  (select enabled from public.company_integrations
   where company_id = '95000000-0000-4000-8000-000000000001'),
  false,
  'integrations are disabled until explicitly enabled'
);

set local role authenticated;

select throws_ok(
  $$select count(*) from public.jobnimbus_records$$,
  '42501',
  null,
  'authenticated users cannot read raw JobNimbus records'
);

select throws_ok(
  $$select public.land_jobnimbus_batch(
    '95000000-0000-4000-8000-000000000001', 'job', '[]'::jsonb, now())$$,
  '42501',
  null,
  'authenticated users cannot land JobNimbus records'
);

reset role;

select * from finish();

rollback;

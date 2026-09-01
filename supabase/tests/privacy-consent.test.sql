begin;
select plan(12);

select has_table('public', 'privacy_consent_evidence', 'privacy consent evidence table exists');
select has_column('public', 'privacy_consent_evidence', 'consent_id', 'consent id exists');
select has_column('public', 'privacy_consent_evidence', 'analytics_granted', 'analytics grant exists');
select has_column('public', 'privacy_consent_evidence', 'advertising_granted', 'advertising grant exists');
select has_function('public', 'record_privacy_consent', array[
  'uuid','uuid','uuid','uuid','text','boolean','boolean','boolean','text','inet','text','timestamp with time zone'
], 'consent recording function exists');

select lives_ok($$
  select * from public.record_privacy_consent(
    'a1000000-0000-4000-8000-000000000001', null, null, null,
    'piw-privacy-v1', false, false, false, 'banner',
    '127.0.0.1', 'pgTAP', '2026-08-28T12:00:00Z'
  )
$$, 'records an anonymous rejection');

select is(
  (select count(*) from public.privacy_consent_evidence
   where consent_id='a1000000-0000-4000-8000-000000000001'),
  1::bigint,
  'one evidence row is stored'
);

select lives_ok($$
  select * from public.record_privacy_consent(
    'a1000000-0000-4000-8000-000000000001', null, null, null,
    'piw-privacy-v1', false, false, false, 'banner',
    '127.0.0.1', 'pgTAP', '2026-08-28T12:00:00Z'
  )
$$, 'a delivery retry is idempotent');

select is(
  (select count(*) from public.privacy_consent_evidence
   where consent_id='a1000000-0000-4000-8000-000000000001'),
  1::bigint,
  'retry does not duplicate evidence'
);

select throws_ok($$
  insert into public.privacy_consent_evidence(
    evidence_id, consent_id, policy_version, necessary_granted,
    analytics_granted, advertising_granted, gpc_detected, source,
    occurred_at
  ) values (
    gen_random_uuid(), gen_random_uuid(), 'piw-privacy-v1', false,
    false, false, false, 'banner', now()
  )
$$, '23514', null, 'necessary consent cannot be false');

select throws_ok($$
  set local role anon;
  select * from public.privacy_consent_evidence
$$, '42501', null, 'anonymous clients cannot read evidence');

select throws_ok($$
  set local role authenticated;
  select * from public.privacy_consent_evidence
$$, '42501', null, 'authenticated clients cannot read evidence directly');

select * from finish();
rollback;

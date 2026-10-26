begin;
select plan(6);

select lives_ok($$
  select * from public.record_public_privacy_consent(
    '9d000000-0000-4000-8000-000000000001',
    '9d000000-0000-4000-8000-0000000000aa',
    'piw-privacy-v1', false, true, false, 'default_notice',
    '198.51.100.20', 'pgTAP', now() - interval '10 minutes'
  )
$$, 'records an opt-out notice default');

select is(
  (select source from public.privacy_consent_evidence
   where evidence_id = '9d000000-0000-4000-8000-000000000001'),
  'default_notice',
  'the notice default keeps its own source rather than claiming a banner click'
);

select throws_ok($$
  select * from public.record_public_privacy_consent(
    '9d000000-0000-4000-8000-000000000002',
    '9d000000-0000-4000-8000-0000000000bb',
    'piw-privacy-v1', false, true, true, 'default_notice',
    '198.51.100.20', 'pgTAP', now() - interval '10 minutes'
  )
$$, '22023', 'Global Privacy Control cannot grant advertising',
  'a notice default cannot grant advertising under GPC');

select throws_ok($$
  select * from public.record_public_privacy_consent(
    '9d000000-0000-4000-8000-000000000003',
    '9d000000-0000-4000-8000-0000000000cc',
    'piw-privacy-v1', false, true, false, 'implied',
    '198.51.100.20', 'pgTAP', now() - interval '10 minutes'
  )
$$, '22023', 'Invalid public privacy consent evidence',
  'sources outside the allowed list are still refused');

select lives_ok($$
  select * from public.record_public_privacy_consent(
    '9d000000-0000-4000-8000-000000000004',
    '9d000000-0000-4000-8000-0000000000aa',
    'piw-privacy-v1', false, false, false, 'preferences',
    '198.51.100.20', 'pgTAP', now() - interval '5 minutes'
  )
$$, 'a later rejection is recorded over the notice default');

select is(
  (select advertising_granted from public.privacy_consent_evidence
   where consent_id = '9d000000-0000-4000-8000-0000000000aa'
     and company_id is null and lead_id is null
   order by occurred_at desc, advertising_granted asc, gpc_detected desc,
            created_at desc, evidence_id desc
   limit 1),
  false,
  'the rejection is the canonical state for that visitor'
);

select * from finish();
rollback;

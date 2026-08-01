begin;
select plan(8);

select has_table(
  'public',
  'context_dialer_deliveries',
  'context dialer deliveries exist'
);
select col_is_pk(
  'public',
  'context_dialer_deliveries',
  'id',
  'context dialer deliveries have a primary key'
);
select has_column(
  'public',
  'context_dialer_deliveries',
  'pipeline_run_id',
  'delivery tracks its pipeline run'
);
select has_column(
  'public',
  'context_dialer_deliveries',
  'attempt_count',
  'delivery tracks attempts'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.context_dialer_deliveries'::regclass),
  true,
  'context dialer deliveries use RLS'
);
select is(
  has_table_privilege('anon', 'public.context_dialer_deliveries', 'select'),
  false,
  'anonymous visitors cannot read dialer deliveries'
);
select is(
  has_table_privilege('authenticated', 'public.context_dialer_deliveries', 'select'),
  true,
  'authenticated admins can query dialer delivery status through RLS'
);
select results_eq(
  $$
    select count(*)::bigint
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'context_dialer_deliveries'
      and indexdef ilike '%where (status = ''queued''::text)%'
  $$,
  array[1::bigint],
  'queued delivery polling uses a partial index'
);

select * from finish();
rollback;

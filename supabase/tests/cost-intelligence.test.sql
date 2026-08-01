begin;
select plan(17);

select has_table('public', 'cost_resource_inventory', 'cost resource inventory exists');
select has_table('public', 'cost_rate_cards', 'versioned rate cards exist');
select has_table('public', 'cost_budget_targets', 'monthly budget targets exist');
select has_table('public', 'cost_collection_runs', 'collection audit log exists');
select has_table('public', 'cost_line_items', 'cost line item ledger exists');

select is((select relrowsecurity from pg_class where oid = 'public.cost_resource_inventory'::regclass), true, 'inventory has RLS');
select is((select relrowsecurity from pg_class where oid = 'public.cost_rate_cards'::regclass), true, 'rate cards have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.cost_budget_targets'::regclass), true, 'budgets have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.cost_collection_runs'::regclass), true, 'runs have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.cost_line_items'::regclass), true, 'line items have RLS');

select is(has_table_privilege('anon', 'public.cost_line_items', 'select'), false, 'anon cannot read billing data');
select is(has_table_privilege('authenticated', 'public.cost_line_items', 'select'), false, 'authenticated users cannot read billing data');
select is(has_table_privilege('service_role', 'public.cost_line_items', 'insert'), true, 'service role writes billing data');
select is((select count(*)::integer from pg_policies where schemaname = 'public' and tablename like 'cost_%' and roles = array['service_role'::name]), 5, 'all cost tables document service-role-only policies');

insert into public.cost_budget_targets(period_start) values ('2026-08-01');
select is((select budget_micros from public.cost_budget_targets where period_start = '2026-08-01'), 1500000000::bigint, 'default monthly target is $1,500');

select throws_ok(
  $$insert into public.cost_budget_targets(period_start) values ('2026-08-02')$$,
  '23514', null, 'budget periods must begin on the first day'
);

insert into public.cost_collection_runs(slot_key, scheduled_for, period_start)
values ('2026-08-01T09:00:00-04:00', '2026-08-01T09:00:00-04:00', '2026-08-01');
select throws_ok(
  $$insert into public.cost_collection_runs(slot_key, scheduled_for, period_start) values ('2026-08-01T09:00:00-04:00', now(), '2026-08-01')$$,
  '23505', null, 'a schedule slot is idempotent'
);

select * from finish();
rollback;

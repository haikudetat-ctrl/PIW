begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

select has_table('public', 'lead_stage_history', 'lead_stage_history exists');
select has_table('public', 'tasks', 'tasks exists');
select has_table('public', 'interactions', 'interactions exists');
select has_table('public', 'notifications', 'notifications exists');

select col_type_is('public', 'leads', 'stage', 'public.lead_stage', 'leads.stage is a governed enum');

select policies_are(
  'public', 'lead_stage_history',
  array['company admins read lead stage history'],
  'lead_stage_history has a single read policy'
);
select policies_are(
  'public', 'tasks',
  array['company admins read tasks', 'company admins create tasks', 'company admins update tasks'],
  'tasks has explicit read/create/update policies'
);
select policies_are(
  'public', 'interactions',
  array['company admins read interactions', 'company admins create interactions'],
  'interactions has explicit read/create policies'
);
select policies_are(
  'public', 'notifications',
  array['company admins read notifications', 'company admins mark notifications read'],
  'notifications has explicit read/update policies'
);

select is(
  has_table_privilege('anon', 'public.tasks', 'select'),
  false,
  'anonymous users cannot select tasks'
);
select is(
  has_table_privilege('authenticated', 'public.lead_stage_history', 'insert'),
  false,
  'authenticated admins cannot directly insert lead stage history'
);
select is(
  has_table_privilege('authenticated', 'public.notifications', 'insert'),
  false,
  'authenticated admins cannot directly insert notifications'
);
select is(
  has_table_privilege('service_role', 'public.notifications', 'insert'),
  true,
  'service role can insert notifications'
);

select * from finish();

rollback;

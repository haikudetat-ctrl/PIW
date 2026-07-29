begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

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

insert into public.companies (id, name)
values ('00000000-0000-4000-8000-000000000001', 'PIW Local Roofing')
on conflict (id) do nothing;

select is(
  (select count(*) from public.submit_lead_intake(
    '00000000-0000-4000-8000-000000000001',
    'Jordan Rivera', '555-010-1000', 'jordan@example.com',
    '12 Birch St, Trenton, NJ', null,
    '55555555-5555-4555-8555-555555555555', 1
  )),
  1::bigint,
  'submit_lead_intake returns one row'
);
select is(
  (select resolution_status from public.properties
   where id = (select property_id from public.leads
               where submitted_address = '12 Birch St, Trenton, NJ')),
  'unresolved',
  'lead intake creates an unresolved property'
);
select is(
  (select count(*) from public.pipeline_runs
   where correlation_id = '55555555-5555-4555-8555-555555555555'),
  1::bigint,
  'lead intake creates one pipeline run'
);
select function_privs_are(
  'public', 'submit_lead_intake',
  array['uuid','text','text','text','text','text','uuid','integer'],
  'authenticated', array[]::text[],
  'authenticated role cannot call submit_lead_intake directly'
);

select is(
  (select from_stage from public.change_lead_stage(
    '00000000-0000-4000-8000-000000000001',
    (select lead_id from public.submit_lead_intake(
      '00000000-0000-4000-8000-000000000001',
      'Casey Nguyen', '555-010-2000', 'casey@example.com',
      '9 Maple Ave, Newark, NJ', null,
      '77777777-7777-4777-8777-777777777777', 1
    )),
    'contacting', null, null
  )),
  'new'::public.lead_stage,
  'change_lead_stage returns the prior stage'
);
select is(
  (select stage from public.leads
   where submitted_address = '9 Maple Ave, Newark, NJ'),
  'contacting',
  'change_lead_stage updates the lead stage'
);
select is(
  (select count(*) from public.lead_stage_history
   where lead_id = (select id from public.leads
                     where submitted_address = '9 Maple Ave, Newark, NJ')
     and from_stage = 'new' and to_stage = 'contacting'),
  1::bigint,
  'change_lead_stage appends stage history'
);

select * from finish();

rollback;

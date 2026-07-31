begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

select has_table('public', 'reps', 'reps exists');
select has_table('public', 'appointments', 'appointments exists');
select has_table('public', 'appointment_rep_intros', 'appointment_rep_intros exists');

select col_type_is(
  'public', 'appointments', 'status', 'public.appointment_status',
  'appointments.status uses the governed enum'
);
select col_type_is(
  'public', 'appointment_rep_intros', 'status',
  'public.appointment_rep_intro_status',
  'appointment_rep_intros.status uses the governed enum'
);

select policies_are(
  'public', 'reps',
  array['company admins read reps', 'company admins create reps', 'company admins update reps'],
  'reps has explicit read/create/update policies'
);
select policies_are(
  'public', 'appointments',
  array[
    'company admins read appointments',
    'company admins create appointments',
    'company admins update appointments'
  ],
  'appointments has explicit read/create/update policies'
);
select policies_are(
  'public', 'appointment_rep_intros',
  array['company admins read appointment rep intros'],
  'appointment_rep_intros has one read policy'
);

select is(
  has_table_privilege('anon', 'public.reps', 'select'),
  false,
  'anonymous users cannot select reps'
);
select is(
  has_table_privilege('authenticated', 'public.reps', 'insert'),
  true,
  'authenticated admins can create reps'
);
select is(
  has_table_privilege('authenticated', 'public.appointments', 'insert'),
  false,
  'appointments has no table-wide authenticated insert privilege'
);
select is(
  has_column_privilege(
    'authenticated', 'public.appointments', 'scheduled_at', 'insert'
  ),
  true,
  'authenticated admins can insert scheduled_at'
);
select is(
  has_column_privilege('authenticated', 'public.appointments', 'rep_id', 'insert'),
  false,
  'authenticated admins cannot insert rep_id'
);
select is(
  has_column_privilege('authenticated', 'public.appointments', 'notes', 'update'),
  true,
  'authenticated admins can update appointment notes'
);
select is(
  has_column_privilege('authenticated', 'public.appointments', 'rep_id', 'update'),
  false,
  'authenticated admins cannot update rep_id'
);
select is(
  has_table_privilege('authenticated', 'public.appointment_rep_intros', 'select'),
  true,
  'authenticated admins can read queued rep intros'
);
select is(
  has_table_privilege('authenticated', 'public.appointment_rep_intros', 'insert'),
  false,
  'authenticated admins cannot compose rep intros'
);
select is(
  has_table_privilege('service_role', 'public.appointment_rep_intros', 'insert'),
  true,
  'service role can compose rep intros'
);

insert into public.companies (id, name)
values ('00000000-0000-4000-8000-000000000001', 'PIW Local Roofing')
on conflict (id) do nothing;

select is(
  (select count(*) from public.submit_lead_intake(
    '00000000-0000-4000-8000-000000000001',
    'Jordan Rivera', '555-010-4000', 'jordan-appointments@example.com',
    '18 Cedar Rd, Princeton, NJ', null,
    '11111111-1111-4111-8111-111111111111', 1
  )),
  1::bigint,
  'submit_lead_intake returns one row'
);

insert into public.reps (
  id, company_id, name, bio, credentials, community_connection
) values (
  '22222222-2222-4222-8222-222222222222',
  '00000000-0000-4000-8000-000000000001',
  'Alex Morgan',
  'Alex has helped New Jersey homeowners for 12 years.',
  'HAAG Certified',
  'Lives and volunteers in Mercer County'
);

select is(
  (select is_active from public.reps
   where id = '22222222-2222-4222-8222-222222222222'),
  true,
  'reps default to active'
);

insert into public.appointments (
  id, company_id, lead_id, scheduled_at, duration_minutes
) select
  '33333333-3333-4333-8333-333333333333',
  '00000000-0000-4000-8000-000000000001',
  leads.id,
  '2026-08-02T16:00:00.000Z',
  60
from public.leads as leads
where leads.submitted_address = '18 Cedar Rd, Princeton, NJ';

select is(
  (select status from public.appointments
   where id = '33333333-3333-4333-8333-333333333333'),
  'scheduled'::public.appointment_status,
  'appointments default to scheduled'
);

update public.appointments
set rep_id = '22222222-2222-4222-8222-222222222222'
where id = '33333333-3333-4333-8333-333333333333';

select is(
  (select rep_id from public.appointments
   where id = '33333333-3333-4333-8333-333333333333'),
  '22222222-2222-4222-8222-222222222222'::uuid,
  'a service-scoped write can assign the rep'
);

insert into public.appointment_rep_intros (
  company_id, appointment_id, rep_id, composed_subject, composed_body, scheduled_for
) values (
  '00000000-0000-4000-8000-000000000001',
  '33333333-3333-4333-8333-333333333333',
  '22222222-2222-4222-8222-222222222222',
  'Meet Alex Morgan, your All Season representative',
  'Hi Jordan, meet Alex Morgan.',
  '2026-08-01T16:00:00.000Z'
);

select is(
  (select status from public.appointment_rep_intros
   where appointment_id = '33333333-3333-4333-8333-333333333333'),
  'queued'::public.appointment_rep_intro_status,
  'rep intros default to queued'
);

select throws_ok(
  $$ insert into public.appointment_rep_intros (
       company_id, appointment_id, rep_id, composed_subject, composed_body, scheduled_for
     ) values (
       '00000000-0000-4000-8000-000000000001',
       '33333333-3333-4333-8333-333333333333',
       '22222222-2222-4222-8222-222222222222',
       'Duplicate', 'Duplicate', now()
     ) $$,
  '23505',
  null,
  'only one queued rep intro exists per appointment'
);

select throws_ok(
  $$ insert into public.reps (company_id, name)
     values ('00000000-0000-4000-8000-000000000001', '') $$,
  '23514',
  null,
  'reps reject a blank name'
);

select throws_ok(
  $$ insert into public.appointments (
       company_id, lead_id, scheduled_at, duration_minutes
     ) select
       '00000000-0000-4000-8000-000000000001', leads.id, now(), -1
     from public.leads as leads
     where leads.submitted_address = '18 Cedar Rd, Princeton, NJ' $$,
  '23514',
  null,
  'appointments reject a negative duration'
);

delete from public.pipeline_runs
where lead_id = (
  select id from public.leads
  where submitted_address = '18 Cedar Rd, Princeton, NJ'
);

delete from public.leads
where submitted_address = '18 Cedar Rd, Princeton, NJ';

select is(
  (select count(*) from public.appointments
   where id = '33333333-3333-4333-8333-333333333333'),
  0::bigint,
  'deleting a lead cascades to its appointments'
);
select is(
  (select count(*) from public.appointment_rep_intros
   where appointment_id = '33333333-3333-4333-8333-333333333333'),
  0::bigint,
  'deleting a lead cascades through appointments to rep intros'
);

select * from finish();

rollback;

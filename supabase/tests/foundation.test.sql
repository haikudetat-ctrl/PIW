begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select has_extension('postgis', 'PostGIS is enabled');
select has_table('public', 'properties', 'properties exists');
select has_table('public', 'observations', 'observations exists');
select has_table('public', 'event_outbox', 'event_outbox exists');
select has_table('public', 'audit_log', 'audit_log exists');
select policies_are(
  'public',
  'properties',
  array['company admins read properties'],
  'properties has explicit read policy'
);
select policies_are(
  'public',
  'leads',
  array['company admins read leads', 'company admins write leads'],
  'leads has explicit admin policies'
);
select is(
  has_table_privilege('anon', 'public.leads', 'select'),
  false,
  'anonymous users cannot select leads'
);

select * from finish();

rollback;

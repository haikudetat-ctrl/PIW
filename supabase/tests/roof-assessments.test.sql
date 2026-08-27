begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select has_table('public', 'roof_assessments', 'roof assessments table exists');
select has_column('public', 'roof_assessments', 'estimate_id', 'assessment belongs to an estimate');
select has_column('public', 'roof_assessments', 'responses', 'validated answers are persisted');
select has_column('public', 'roof_assessments', 'scores', 'derived scores are persisted');
select has_column('public', 'roof_assessments', 'property_revealed_at', 'property reveal is resumable');
select col_is_unique('public', 'roof_assessments', 'estimate_id', 'one assessment exists per estimate');
select policies_are(
  'public',
  'roof_assessments',
  array['company admins read roof assessments'],
  'only the tenant-scoped admin read policy exists'
);
select table_privs_are(
  'public', 'roof_assessments', 'anon', array[]::text[],
  'anonymous clients have no direct table privileges'
);
select table_privs_are(
  'public', 'roof_assessments', 'authenticated', array['SELECT'],
  'authenticated admins may only select assessments'
);
select table_privs_are(
  'public', 'roof_assessments', 'service_role',
  array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'],
  'service role owns assessment persistence'
);

select col_has_check('public', 'roof_assessments', 'status', 'assessment status is constrained');
select col_has_check('public', 'roof_assessments', 'recommendation', 'recommendation is constrained');

select * from finish();
rollback;

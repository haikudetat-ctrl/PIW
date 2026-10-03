begin;

select plan(5);

select has_table('public', 'property_preview_email_suppressions', 'preview email suppressions exist');
select table_privs_are(
  'public', 'property_preview_email_suppressions', 'anon', array[]::text[],
  'anonymous clients cannot read suppressions'
);
select table_privs_are(
  'public', 'property_preview_email_suppressions', 'authenticated', array[]::text[],
  'authenticated clients cannot read suppressions'
);

insert into public.companies (id, name)
values ('fe000000-0000-4000-8000-000000000001', 'Suppression Company');

select lives_ok(
  $$insert into public.property_preview_email_suppressions (company_id, email_normalized)
    values ('fe000000-0000-4000-8000-000000000001', 'alex@example.com')$$,
  'a normalized address can be suppressed'
);
select throws_ok(
  $$insert into public.property_preview_email_suppressions (company_id, email_normalized)
    values ('fe000000-0000-4000-8000-000000000001', 'Alex@Example.com')$$,
  '23514', null,
  'suppressions only store normalized addresses'
);

select * from finish();
rollback;

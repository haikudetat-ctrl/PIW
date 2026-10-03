begin;

select plan(9);

select has_table('public', 'company_public_hosts', 'tenant public hosts table exists');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.company_public_hosts'::regclass),
  'tenant public hosts have RLS enabled'
);
select table_privs_are(
  'public', 'company_public_hosts', 'anon', array[]::text[],
  'anonymous clients cannot read tenant hosts'
);
select table_privs_are(
  'public', 'company_public_hosts', 'authenticated', array[]::text[],
  'authenticated clients cannot read tenant hosts'
);

insert into public.companies (id, name)
values ('fb000000-0000-4000-8000-000000000001', 'Public Host Company');

select lives_ok(
  $$insert into public.company_public_hosts (host, company_id, brand)
    values ('estimate.allseasonroofingquote.com', 'fb000000-0000-4000-8000-000000000001',
            '{"displayName":"All Season Solar","privacyUrl":"https://allseasonroofingquote.com/privacy.html"}')$$,
  'a lowercase host with an object brand is accepted'
);
select throws_ok(
  $$insert into public.company_public_hosts (host, company_id)
    values ('Estimate.Example.com', 'fb000000-0000-4000-8000-000000000001')$$,
  '23514', null,
  'mixed-case hosts are rejected'
);
select throws_ok(
  $$insert into public.company_public_hosts (host, company_id)
    values ('estimate.example.com/path', 'fb000000-0000-4000-8000-000000000001')$$,
  '23514', null,
  'hosts with paths are rejected'
);
select throws_ok(
  $$insert into public.company_public_hosts (host, company_id, brand)
    values ('quote.example.com', 'fb000000-0000-4000-8000-000000000001', '[]')$$,
  '23514', null,
  'brand must be a JSON object'
);
select throws_ok(
  $$insert into public.company_public_hosts (host, company_id)
    values ('estimate.allseasonroofingquote.com', 'fb000000-0000-4000-8000-000000000001')$$,
  '23505', null,
  'a host belongs to exactly one company'
);

select * from finish();
rollback;

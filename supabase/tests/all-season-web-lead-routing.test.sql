begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

insert into public.companies (id, name)
values ('a2000000-0000-4000-8000-000000000001', 'All Season web routing test');

create temp table routed_web_leads as
select samples.interest, accepted.lead_id
from (values
  ('solar', 'a2000000-0000-4000-8000-000000000002'::uuid),
  ('both', 'a2000000-0000-4000-8000-000000000003'::uuid),
  ('roofing', 'a2000000-0000-4000-8000-000000000004'::uuid)
) as samples(interest, submission_id)
cross join lateral public.submit_all_season_web_lead(
  'a2000000-0000-4000-8000-000000000001', samples.submission_id,
  'Test Lead', '(201) 555-0100', 'qa@example.com', '1 Main St, Newark, NJ 07102',
  samples.interest, now(), '{}'::jsonb, 'all-season-quote-v1', '127.0.0.1',
  'pgtap', 2, '+12015550100', 'qa@example.com', ''
) as accepted;

select results_eq(
  $$select lead.interest, delivery.destination, delivery.source_label
    from routed_web_leads lead join public.lead_distribution_deliveries delivery
      on delivery.lead_id = lead.lead_id order by lead.interest$$,
  $$values ('both', 'activeprospect_web', 'Web Solar'),
           ('roofing', 'activeprospect_web', 'Web Roofing'),
           ('solar', 'activeprospect_web', 'Web Solar')$$,
  'each web lead has exactly one destination and the expected source label'
);

select is(
  (select is_duplicate from public.submit_all_season_web_lead(
    'a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002',
    'Test Lead', '(201) 555-0100', 'qa@example.com', '1 Main St, Newark, NJ 07102',
    'roofing', now(), '{}'::jsonb, 'all-season-quote-v1', '127.0.0.1',
    'pgtap', 2, '+12015550100', 'qa@example.com', ''
  )),
  true, 'retry reuses the original intake even if interest changes'
);

select results_eq(
  $$select source_label from public.lead_distribution_deliveries
    where lead_id = (select lead_id from routed_web_leads where interest = 'solar')$$,
  $$values ('Web Solar')$$,
  'retry does not duplicate or reroute the original delivery'
);

create temp table legacy_web_lead as
select * from public.submit_all_season_lead(
  'a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000005',
  'Legacy Lead', '(201) 555-0101', 'legacy@example.com', '2 Main St, Newark, NJ 07102',
  'roofing', now(), '{}'::jsonb, 'all-season-quote-v1', '127.0.0.1',
  'pgtap', 2, '+12015550101', 'legacy@example.com', ''
);

select is(
  (select count(*) from public.lead_distribution_deliveries
    where lead_id = (select lead_id from legacy_web_lead)),
  0::bigint, 'legacy intake remains outside the new web distribution route'
);

select function_privs_are(
  'public', 'submit_all_season_web_lead',
  array['uuid','uuid','text','text','text','text','text','timestamp with time zone','jsonb','text','text','text','integer','text','text','text'],
  'anon', array[]::text[], 'anonymous clients cannot call the web routing RPC'
);

select * from finish();
rollback;

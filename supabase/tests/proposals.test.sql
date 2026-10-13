begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select has_table('public', 'proposals', 'proposals exist');
select has_table('public', 'proposal_options', 'proposal options exist');
select has_table('public', 'proposal_add_ons', 'proposal add-ons exist');
select is(
  (select bool_and(relrowsecurity) from pg_class where oid in (
    'public.proposals'::regclass, 'public.proposal_options'::regclass, 'public.proposal_add_ons'::regclass
  )),
  true, 'every proposal table uses RLS'
);
select is(has_table_privilege('anon', 'public.proposals', 'select'), false, 'anon cannot read proposals');

insert into public.companies(id, name) values
  ('93000000-0000-4000-8000-000000000001', 'Proposal Company'),
  ('93000000-0000-4000-8000-000000000002', 'Other Company');
insert into auth.users(id, email) values
  ('93000000-0000-4000-8000-000000000101', 'proposal-admin@example.com'),
  ('93000000-0000-4000-8000-000000000102', 'other-admin@example.com');
insert into public.admin_profiles(id, company_id, display_name) values
  ('93000000-0000-4000-8000-000000000101', '93000000-0000-4000-8000-000000000001', 'Proposal Admin'),
  ('93000000-0000-4000-8000-000000000102', '93000000-0000-4000-8000-000000000002', 'Other Admin');
insert into public.properties(id, company_id, canonical_address, resolution_status) values
  ('93000000-0000-4000-8000-000000000011', '93000000-0000-4000-8000-000000000001', '14 Linden Ave, Haddonfield, NJ 08033', 'resolved');
insert into public.leads(id, company_id, property_id, name, phone, email, submitted_address) values
  ('93000000-0000-4000-8000-000000000021', '93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000011',
   'Proposal Lead', '+16095550131', 'proposal@example.com', '14 Linden Ave, Haddonfield, NJ 08033');
insert into public.roof_pricing_rate_cards(id, company_id, version, name, market, effective_from) values
  ('93000000-0000-4000-8000-000000000051', '93000000-0000-4000-8000-000000000001', 'proposal-v1', 'Proposal', 'NJ', '2026-01-01');

select set_config('request.jwt.claims', '{"sub":"93000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
set local role authenticated;

insert into public.proposals(
  id, company_id, lead_id, version, roof_squares, measurement_source, measurement_ref,
  rate_card_id, pricing_version, valid_until
) values (
  '93000000-0000-4000-8000-000000000061', '93000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000021', 1, 29.6, 'roofr', 'roofr-file-1',
  '93000000-0000-4000-8000-000000000051', 'proposal-v1', '2026-11-12'
);
insert into public.proposal_options(
  company_id, proposal_id, tier_key, display_order, customer_name, customer_description,
  warranty_summary, price_per_square_cents
) values
  ('93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000061', 'good', 1, 'Patriot', 'Entry.', 'SureStart', 88800),
  ('93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000061', 'better', 2, 'Landmark', 'Popular.', 'SureStart PLUS', 107500),
  ('93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000061', 'best', 3, 'Landmark PRO', 'Premium.', 'SureStart PLUS', 145000);
insert into public.proposal_add_ons(
  id, company_id, proposal_id, adjustment_code, label, calculation_kind, unit_value, display_order
) values (
  '93000000-0000-4000-8000-000000000071', '93000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000061', 'chimney_flashing', 'Chimney flashing', 'flat', 650, 1
);

select lives_ok(
  $$update public.proposals set roof_squares = 30.2, measurement_source = 'manual', measurement_ref = null
    where id = '93000000-0000-4000-8000-000000000061'$$,
  'a draft can be re-measured'
);
select lives_ok(
  $$update public.proposal_add_ons set included = true where id = '93000000-0000-4000-8000-000000000071'$$,
  'a draft add-on can be included'
);
select throws_ok(
  $$update public.proposals set status = 'sent' where id = '93000000-0000-4000-8000-000000000061'$$,
  '23514', null,
  'a sent proposal must record when it was sent'
);
select lives_ok(
  $$update public.proposals set status = 'sent', sent_at = now() where id = '93000000-0000-4000-8000-000000000061'$$,
  'a draft can be sent'
);
select throws_ok(
  $$update public.proposals set roof_squares = 40 where id = '93000000-0000-4000-8000-000000000061'$$,
  '55000', 'Sent proposals cannot be repriced; create a new version',
  'a sent proposal cannot be re-measured'
);
select throws_ok(
  $$update public.proposal_options set price_per_square_cents = 1 where proposal_id = '93000000-0000-4000-8000-000000000061'$$,
  '55000', 'Sent proposals cannot be repriced; create a new version',
  'a sent proposal cannot be repriced'
);
select throws_ok(
  $$delete from public.proposal_add_ons where id = '93000000-0000-4000-8000-000000000071'$$,
  '55000', 'Sent proposals cannot be repriced; create a new version',
  'a sent proposal keeps its add-ons'
);
select throws_ok(
  $$update public.proposals set status = 'draft', sent_at = null where id = '93000000-0000-4000-8000-000000000061'$$,
  '55000', null,
  'a sent proposal cannot return to draft'
);
select lives_ok(
  $$update public.proposals set status = 'accepted' where id = '93000000-0000-4000-8000-000000000061'$$,
  'a sent proposal can be accepted'
);
delete from public.proposals where id = '93000000-0000-4000-8000-000000000061';
select is(
  (select count(*) from public.proposals where id = '93000000-0000-4000-8000-000000000061'),
  1::bigint, 'a sent proposal cannot be deleted'
);

insert into public.proposals(
  id, company_id, lead_id, version, roof_squares, measurement_source, rate_card_id, pricing_version, valid_until
) values (
  '93000000-0000-4000-8000-000000000062', '93000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000021', 2, 30.2, 'manual',
  '93000000-0000-4000-8000-000000000051', 'proposal-v1', '2026-11-12'
);
insert into public.proposal_options(
  company_id, proposal_id, tier_key, display_order, customer_name, customer_description,
  warranty_summary, price_per_square_cents
) values ('93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000062', 'good', 1, 'Patriot', 'Entry.', 'SureStart', 88800);
delete from public.proposals where id = '93000000-0000-4000-8000-000000000062';
select is(
  (select count(*) from public.proposal_options where proposal_id = '93000000-0000-4000-8000-000000000062'),
  0::bigint, 'deleting a draft removes its options'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"93000000-0000-4000-8000-000000000102","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*) from public.proposals), 0::bigint, 'another company cannot see the proposal');
select throws_ok(
  $$insert into public.proposals(company_id, lead_id, version, roof_squares, measurement_source, rate_card_id, pricing_version, valid_until)
    values ('93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000021', 2, 20, 'manual',
            '93000000-0000-4000-8000-000000000051', 'proposal-v1', '2026-11-12')$$,
  '42501', null,
  'another company cannot create a proposal on the lead'
);

reset role;

select * from finish();
rollback;

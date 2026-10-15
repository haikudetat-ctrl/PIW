begin;

select plan(19);

insert into public.companies(id, name) values
  ('97000000-0000-4000-8000-000000000001', 'Booking Company'),
  ('97000000-0000-4000-8000-000000000002', 'Booking Control');

-- -----------------------------------------------------------------------------
-- Access
-- -----------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.intake_leadconduit_lead(uuid, text, text, text, uuid, text, text, text, text, text, text, text, text, boolean, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.intake_leadconduit_lead(uuid, text, text, text, uuid, text, text, text, text, text, text, text, text, boolean, uuid)', 'execute'),
  'only the service role takes in LeadConduit leads'
);
select ok(
  not has_function_privilege('authenticated', 'public.queue_jobnimbus_rebook_tasks(uuid, interval)', 'execute'),
  'only the service role queues rebook tasks'
);

-- -----------------------------------------------------------------------------
-- LeadConduit intake
-- -----------------------------------------------------------------------------

select is(
  (select outcome from public.intake_leadconduit_lead(
    '97000000-0000-4000-8000-000000000001', 'flow-roofing', 'Roofing', 'lc-ana', null,
    'Ana Vendor', '(609) 555-0111', '+16095550111', 'Ana@Example.invalid', 'ana@example.invalid',
    '11 Vendor Way', 'Angi', 'https://cert.example.invalid/ana', false,
    '97000000-0000-4000-8000-00000000c001')),
  'created',
  'a new delivered lead is created'
);

select results_eq(
  $$select source_system, external_lead_id, source_account_id, original_lead_source, campaign, phone_e164, stage::text
    from public.leads where company_id = '97000000-0000-4000-8000-000000000001' and external_lead_id = 'lc-ana'$$,
  $$values ('leadconduit', 'lc-ana', 'flow-roofing', 'Angi', 'Roofing', '+16095550111', 'new')$$,
  'the lead keeps its LeadConduit source'
);

select results_eq(
  $$select task.title, task.source_key, task.status::text
    from public.tasks as task join public.leads as lead on lead.id = task.lead_id
    where lead.external_lead_id = 'lc-ana'$$,
  $$values ('Call new lead now', 'call:leadconduit:lc-ana', 'open')$$,
  'the new lead gets a call task'
);

select is(
  (select count(*)::integer from public.notifications as notification join public.leads as lead on lead.id = notification.lead_id
   where lead.external_lead_id = 'lc-ana' and notification.type = 'lead_submitted'),
  1,
  'the new lead raises a notification'
);

select is(
  (select count(*)::integer from public.lead_stage_history as history join public.leads as lead on lead.id = history.lead_id
   where lead.external_lead_id = 'lc-ana' and history.from_stage is null and history.to_stage = 'new'),
  1,
  'the new lead has its initial stage row'
);

select is(
  (select outcome from public.intake_leadconduit_lead(
    '97000000-0000-4000-8000-000000000001', 'flow-roofing', 'Roofing', 'lc-ana', null,
    'Ana Vendor', '(609) 555-0111', '+16095550111', 'ana@example.invalid', 'ana@example.invalid',
    '11 Vendor Way', 'Angi', null, false, '97000000-0000-4000-8000-00000000c002')),
  'existing_leadconduit_lead',
  'a replayed delivery finds the same lead'
);

select is(
  (select outcome from public.intake_leadconduit_lead(
    '97000000-0000-4000-8000-000000000001', 'flow-virtual', 'Roofing Virtual Quote', 'lc-ana-virtual', null,
    'Ana Vendor', '609.555.0111', '+16095550111', 'other@example.invalid', 'other@example.invalid',
    '11 Vendor Way', 'Angi', null, false, '97000000-0000-4000-8000-00000000c003')),
  'matched_contact',
  'the same phone through the other flow matches the existing lead'
);

-- A lead that started in Rake (no phone_e164 stored) comes back through the flow.
insert into public.properties(id, company_id) values
  ('97000000-0000-4000-8000-000000000101', '97000000-0000-4000-8000-000000000001');
insert into public.leads(id, company_id, property_id, name, phone, email, submitted_address, source_system)
values ('97000000-0000-4000-8000-000000000201', '97000000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000101', 'Rake Lead', '732-555-0122', 'rake@example.invalid', '22 Rake Way', 'manual');

select is(
  (select outcome from public.intake_leadconduit_lead(
    '97000000-0000-4000-8000-000000000001', 'flow-roofing', 'Roofing', 'lc-rake', '97000000-0000-4000-8000-000000000201',
    'Rake Lead', '7325550122', '+17325550122', 'rake@example.invalid', 'rake@example.invalid',
    '22 Rake Way', 'PIW', null, false, '97000000-0000-4000-8000-00000000c004')),
  'existing_piw_lead',
  'an echoed Rake lead ID links back to that lead'
);

select is(
  (select outcome from public.intake_leadconduit_lead(
    '97000000-0000-4000-8000-000000000001', 'flow-roofing', 'Roofing', 'lc-rake-2', null,
    'Rake Lead', '+1 732 555 0122', '+17325550122', 'nobody@example.invalid', 'nobody@example.invalid',
    '22 Rake Way', 'PIW', null, false, '97000000-0000-4000-8000-00000000c005')),
  'matched_contact',
  'a Rake lead without the echoed ID still matches on its phone digits'
);

select is(
  (select outcome from public.intake_leadconduit_lead(
    '97000000-0000-4000-8000-000000000002', 'flow-roofing', 'Roofing', 'lc-ana', '97000000-0000-4000-8000-000000000201',
    'Ana Vendor', '(609) 555-0111', '+16095550111', 'ana@example.invalid', 'ana@example.invalid',
    '11 Vendor Way', 'Angi', null, false, '97000000-0000-4000-8000-00000000c006')),
  'created',
  'another company neither sees nor links to the first company''s leads'
);

select is(
  (select count(*)::integer from public.leads where company_id = '97000000-0000-4000-8000-000000000001'),
  2,
  'matches create no extra leads'
);

-- -----------------------------------------------------------------------------
-- Task source keys
-- -----------------------------------------------------------------------------

select throws_ok(
  $$insert into public.tasks(company_id, lead_id, title, source_key)
    select company_id, id, 'Duplicate call', 'call:leadconduit:lc-ana'
    from public.leads where external_lead_id = 'lc-ana' and company_id = '97000000-0000-4000-8000-000000000001'$$,
  '23505',
  null,
  'a source key is used once per company'
);

-- -----------------------------------------------------------------------------
-- JobNimbus no-shows
-- -----------------------------------------------------------------------------

insert into public.jn_contacts(company_id, jnid, phone_normalized, jn_created_at) values
  ('97000000-0000-4000-8000-000000000001', 'contact-ana', '+16095550111', now() - interval '3 days'),
  ('97000000-0000-4000-8000-000000000001', 'contact-rake', '+17325550122', now() - interval '3 days');
insert into public.jn_jobs(company_id, jnid, primary_contact_jnid, status_name, status_changed_at, jn_created_at) values
  ('97000000-0000-4000-8000-000000000001', 'job-ana', 'contact-ana', 'No Show', now() - interval '1 day', now() - interval '3 days'),
  ('97000000-0000-4000-8000-000000000001', 'job-rake', 'contact-rake', 'No Show', now() - interval '1 day', now() - interval '3 days');

-- Rake Lead was already rebooked in Rake after the no-show.
insert into public.appointments(company_id, lead_id, scheduled_at, status)
values ('97000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000201', now() + interval '2 days', 'scheduled');

select lives_ok(
  $$select public.refresh_customer_journey('97000000-0000-4000-8000-000000000001')$$,
  'the journey refresh records the no-shows'
);

select is(
  public.queue_jobnimbus_rebook_tasks('97000000-0000-4000-8000-000000000001'),
  1,
  'one rebook task: the lead already rebooked in Rake is skipped'
);

select results_eq(
  $$select task.title, task.source_key like 'rebook:jobnimbus_job:job-ana:%'
    from public.tasks as task join public.leads as lead on lead.id = task.lead_id
    where lead.external_lead_id = 'lc-ana' and task.title = 'Rebook no-show'$$,
  $$values ('Rebook no-show', true)$$,
  'the rebook task lands on the matched Rake lead'
);

select is(
  public.queue_jobnimbus_rebook_tasks('97000000-0000-4000-8000-000000000001'),
  0,
  'queueing again adds nothing'
);

select is(
  public.queue_jobnimbus_rebook_tasks('97000000-0000-4000-8000-000000000001', interval '1 hour'),
  0,
  'no-shows older than the lookback are ignored'
);

select * from finish();
rollback;

-- LeadConduit intake visibility.
--
-- 1. Stop calling leads "filtered" when PIW cannot know. leadconduit_filtered_leads
--    treated any intake without a delivered checkpoint as filtered, so while
--    only the intake recipient is wired in LeadConduit every lead looked
--    filtered before CoreLogic. A lead now counts as filtered only when the
--    flow's delivered recipient demonstrably fired on both sides of it (within
--    a week before and after), and "before CoreLogic" needs the same evidence
--    for the CoreLogic recipient; otherwise the stop point is "unknown".
-- 2. Remove the journey "filtered" stages that the old rule recorded.
-- 3. Record which states a company serves, so out-of-area leads can be flagged.
-- 4. A per-lead quality view for the vendor scorecard and lead feed.

-- Liveness lookups: "did this recipient fire for this flow near this time?"
create index if not exists leadconduit_events_checkpoint_flow_time_idx
  on public.leadconduit_events (company_id, flow_id, event_type, occurred_at)
  where event_type in ('shadow_checkpoint', 'checkpoint_delivered');

create or replace view public.leadconduit_filtered_leads
with (security_invoker = true)
as
select
  intake.company_id,
  intake.flow_id,
  intake.lead_id,
  intake.source_id,
  intake.source_name,
  intake.occurred_at as entered_at,
  case
    when corelogic.id is not null then 'after_corelogic'
    when exists (
      select 1 from public.leadconduit_events as seen
      where seen.company_id = intake.company_id
        and seen.flow_id = intake.flow_id
        and seen.event_type = 'shadow_checkpoint'
        and seen.occurred_at <= intake.occurred_at
        and seen.occurred_at >= intake.occurred_at - interval '7 days'
    ) and exists (
      select 1 from public.leadconduit_events as seen
      where seen.company_id = intake.company_id
        and seen.flow_id = intake.flow_id
        and seen.event_type = 'shadow_checkpoint'
        and seen.occurred_at >= intake.occurred_at
        and seen.occurred_at <= intake.occurred_at + interval '7 days'
    ) then 'before_corelogic'
    else 'unknown'
  end as stopped_at,
  corelogic.reason_category as likely_filter_category,
  intake.lead_name,
  intake.submitted_phone,
  intake.submitted_email,
  intake.submitted_address,
  intake.phone_normalized,
  intake.email_normalized,
  intake.trustedform_url,
  intake.attribution ->> 'piw_reference' as piw_reference,
  intake.is_test
from public.leadconduit_events as intake
left join public.leadconduit_events as corelogic
  on corelogic.company_id = intake.company_id
 and corelogic.flow_id = intake.flow_id
 and corelogic.lead_id = intake.lead_id
 and corelogic.event_type = 'shadow_checkpoint'
where intake.event_type = 'checkpoint_intake'
  and intake.occurred_at < pg_catalog.now() - interval '2 hours'
  and not exists (
    select 1
    from public.leadconduit_events as delivered
    where delivered.company_id = intake.company_id
      and delivered.flow_id = intake.flow_id
      and delivered.lead_id = intake.lead_id
      and delivered.event_type = 'checkpoint_delivered'
  )
  -- The delivered recipient was live before and after this lead entered.
  and exists (
    select 1 from public.leadconduit_events as seen
    where seen.company_id = intake.company_id
      and seen.flow_id = intake.flow_id
      and seen.event_type = 'checkpoint_delivered'
      and seen.occurred_at <= intake.occurred_at
      and seen.occurred_at >= intake.occurred_at - interval '7 days'
  )
  and exists (
    select 1 from public.leadconduit_events as seen
    where seen.company_id = intake.company_id
      and seen.flow_id = intake.flow_id
      and seen.event_type = 'checkpoint_delivered'
      and seen.occurred_at >= intake.occurred_at
      and seen.occurred_at <= intake.occurred_at + interval '7 days'
  );

-- The journey refresh only adds stages, so the ones the old rule recorded stay
-- until removed. The view now returns only leads PIW can show were filtered.
delete from public.customer_journey_events as event
where event.stage = 'ap_filtered'
  and event.source_system = 'leadconduit'
  and not exists (
    select 1 from public.leadconduit_filtered_leads as filtered
    where filtered.company_id = event.company_id
      and filtered.flow_id || ':' || filtered.lead_id = event.source_ref
      and not filtered.is_test
  );

-- Two-letter USPS codes. Null means "not configured": nothing is flagged.
alter table public.companies
  add column service_states text[]
  constraint companies_service_states_check check (
    service_states is null
    or (
      pg_catalog.cardinality(service_states) > 0
      and pg_catalog.array_to_string(service_states, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'
    )
  );

-- AllSeason Solar serves New Jersey. No-op in environments without it.
update public.companies
set service_states = array['NJ']
where id = '7648b78d-836f-489e-ada1-9dcea8b22220'
  and service_states is null;

-- One row per live intake lead. Keeps the street out: the feed needs a town,
-- and phone and email only as presence flags.
--   repeat_of_*           the same phone or email entered through any source
--                         in the 30 days before
--   jobnimbus_contact_since  the earliest JobNimbus contact with the same
--                         phone or email created more than a day before the
--                         lead (a day excludes the lead's own handoff)
create view public.leadconduit_intake_quality
with (security_invoker = true)
as
select
  intake.company_id,
  intake.flow_id,
  intake.lead_id,
  intake.source_name,
  intake.occurred_at as received_at,
  nullif(pg_catalog.btrim(intake.lead_name), '') as lead_name,
  -- Some vendors send a blank city (", , MA 02108"); that reads as no city.
  nullif(pg_catalog.btrim(pg_catalog.substring(
    intake.submitted_address, ',\s*([^,]+?)\s*,\s*[A-Za-z]{2}\s+\d{5}(?:-\d{4})?\s*$'
  )), '') as city,
  pg_catalog.upper(pg_catalog.substring(
    intake.submitted_address, ',\s*([A-Za-z]{2})\s+\d{5}(?:-\d{4})?\s*$'
  )) as state,
  coalesce(intake.submitted_address ~ '[[:alnum:]]', false) as has_address,
  coalesce(intake.trustedform_url ~ '\S', false) as has_trustedform,
  intake.phone_normalized is not null as has_phone,
  intake.email_normalized is not null as has_email,
  (
    intake.lead_name is null
    and intake.submitted_phone is null
    and intake.submitted_email is null
    and intake.submitted_address is null
    and intake.trustedform_url is null
  ) as contact_redacted,
  earlier.received_at as repeat_of_received_at,
  earlier.source_name as repeat_of_source_name,
  least(by_phone.created_at, by_email.created_at) as jobnimbus_contact_since,
  company.service_states
from public.leadconduit_events as intake
join public.companies as company on company.id = intake.company_id
left join lateral (
  select candidate.received_at, candidate.source_name
  from (
    (
      select prior.occurred_at as received_at, prior.source_name
      from public.leadconduit_events as prior
      where prior.company_id = intake.company_id
        and prior.phone_normalized = intake.phone_normalized
        and prior.event_type = 'checkpoint_intake'
        and not prior.is_test
        and (prior.flow_id, prior.lead_id) is distinct from (intake.flow_id, intake.lead_id)
        and prior.occurred_at < intake.occurred_at
        and prior.occurred_at >= intake.occurred_at - interval '30 days'
      order by prior.occurred_at desc
      limit 1
    )
    union all
    (
      select prior.occurred_at as received_at, prior.source_name
      from public.leadconduit_events as prior
      where prior.company_id = intake.company_id
        and prior.email_normalized = intake.email_normalized
        and prior.event_type = 'checkpoint_intake'
        and not prior.is_test
        and (prior.flow_id, prior.lead_id) is distinct from (intake.flow_id, intake.lead_id)
        and prior.occurred_at < intake.occurred_at
        and prior.occurred_at >= intake.occurred_at - interval '30 days'
      order by prior.occurred_at desc
      limit 1
    )
  ) as candidate
  order by candidate.received_at desc
  limit 1
) as earlier on true
left join lateral (
  select pg_catalog.min(contact.jn_created_at) as created_at
  from public.jn_contacts as contact
  where contact.company_id = intake.company_id
    and contact.phone_normalized = intake.phone_normalized
    and contact.jn_created_at < intake.occurred_at - interval '1 day'
) as by_phone on true
left join lateral (
  select pg_catalog.min(contact.jn_created_at) as created_at
  from public.jn_contacts as contact
  where contact.company_id = intake.company_id
    and contact.email_normalized = intake.email_normalized
    and contact.jn_created_at < intake.occurred_at - interval '1 day'
) as by_email on true
where intake.event_type = 'checkpoint_intake'
  and not intake.is_test;

revoke all on public.leadconduit_intake_quality from anon, authenticated;
grant select on public.leadconduit_intake_quality to authenticated, service_role;

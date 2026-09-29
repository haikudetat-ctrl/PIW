-- Journey checkpoints for the Roofing and Roofing Virtual Quote flows.
--
-- The receiver now accepts three checkpoints per lead, stored as separate
-- leadconduit_events rows:
--   checkpoint_intake     immediately after source acceptance (keeps contact)
--   shadow_checkpoint     after CoreLogic (existing; contact only for candidates)
--   checkpoint_delivered  after the last client destination (matching keys only)
--
-- A lead seen at intake that never reaches delivery within the grace period
-- was filtered. Where it stopped tells us roughly why.

create index if not exists leadconduit_events_checkpoint_lead_idx
  on public.leadconduit_events (company_id, flow_id, lead_id, event_type)
  where event_type in ('checkpoint_intake', 'shadow_checkpoint', 'checkpoint_delivered');

-- Leads that entered a flow but were not delivered. Two hours covers normal
-- flow latency; anything younger is still in flight and excluded.
create view public.leadconduit_filtered_leads
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
    when corelogic.id is null then 'before_corelogic'
    else 'after_corelogic'
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
  );

revoke all on public.leadconduit_filtered_leads from anon, authenticated;
grant select on public.leadconduit_filtered_leads to service_role;

-- Retention. Not scheduled: the owner must approve a written retention
-- schedule before live intake traffic (see the LeadConduit checkpoint
-- runbook). Clears submitted contact details from intake rows after the
-- given ages, sooner for delivered leads (the client's systems hold them)
-- than for filtered leads (kept for recovery). Normalized phone and email
-- remain for journey matching.
create function public.redact_leadconduit_checkpoint_contacts(
  p_company_id uuid,
  p_delivered_after interval,
  p_filtered_after interval
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redacted integer;
begin
  if p_delivered_after < interval '0' or p_filtered_after < interval '0' then
    raise exception 'Retention ages must not be negative' using errcode = '22023';
  end if;

  update public.leadconduit_events as intake
  set lead_name = null,
      submitted_phone = null,
      submitted_email = null,
      submitted_address = null,
      trustedform_url = null
  where intake.company_id = p_company_id
    and intake.event_type = 'checkpoint_intake'
    and (
      intake.lead_name is not null
      or intake.submitted_phone is not null
      or intake.submitted_email is not null
      or intake.submitted_address is not null
      or intake.trustedform_url is not null
    )
    and intake.occurred_at < pg_catalog.now() - case
      when exists (
        select 1
        from public.leadconduit_events as delivered
        where delivered.company_id = intake.company_id
          and delivered.flow_id = intake.flow_id
          and delivered.lead_id = intake.lead_id
          and delivered.event_type = 'checkpoint_delivered'
      ) then p_delivered_after
      else p_filtered_after
    end;
  get diagnostics v_redacted = row_count;
  return v_redacted;
end;
$$;

revoke execute on function public.redact_leadconduit_checkpoint_contacts(uuid, interval, interval)
  from public, anon, authenticated;
grant execute on function public.redact_leadconduit_checkpoint_contacts(uuid, interval, interval)
  to service_role;

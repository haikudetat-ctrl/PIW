-- Split the funnel into a consent-gated browser Lead and a durable,
-- deduplicated browser/CAPI QualifiedLead. Historical Lead deliveries remain
-- unchanged; only new accepted submissions use QualifiedLead.

alter table public.meta_event_deliveries
  drop constraint meta_event_deliveries_event_name_check;

alter table public.meta_event_deliveries
  add constraint meta_event_deliveries_event_name_check
  check (event_name in ('Lead', 'QualifiedLead', 'AssessmentCompleted'));

alter table public.meta_event_deliveries
  drop constraint meta_event_deliveries_check;

alter table public.meta_event_deliveries
  add constraint meta_event_deliveries_event_shape_check check (
    (event_name in ('Lead', 'QualifiedLead') and assessment_id is null)
    or (event_name = 'AssessmentCompleted' and assessment_id is not null)
  );

create unique index meta_event_one_qualified_lead_idx
  on public.meta_event_deliveries(lead_id, event_name)
  where event_name = 'QualifiedLead';

create function public.reserve_meta_qualified_lead_delivery(
  p_lead_id uuid,
  p_company_id uuid,
  p_consent_id uuid,
  p_policy_version text,
  p_event_time timestamptz
) returns setof public.meta_event_deliveries
language sql
security definer
set search_path = ''
as $$
  insert into public.meta_event_deliveries (
    company_id, lead_id, assessment_id, consent_id, policy_version,
    event_name, event_time
  )
  select
    lead.company_id, lead.id, null, consent.consent_id, consent.policy_version,
    'QualifiedLead', p_event_time
  from public.leads as lead
  join lateral (
    select evidence.consent_id, evidence.company_id, evidence.lead_id,
           evidence.policy_version, evidence.advertising_granted
    from public.privacy_consent_evidence as evidence
    where evidence.consent_id = p_consent_id
      and evidence.policy_version = p_policy_version
      and evidence.occurred_at <= p_event_time
    order by
      evidence.occurred_at desc,
      evidence.advertising_granted asc,
      evidence.gpc_detected desc,
      evidence.created_at desc,
      evidence.evidence_id desc
    limit 1
  ) as consent on true
  where lead.id = p_lead_id
    and lead.company_id = p_company_id
    and consent.company_id = lead.company_id
    and consent.lead_id = lead.id
    and consent.advertising_granted
  on conflict (lead_id, event_name) where event_name = 'QualifiedLead'
  do update set lead_id = excluded.lead_id
  returning public.meta_event_deliveries.*;
$$;

revoke all on function public.reserve_meta_qualified_lead_delivery(
  uuid,uuid,uuid,text,timestamptz
) from public, anon, authenticated;
grant execute on function public.reserve_meta_qualified_lead_delivery(
  uuid,uuid,uuid,text,timestamptz
) to service_role;

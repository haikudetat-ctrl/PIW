-- Consent-gated, idempotent Meta Conversions API delivery state. Contact
-- details and outbound payloads remain in their canonical sources and are
-- deliberately absent from this ledger.

create table public.meta_event_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null,
  assessment_id uuid,
  consent_id uuid not null,
  policy_version text not null check (policy_version = 'piw-privacy-v1'),
  event_name text not null check (event_name in ('Lead', 'AssessmentCompleted')),
  event_id uuid not null default extensions.gen_random_uuid(),
  event_time timestamptz not null,
  status text not null default 'pending' check (
    status in ('pending', 'sending', 'sent', 'retryable_failed', 'permanent_failed')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  payload_hash text check (payload_hash is null or payload_hash ~ '^[0-9a-f]{64}$'),
  meta_http_status integer check (
    meta_http_status is null or meta_http_status between 100 and 599
  ),
  meta_trace_id text check (meta_trace_id is null or pg_catalog.length(meta_trace_id) <= 128),
  last_error_category text check (
    last_error_category is null or pg_catalog.length(last_error_category) <= 128
  ),
  last_attempted_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (event_id),
  foreign key (company_id, lead_id)
    references public.leads(company_id, id) on delete cascade,
  foreign key (company_id, assessment_id)
    references public.roof_assessments(company_id, id) on delete cascade,
  check (
    (event_name = 'Lead' and assessment_id is null)
    or (event_name = 'AssessmentCompleted' and assessment_id is not null)
  )
);

create unique index meta_event_one_lead_idx
  on public.meta_event_deliveries(lead_id, event_name)
  where event_name = 'Lead';
create unique index meta_event_one_assessment_idx
  on public.meta_event_deliveries(assessment_id, event_name)
  where event_name = 'AssessmentCompleted';
create index meta_event_pending_idx
  on public.meta_event_deliveries(status, updated_at)
  where status in ('pending', 'retryable_failed', 'sending');

alter table public.meta_event_deliveries enable row level security;
revoke all on table public.meta_event_deliveries
  from public, anon, authenticated, service_role;
grant select on table public.meta_event_deliveries to service_role;

create function public.reserve_meta_lead_delivery(
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
    'Lead', p_event_time
  from public.leads as lead
  join lateral (
    select evidence.consent_id, evidence.company_id, evidence.lead_id,
           evidence.policy_version, evidence.advertising_granted
    from public.privacy_consent_evidence as evidence
    where evidence.consent_id = p_consent_id
      and evidence.policy_version = p_policy_version
      and evidence.occurred_at <= p_event_time
    order by evidence.occurred_at desc, evidence.created_at desc, evidence.evidence_id desc
    limit 1
  ) as consent on true
  where lead.id = p_lead_id
    and lead.company_id = p_company_id
    and consent.company_id = lead.company_id
    and consent.lead_id = lead.id
    and consent.advertising_granted
  on conflict (lead_id, event_name) where event_name = 'Lead'
  do update set lead_id = excluded.lead_id
  returning public.meta_event_deliveries.*;
$$;

create function public.reserve_meta_assessment_delivery(
  p_assessment_id uuid,
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
    assessment.company_id, assessment.lead_id, assessment.id,
    consent.consent_id, consent.policy_version, 'AssessmentCompleted', p_event_time
  from public.roof_assessments as assessment
  join public.roof_estimates as estimate
    on estimate.id = assessment.estimate_id
   and estimate.company_id = assessment.company_id
   and estimate.lead_id = assessment.lead_id
  join lateral (
    select evidence.consent_id, evidence.company_id, evidence.lead_id,
           evidence.policy_version, evidence.advertising_granted
    from public.privacy_consent_evidence as evidence
    where evidence.consent_id = p_consent_id
      and evidence.policy_version = p_policy_version
      and evidence.occurred_at <= p_event_time
    order by evidence.occurred_at desc, evidence.created_at desc, evidence.evidence_id desc
    limit 1
  ) as consent on true
  where assessment.id = p_assessment_id
    and assessment.company_id = p_company_id
    and consent.company_id = assessment.company_id
    and consent.lead_id = assessment.lead_id
    and consent.advertising_granted
    and assessment.status = 'completed'
    and estimate.status = 'ready'
    and estimate.roof_squares > 0
    and estimate.range_low_cents > 0
    and estimate.range_high_cents >= estimate.range_low_cents
    -- Production quote delivery requires an exact ordered Good/Better/Best
    -- snapshot tied to the same trusted measurement and pricing version.
    and (
      select pg_catalog.count(*)
      from public.roof_estimate_packages as package
      where package.company_id = estimate.company_id
        and package.estimate_id = estimate.id
        and package.measured_roof_squares = estimate.roof_squares
        and package.pricing_version = estimate.pricing_version
    ) = 3
    and exists (
      select 1 from public.roof_estimate_packages as package
      where package.company_id = estimate.company_id and package.estimate_id = estimate.id
        and package.tier_key = 'good' and package.display_order = 1
    )
    and exists (
      select 1 from public.roof_estimate_packages as package
      where package.company_id = estimate.company_id and package.estimate_id = estimate.id
        and package.tier_key = 'better' and package.display_order = 2
        and package.range_low_cents = estimate.range_low_cents
        and package.range_high_cents = estimate.range_high_cents
    )
    and exists (
      select 1 from public.roof_estimate_packages as package
      where package.company_id = estimate.company_id and package.estimate_id = estimate.id
        and package.tier_key = 'best' and package.display_order = 3
    )
  on conflict (assessment_id, event_name) where event_name = 'AssessmentCompleted'
  do update set assessment_id = excluded.assessment_id
  returning public.meta_event_deliveries.*;
$$;

create function public.claim_meta_delivery(
  p_delivery_id uuid,
  p_claimed_at timestamptz
) returns setof public.meta_event_deliveries
language sql
security definer
set search_path = ''
as $$
  with candidate as (
    select delivery.id
    from public.meta_event_deliveries as delivery
    where delivery.id = p_delivery_id
      and p_claimed_at is not null
      and delivery.event_time <= p_claimed_at
      and delivery.attempt_count < 5
      and (
        delivery.status in ('pending', 'retryable_failed')
        or (
          delivery.status = 'sending'
          and delivery.last_attempted_at <= p_claimed_at - interval '10 minutes'
        )
      )
      -- Revalidate both historical eligibility and current consent in the
      -- same statement that locks and transitions the delivery. A later
      -- grant cannot authorize the historical event, while a later
      -- revocation suppresses a previously valid reservation.
      and exists (
        select 1
        from lateral (
          select evidence.company_id, evidence.lead_id,
                 evidence.policy_version, evidence.advertising_granted
          from public.privacy_consent_evidence as evidence
          where evidence.consent_id = delivery.consent_id
            and evidence.policy_version = delivery.policy_version
            and evidence.occurred_at <= delivery.event_time
          order by evidence.occurred_at desc, evidence.created_at desc, evidence.evidence_id desc
          limit 1
        ) as consent_at_event
        join lateral (
          select evidence.company_id, evidence.lead_id,
                 evidence.policy_version, evidence.advertising_granted
          from public.privacy_consent_evidence as evidence
          where evidence.consent_id = delivery.consent_id
            and evidence.policy_version = delivery.policy_version
            and evidence.occurred_at <= p_claimed_at
          order by evidence.occurred_at desc, evidence.created_at desc, evidence.evidence_id desc
          limit 1
        ) as current_consent on true
        where consent_at_event.company_id = delivery.company_id
          and consent_at_event.lead_id = delivery.lead_id
          and consent_at_event.policy_version = delivery.policy_version
          and consent_at_event.advertising_granted
          and current_consent.company_id = delivery.company_id
          and current_consent.lead_id = delivery.lead_id
          and current_consent.policy_version = delivery.policy_version
          and current_consent.advertising_granted
      )
    for update skip locked
  )
  update public.meta_event_deliveries as delivery
  set status = 'sending',
      attempt_count = delivery.attempt_count + 1,
      last_attempted_at = p_claimed_at,
      updated_at = p_claimed_at
  from candidate
  where delivery.id = candidate.id
  returning delivery.*;
$$;

create function public.list_pending_meta_deliveries(
  p_limit integer,
  p_observed_at timestamptz
) returns table(id uuid)
language sql
security definer
set search_path = ''
as $$
  select delivery.id
  from public.meta_event_deliveries as delivery
  where p_observed_at is not null
    and delivery.event_time <= p_observed_at
    and delivery.attempt_count < 5
    and (
      delivery.status in ('pending', 'retryable_failed')
      or (
        delivery.status = 'sending'
        and delivery.last_attempted_at <= p_observed_at - interval '10 minutes'
      )
    )
    and exists (
      select 1
      from lateral (
        select evidence.company_id, evidence.lead_id,
               evidence.policy_version, evidence.advertising_granted
        from public.privacy_consent_evidence as evidence
        where evidence.consent_id = delivery.consent_id
          and evidence.policy_version = delivery.policy_version
          and evidence.occurred_at <= delivery.event_time
        order by evidence.occurred_at desc, evidence.created_at desc, evidence.evidence_id desc
        limit 1
      ) as consent_at_event
      join lateral (
        select evidence.company_id, evidence.lead_id,
               evidence.policy_version, evidence.advertising_granted
        from public.privacy_consent_evidence as evidence
        where evidence.consent_id = delivery.consent_id
          and evidence.policy_version = delivery.policy_version
          and evidence.occurred_at <= p_observed_at
        order by evidence.occurred_at desc, evidence.created_at desc, evidence.evidence_id desc
        limit 1
      ) as current_consent on true
      where consent_at_event.company_id = delivery.company_id
        and consent_at_event.lead_id = delivery.lead_id
        and consent_at_event.policy_version = delivery.policy_version
        and consent_at_event.advertising_granted
        and current_consent.company_id = delivery.company_id
        and current_consent.lead_id = delivery.lead_id
        and current_consent.policy_version = delivery.policy_version
        and current_consent.advertising_granted
    )
  order by delivery.updated_at, delivery.id
  limit least(greatest(coalesce(p_limit, 50), 0), 50);
$$;

-- The fixed six-argument adapter contract has one diagnostic token. For a
-- successful outcome it is a Meta trace ID; for either failure outcome it is
-- an error category. The opposite column is cleared, and arbitrary response
-- text is reduced to a bounded token rather than being stored verbatim.
create function public.complete_meta_delivery(
  p_delivery_id uuid,
  p_status text,
  p_meta_http_status integer,
  p_payload_hash text,
  p_diagnostic text,
  p_completed_at timestamptz
) returns setof public.meta_event_deliveries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload_hash text;
  v_diagnostic text;
begin
  if p_status is null
    or p_status not in ('sent', 'retryable_failed', 'permanent_failed')
  then
    raise exception using errcode = '22023', message = 'Invalid Meta delivery outcome';
  end if;
  if p_completed_at is null then
    raise exception using errcode = '22023', message = 'Meta delivery completion time is required';
  end if;

  v_payload_hash := pg_catalog.lower(
    nullif(pg_catalog.btrim(coalesce(p_payload_hash, '')), '')
  );
  if v_payload_hash is not null and v_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid Meta payload hash';
  end if;

  v_diagnostic := pg_catalog.left(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(coalesce(p_diagnostic, '')),
      '[^A-Za-z0-9._:-]+', '_', 'g'
    ),
    128
  );
  v_diagnostic := nullif(v_diagnostic, '');
  if p_status <> 'sent' then
    v_diagnostic := pg_catalog.lower(v_diagnostic);
  end if;

  return query
  update public.meta_event_deliveries as delivery
  set status = p_status,
      payload_hash = v_payload_hash,
      meta_http_status = p_meta_http_status,
      meta_trace_id = case when p_status = 'sent' then v_diagnostic else null end,
      last_error_category = case when p_status = 'sent' then null else v_diagnostic end,
      sent_at = case when p_status = 'sent' then p_completed_at else null end,
      updated_at = p_completed_at
  where delivery.id = p_delivery_id
    and delivery.status = 'sending'
  returning delivery.*;
end;
$$;

revoke all on function public.reserve_meta_lead_delivery(uuid,uuid,uuid,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.reserve_meta_assessment_delivery(uuid,uuid,uuid,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_meta_delivery(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.list_pending_meta_deliveries(integer,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_meta_delivery(uuid,text,integer,text,text,timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function public.reserve_meta_lead_delivery(uuid,uuid,uuid,text,timestamptz)
  to service_role;
grant execute on function public.reserve_meta_assessment_delivery(uuid,uuid,uuid,text,timestamptz)
  to service_role;
grant execute on function public.claim_meta_delivery(uuid,timestamptz)
  to service_role;
grant execute on function public.list_pending_meta_deliveries(integer,timestamptz)
  to service_role;
grant execute on function public.complete_meta_delivery(uuid,text,integer,text,text,timestamptz)
  to service_role;

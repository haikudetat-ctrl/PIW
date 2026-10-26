-- Opt-out advertising model for public estimate and website pages.
--
-- When NEXT_PUBLIC_ADVERTISING_DEFAULT_ON is set, a visitor with no saved
-- choice, no Global Privacy Control signal, and no local denial is recorded
-- with source 'default_notice': advertising on by notice rather than by a
-- banner click. It is a distinct source so the evidence never claims a click
-- that did not happen. Denials, GPC, and the rate limits are unchanged.

alter table public.privacy_consent_evidence
  drop constraint privacy_consent_evidence_source_check;
alter table public.privacy_consent_evidence
  add constraint privacy_consent_evidence_source_check
  check (source in ('banner', 'preferences', 'gpc', 'default_notice'));

create or replace function public.record_public_privacy_consent(
  p_evidence_id uuid,
  p_consent_id uuid,
  p_policy_version text,
  p_analytics_granted boolean,
  p_advertising_granted boolean,
  p_gpc_detected boolean,
  p_source text,
  p_request_ip inet,
  p_user_agent text,
  p_occurred_at timestamptz
) returns table(
  evidence_id uuid,
  consent_id uuid,
  policy_version text,
  analytics_granted boolean,
  advertising_granted boolean,
  gpc_detected boolean,
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_current public.privacy_consent_evidence%rowtype;
  v_existing public.privacy_consent_evidence%rowtype;
  v_consent_writes integer;
  v_ip_writes integer;
  v_is_revocation boolean := false;
  v_user_agent text;
  v_first_lock bigint;
  v_second_lock bigint;
begin
  if p_evidence_id is null
    or p_consent_id is null
    or p_policy_version <> 'piw-privacy-v1'
    or p_analytics_granted is null
    or p_advertising_granted is null
    or p_gpc_detected is null
    or p_source not in ('banner', 'preferences', 'gpc', 'default_notice')
    or p_request_ip is null
    or p_occurred_at is null
    or p_occurred_at > v_now + interval '30 seconds'
  then
    raise exception using errcode = '22023', message = 'Invalid public privacy consent evidence';
  end if;

  if p_gpc_detected and p_advertising_granted then
    raise exception using errcode = '22023', message = 'Global Privacy Control cannot grant advertising';
  end if;

  -- Acquire both locks in a stable order so an IP shared by two consent IDs
  -- cannot create an advisory-lock deadlock.
  v_first_lock := pg_catalog.hashtextextended('privacy-consent:' || p_consent_id::text, 0);
  v_second_lock := pg_catalog.hashtextextended('privacy-ip:' || p_request_ip::text, 0);
  if v_first_lock <= v_second_lock then
    perform pg_catalog.pg_advisory_xact_lock(v_first_lock);
    perform pg_catalog.pg_advisory_xact_lock(v_second_lock);
  else
    perform pg_catalog.pg_advisory_xact_lock(v_second_lock);
    perform pg_catalog.pg_advisory_xact_lock(v_first_lock);
  end if;

  -- Stable retries (including a retry that generated a new request ID) return
  -- the already-recorded evidence rather than consuming another write slot.
  select evidence.* into v_existing
  from public.privacy_consent_evidence as evidence
  where evidence.consent_id = p_consent_id
    and evidence.policy_version = p_policy_version
    and evidence.company_id is null
    and evidence.lead_id is null
    and evidence.occurred_at = p_occurred_at
    and evidence.source = p_source
    and evidence.analytics_granted = p_analytics_granted
    and evidence.advertising_granted = p_advertising_granted
    and evidence.gpc_detected = p_gpc_detected
    and evidence.request_ip is not distinct from p_request_ip
  order by evidence.created_at desc, evidence.evidence_id desc
  limit 1;
  if found then
    return query select
      v_existing.evidence_id,
      v_existing.consent_id,
      v_existing.policy_version,
      v_existing.analytics_granted,
      v_existing.advertising_granted,
      v_existing.gpc_detected,
      v_existing.occurred_at;
    return;
  end if;

  select evidence.* into v_existing
  from public.privacy_consent_evidence as evidence
  where evidence.evidence_id = p_evidence_id;
  if found then
    raise exception using errcode = '22023', message = 'Privacy consent evidence identifier conflict';
  end if;

  -- The canonical ordering gives a same-instant denial precedence over a
  -- grant.  Evidence remains append-only; stale/equal grant candidates simply
  -- return the already-authoritative row.
  select evidence.* into v_current
  from public.privacy_consent_evidence as evidence
  where evidence.consent_id = p_consent_id
    and evidence.policy_version = p_policy_version
    and evidence.company_id is null
    and evidence.lead_id is null
  order by
    evidence.occurred_at desc,
    evidence.advertising_granted asc,
    evidence.gpc_detected desc,
    evidence.created_at desc,
    evidence.evidence_id desc
  limit 1;

  if found and p_occurred_at < v_current.occurred_at then
    return query select
      v_current.evidence_id,
      v_current.consent_id,
      v_current.policy_version,
      v_current.analytics_granted,
      v_current.advertising_granted,
      v_current.gpc_detected,
      v_current.occurred_at;
    return;
  end if;

  if found
    and p_occurred_at = v_current.occurred_at
    and not p_advertising_granted
    and v_current.advertising_granted
  then
    -- This is the deliberate equal-time revocation case. It is append-only
    -- and will win the canonical ordering after insertion.
    v_is_revocation := true;
  elsif found
    and p_occurred_at = v_current.occurred_at
    and v_current.advertising_granted = false
    and p_advertising_granted = true
  then
    return query select
      v_current.evidence_id,
      v_current.consent_id,
      v_current.policy_version,
      v_current.analytics_granted,
      v_current.advertising_granted,
      v_current.gpc_detected,
      v_current.occurred_at;
    return;
  elsif found
    and not p_advertising_granted
    and v_current.advertising_granted
  then
    v_is_revocation := true;
  end if;

  select pg_catalog.count(*)::integer into v_consent_writes
  from public.privacy_consent_evidence as evidence
  where evidence.consent_id = p_consent_id
    and evidence.policy_version = p_policy_version
    and evidence.company_id is null
    and evidence.lead_id is null
    and evidence.created_at > v_now - interval '1 hour';

  select pg_catalog.count(*)::integer into v_ip_writes
  from public.privacy_consent_evidence as evidence
  where evidence.company_id is null
    and evidence.lead_id is null
    and evidence.request_ip = p_request_ip
    and evidence.created_at > v_now - interval '1 hour';

  if (v_consent_writes >= 12 or v_ip_writes >= 60) and not v_is_revocation then
    raise exception using errcode = 'P0001', message = 'Privacy consent request limit exceeded';
  end if;

  v_user_agent := nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_user_agent, '')), 512), '');
  insert into public.privacy_consent_evidence (
    evidence_id,
    consent_id,
    company_id,
    lead_id,
    policy_version,
    necessary_granted,
    analytics_granted,
    advertising_granted,
    gpc_detected,
    source,
    request_ip,
    user_agent,
    occurred_at
  ) values (
    p_evidence_id,
    p_consent_id,
    null,
    null,
    p_policy_version,
    true,
    p_analytics_granted,
    p_advertising_granted,
    p_gpc_detected,
    p_source,
    p_request_ip,
    v_user_agent,
    p_occurred_at
  );

  return query select
    p_evidence_id,
    p_consent_id,
    p_policy_version,
    p_analytics_granted,
    p_advertising_granted,
    p_gpc_detected,
    p_occurred_at;
end;
$$;

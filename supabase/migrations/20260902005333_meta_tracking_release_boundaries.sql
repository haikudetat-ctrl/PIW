-- Forward-only release correction for the privacy and Meta tracking rollout.
-- The earlier privacy and Meta ledger migrations are already applied in the
-- production project, so this file only replaces functions and adds isolated
-- append-only/limiting storage.

create table public.roof_assessment_result_view_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  request_ip inet not null,
  token_hash bytea not null check (pg_catalog.octet_length(token_hash) = 32),
  reserved_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index roof_assessment_result_view_attempts_token_idx
  on public.roof_assessment_result_view_attempts(token_hash, reserved_at desc);
create index roof_assessment_result_view_attempts_ip_idx
  on public.roof_assessment_result_view_attempts(request_ip, reserved_at desc);

alter table public.roof_assessment_result_view_attempts enable row level security;
revoke all on public.roof_assessment_result_view_attempts
  from public, anon, authenticated, service_role;

-- The original broad uniqueness constraint made a same-instant grant and
-- revocation impossible to retain together.  The public RPC below supplies
-- idempotency under its transaction-scoped lock, while evidence itself stays
-- append-only so the canonical denial-first ordering can be applied.
alter table public.privacy_consent_evidence
  drop constraint if exists privacy_consent_evidence_consent_id_policy_version_occurred_key;

-- Public consent is intentionally written through one constrained RPC.  The
-- opaque consent ID and trusted request IP are both locked for the complete
-- transaction, which makes the rolling windows durable under concurrency.
create function public.record_public_privacy_consent(
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
    or p_source not in ('banner', 'preferences', 'gpc')
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

-- The result-view endpoint performs this small, service-only reservation
-- before any result lookup. The table stores a SHA-256 token hash, never the
-- public estimate token itself.
create function public.consume_roof_assessment_result_view_limit(
  p_public_token uuid,
  p_request_ip inet
) returns table(allowed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_token_hash bytea;
  v_token_lock bigint;
  v_ip_lock bigint;
begin
  if p_public_token is null or p_request_ip is null then
    raise exception using errcode = '22023', message = 'Result view request IP is required';
  end if;

  v_token_hash := extensions.digest(p_public_token::text, 'sha256');
  v_token_lock := pg_catalog.hashtextextended('roof-result-token:' || pg_catalog.encode(v_token_hash, 'hex'), 0);
  v_ip_lock := pg_catalog.hashtextextended('roof-result-ip:' || p_request_ip::text, 0);
  if v_token_lock <= v_ip_lock then
    perform pg_catalog.pg_advisory_xact_lock(v_token_lock);
    perform pg_catalog.pg_advisory_xact_lock(v_ip_lock);
  else
    perform pg_catalog.pg_advisory_xact_lock(v_ip_lock);
    perform pg_catalog.pg_advisory_xact_lock(v_token_lock);
  end if;

  if (select pg_catalog.count(*)
      from public.roof_assessment_result_view_attempts as attempt
      where attempt.token_hash = v_token_hash
        and attempt.reserved_at > v_now - interval '1 hour') >= 12
    or (select pg_catalog.count(*)
        from public.roof_assessment_result_view_attempts as attempt
        where attempt.request_ip = p_request_ip
          and attempt.reserved_at > v_now - interval '1 hour') >= 60
  then
    return query select false;
    return;
  end if;

  insert into public.roof_assessment_result_view_attempts(
    request_ip, token_hash, reserved_at
  ) values (
    p_request_ip, v_token_hash, v_now
  );
  return query select true;
end;
$$;

-- Acknowledge the first trusted customer-visible result and reserve the Meta
-- delivery in the same transaction. A later reload can return the original
-- envelope, but it can never turn an initially denied/missing consent into a
-- retrospective conversion.
create function public.acknowledge_roof_assessment_result_view(
  p_company_id uuid,
  p_assessment_id uuid,
  p_estimate_id uuid,
  p_consent_id uuid,
  p_policy_version text,
  p_analytics_granted boolean,
  p_advertising_granted boolean,
  p_gpc_detected boolean,
  p_source text,
  p_request_ip inet,
  p_user_agent text
) returns table(
  result_viewed_at timestamptz,
  meta_delivery_id uuid,
  meta_event_id uuid,
  meta_event_name text,
  meta_event_time timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assessment public.roof_assessments%rowtype;
  v_canonical public.privacy_consent_evidence%rowtype;
  v_delivery public.meta_event_deliveries%rowtype;
  v_result_viewed_at timestamptz;
  v_trusted boolean := false;
  v_has_consent boolean := false;
  v_record_linked boolean := false;
begin
  if p_company_id is null or p_assessment_id is null or p_estimate_id is null then
    raise exception using errcode = '22023', message = 'Assessment result scope is required';
  end if;

  v_has_consent := p_consent_id is not null
    or p_policy_version is not null
    or p_analytics_granted is not null
    or p_advertising_granted is not null
    or p_gpc_detected is not null
    or p_source is not null;
  if v_has_consent and (
    p_consent_id is null
    or p_policy_version <> 'piw-privacy-v1'
    or p_analytics_granted is null
    or p_advertising_granted is null
    or p_gpc_detected is null
    or p_source not in ('banner', 'preferences', 'gpc')
    or (p_gpc_detected and p_advertising_granted)
  ) then
    raise exception using errcode = '22023', message = 'Invalid assessment privacy consent';
  end if;

  select assessment.* into v_assessment
  from public.roof_assessments as assessment
  where assessment.id = p_assessment_id
    and assessment.company_id = p_company_id
    and assessment.estimate_id = p_estimate_id
  for update;
  if not found then
    raise exception 'Roof assessment not found for company';
  end if;

  if v_assessment.status <> 'completed' then
    raise exception 'Roof assessment is not complete';
  end if;

  select exists (
    select 1
    from public.roof_estimates as estimate
    where estimate.id = p_estimate_id
      and estimate.company_id = p_company_id
      and estimate.lead_id = v_assessment.lead_id
      and estimate.status = 'ready'
      and estimate.roof_squares > 0
      and estimate.range_low_cents > 0
      and estimate.range_high_cents >= estimate.range_low_cents
      and (select pg_catalog.count(*)
           from public.roof_estimate_packages as package
           where package.company_id = estimate.company_id
             and package.estimate_id = estimate.id
             and package.measured_roof_squares = estimate.roof_squares
             and package.pricing_version = estimate.pricing_version) = 3
      and exists (
        select 1 from public.roof_estimate_packages as package
        where package.company_id = estimate.company_id
          and package.estimate_id = estimate.id
          and package.tier_key = 'good'
          and package.display_order = 1
      )
      and exists (
        select 1 from public.roof_estimate_packages as package
        where package.company_id = estimate.company_id
          and package.estimate_id = estimate.id
          and package.tier_key = 'better'
          and package.display_order = 2
          and package.range_low_cents = estimate.range_low_cents
          and package.range_high_cents = estimate.range_high_cents
      )
      and exists (
        select 1 from public.roof_estimate_packages as package
        where package.company_id = estimate.company_id
          and package.estimate_id = estimate.id
          and package.tier_key = 'best'
          and package.display_order = 3
      )
  ) into v_trusted;
  if not v_trusted then
    raise exception 'Assessment quote is not ready';
  end if;

  if v_assessment.result_viewed_at is not null then
    select delivery.* into v_delivery
    from public.meta_event_deliveries as delivery
    where delivery.company_id = p_company_id
      and delivery.assessment_id = p_assessment_id
      and delivery.event_name = 'AssessmentCompleted';
    return query select
      v_assessment.result_viewed_at,
      v_delivery.id,
      v_delivery.event_id,
      v_delivery.event_name,
      v_delivery.event_time;
    return;
  end if;

  select viewed.result_viewed_at into v_result_viewed_at
  from public.mark_roof_assessment_result_viewed(
    p_company_id, p_assessment_id, p_estimate_id
  ) as viewed;

  if v_has_consent then
    select evidence.* into v_canonical
    from public.privacy_consent_evidence as evidence
    where evidence.consent_id = p_consent_id
      and evidence.policy_version = p_policy_version
      and evidence.company_id is null
      and evidence.lead_id is null
      and evidence.occurred_at <= v_result_viewed_at
    order by
      evidence.occurred_at desc,
      evidence.advertising_granted asc,
      evidence.gpc_detected desc,
      evidence.created_at desc,
      evidence.evidence_id desc
    limit 1;

    -- A live GPC signal is allowed to record an event-time denial even when
    -- the last canonical snapshot was an earlier grant. All other values must
    -- match canonical evidence before they can be linked to this lead.
    v_record_linked := found and (
      p_gpc_detected
      or (
        v_canonical.analytics_granted = p_analytics_granted
        and v_canonical.advertising_granted = p_advertising_granted
        and v_canonical.gpc_detected = p_gpc_detected
      )
    );
    if v_record_linked then
      insert into public.privacy_consent_evidence(
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
        extensions.gen_random_uuid(),
        p_consent_id,
        p_company_id,
        v_assessment.lead_id,
        p_policy_version,
        true,
        p_analytics_granted,
        p_advertising_granted,
        p_gpc_detected,
        p_source,
        p_request_ip,
        nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_user_agent, '')), 512), ''),
        v_result_viewed_at
      );

      if p_advertising_granted
        and not p_gpc_detected
        and v_canonical.advertising_granted
        and not v_canonical.gpc_detected
      then
        select delivery.* into v_delivery
        from public.reserve_meta_assessment_delivery(
          p_assessment_id,
          p_company_id,
          p_consent_id,
          p_policy_version,
          v_result_viewed_at
        ) as delivery;
      end if;
    end if;
  end if;

  return query select
    v_result_viewed_at,
    v_delivery.id,
    v_delivery.event_id,
    v_delivery.event_name,
    v_delivery.event_time;
end;
$$;

-- Historical consent must remain linked to the original business event. The
-- current preference then accepts the unlinked canonical sequence (or the
-- original lead's linked fallback when no canonical row exists), never a
-- different lead's linked evidence. This lets an unlinked revoke suppress a
-- pending delivery without allowing a later grant to backfill a denied event.
create or replace function public.claim_meta_delivery(
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
      and exists (
        select 1
        from lateral (
          select evidence.company_id, evidence.lead_id,
                 evidence.policy_version, evidence.advertising_granted
          from public.privacy_consent_evidence as evidence
          where evidence.consent_id = delivery.consent_id
            and evidence.policy_version = delivery.policy_version
            and evidence.company_id = delivery.company_id
            and evidence.lead_id = delivery.lead_id
            and evidence.occurred_at <= delivery.event_time
          order by
            evidence.occurred_at desc,
            evidence.advertising_granted asc,
            evidence.gpc_detected desc,
            evidence.created_at desc,
            evidence.evidence_id desc
          limit 1
        ) as consent_at_event
        join lateral (
          select evidence.policy_version, evidence.advertising_granted
          from public.privacy_consent_evidence as evidence
          where evidence.consent_id = delivery.consent_id
            and evidence.policy_version = delivery.policy_version
            and (
              (evidence.company_id is null and evidence.lead_id is null)
              or (evidence.company_id = delivery.company_id and evidence.lead_id = delivery.lead_id)
            )
            and evidence.occurred_at <= p_claimed_at
          order by
            evidence.occurred_at desc,
            evidence.advertising_granted asc,
            evidence.gpc_detected desc,
            evidence.created_at desc,
            evidence.evidence_id desc
          limit 1
        ) as current_consent on true
        where consent_at_event.company_id = delivery.company_id
          and consent_at_event.lead_id = delivery.lead_id
          and consent_at_event.policy_version = delivery.policy_version
          and consent_at_event.advertising_granted
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

create or replace function public.list_pending_meta_deliveries(
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
          and evidence.company_id = delivery.company_id
          and evidence.lead_id = delivery.lead_id
          and evidence.occurred_at <= delivery.event_time
        order by
          evidence.occurred_at desc,
          evidence.advertising_granted asc,
          evidence.gpc_detected desc,
          evidence.created_at desc,
          evidence.evidence_id desc
        limit 1
      ) as consent_at_event
      join lateral (
        select evidence.policy_version, evidence.advertising_granted
        from public.privacy_consent_evidence as evidence
        where evidence.consent_id = delivery.consent_id
          and evidence.policy_version = delivery.policy_version
          and (
            (evidence.company_id is null and evidence.lead_id is null)
            or (evidence.company_id = delivery.company_id and evidence.lead_id = delivery.lead_id)
          )
          and evidence.occurred_at <= p_observed_at
        order by
          evidence.occurred_at desc,
          evidence.advertising_granted asc,
          evidence.gpc_detected desc,
          evidence.created_at desc,
          evidence.evidence_id desc
        limit 1
      ) as current_consent on true
      where consent_at_event.company_id = delivery.company_id
        and consent_at_event.lead_id = delivery.lead_id
        and consent_at_event.policy_version = delivery.policy_version
        and consent_at_event.advertising_granted
        and current_consent.policy_version = delivery.policy_version
        and current_consent.advertising_granted
    )
  order by delivery.updated_at, delivery.id
  limit least(greatest(coalesce(p_limit, 50), 0), 50);
$$;

create or replace function public.complete_meta_delivery(
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
  v_delivery public.meta_event_deliveries%rowtype;
  v_payload_hash text;
  v_diagnostic text;
  v_status text;
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

  select delivery.* into v_delivery
  from public.meta_event_deliveries as delivery
  where delivery.id = p_delivery_id
    and delivery.status = 'sending'
  for update;
  if not found then
    return;
  end if;

  v_status := p_status;
  v_diagnostic := nullif(pg_catalog.left(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(coalesce(p_diagnostic, '')),
      '[^A-Za-z0-9._:-]+', '_', 'g'
    ),
    128
  ), '');
  if v_status <> 'sent' then
    v_diagnostic := pg_catalog.lower(v_diagnostic);
  end if;

  -- The fifth claim has already consumed the retry budget. Persist a terminal
  -- sanitized outcome instead of leaving an unclaimable retryable row behind.
  if p_status = 'retryable_failed' and v_delivery.attempt_count >= 5 then
    v_status := 'permanent_failed';
    v_diagnostic := 'retry_exhausted';
  end if;

  return query
  update public.meta_event_deliveries as delivery
  set status = v_status,
      payload_hash = v_payload_hash,
      meta_http_status = p_meta_http_status,
      meta_trace_id = case when v_status = 'sent' then v_diagnostic else null end,
      last_error_category = case when v_status = 'sent' then null else v_diagnostic end,
      sent_at = case when v_status = 'sent' then p_completed_at else null end,
      updated_at = p_completed_at
  where delivery.id = v_delivery.id
  returning delivery.*;
end;
$$;

revoke all on function public.record_public_privacy_consent(
  uuid, uuid, text, boolean, boolean, boolean, text, inet, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.consume_roof_assessment_result_view_limit(uuid, inet)
  from public, anon, authenticated, service_role;
revoke all on function public.acknowledge_roof_assessment_result_view(
  uuid, uuid, uuid, uuid, text, boolean, boolean, boolean, text, inet, text
) from public, anon, authenticated, service_role;
revoke all on function public.claim_meta_delivery(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.list_pending_meta_deliveries(integer, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_meta_delivery(uuid, text, integer, text, text, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function public.record_public_privacy_consent(
  uuid, uuid, text, boolean, boolean, boolean, text, inet, text, timestamptz
) to service_role;
grant execute on function public.consume_roof_assessment_result_view_limit(uuid, inet)
  to service_role;
grant execute on function public.acknowledge_roof_assessment_result_view(
  uuid, uuid, uuid, uuid, text, boolean, boolean, boolean, text, inet, text
) to service_role;
grant execute on function public.claim_meta_delivery(uuid, timestamptz)
  to service_role;
grant execute on function public.list_pending_meta_deliveries(integer, timestamptz)
  to service_role;
grant execute on function public.complete_meta_delivery(uuid, text, integer, text, text, timestamptz)
  to service_role;

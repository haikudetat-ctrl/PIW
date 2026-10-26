-- Google Search Ads attribution, conversion upload and spend.
--
--   1. website_arrivals learns the Google search landing slugs and stores
--      Google/Microsoft click IDs and ValueTrack values (pre-consent, no IP).
--   2. lead_ad_attribution: the verified first/last paid touch for each lead.
--   3. company_google_ads_settings: per-company account and conversion action
--      IDs, kill switches and the advertising consent model.
--   4. lead_quality_flags: managers mark junk leads; flagged leads are never
--      uploaded and recently sent conversions are retracted.
--   5. ad_conversion_deliveries: idempotent, consent-gated offline conversion
--      ledger (qualified lead, appointment set, appointment ran, sold).
--   6. ad_spend_daily + ad_spend_import_runs: daily Google Ads cost by
--      campaign and keyword, imported from the Google Ads API.
--   7. paid_media_alerts: one row per alert per day, so alerts never repeat.
--   8. report_paid_search: the manager-facing paid search report.
--   9. purge_expired_click_ids: raw click IDs are kept 13 months.
--
-- The Meta ledger (meta_event_deliveries) is deliberately untouched. This
-- ledger has a platform column so Meta can move onto it later without
-- changing the live Meta pipeline now.

-- -----------------------------------------------------------------------------
-- 1. website_arrivals
-- -----------------------------------------------------------------------------

alter table public.website_arrivals
  drop constraint if exists website_arrivals_campaign_slug_check;
alter table public.website_arrivals
  add constraint website_arrivals_campaign_slug_check check (
    campaign_slug is null or campaign_slug in (
      'weather-report', 'seasonal-shield', 'for-every-season',
      'roof-replacement', 'roof-replacement-cost', 'roofing-contractor'
    )
  );

alter table public.website_arrivals
  add column gclid text check (gclid is null or pg_catalog.length(gclid) <= 512),
  add column gbraid text check (gbraid is null or pg_catalog.length(gbraid) <= 512),
  add column wbraid text check (wbraid is null or pg_catalog.length(wbraid) <= 512),
  add column msclkid text check (msclkid is null or pg_catalog.length(msclkid) <= 512),
  add column gad_source text check (gad_source is null or pg_catalog.length(gad_source) <= 50),
  add column gad_campaignid text check (gad_campaignid is null or pg_catalog.length(gad_campaignid) <= 50),
  add column google_campaign_id text check (google_campaign_id is null or pg_catalog.length(google_campaign_id) <= 50),
  add column google_ad_group_id text check (google_ad_group_id is null or pg_catalog.length(google_ad_group_id) <= 50),
  add column google_keyword text check (google_keyword is null or pg_catalog.length(google_keyword) <= 200),
  add column google_match_type text check (google_match_type is null or pg_catalog.length(google_match_type) <= 20),
  add column google_creative_id text check (google_creative_id is null or pg_catalog.length(google_creative_id) <= 50),
  add column google_target_id text check (google_target_id is null or pg_catalog.length(google_target_id) <= 100),
  add column google_device text check (google_device is null or pg_catalog.length(google_device) <= 20),
  add column google_network text check (google_network is null or pg_catalog.length(google_network) <= 20),
  add column google_loc_physical_ms text check (google_loc_physical_ms is null or pg_catalog.length(google_loc_physical_ms) <= 50);

comment on column public.website_arrivals.gclid is
  'Google Ads click ID from the landing URL. Withheld by the website under Global Privacy Control; nulled after 13 months.';

create index website_arrivals_google_click_idx
  on public.website_arrivals (company_id, occurred_at desc)
  where gclid is not null or gbraid is not null or wbraid is not null;
create index website_arrivals_google_campaign_idx
  on public.website_arrivals (google_campaign_id, occurred_at desc)
  where google_campaign_id is not null;

-- -----------------------------------------------------------------------------
-- 2. lead_ad_attribution
-- -----------------------------------------------------------------------------

create table public.lead_ad_attribution (
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null,
  -- Internal credit: the last paid touch, click IDs outranking tags.
  channel text not null check (
    channel in ('google_ads', 'microsoft_ads', 'meta_ads', 'other_paid', 'untracked')
  ),
  -- The single Google click identifier sent with uploads (Google accepts one).
  click_id_type text check (click_id_type is null or click_id_type in ('gclid', 'gbraid', 'wbraid')),
  gclid text check (gclid is null or pg_catalog.length(gclid) <= 512),
  gbraid text check (gbraid is null or pg_catalog.length(gbraid) <= 512),
  wbraid text check (wbraid is null or pg_catalog.length(wbraid) <= 512),
  msclkid text check (msclkid is null or pg_catalog.length(msclkid) <= 512),
  fbclid text check (fbclid is null or pg_catalog.length(fbclid) <= 512),
  clicked_at timestamptz,
  landing_path text check (landing_path is null or pg_catalog.length(landing_path) <= 300),
  google_campaign_id text check (google_campaign_id is null or pg_catalog.length(google_campaign_id) <= 50),
  google_ad_group_id text check (google_ad_group_id is null or pg_catalog.length(google_ad_group_id) <= 50),
  google_keyword text check (google_keyword is null or pg_catalog.length(google_keyword) <= 200),
  google_match_type text check (google_match_type is null or pg_catalog.length(google_match_type) <= 20),
  google_target_id text check (google_target_id is null or pg_catalog.length(google_target_id) <= 100),
  google_creative_id text check (google_creative_id is null or pg_catalog.length(google_creative_id) <= 50),
  google_device text check (google_device is null or pg_catalog.length(google_device) <= 20),
  google_network text check (google_network is null or pg_catalog.length(google_network) <= 20),
  utm_source text check (utm_source is null or pg_catalog.length(utm_source) <= 200),
  utm_medium text check (utm_medium is null or pg_catalog.length(utm_medium) <= 200),
  utm_campaign text check (utm_campaign is null or pg_catalog.length(utm_campaign) <= 200),
  utm_term text check (utm_term is null or pg_catalog.length(utm_term) <= 200),
  utm_content text check (utm_content is null or pg_catalog.length(utm_content) <= 200),
  first_touch jsonb check (first_touch is null or pg_catalog.jsonb_typeof(first_touch) = 'object'),
  last_touch jsonb check (last_touch is null or pg_catalog.jsonb_typeof(last_touch) = 'object'),
  -- False when attribution came only from the legacy UTM/fbclid fields
  -- rather than the signed first-party token.
  token_verified boolean not null,
  recorded_at timestamptz not null default pg_catalog.now(),
  click_ids_purged_at timestamptz,
  primary key (company_id, lead_id),
  foreign key (company_id, lead_id) references public.leads(company_id, id) on delete cascade,
  check (
    (click_id_type is null)
    or (click_id_type = 'gclid' and gclid is not null)
    or (click_id_type = 'gbraid' and gbraid is not null)
    or (click_id_type = 'wbraid' and wbraid is not null)
  )
);

comment on table public.lead_ad_attribution is
  'Verified first/last paid touch per lead. Written once at lead acceptance. No contact details.';

create index lead_ad_attribution_channel_idx
  on public.lead_ad_attribution (company_id, channel, recorded_at desc);
create index lead_ad_attribution_google_ad_group_idx
  on public.lead_ad_attribution (company_id, google_ad_group_id)
  where google_ad_group_id is not null;

-- -----------------------------------------------------------------------------
-- 3. company_google_ads_settings
-- -----------------------------------------------------------------------------

create table public.company_google_ads_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  customer_id text not null check (customer_id ~ '^[0-9]{10}$'),
  -- The manager (MCC) account the OAuth user reaches this account through.
  login_customer_id text check (login_customer_id is null or login_customer_id ~ '^[0-9]{10}$'),
  uploads_enabled boolean not null default false,
  -- Dry run validates every payload against the real account with
  -- validateOnly and records nothing in Google Ads.
  dry_run boolean not null default true,
  -- Owner decision pending: sold conversions upload without revenue until on.
  send_conversion_values boolean not null default false,
  -- Uploads with hashed contact details but no click ID. Requires explicit
  -- Advertising consent regardless of the consent model.
  identifier_only_uploads boolean not null default false,
  -- opt_in: upload only with recorded Advertising consent.
  -- opt_out: upload unless the visitor declined or sent GPC.
  consent_model text not null default 'opt_in' check (consent_model in ('opt_in', 'opt_out')),
  qualified_lead_action_id text check (qualified_lead_action_id is null or qualified_lead_action_id ~ '^[0-9]{1,20}$'),
  appointment_set_action_id text check (appointment_set_action_id is null or appointment_set_action_id ~ '^[0-9]{1,20}$'),
  appointment_ran_action_id text check (appointment_ran_action_id is null or appointment_ran_action_id ~ '^[0-9]{1,20}$'),
  sold_action_id text check (sold_action_id is null or sold_action_id ~ '^[0-9]{1,20}$'),
  spend_import_enabled boolean not null default false,
  monthly_budget_usd numeric(12, 2) check (monthly_budget_usd is null or monthly_budget_usd > 0),
  currency_code text not null default 'USD' check (currency_code ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

comment on table public.company_google_ads_settings is
  'Google Ads account wiring per company. OAuth credentials live in the deployment environment, never here.';

-- -----------------------------------------------------------------------------
-- 4. lead_quality_flags
-- -----------------------------------------------------------------------------

create table public.lead_quality_flags (
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null,
  flag text not null check (
    flag in ('spam', 'invalid', 'duplicate', 'test', 'not_homeowner', 'out_of_area')
  ),
  note text check (note is null or pg_catalog.length(note) <= 500),
  flagged_by uuid references public.admin_profiles(id) on delete set null,
  flagged_at timestamptz not null default pg_catalog.now(),
  primary key (company_id, lead_id),
  foreign key (company_id, lead_id) references public.leads(company_id, id) on delete cascade
);

create function public.flag_lead_quality(p_lead_id uuid, p_flag text, p_note text default null)
returns public.lead_quality_flags
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := public.current_company_id();
  v_row public.lead_quality_flags;
begin
  if v_company_id is null or not public.has_company_role('manager') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.leads as lead
    where lead.id = p_lead_id and lead.company_id = v_company_id
  ) then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  insert into public.lead_quality_flags (company_id, lead_id, flag, note, flagged_by)
  values (v_company_id, p_lead_id, p_flag, nullif(pg_catalog.btrim(coalesce(p_note, '')), ''), (select auth.uid()))
  on conflict (company_id, lead_id) do update
    set flag = excluded.flag,
        note = excluded.note,
        flagged_by = excluded.flagged_by,
        flagged_at = pg_catalog.now()
  returning * into v_row;
  return v_row;
end;
$$;

create function public.clear_lead_quality_flag(p_lead_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := public.current_company_id();
begin
  if v_company_id is null or not public.has_company_role('manager') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  delete from public.lead_quality_flags
  where company_id = v_company_id and lead_id = p_lead_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. ad_conversion_deliveries
-- -----------------------------------------------------------------------------

create table public.ad_conversion_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null,
  platform text not null default 'google_ads' check (platform = 'google_ads'),
  event_name text not null check (
    event_name in ('qualified_lead', 'appointment_set', 'appointment_ran', 'sold')
  ),
  -- Sent as the conversion's orderId: Google deduplicates on it, and a
  -- retraction references it.
  order_id text not null check (order_id ~ '^[a-z]{2}-[0-9a-f]{32}$'),
  -- What produced the conversion, e.g. lead:<id>, appointment:<id>, jobnimbus_job:<jnid>.
  source_ref text not null check (pg_catalog.length(source_ref) between 1 and 200),
  conversion_time timestamptz not null,
  -- Stored for internal reporting; sent only when send_conversion_values is on.
  conversion_value numeric(12, 2) check (conversion_value is null or conversion_value >= 0),
  status text not null default 'pending' check (
    status in ('pending', 'sending', 'sent', 'retryable_failed', 'permanent_failed', 'skipped')
  ),
  skip_reason text check (skip_reason is null or pg_catalog.length(skip_reason) <= 64),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default pg_catalog.now(),
  http_status integer check (http_status is null or http_status between 100 and 599),
  last_error_category text check (last_error_category is null or pg_catalog.length(last_error_category) <= 128),
  payload_hash text check (payload_hash is null or payload_hash ~ '^[0-9a-f]{64}$'),
  request_id text check (request_id is null or pg_catalog.length(request_id) <= 128),
  last_attempted_at timestamptz,
  last_validated_at timestamptz,
  sent_at timestamptz,
  sent_with_value boolean,
  sent_with_identifiers boolean,
  retraction_status text not null default 'none' check (
    retraction_status in ('none', 'pending', 'sending', 'sent', 'failed')
  ),
  retraction_reason text check (retraction_reason is null or pg_catalog.length(retraction_reason) <= 64),
  retraction_attempt_count integer not null default 0 check (retraction_attempt_count >= 0),
  retracted_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (company_id, platform, lead_id, event_name),
  unique (platform, order_id),
  foreign key (company_id, lead_id) references public.leads(company_id, id) on delete cascade,
  check ((status = 'skipped') = (skip_reason is not null)),
  check (status <> 'sent' or sent_at is not null)
);

comment on table public.ad_conversion_deliveries is
  'Offline conversion upload ledger. No contact details and no outbound payload: only a payload hash.';

create index ad_conversion_deliveries_due_idx
  on public.ad_conversion_deliveries (next_attempt_at)
  where status in ('pending', 'retryable_failed', 'sending');
create index ad_conversion_deliveries_retraction_idx
  on public.ad_conversion_deliveries (updated_at)
  where retraction_status in ('pending', 'sending');
create index ad_conversion_deliveries_lead_idx
  on public.ad_conversion_deliveries (company_id, lead_id);

create function public.ad_conversion_order_id(p_event_name text, p_lead_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_event_name
      when 'qualified_lead' then 'ql'
      when 'appointment_set' then 'as'
      when 'appointment_ran' then 'ar'
      when 'sold' then 'sd'
    end || '-' || pg_catalog.replace(p_lead_id::text, '-', '')
$$;

-- Qualification and downstream-stage detection for every Google-attributed
-- lead. Set-based and idempotent: a lead/event pair is decided once, either
-- queued for upload or recorded as skipped with the reason.
create function public.enqueue_google_ads_conversions(p_company_id uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.company_google_ads_settings;
  v_qualified integer := 0;
  v_appointment_set integer := 0;
  v_appointment_ran integer := 0;
  v_sold integer := 0;
begin
  select * into v_settings
  from public.company_google_ads_settings
  where company_id = p_company_id;
  if not found or p_now is null then
    return pg_catalog.jsonb_build_object('enqueued', 0, 'configured', false);
  end if;

  -- Candidate leads: Google credit, a usable identifier, inside the 90 day
  -- click window, not a test lead.
  drop table if exists pg_temp.google_conversion_candidates;
  create temporary table google_conversion_candidates (
    lead_id uuid primary key,
    lead_created_at timestamptz,
    clicked_at timestamptz,
    phone_e164 text,
    email_normalized text,
    submitted_address text,
    flagged boolean,
    customer_id uuid
  ) on commit drop;

  insert into pg_temp.google_conversion_candidates
  select lead.id, lead.created_at, coalesce(attribution.clicked_at, lead.created_at),
    lead.phone_e164, lead.email_normalized, lead.submitted_address,
    exists (
      select 1 from public.lead_quality_flags as flag
      where flag.company_id = lead.company_id and flag.lead_id = lead.id
    ),
    (
      select identity.customer_id from public.customer_identities as identity
      where identity.company_id = lead.company_id
        and identity.source_system = 'piw_lead'
        and identity.external_id = lead.id::text
      limit 1
    )
  from public.lead_ad_attribution as attribution
  join public.leads as lead
    on lead.id = attribution.lead_id and lead.company_id = attribution.company_id
  where attribution.company_id = p_company_id
    and attribution.channel = 'google_ads'
    and not lead.is_test
    and (attribution.click_id_type is not null or v_settings.identifier_only_uploads)
    and coalesce(attribution.clicked_at, lead.created_at) > p_now - interval '90 days';

  -- Qualified lead ---------------------------------------------------------
  with decided as (
    select candidate.lead_id,
      candidate.lead_created_at as conversion_time,
      (
        select assessment.responses ->> 'ownership'
        from public.roof_assessments as assessment
        where assessment.company_id = p_company_id and assessment.lead_id = candidate.lead_id
          and assessment.responses ? 'ownership'
        order by assessment.updated_at desc
        limit 1
      ) as ownership,
      candidate
    from pg_temp.google_conversion_candidates as candidate
    where not exists (
      select 1 from public.ad_conversion_deliveries as delivery
      where delivery.company_id = p_company_id
        and delivery.platform = 'google_ads'
        and delivery.lead_id = candidate.lead_id
        and delivery.event_name = 'qualified_lead'
    )
  ),
  judged as (
    select decided.lead_id, decided.conversion_time,
      case
        when (decided.candidate).flagged then 'lead_flagged'
        when decided.ownership in ('manager', 'not_owner') then 'not_homeowner'
        when coalesce((decided.candidate).phone_e164, '') !~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$' then 'invalid_phone'
        when coalesce((decided.candidate).submitted_address, '') !~* '(\mNJ\M|new jersey)' then 'out_of_area'
        when exists (
          select 1 from public.leads as earlier
          where earlier.company_id = p_company_id
            and earlier.id <> decided.lead_id
            and not earlier.is_test
            and earlier.created_at < (decided.candidate).lead_created_at
            and earlier.created_at >= (decided.candidate).lead_created_at - interval '30 days'
            and (
              (earlier.phone_e164 is not null and earlier.phone_e164 = (decided.candidate).phone_e164)
              or (earlier.email_normalized is not null and earlier.email_normalized = (decided.candidate).email_normalized)
            )
        ) then 'duplicate_30_days'
        when (decided.candidate).customer_id is not null and exists (
          select 1 from public.customer_journey_events as event
          where event.company_id = p_company_id
            and event.customer_id = (decided.candidate).customer_id
            and event.stage = 'sold'
            and event.occurred_at < (decided.candidate).lead_created_at
        ) then 'existing_customer'
        else null
      end as skip_reason,
      -- Ownership is asked late in the flow. Wait a day for an answer; after
      -- that an unanswered lead still qualifies on the other checks.
      decided.ownership is not null
        or (decided.candidate).lead_created_at <= p_now - interval '24 hours' as ready
    from decided
  )
  insert into public.ad_conversion_deliveries (
    company_id, lead_id, event_name, order_id, source_ref, conversion_time,
    status, skip_reason, next_attempt_at, created_at, updated_at
  )
  select p_company_id, judged.lead_id, 'qualified_lead',
    public.ad_conversion_order_id('qualified_lead', judged.lead_id),
    'lead:' || judged.lead_id::text, judged.conversion_time,
    case when judged.skip_reason is null then 'pending' else 'skipped' end,
    judged.skip_reason, p_now, p_now, p_now
  from judged
  where judged.ready or judged.skip_reason is not null
  on conflict do nothing;
  get diagnostics v_qualified = row_count;

  -- Appointment set: a PIW appointment, or the journey stage from JobNimbus.
  with stage_times as (
    select candidate.lead_id, candidate.clicked_at, candidate.flagged,
      least(
        (
          select pg_catalog.min(appointment.created_at)
          from public.appointments as appointment
          where appointment.company_id = p_company_id
            and appointment.lead_id = candidate.lead_id
            and appointment.status::text <> 'cancelled'
        ),
        (
          select pg_catalog.min(event.occurred_at)
          from public.customer_journey_events as event
          where event.company_id = p_company_id
            and event.customer_id = candidate.customer_id
            and event.stage = 'appointment_set'
            and not event.is_approximate
        )
      ) as occurred_at
    from pg_temp.google_conversion_candidates as candidate
  )
  insert into public.ad_conversion_deliveries (
    company_id, lead_id, event_name, order_id, source_ref, conversion_time, status, skip_reason,
    next_attempt_at, created_at, updated_at
  )
  select p_company_id, stage_times.lead_id, 'appointment_set',
    public.ad_conversion_order_id('appointment_set', stage_times.lead_id),
    'lead:' || stage_times.lead_id::text, stage_times.occurred_at,
    case
      when stage_times.flagged or stage_times.occurred_at < stage_times.clicked_at
        or stage_times.occurred_at > stage_times.clicked_at + interval '90 days' then 'skipped'
      else 'pending'
    end,
    case
      when stage_times.flagged then 'lead_flagged'
      when stage_times.occurred_at < stage_times.clicked_at then 'before_click'
      when stage_times.occurred_at > stage_times.clicked_at + interval '90 days' then 'outside_click_window'
    end,
    p_now, p_now, p_now
  from stage_times
  where stage_times.occurred_at is not null and stage_times.occurred_at <= p_now
  on conflict do nothing;
  get diagnostics v_appointment_set = row_count;

  -- Appointment ran: a completed PIW appointment, the journey stage, or a
  -- quote (a roofing quote means the appointment happened).
  with stage_times as (
    select candidate.lead_id, candidate.clicked_at, candidate.flagged,
      least(
        (
          select pg_catalog.min(appointment.scheduled_at)
          from public.appointments as appointment
          where appointment.company_id = p_company_id
            and appointment.lead_id = candidate.lead_id
            and appointment.status::text = 'completed'
        ),
        (
          select pg_catalog.min(event.occurred_at)
          from public.customer_journey_events as event
          where event.company_id = p_company_id
            and event.customer_id = candidate.customer_id
            and event.stage in ('appointment_ran', 'quoted')
            and not event.is_approximate
        )
      ) as occurred_at
    from pg_temp.google_conversion_candidates as candidate
  )
  insert into public.ad_conversion_deliveries (
    company_id, lead_id, event_name, order_id, source_ref, conversion_time, status, skip_reason,
    next_attempt_at, created_at, updated_at
  )
  select p_company_id, stage_times.lead_id, 'appointment_ran',
    public.ad_conversion_order_id('appointment_ran', stage_times.lead_id),
    'lead:' || stage_times.lead_id::text, stage_times.occurred_at,
    case
      when stage_times.flagged or stage_times.occurred_at < stage_times.clicked_at
        or stage_times.occurred_at > stage_times.clicked_at + interval '90 days' then 'skipped'
      else 'pending'
    end,
    case
      when stage_times.flagged then 'lead_flagged'
      when stage_times.occurred_at < stage_times.clicked_at then 'before_click'
      when stage_times.occurred_at > stage_times.clicked_at + interval '90 days' then 'outside_click_window'
    end,
    p_now, p_now, p_now
  from stage_times
  where stage_times.occurred_at is not null and stage_times.occurred_at <= p_now
  on conflict do nothing;
  get diagnostics v_appointment_ran = row_count;

  -- Sold: the journey stage on a JobNimbus job, valued at the approved total.
  with sold as (
    select distinct on (candidate.lead_id)
      candidate.lead_id, candidate.clicked_at, candidate.flagged,
      event.occurred_at, event.source_ref as jnid, job.approved_total
    from pg_temp.google_conversion_candidates as candidate
    join public.customer_journey_events as event
      on event.company_id = p_company_id
     and event.customer_id = candidate.customer_id
     and event.stage = 'sold'
     and event.source_system = 'jobnimbus_job'
    left join public.jn_jobs as job
      on job.company_id = p_company_id and job.jnid = event.source_ref
    order by candidate.lead_id, event.is_approximate, event.occurred_at
  )
  insert into public.ad_conversion_deliveries (
    company_id, lead_id, event_name, order_id, source_ref, conversion_time,
    conversion_value, status, skip_reason, next_attempt_at, created_at, updated_at
  )
  select p_company_id, sold.lead_id, 'sold',
    public.ad_conversion_order_id('sold', sold.lead_id),
    'jobnimbus_job:' || sold.jnid, sold.occurred_at,
    case when sold.approved_total > 0 then sold.approved_total end,
    case
      when sold.flagged or sold.occurred_at < sold.clicked_at
        or sold.occurred_at > sold.clicked_at + interval '90 days' then 'skipped'
      else 'pending'
    end,
    case
      when sold.flagged then 'lead_flagged'
      when sold.occurred_at < sold.clicked_at then 'before_click'
      when sold.occurred_at > sold.clicked_at + interval '90 days' then 'outside_click_window'
    end,
    p_now, p_now, p_now
  from sold
  where sold.occurred_at <= p_now
  on conflict do nothing;
  get diagnostics v_sold = row_count;

  -- A lead flagged after its conversions were queued: stop unsent ones, and
  -- retract ones sent within the last 14 days.
  update public.ad_conversion_deliveries as delivery
  set status = 'skipped', skip_reason = 'lead_flagged', updated_at = p_now
  from public.lead_quality_flags as flag
  where delivery.company_id = p_company_id
    and flag.company_id = delivery.company_id
    and flag.lead_id = delivery.lead_id
    and delivery.status in ('pending', 'retryable_failed');

  update public.ad_conversion_deliveries as delivery
  set retraction_status = 'pending',
      retraction_reason = 'lead_flagged:' || flag.flag,
      updated_at = p_now
  from public.lead_quality_flags as flag
  where delivery.company_id = p_company_id
    and flag.company_id = delivery.company_id
    and flag.lead_id = delivery.lead_id
    and delivery.status = 'sent'
    and delivery.retraction_status = 'none'
    and flag.flagged_at <= delivery.sent_at + interval '14 days';

  return pg_catalog.jsonb_build_object(
    'configured', true,
    'qualified_lead', v_qualified,
    'appointment_set', v_appointment_set,
    'appointment_ran', v_appointment_ran,
    'sold', v_sold,
    'enqueued', v_qualified + v_appointment_set + v_appointment_ran + v_sold
  );
end;
$$;

-- Consent for an upload, evaluated at send time. 'granted' and 'denied' come
-- from the newest evidence for the consent ID last recorded on the lead, so a
-- later revocation from the banner is honored. 'unknown' means no evidence.
create function public.ad_conversion_consent_state(p_company_id uuid, p_lead_id uuid, p_at timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with lead_consent as (
    select evidence.consent_id, evidence.policy_version
    from public.privacy_consent_evidence as evidence
    where evidence.company_id = p_company_id and evidence.lead_id = p_lead_id
      and evidence.occurred_at <= p_at
    order by evidence.occurred_at desc, evidence.created_at desc
    limit 1
  ),
  current_consent as (
    select evidence.advertising_granted, evidence.gpc_detected
    from public.privacy_consent_evidence as evidence
    join lead_consent
      on lead_consent.consent_id = evidence.consent_id
     and lead_consent.policy_version = evidence.policy_version
    where evidence.occurred_at <= p_at
    order by evidence.occurred_at desc, evidence.created_at desc
    limit 1
  )
  select coalesce(
    (select case when advertising_granted and not gpc_detected then 'granted' else 'denied' end from current_consent),
    'unknown'
  )
$$;

create function public.list_due_ad_conversions(p_limit integer, p_now timestamptz)
returns table (id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select delivery.id
  from public.ad_conversion_deliveries as delivery
  join public.company_google_ads_settings as settings
    on settings.company_id = delivery.company_id
  where settings.uploads_enabled
    and delivery.next_attempt_at <= p_now
    and (
      delivery.status in ('pending', 'retryable_failed')
      or (delivery.status = 'sending' and delivery.last_attempted_at <= p_now - interval '10 minutes')
    )
  order by delivery.next_attempt_at
  limit least(greatest(coalesce(p_limit, 1), 1), 100)
$$;

-- Locks one delivery for sending and returns everything the sender needs.
-- Contact details leave the database only here, only to be hashed in memory.
create function public.claim_ad_conversion(p_delivery_id uuid, p_now timestamptz)
returns table (
  id uuid,
  company_id uuid,
  lead_id uuid,
  event_name text,
  order_id text,
  conversion_time timestamptz,
  conversion_value numeric,
  attempt_count integer,
  created_at timestamptz,
  customer_id text,
  login_customer_id text,
  conversion_action_id text,
  dry_run boolean,
  send_conversion_values boolean,
  identifier_only_uploads boolean,
  consent_model text,
  currency_code text,
  consent_state text,
  click_id_type text,
  click_id text,
  email text,
  phone_e164 text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidate as (
    select delivery.id
    from public.ad_conversion_deliveries as delivery
    join public.company_google_ads_settings as settings
      on settings.company_id = delivery.company_id
    where delivery.id = p_delivery_id
      and settings.uploads_enabled
      and delivery.next_attempt_at <= p_now
      and (
        delivery.status in ('pending', 'retryable_failed')
        or (delivery.status = 'sending' and delivery.last_attempted_at <= p_now - interval '10 minutes')
      )
    for update of delivery skip locked
  ),
  claimed as (
    update public.ad_conversion_deliveries as delivery
    set status = 'sending',
        attempt_count = delivery.attempt_count + 1,
        last_attempted_at = p_now,
        updated_at = p_now
    from candidate
    where delivery.id = candidate.id
    returning delivery.*
  )
  select claimed.id, claimed.company_id, claimed.lead_id, claimed.event_name,
    claimed.order_id, claimed.conversion_time, claimed.conversion_value,
    claimed.attempt_count, claimed.created_at,
    settings.customer_id, settings.login_customer_id,
    case claimed.event_name
      when 'qualified_lead' then settings.qualified_lead_action_id
      when 'appointment_set' then settings.appointment_set_action_id
      when 'appointment_ran' then settings.appointment_ran_action_id
      when 'sold' then settings.sold_action_id
    end,
    settings.dry_run, settings.send_conversion_values, settings.identifier_only_uploads,
    settings.consent_model, settings.currency_code,
    public.ad_conversion_consent_state(claimed.company_id, claimed.lead_id, p_now),
    attribution.click_id_type,
    case attribution.click_id_type
      when 'gclid' then attribution.gclid
      when 'gbraid' then attribution.gbraid
      when 'wbraid' then attribution.wbraid
    end,
    lead.email, lead.phone_e164
  from claimed
  join public.company_google_ads_settings as settings on settings.company_id = claimed.company_id
  join public.leads as lead on lead.id = claimed.lead_id and lead.company_id = claimed.company_id
  left join public.lead_ad_attribution as attribution
    on attribution.company_id = claimed.company_id and attribution.lead_id = claimed.lead_id;
end;
$$;

-- Outcomes: sent | validated (dry run passed) | deferred (waiting for
-- consent or configuration) | retryable_failed | permanent_failed | skipped.
create function public.complete_ad_conversion(
  p_delivery_id uuid,
  p_outcome text,
  p_now timestamptz,
  p_http_status integer default null,
  p_error_category text default null,
  p_payload_hash text default null,
  p_request_id text default null,
  p_skip_reason text default null,
  p_sent_with_value boolean default null,
  p_sent_with_identifiers boolean default null
)
returns setof public.ad_conversion_deliveries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.ad_conversion_deliveries;
  v_backoff interval;
begin
  select * into v_delivery from public.ad_conversion_deliveries
  where id = p_delivery_id
  for update;
  if not found then
    return;
  end if;
  if v_delivery.status <> 'sending' then
    raise exception 'Delivery % is not being sent', p_delivery_id;
  end if;

  v_backoff := case
    when v_delivery.attempt_count <= 1 then interval '5 minutes'
    when v_delivery.attempt_count = 2 then interval '30 minutes'
    when v_delivery.attempt_count = 3 then interval '2 hours'
    when v_delivery.attempt_count = 4 then interval '12 hours'
    else interval '24 hours'
  end;

  if p_outcome = 'sent' then
    update public.ad_conversion_deliveries
    set status = 'sent', sent_at = p_now, http_status = p_http_status,
        payload_hash = p_payload_hash, request_id = p_request_id,
        last_error_category = null, sent_with_value = p_sent_with_value,
        sent_with_identifiers = p_sent_with_identifiers, updated_at = p_now
    where id = p_delivery_id
    returning * into v_delivery;
  elsif p_outcome = 'validated' then
    -- Dry run: valid against the real account, nothing recorded. Check again
    -- daily so the payload is still valid when dry run is switched off.
    update public.ad_conversion_deliveries
    set status = 'pending', last_validated_at = p_now, http_status = p_http_status,
        payload_hash = p_payload_hash, request_id = p_request_id,
        last_error_category = null, attempt_count = 0,
        next_attempt_at = p_now + interval '1 day', updated_at = p_now
    where id = p_delivery_id
    returning * into v_delivery;
  elsif p_outcome = 'deferred' then
    -- No consent decision yet (opt-in) or the conversion action is not set:
    -- wait, then give up after 14 days.
    update public.ad_conversion_deliveries
    set status = case when v_delivery.created_at <= p_now - interval '14 days' then 'skipped' else 'pending' end,
        skip_reason = case when v_delivery.created_at <= p_now - interval '14 days'
          then coalesce(p_skip_reason, 'deferred_too_long') end,
        last_error_category = p_error_category,
        attempt_count = 0,
        next_attempt_at = p_now + interval '6 hours',
        updated_at = p_now
    where id = p_delivery_id
    returning * into v_delivery;
  elsif p_outcome = 'retryable_failed' then
    update public.ad_conversion_deliveries
    set status = case when v_delivery.attempt_count >= 6 then 'permanent_failed' else 'retryable_failed' end,
        http_status = p_http_status, last_error_category = p_error_category,
        payload_hash = coalesce(p_payload_hash, payload_hash), request_id = p_request_id,
        next_attempt_at = p_now + v_backoff, updated_at = p_now
    where id = p_delivery_id
    returning * into v_delivery;
  elsif p_outcome = 'permanent_failed' then
    update public.ad_conversion_deliveries
    set status = 'permanent_failed', http_status = p_http_status,
        last_error_category = p_error_category,
        payload_hash = coalesce(p_payload_hash, payload_hash), request_id = p_request_id,
        updated_at = p_now
    where id = p_delivery_id
    returning * into v_delivery;
  elsif p_outcome = 'skipped' then
    update public.ad_conversion_deliveries
    set status = 'skipped', skip_reason = coalesce(p_skip_reason, 'skipped'),
        last_error_category = p_error_category, updated_at = p_now
    where id = p_delivery_id
    returning * into v_delivery;
  else
    raise exception 'Unknown delivery outcome %', p_outcome;
  end if;

  return next v_delivery;
end;
$$;

create function public.list_due_ad_conversion_retractions(p_limit integer, p_now timestamptz)
returns table (
  id uuid,
  company_id uuid,
  order_id text,
  event_name text,
  customer_id text,
  login_customer_id text,
  conversion_action_id text,
  dry_run boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select delivery.id, delivery.company_id, delivery.order_id, delivery.event_name,
    settings.customer_id, settings.login_customer_id,
    case delivery.event_name
      when 'qualified_lead' then settings.qualified_lead_action_id
      when 'appointment_set' then settings.appointment_set_action_id
      when 'appointment_ran' then settings.appointment_ran_action_id
      when 'sold' then settings.sold_action_id
    end,
    settings.dry_run
  from public.ad_conversion_deliveries as delivery
  join public.company_google_ads_settings as settings on settings.company_id = delivery.company_id
  where settings.uploads_enabled
    and delivery.status = 'sent'
    and delivery.retraction_status = 'pending'
    and delivery.retraction_attempt_count < 5
  order by delivery.updated_at
  limit least(greatest(coalesce(p_limit, 1), 1), 100)
$$;

create function public.complete_ad_conversion_retraction(
  p_delivery_id uuid,
  p_succeeded boolean,
  p_now timestamptz,
  p_error_category text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ad_conversion_deliveries
  set retraction_status = case
        when p_succeeded then 'sent'
        when retraction_attempt_count + 1 >= 5 then 'failed'
        else 'pending'
      end,
      retraction_attempt_count = retraction_attempt_count + 1,
      retracted_at = case when p_succeeded then p_now end,
      last_error_category = case when p_succeeded then last_error_category else p_error_category end,
      updated_at = p_now
  where id = p_delivery_id and retraction_status = 'pending'
$$;

-- -----------------------------------------------------------------------------
-- 6. Spend
-- -----------------------------------------------------------------------------

create table public.ad_spend_daily (
  company_id uuid not null references public.companies(id) on delete cascade,
  platform text not null default 'google_ads' check (platform = 'google_ads'),
  spend_date date not null,
  -- 'campaign' rows hold every dollar; 'keyword' rows break search spend down.
  grain text not null check (grain in ('campaign', 'keyword')),
  campaign_id text not null check (campaign_id ~ '^[0-9]{1,20}$'),
  campaign_name text check (campaign_name is null or pg_catalog.length(campaign_name) <= 300),
  ad_group_id text not null default '' check (ad_group_id = '' or ad_group_id ~ '^[0-9]{1,20}$'),
  ad_group_name text check (ad_group_name is null or pg_catalog.length(ad_group_name) <= 300),
  criterion_id text not null default '' check (criterion_id = '' or criterion_id ~ '^[0-9]{1,20}$'),
  keyword_text text check (keyword_text is null or pg_catalog.length(keyword_text) <= 300),
  match_type text check (match_type is null or pg_catalog.length(match_type) <= 30),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  clicks integer not null default 0 check (clicks >= 0),
  impressions integer not null default 0 check (impressions >= 0),
  platform_conversions numeric(14, 4) not null default 0,
  currency_code text not null default 'USD' check (currency_code ~ '^[A-Z]{3}$'),
  imported_at timestamptz not null default pg_catalog.now(),
  primary key (company_id, platform, spend_date, grain, campaign_id, ad_group_id, criterion_id),
  check (grain = 'campaign' or (ad_group_id <> '' and criterion_id <> ''))
);

create index ad_spend_daily_date_idx on public.ad_spend_daily (company_id, spend_date desc);

create table public.ad_spend_import_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  platform text not null default 'google_ads' check (platform = 'google_ads'),
  started_at timestamptz not null default pg_catalog.now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  date_from date not null,
  date_to date not null,
  rows_upserted integer check (rows_upserted is null or rows_upserted >= 0),
  error_category text check (error_category is null or pg_catalog.length(error_category) <= 128),
  check (date_to >= date_from)
);

create index ad_spend_import_runs_company_idx on public.ad_spend_import_runs (company_id, started_at desc);

-- -----------------------------------------------------------------------------
-- 7. Alerts
-- -----------------------------------------------------------------------------

create table public.paid_media_alerts (
  company_id uuid not null references public.companies(id) on delete cascade,
  alert_key text not null check (pg_catalog.length(alert_key) between 1 and 64),
  alert_date date not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  message text not null check (pg_catalog.length(message) <= 1000),
  delivered boolean not null default false,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (company_id, alert_key, alert_date)
);

-- Health numbers the alert job evaluates. Service role only.
create function public.paid_search_health(p_company_id uuid, p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      ((p_now at time zone 'America/New_York')::date - 1) as yesterday,
      pg_catalog.date_trunc('month', p_now at time zone 'America/New_York')::date as month_start,
      (p_now at time zone 'America/New_York')::date as today
  )
  select pg_catalog.jsonb_build_object(
    'spend_48h_usd', coalesce((
      select pg_catalog.sum(spend.cost_micros) / 1000000.0
      from public.ad_spend_daily as spend, bounds
      where spend.company_id = p_company_id and spend.grain = 'campaign'
        and spend.spend_date >= bounds.today - 2
    ), 0),
    'google_leads_48h', (
      select pg_catalog.count(*) from public.lead_ad_attribution as attribution
      where attribution.company_id = p_company_id and attribution.channel = 'google_ads'
        and attribution.recorded_at >= p_now - interval '48 hours'
    ),
    'clicks_yesterday', coalesce((
      select pg_catalog.sum(spend.clicks)
      from public.ad_spend_daily as spend, bounds
      where spend.company_id = p_company_id and spend.grain = 'campaign'
        and spend.spend_date = bounds.yesterday
    ), 0),
    'google_arrivals_yesterday', (
      select pg_catalog.count(*)
      from public.website_arrivals as arrival, bounds
      where arrival.company_id = p_company_id
        and not arrival.is_likely_bot
        and (arrival.gclid is not null or arrival.gbraid is not null or arrival.wbraid is not null)
        and (arrival.occurred_at at time zone 'America/New_York')::date = bounds.yesterday
    ),
    'month_to_date_spend_usd', coalesce((
      select pg_catalog.sum(spend.cost_micros) / 1000000.0
      from public.ad_spend_daily as spend, bounds
      where spend.company_id = p_company_id and spend.grain = 'campaign'
        and spend.spend_date >= bounds.month_start
    ), 0),
    'monthly_budget_usd', (
      select settings.monthly_budget_usd from public.company_google_ads_settings as settings
      where settings.company_id = p_company_id
    ),
    'day_of_month', (select extract(day from bounds.today)::integer from bounds),
    'days_in_month', (
      select extract(day from (bounds.month_start + interval '1 month - 1 day'))::integer from bounds
    ),
    'uploads_permanent_failed_24h', (
      select pg_catalog.count(*) from public.ad_conversion_deliveries as delivery
      where delivery.company_id = p_company_id and delivery.status = 'permanent_failed'
        and delivery.updated_at >= p_now - interval '24 hours'
    ),
    'uploads_retrying_over_6h', (
      select pg_catalog.count(*) from public.ad_conversion_deliveries as delivery
      where delivery.company_id = p_company_id and delivery.status = 'retryable_failed'
        and delivery.created_at <= p_now - interval '6 hours'
    ),
    'retractions_failed', (
      select pg_catalog.count(*) from public.ad_conversion_deliveries as delivery
      where delivery.company_id = p_company_id and delivery.retraction_status = 'failed'
        and delivery.updated_at >= p_now - interval '24 hours'
    ),
    'last_spend_import_succeeded_at', (
      select pg_catalog.max(run.finished_at) from public.ad_spend_import_runs as run
      where run.company_id = p_company_id and run.status = 'succeeded'
    ),
    'spend_import_enabled', coalesce((
      select settings.spend_import_enabled from public.company_google_ads_settings as settings
      where settings.company_id = p_company_id
    ), false)
  )
$$;

-- -----------------------------------------------------------------------------
-- 8. Manager report
-- -----------------------------------------------------------------------------

create function public.report_paid_search(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := public.current_company_id();
  v_from_date date := (p_from at time zone 'America/New_York')::date;
  v_to_date date := (p_to at time zone 'America/New_York')::date;
begin
  if v_company_id is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return (
    with google_leads as (
      select attribution.lead_id, attribution.recorded_at, attribution.google_campaign_id,
        attribution.google_ad_group_id, attribution.google_keyword, attribution.google_match_type,
        attribution.google_target_id, attribution.click_id_type, attribution.landing_path,
        lead.created_at, lead.is_test
      from public.lead_ad_attribution as attribution
      join public.leads as lead
        on lead.id = attribution.lead_id and lead.company_id = attribution.company_id
      where attribution.company_id = v_company_id
        and attribution.channel = 'google_ads'
        and lead.created_at >= p_from and lead.created_at < p_to
        and not lead.is_test
    ),
    stages as (
      select delivery.lead_id,
        bool_or(delivery.event_name = 'qualified_lead' and delivery.status <> 'skipped') as qualified,
        bool_or(delivery.event_name = 'appointment_set' and delivery.status <> 'skipped') as appointment_set,
        bool_or(delivery.event_name = 'appointment_ran' and delivery.status <> 'skipped') as appointment_ran,
        bool_or(delivery.event_name = 'sold' and delivery.status <> 'skipped') as sold,
        pg_catalog.sum(delivery.conversion_value) filter (
          where delivery.event_name = 'sold' and delivery.status <> 'skipped'
        ) as revenue
      from public.ad_conversion_deliveries as delivery
      where delivery.company_id = v_company_id
        and delivery.lead_id in (select lead_id from google_leads)
      group by delivery.lead_id
    ),
    flags as (
      select flag.lead_id, flag.flag
      from public.lead_quality_flags as flag
      where flag.company_id = v_company_id and flag.lead_id in (select lead_id from google_leads)
    ),
    spend as (
      select spend.spend_date, pg_catalog.sum(spend.cost_micros) / 1000000.0 as cost,
        pg_catalog.sum(spend.clicks) as clicks, pg_catalog.sum(spend.impressions) as impressions
      from public.ad_spend_daily as spend
      where spend.company_id = v_company_id and spend.grain = 'campaign'
        and spend.spend_date >= v_from_date and spend.spend_date < v_to_date
      group by spend.spend_date
    ),
    arrivals as (
      select (arrival.occurred_at at time zone 'America/New_York')::date as arrival_date,
        pg_catalog.count(*) as arrivals
      from public.website_arrivals as arrival
      where arrival.company_id = v_company_id
        and arrival.occurred_at >= p_from and arrival.occurred_at < p_to
        and not arrival.is_likely_bot
        and (arrival.gclid is not null or arrival.gbraid is not null or arrival.wbraid is not null)
      group by 1
    ),
    leads_by_day as (
      select (google_leads.created_at at time zone 'America/New_York')::date as lead_date,
        pg_catalog.count(*) as leads,
        pg_catalog.count(*) filter (where coalesce(stages.qualified, false)) as qualified
      from google_leads
      left join stages on stages.lead_id = google_leads.lead_id
      group by 1
    ),
    days as (
      select day::date as day
      from pg_catalog.generate_series(v_from_date::timestamp, (v_to_date - 1)::timestamp, interval '1 day') as day
    ),
    keyword_spend as (
      select spend.ad_group_id, spend.criterion_id,
        pg_catalog.max(spend.ad_group_name) as ad_group_name,
        pg_catalog.max(spend.keyword_text) as keyword_text,
        pg_catalog.max(spend.match_type) as match_type,
        pg_catalog.sum(spend.cost_micros) / 1000000.0 as cost,
        pg_catalog.sum(spend.clicks) as clicks
      from public.ad_spend_daily as spend
      where spend.company_id = v_company_id and spend.grain = 'keyword'
        and spend.spend_date >= v_from_date and spend.spend_date < v_to_date
      group by spend.ad_group_id, spend.criterion_id
    ),
    keyword_leads as (
      select google_leads.google_ad_group_id as ad_group_id,
        pg_catalog.substring(google_leads.google_target_id, 'kwd-([0-9]+)') as criterion_id,
        pg_catalog.max(google_leads.google_keyword) as keyword_text,
        pg_catalog.count(*) as leads,
        pg_catalog.count(*) filter (where coalesce(stages.qualified, false)) as qualified,
        pg_catalog.count(*) filter (where coalesce(stages.appointment_set, false)) as appointments,
        pg_catalog.count(*) filter (where coalesce(stages.sold, false)) as sold
      from google_leads
      left join stages on stages.lead_id = google_leads.lead_id
      group by 1, 2
    ),
    keywords as (
      select
        coalesce(keyword_spend.ad_group_id, keyword_leads.ad_group_id) as ad_group_id,
        coalesce(keyword_spend.criterion_id, keyword_leads.criterion_id) as criterion_id,
        keyword_spend.ad_group_name,
        coalesce(keyword_spend.keyword_text, keyword_leads.keyword_text) as keyword_text,
        keyword_spend.match_type,
        coalesce(keyword_spend.cost, 0) as cost,
        coalesce(keyword_spend.clicks, 0) as clicks,
        coalesce(keyword_leads.leads, 0) as leads,
        coalesce(keyword_leads.qualified, 0) as qualified,
        coalesce(keyword_leads.appointments, 0) as appointments,
        coalesce(keyword_leads.sold, 0) as sold
      from keyword_spend
      full join keyword_leads
        on keyword_leads.ad_group_id = keyword_spend.ad_group_id
       and keyword_leads.criterion_id = keyword_spend.criterion_id
    )
    select pg_catalog.jsonb_build_object(
      'spend', coalesce((select pg_catalog.sum(cost) from spend), 0),
      'clicks', coalesce((select pg_catalog.sum(clicks) from spend), 0),
      'impressions', coalesce((select pg_catalog.sum(impressions) from spend), 0),
      'arrivals', coalesce((select pg_catalog.sum(arrivals) from arrivals), 0),
      'leads', (select pg_catalog.count(*) from google_leads),
      'qualified', (select pg_catalog.count(*) from stages where qualified),
      'appointments_set', (select pg_catalog.count(*) from stages where appointment_set),
      'appointments_ran', (select pg_catalog.count(*) from stages where appointment_ran),
      'sold', (select pg_catalog.count(*) from stages where sold),
      'revenue', coalesce((select pg_catalog.sum(revenue) from stages), 0),
      'flagged', (select pg_catalog.count(*) from flags),
      'last_spend_import_at', (
        select pg_catalog.max(run.finished_at) from public.ad_spend_import_runs as run
        where run.company_id = v_company_id and run.status = 'succeeded'
      ),
      'daily', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'date', days.day,
          'spend', coalesce(spend.cost, 0),
          'clicks', coalesce(spend.clicks, 0),
          'arrivals', coalesce(arrivals.arrivals, 0),
          'leads', coalesce(leads_by_day.leads, 0),
          'qualified', coalesce(leads_by_day.qualified, 0)
        ) order by days.day)
        from days
        left join spend on spend.spend_date = days.day
        left join arrivals on arrivals.arrival_date = days.day
        left join leads_by_day on leads_by_day.lead_date = days.day
      ), '[]'::jsonb),
      'keywords', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(keywords) order by keywords.cost desc, keywords.leads desc)
        from keywords
      ), '[]'::jsonb),
      'deliveries', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'event_name', grouped.event_name, 'status', grouped.status, 'count', grouped.total
        ))
        from (
          select delivery.event_name, delivery.status, pg_catalog.count(*) as total
          from public.ad_conversion_deliveries as delivery
          where delivery.company_id = v_company_id and delivery.created_at >= p_from
          group by delivery.event_name, delivery.status
        ) as grouped
      ), '[]'::jsonb),
      'recent_leads', coalesce((
        select pg_catalog.jsonb_agg(row_to_json(recent)::jsonb order by recent.created_at desc)
        from (
          select google_leads.lead_id, google_leads.created_at, google_leads.google_keyword,
            google_leads.google_match_type, google_leads.landing_path, google_leads.click_id_type,
            coalesce(stages.qualified, false) as qualified,
            coalesce(stages.appointment_set, false) as appointment_set,
            coalesce(stages.sold, false) as sold,
            flags.flag
          from google_leads
          left join stages on stages.lead_id = google_leads.lead_id
          left join flags on flags.lead_id = google_leads.lead_id
          order by google_leads.created_at desc
          limit 50
        ) as recent
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Retention
-- -----------------------------------------------------------------------------

create function public.purge_expired_click_ids(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := p_now - interval '13 months';
  v_arrivals integer;
  v_attribution integer;
begin
  update public.website_arrivals
  set gclid = null, gbraid = null, wbraid = null, msclkid = null, fbclid = null
  where occurred_at < v_cutoff
    and (gclid is not null or gbraid is not null or wbraid is not null or msclkid is not null or fbclid is not null);
  get diagnostics v_arrivals = row_count;

  update public.lead_ad_attribution
  set gclid = null, gbraid = null, wbraid = null, msclkid = null, fbclid = null,
      click_id_type = null,
      first_touch = first_touch - array['gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid'],
      last_touch = last_touch - array['gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid'],
      click_ids_purged_at = p_now
  where recorded_at < v_cutoff and click_ids_purged_at is null;
  get diagnostics v_attribution = row_count;

  return pg_catalog.jsonb_build_object('arrivals', v_arrivals, 'lead_attribution', v_attribution);
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------

alter table public.lead_ad_attribution enable row level security;
alter table public.company_google_ads_settings enable row level security;
alter table public.lead_quality_flags enable row level security;
alter table public.ad_conversion_deliveries enable row level security;
alter table public.ad_spend_daily enable row level security;
alter table public.ad_spend_import_runs enable row level security;
alter table public.paid_media_alerts enable row level security;

revoke all on table
  public.lead_ad_attribution,
  public.company_google_ads_settings,
  public.lead_quality_flags,
  public.ad_conversion_deliveries,
  public.ad_spend_daily,
  public.ad_spend_import_runs,
  public.paid_media_alerts
from public, anon, authenticated;

grant select, insert on public.lead_ad_attribution to service_role;
grant select, insert, update on public.company_google_ads_settings to service_role;
grant select on public.lead_quality_flags to service_role;
grant select on public.ad_conversion_deliveries to service_role;
grant select, insert, update on public.ad_spend_daily to service_role;
grant select, insert, update on public.ad_spend_import_runs to service_role;
grant select, insert, update on public.paid_media_alerts to service_role;

revoke execute on function
  public.flag_lead_quality(uuid, text, text),
  public.clear_lead_quality_flag(uuid),
  public.ad_conversion_order_id(text, uuid),
  public.enqueue_google_ads_conversions(uuid, timestamptz),
  public.ad_conversion_consent_state(uuid, uuid, timestamptz),
  public.list_due_ad_conversions(integer, timestamptz),
  public.claim_ad_conversion(uuid, timestamptz),
  public.complete_ad_conversion(uuid, text, timestamptz, integer, text, text, text, text, boolean, boolean),
  public.list_due_ad_conversion_retractions(integer, timestamptz),
  public.complete_ad_conversion_retraction(uuid, boolean, timestamptz, text),
  public.paid_search_health(uuid, timestamptz),
  public.report_paid_search(timestamptz, timestamptz),
  public.purge_expired_click_ids(timestamptz)
from public, anon, authenticated;

grant execute on function
  public.flag_lead_quality(uuid, text, text),
  public.clear_lead_quality_flag(uuid),
  public.report_paid_search(timestamptz, timestamptz)
to authenticated;

grant execute on function
  public.enqueue_google_ads_conversions(uuid, timestamptz),
  public.ad_conversion_consent_state(uuid, uuid, timestamptz),
  public.list_due_ad_conversions(integer, timestamptz),
  public.claim_ad_conversion(uuid, timestamptz),
  public.complete_ad_conversion(uuid, text, timestamptz, integer, text, text, text, text, boolean, boolean),
  public.list_due_ad_conversion_retractions(integer, timestamptz),
  public.complete_ad_conversion_retraction(uuid, boolean, timestamptz, text),
  public.paid_search_health(uuid, timestamptz),
  public.purge_expired_click_ids(timestamptz),
  public.ad_conversion_order_id(text, uuid)
to service_role;

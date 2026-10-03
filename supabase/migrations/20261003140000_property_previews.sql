-- Anonymous, pre-lead property previews for the value-first quote flow.
--
-- A preview is created when a homeowner submits an address and accepts the
-- property-processing notice. It is bound to a property so the aerial image and
-- Google Solar measurement can run before contact details exist. The preview URL
-- carries an opaque token; only its SHA-256 hash is stored. Conversion into a
-- lead happens through the canonical intake transaction (a later migration).
--
-- Everything here is service-role only. Limits are enforced in the same
-- transaction as the write so they cannot be raced from the application.

create table public.property_previews (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  property_id uuid not null,
  google_place_id text
    check (google_place_id is null or pg_catalog.length(pg_catalog.btrim(google_place_id)) > 0),
  submitted_address text not null
    check (pg_catalog.length(pg_catalog.btrim(submitted_address)) between 5 and 500),
  normalized_address text not null,
  address_mode text not null check (address_mode in ('google', 'manual')),
  campaign text,
  entry_point text not null check (pg_catalog.length(pg_catalog.btrim(entry_point)) > 0),
  presentation_key text not null check (pg_catalog.length(pg_catalog.btrim(presentation_key)) > 0),
  attribution jsonb not null default '{}'::jsonb
    check (pg_catalog.jsonb_typeof(attribution) = 'object'),
  referrer text,
  experiment_arm text not null default 'value_first'
    check (experiment_arm in ('legacy', 'value_first')),
  reveal_mode text not null default 'full' check (reveal_mode in ('full', 'skipped')),
  processing_disclosure_version text not null
    check (pg_catalog.length(pg_catalog.btrim(processing_disclosure_version)) > 0),
  processing_accepted_at timestamptz not null,
  ip_address inet not null,
  user_agent text not null check (pg_catalog.length(pg_catalog.btrim(user_agent)) > 0),
  responses jsonb not null default '{}'::jsonb
    check (pg_catalog.jsonb_typeof(responses) = 'object'),
  saved_email text,
  saved_email_normalized text,
  email_disclosure_version text,
  email_accepted_at timestamptz,
  reminders_sent smallint not null default 0 check (reminders_sent between 0 and 2),
  unsubscribed_at timestamptz,
  revealed_at timestamptz,
  contact_viewed_at timestamptz,
  status text not null default 'active' check (status in ('active', 'converted', 'expired')),
  converted_lead_id uuid,
  submission_id uuid,
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (company_id, id),
  foreign key (company_id, property_id)
    references public.properties(company_id, id) on delete cascade,
  foreign key (company_id, converted_lead_id)
    references public.leads(company_id, id),
  check ((saved_email is null) = (saved_email_normalized is null)),
  check ((saved_email is null) = (email_disclosure_version is null)),
  check ((saved_email is null) = (email_accepted_at is null)),
  check ((status = 'converted') = (converted_lead_id is not null and submission_id is not null))
);

create index property_previews_company_created_idx
  on public.property_previews (company_id, created_at desc);
create index property_previews_place_reuse_idx
  on public.property_previews (company_id, google_place_id, created_at desc)
  where google_place_id is not null;
create index property_previews_address_reuse_idx
  on public.property_previews (company_id, normalized_address, created_at desc);
create index property_previews_active_expiry_idx
  on public.property_previews (expires_at)
  where status = 'active';

comment on table public.property_previews is
  'Anonymous pre-lead quote previews. Token hash only; service role only.';

-- Fixed-window counters for preview creation (per hashed IP per hour, per
-- company per day). Rows are disposable and hold no raw IP address.
create table public.property_preview_rate_buckets (
  bucket_key text not null check (pg_catalog.length(bucket_key) between 1 and 200),
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (bucket_key, window_start)
);

-- One row per accepted "Email me this" send, for per-preview and per-address
-- daily limits.
create table public.property_preview_email_sends (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  preview_id uuid not null,
  email_normalized text not null,
  sent_at timestamptz not null default pg_catalog.now(),
  foreign key (company_id, preview_id)
    references public.property_previews(company_id, id) on delete cascade
);

create index property_preview_email_sends_preview_idx
  on public.property_preview_email_sends (company_id, preview_id, sent_at desc);
create index property_preview_email_sends_email_idx
  on public.property_preview_email_sends (company_id, email_normalized, sent_at desc);

alter table public.property_previews enable row level security;
alter table public.property_preview_rate_buckets enable row level security;
alter table public.property_preview_email_sends enable row level security;

create function public.consume_property_preview_rate_limit(
  p_bucket_key text,
  p_window interval,
  p_limit integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz := pg_catalog.to_timestamp(
    pg_catalog.floor(
      extract(epoch from pg_catalog.now()) / extract(epoch from p_window)
    ) * extract(epoch from p_window)
  );
  v_count integer;
begin
  insert into public.property_preview_rate_buckets as bucket (bucket_key, window_start, request_count)
  values (p_bucket_key, v_window_start, 1)
  on conflict (bucket_key, window_start)
  do update set request_count = bucket.request_count + 1
  returning bucket.request_count into v_count;
  return v_count <= p_limit;
end;
$$;

create function public.create_property_preview(
  p_company_id uuid,
  p_token_hash text,
  p_submitted_address text,
  p_google_place_id text,
  p_address_mode text,
  p_campaign text,
  p_entry_point text,
  p_presentation_key text,
  p_attribution jsonb,
  p_referrer text,
  p_processing_disclosure_version text,
  p_processing_accepted_at timestamptz,
  p_ip_address text,
  p_user_agent text,
  p_hourly_ip_limit integer default 10,
  p_daily_company_limit integer default 500
) returns table (
  preview_id uuid,
  property_id uuid,
  rate_limited boolean,
  reused_property boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip inet;
  v_ip_digest text;
  v_address text;
  v_normalized_address text;
  v_place_id text;
  v_property_id uuid;
  v_reused boolean := false;
  v_preview_id uuid;
begin
  if p_company_id is null or not exists (
    select 1 from public.companies as company where company.id = p_company_id
  ) then
    raise exception 'Preview company does not exist';
  end if;
  if p_attribution is null or pg_catalog.jsonb_typeof(p_attribution) <> 'object' then
    raise exception 'Preview attribution must be a JSON object';
  end if;
  if p_processing_accepted_at is null then
    raise exception 'Preview processing consent timestamp is required';
  end if;

  begin
    v_ip := pg_catalog.btrim(p_ip_address)::inet;
  exception
    when invalid_text_representation then
      raise exception 'Preview IP address is invalid';
  end;
  if v_ip is null then
    raise exception 'Preview IP address is required';
  end if;

  v_ip_digest := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_company_id::text || ':' || pg_catalog.host(v_ip), 'UTF8')),
    'hex'
  );
  if not public.consume_property_preview_rate_limit('ip:' || v_ip_digest, interval '1 hour', p_hourly_ip_limit)
    or not public.consume_property_preview_rate_limit('company:' || p_company_id::text, interval '1 day', p_daily_company_limit)
  then
    return query select null::uuid, null::uuid, true, false;
    return;
  end if;

  v_address := pg_catalog.btrim(coalesce(p_submitted_address, ''));
  if pg_catalog.length(v_address) < 5 or pg_catalog.length(v_address) > 500 then
    raise exception 'Preview address is required';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Preview token hash is invalid';
  end if;
  v_normalized_address := public.normalize_property_address(v_address);
  v_place_id := nullif(pg_catalog.btrim(coalesce(p_google_place_id, '')), '');
  if p_address_mode = 'google' and v_place_id is null then
    raise exception 'A Google preview requires a Place ID';
  end if;
  if p_address_mode = 'manual' and v_place_id is not null then
    raise exception 'A manual preview must not carry a Place ID';
  end if;

  -- Serialize previews for the same place/address so concurrent submissions
  -- share one property and therefore one provider lookup.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_company_id::text || ':property-preview-address:' || v_normalized_address,
      0
    )
  );
  if v_place_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_company_id::text || ':property-preview-place:' || v_place_id,
        0
      )
    );
  end if;

  select preview.property_id into v_property_id
  from public.property_previews as preview
  where preview.company_id = p_company_id
    and preview.created_at >= pg_catalog.now() - interval '30 days'
    and (
      (v_place_id is not null and preview.google_place_id = v_place_id)
      or (v_place_id is null and preview.google_place_id is null
          and preview.normalized_address = v_normalized_address)
    )
  order by preview.created_at desc, preview.id
  limit 1;

  if found then
    v_reused := true;
  else
    insert into public.properties (company_id, canonical_address, resolution_status)
    values (p_company_id, v_address, 'unresolved')
    returning id into v_property_id;
  end if;

  insert into public.property_previews (
    company_id, token_hash, property_id, google_place_id, submitted_address,
    normalized_address, address_mode, campaign, entry_point, presentation_key,
    attribution, referrer, processing_disclosure_version, processing_accepted_at,
    ip_address, user_agent, expires_at
  ) values (
    p_company_id, p_token_hash, v_property_id, v_place_id, v_address,
    v_normalized_address, p_address_mode, nullif(pg_catalog.btrim(coalesce(p_campaign, '')), ''),
    pg_catalog.btrim(p_entry_point), pg_catalog.btrim(p_presentation_key),
    p_attribution, nullif(pg_catalog.btrim(coalesce(p_referrer, '')), ''),
    pg_catalog.btrim(p_processing_disclosure_version), p_processing_accepted_at,
    v_ip, pg_catalog.btrim(p_user_agent), pg_catalog.now() + interval '7 days'
  )
  returning id into v_preview_id;

  return query select v_preview_id, v_property_id, false, v_reused;
end;
$$;

create function public.record_property_preview_responses(
  p_company_id uuid,
  p_token_hash text,
  p_responses jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
begin
  if p_responses is null or pg_catalog.jsonb_typeof(p_responses) <> 'object' then
    raise exception 'Preview responses must be a JSON object';
  end if;
  for v_key, v_value in select * from pg_catalog.jsonb_each(p_responses) loop
    if pg_catalog.jsonb_typeof(v_value) <> 'string' or not (
      (v_key = 'reason' and v_value #>> '{}' in (
        'roof_age', 'active_leak', 'damaged_shingles', 'storm_damage',
        'transaction', 'planning', 'known_replacement'))
      or (v_key = 'roofAge' and v_value #>> '{}' in (
        'under_5', '5_10', '10_15', '15_20', '20_plus', 'unknown'))
      or (v_key = 'timeline' and v_value #>> '{}' in (
        'asap', 'within_month', 'this_season', 'this_year', 'researching'))
    ) then
      raise exception 'Preview response % is not allowed', v_key;
    end if;
  end loop;

  update public.property_previews as preview
  set responses = preview.responses || p_responses,
      updated_at = pg_catalog.now()
  where preview.company_id = p_company_id
    and preview.token_hash = p_token_hash
    and preview.status = 'active'
    and preview.expires_at > pg_catalog.now();

  if not found then
    raise exception 'Preview is not active';
  end if;
end;
$$;

create function public.mark_property_preview_progress(
  p_company_id uuid,
  p_token_hash text,
  p_step text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_step not in ('revealed', 'contact_viewed') then
    raise exception 'Unknown preview progress step';
  end if;

  update public.property_previews as preview
  set revealed_at = case
        when p_step = 'revealed' then coalesce(preview.revealed_at, pg_catalog.now())
        else preview.revealed_at
      end,
      contact_viewed_at = case
        when p_step = 'contact_viewed' then coalesce(preview.contact_viewed_at, pg_catalog.now())
        else preview.contact_viewed_at
      end,
      updated_at = pg_catalog.now()
  where preview.company_id = p_company_id
    and preview.token_hash = p_token_hash
    and preview.status = 'active'
    and preview.expires_at > pg_catalog.now();
end;
$$;

create function public.save_property_preview_email(
  p_company_id uuid,
  p_token_hash text,
  p_email text,
  p_disclosure_version text,
  p_accepted_at timestamptz,
  p_daily_limit integer default 3
) returns table (allowed boolean, preview_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview public.property_previews%rowtype;
  v_email text := pg_catalog.btrim(coalesce(p_email, ''));
  v_email_normalized text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or pg_catalog.length(v_email) > 320 then
    raise exception 'Preview email is invalid';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_disclosure_version, ''))) = 0 or p_accepted_at is null then
    raise exception 'Preview email consent is required';
  end if;

  select preview.* into v_preview
  from public.property_previews as preview
  where preview.company_id = p_company_id
    and preview.token_hash = p_token_hash
    and preview.status = 'active'
    and preview.expires_at > pg_catalog.now()
  for update;

  if not found then
    raise exception 'Preview is not active';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_company_id::text || ':property-preview-email:' || v_email_normalized,
      0
    )
  );

  if (
    select pg_catalog.count(*) from public.property_preview_email_sends as send
    where send.company_id = p_company_id
      and send.preview_id = v_preview.id
      and send.sent_at > pg_catalog.now() - interval '1 day'
  ) >= p_daily_limit or (
    select pg_catalog.count(*) from public.property_preview_email_sends as send
    where send.company_id = p_company_id
      and send.email_normalized = v_email_normalized
      and send.sent_at > pg_catalog.now() - interval '1 day'
  ) >= p_daily_limit then
    return query select false, v_preview.id;
    return;
  end if;

  update public.property_previews as preview
  set saved_email = v_email,
      saved_email_normalized = v_email_normalized,
      email_disclosure_version = pg_catalog.btrim(p_disclosure_version),
      email_accepted_at = p_accepted_at,
      expires_at = greatest(preview.expires_at, pg_catalog.now() + interval '30 days'),
      updated_at = pg_catalog.now()
  where preview.id = v_preview.id;

  insert into public.property_preview_email_sends (company_id, preview_id, email_normalized)
  values (p_company_id, v_preview.id, v_email_normalized);

  return query select true, v_preview.id;
end;
$$;

create function public.expire_property_previews()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.property_previews as preview
  set status = 'expired', updated_at = pg_catalog.now()
  where preview.status = 'active'
    and preview.expires_at <= pg_catalog.now();
  get diagnostics v_count = row_count;

  delete from public.property_preview_rate_buckets as bucket
  where bucket.window_start < pg_catalog.now() - interval '2 days';

  return v_count;
end;
$$;

revoke all on public.property_previews from public, anon, authenticated;
revoke all on public.property_preview_rate_buckets from public, anon, authenticated;
revoke all on public.property_preview_email_sends from public, anon, authenticated;
grant select, insert, update on public.property_previews to service_role;
grant select on public.property_preview_email_sends to service_role;

revoke all on function public.consume_property_preview_rate_limit(text, interval, integer) from public, anon, authenticated;
revoke all on function public.create_property_preview(uuid, text, text, text, text, text, text, text, jsonb, text, text, timestamptz, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.record_property_preview_responses(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.mark_property_preview_progress(uuid, text, text) from public, anon, authenticated;
revoke all on function public.save_property_preview_email(uuid, text, text, text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.expire_property_previews() from public, anon, authenticated;

grant execute on function public.create_property_preview(uuid, text, text, text, text, text, text, text, jsonb, text, text, timestamptz, text, text, integer, integer) to service_role;
grant execute on function public.record_property_preview_responses(uuid, text, jsonb) to service_role;
grant execute on function public.mark_property_preview_progress(uuid, text, text) to service_role;
grant execute on function public.save_property_preview_email(uuid, text, text, text, timestamptz, integer) to service_role;
grant execute on function public.expire_property_previews() to service_role;

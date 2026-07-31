-- Google-powered homeowner roof estimate funnel.
-- Provider credentials and all mutations remain server-side. Public visitors
-- receive only an opaque estimate token; no table is granted to anon.

create table public.lead_consents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id) on delete cascade,
  consent_type text not null check (
    consent_type in ('estimate_processing', 'email_contact', 'sms_contact')
  ),
  granted boolean not null,
  disclosure_version text not null check (length(trim(disclosure_version)) > 0),
  source text not null default 'roof_estimate_form',
  ip_address inet,
  user_agent text,
  granted_at timestamptz not null default now(),
  unique (lead_id, consent_type)
);

create table public.provider_usage_monthly (
  api_name text not null check (length(trim(api_name)) > 0),
  period_start date not null check (period_start = date_trunc('month', period_start)::date),
  call_limit integer not null check (call_limit > 0),
  reserved_count integer not null default 0 check (reserved_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (api_name, period_start),
  check (reserved_count <= call_limit)
);

create table public.roof_insights (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  property_id uuid not null references public.properties(id) on delete cascade,
  provider text not null default 'google_solar',
  normalized_address text not null check (length(trim(normalized_address)) > 0),
  google_place_id text,
  building_name text,
  lookup_status text not null check (
    lookup_status in ('success', 'no_coverage', 'quota_exhausted', 'error')
  ),
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  imagery_date date,
  imagery_quality text,
  roof_segments jsonb not null default '[]'::jsonb,
  plane_count integer check (plane_count is null or plane_count >= 0),
  total_roof_sqft numeric check (total_roof_sqft is null or total_roof_sqft >= 0),
  raw_response jsonb,
  source_retrieved_at timestamptz not null default now(),
  cache_expires_at timestamptz not null default (now() + interval '180 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider, normalized_address)
);

create table public.roof_estimates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  roof_insight_id uuid references public.roof_insights(id),
  status text not null default 'pending' check (
    status in ('pending', 'ready', 'no_coverage', 'quota_exhausted', 'failed')
  ),
  total_roof_sqft numeric check (total_roof_sqft is null or total_roof_sqft >= 0),
  roof_squares numeric check (roof_squares is null or roof_squares >= 0),
  price_per_square_low_cents integer not null default 50000 check (price_per_square_low_cents > 0),
  price_per_square_high_cents integer not null default 75000 check (
    price_per_square_high_cents >= price_per_square_low_cents
  ),
  range_low_cents integer check (range_low_cents is null or range_low_cents >= 0),
  range_high_cents integer check (
    range_high_cents is null or range_high_cents >= coalesce(range_low_cents, 0)
  ),
  pricing_version text not null default 'nj-asphalt-v1',
  assumptions jsonb not null default '{}'::jsonb,
  public_token uuid not null default gen_random_uuid() unique,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id)
);

create table public.estimate_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  estimate_id uuid not null references public.roof_estimates(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  destination text not null check (length(trim(destination)) > 0),
  composed_subject text,
  composed_body text not null check (length(trim(composed_body)) > 0),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (estimate_id, channel)
);

create index lead_consents_company_id_idx on public.lead_consents(company_id);
create index lead_consents_lead_id_idx on public.lead_consents(lead_id);
create index roof_insights_property_id_idx on public.roof_insights(property_id);
create index roof_insights_cache_idx
  on public.roof_insights(company_id, normalized_address, cache_expires_at desc);
create index roof_estimates_company_created_idx
  on public.roof_estimates(company_id, created_at desc);
create index roof_estimates_property_id_idx on public.roof_estimates(property_id);
create index estimate_deliveries_queued_idx
  on public.estimate_deliveries(scheduled_for)
  where status = 'queued';

alter table public.lead_consents enable row level security;
alter table public.provider_usage_monthly enable row level security;
alter table public.roof_insights enable row level security;
alter table public.roof_estimates enable row level security;
alter table public.estimate_deliveries enable row level security;

revoke all on public.lead_consents from anon, authenticated;
revoke all on public.provider_usage_monthly from anon, authenticated;
revoke all on public.roof_insights from anon, authenticated;
revoke all on public.roof_estimates from anon, authenticated;
revoke all on public.estimate_deliveries from anon, authenticated;

grant all on public.lead_consents to service_role;
grant all on public.provider_usage_monthly to service_role;
grant all on public.roof_insights to service_role;
grant all on public.roof_estimates to service_role;
grant all on public.estimate_deliveries to service_role;

grant select on public.lead_consents to authenticated;
grant select on public.roof_insights to authenticated;
grant select on public.roof_estimates to authenticated;
grant select on public.estimate_deliveries to authenticated;

create policy "company admins read lead consents" on public.lead_consents
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read roof insights" on public.roof_insights
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read roof estimates" on public.roof_estimates
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read estimate deliveries" on public.estimate_deliveries
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create or replace function public.reserve_provider_usage(
  p_api_name text,
  p_period_start date,
  p_limit integer
) returns table (
  allowed boolean,
  reserved_count integer,
  call_limit integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.provider_usage_monthly%rowtype;
begin
  if p_limit < 1 then
    raise exception 'Provider usage limit must be positive';
  end if;
  if p_period_start <> date_trunc('month', p_period_start)::date then
    raise exception 'Provider usage period must start on the first day of a month';
  end if;

  insert into public.provider_usage_monthly (
    api_name, period_start, call_limit, reserved_count
  ) values (p_api_name, p_period_start, p_limit, 0)
  on conflict (api_name, period_start) do nothing;

  update public.provider_usage_monthly as usage
  set reserved_count = usage.reserved_count + 1,
      call_limit = least(usage.call_limit, p_limit),
      updated_at = now()
  where usage.api_name = p_api_name
    and usage.period_start = p_period_start
    and usage.reserved_count < least(usage.call_limit, p_limit)
  returning usage.* into v_row;

  if found then
    return query select true, v_row.reserved_count, v_row.call_limit;
    return;
  end if;

  select usage.* into strict v_row
  from public.provider_usage_monthly as usage
  where usage.api_name = p_api_name
    and usage.period_start = p_period_start;
  return query select false, v_row.reserved_count, v_row.call_limit;
end;
$$;

revoke execute on function public.reserve_provider_usage(text, date, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_provider_usage(text, date, integer)
  to service_role;

create or replace function public.submit_roof_estimate_lead(
  p_company_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_submitted_address text,
  p_disclosure_version text,
  p_ip_address text,
  p_user_agent text,
  p_correlation_id uuid,
  p_pipeline_version integer
) returns table (
  lead_id uuid,
  property_id uuid,
  pipeline_run_id uuid,
  estimate_id uuid,
  public_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property_id uuid := gen_random_uuid();
  v_lead_id uuid := gen_random_uuid();
  v_pipeline_run_id uuid := gen_random_uuid();
  v_estimate_id uuid := gen_random_uuid();
  v_public_token uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'Estimate company does not exist';
  end if;
  if length(trim(p_name)) = 0 or length(trim(p_phone)) = 0
     or length(trim(p_email)) = 0 or length(trim(p_submitted_address)) = 0 then
    raise exception 'Roof estimate contact and address fields are required';
  end if;

  insert into public.properties (id, company_id)
  values (v_property_id, p_company_id);

  insert into public.leads (
    id, company_id, property_id, name, phone, email, submitted_address,
    service_requested, notes
  ) values (
    v_lead_id, p_company_id, v_property_id, trim(p_name), trim(p_phone),
    lower(trim(p_email)), trim(p_submitted_address), 'roofing',
    'Submitted through the public roof estimate form.'
  );

  insert into public.pipeline_runs (
    id, company_id, lead_id, property_id, correlation_id, pipeline_version
  ) values (
    v_pipeline_run_id, p_company_id, v_lead_id, v_property_id,
    p_correlation_id, p_pipeline_version
  );

  insert into public.lead_consents (
    company_id, lead_id, consent_type, granted, disclosure_version,
    ip_address, user_agent
  )
  select p_company_id, v_lead_id, consent_type, true, p_disclosure_version,
         nullif(trim(coalesce(p_ip_address, '')), '')::inet, p_user_agent
  from unnest(array[
    'estimate_processing', 'email_contact', 'sms_contact'
  ]) as consent_type;

  insert into public.roof_estimates (
    id, company_id, lead_id, property_id, public_token
  ) values (
    v_estimate_id, p_company_id, v_lead_id, v_property_id, v_public_token
  );

  return query select v_lead_id, v_property_id, v_pipeline_run_id,
                      v_estimate_id, v_public_token;
end;
$$;

revoke execute on function public.submit_roof_estimate_lead(
  uuid, text, text, text, text, text, text, text, uuid, integer
) from public, anon, authenticated;
grant execute on function public.submit_roof_estimate_lead(
  uuid, text, text, text, text, text, text, text, uuid, integer
) to service_role;

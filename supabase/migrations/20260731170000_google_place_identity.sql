-- Carry the user-selected Google Place ID from consented estimate intake into
-- address evidence. Place IDs are the durable cross-API identity; the server
-- still resolves the canonical address and coordinates through Geocoding.

alter table public.roof_estimates add column google_place_id text;
alter table public.property_addresses add column google_place_id text;

create index roof_estimates_google_place_id_idx
  on public.roof_estimates(google_place_id)
  where google_place_id is not null;
create index property_addresses_google_place_id_idx
  on public.property_addresses(company_id, google_place_id)
  where google_place_id is not null;

drop function public.submit_roof_estimate_lead(
  uuid, text, text, text, text, text, text, text, uuid, integer
);

create function public.submit_roof_estimate_lead(
  p_company_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_submitted_address text,
  p_disclosure_version text,
  p_ip_address text,
  p_user_agent text,
  p_correlation_id uuid,
  p_pipeline_version integer,
  p_google_place_id text default null
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
    id, company_id, lead_id, property_id, public_token, google_place_id
  ) values (
    v_estimate_id, p_company_id, v_lead_id, v_property_id, v_public_token,
    nullif(trim(coalesce(p_google_place_id, '')), '')
  );

  return query select v_lead_id, v_property_id, v_pipeline_run_id,
                      v_estimate_id, v_public_token;
end;
$$;

revoke execute on function public.submit_roof_estimate_lead(
  uuid, text, text, text, text, text, text, text, uuid, integer, text
) from public, anon, authenticated;
grant execute on function public.submit_roof_estimate_lead(
  uuid, text, text, text, text, text, text, text, uuid, integer, text
) to service_role;

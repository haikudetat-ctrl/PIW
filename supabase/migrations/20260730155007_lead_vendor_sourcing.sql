-- Vendor source-tracking columns on leads. PIW's manual intake path
-- (submit_lead_intake) is untouched; vendor-sourced leads flow through the
-- new submit_lead_intake_from_source function below and populate these.
alter table public.leads
  add column external_lead_id text,
  add column source_system text not null default 'piw_intake'
    check (length(trim(source_system)) > 0),
  add column source_account_id text,
  add column source_record_id text,
  add column original_lead_source text,
  add column campaign text,
  add column consent_reference text,
  add column trustedform_url text,
  add column is_test boolean not null default false,
  add column phone_e164 text,
  add column email_normalized text;

-- Safety-net dedupe: a given vendor's lead id should map to exactly one PIW
-- lead. Normal-path duplicate suppression happens earlier, at the
-- integration_events idempotency check, so this is a backstop, not the
-- primary mechanism.
create unique index leads_source_external_id_idx
  on public.leads(source_system, external_lead_id)
  where external_lead_id is not null;

create index leads_is_test_idx on public.leads(company_id) where is_test = true;

-- Vendor-sourced counterpart to submit_lead_intake. Kept as a separate
-- function (rather than widening submit_lead_intake's signature) so the
-- existing manual-intake call site and its privilege grant are untouched.
create or replace function public.submit_lead_intake_from_source(
  p_company_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_submitted_address text,
  p_notes text,
  p_correlation_id uuid,
  p_pipeline_version integer,
  p_source_system text,
  p_external_lead_id text default null,
  p_source_account_id text default null,
  p_source_record_id text default null,
  p_original_lead_source text default null,
  p_campaign text default null,
  p_consent_reference text default null,
  p_trustedform_url text default null,
  p_is_test boolean default false,
  p_phone_e164 text default null,
  p_email_normalized text default null
) returns table (
  lead_id uuid,
  property_id uuid,
  pipeline_run_id uuid,
  is_duplicate boolean
)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_property_id uuid;
  v_lead_id uuid;
  v_pipeline_run_id uuid;
begin
  if p_external_lead_id is not null then
    select id, property_id into v_lead_id, v_property_id
    from public.leads
    where source_system = p_source_system and external_lead_id = p_external_lead_id;
  end if;

  if v_lead_id is not null then
    select id into v_pipeline_run_id
    from public.pipeline_runs
    where lead_id = v_lead_id
    order by started_at desc
    limit 1;

    return query select v_lead_id, v_property_id, v_pipeline_run_id, true;
    return;
  end if;

  insert into public.properties (company_id, resolution_status)
  values (p_company_id, 'unresolved')
  returning id into v_property_id;

  insert into public.leads (
    company_id, property_id, name, phone, email, submitted_address, notes,
    source_system, external_lead_id, source_account_id, source_record_id,
    original_lead_source, campaign, consent_reference, trustedform_url,
    is_test, phone_e164, email_normalized
  ) values (
    p_company_id, v_property_id, p_name, p_phone, p_email, p_submitted_address, p_notes,
    p_source_system, p_external_lead_id, p_source_account_id, p_source_record_id,
    p_original_lead_source, p_campaign, p_consent_reference, p_trustedform_url,
    p_is_test, p_phone_e164, p_email_normalized
  )
  returning id into v_lead_id;

  insert into public.pipeline_runs (
    company_id, lead_id, property_id, correlation_id, pipeline_version, status
  ) values (
    p_company_id, v_lead_id, v_property_id, p_correlation_id, p_pipeline_version, 'received'
  )
  returning id into v_pipeline_run_id;

  return query select v_lead_id, v_property_id, v_pipeline_run_id, false;
end;
$$;

revoke all on function public.submit_lead_intake_from_source(
  uuid, text, text, text, text, text, uuid, integer, text, text, text, text,
  text, text, text, text, boolean, text, text
) from public, anon, authenticated;

grant execute on function public.submit_lead_intake_from_source(
  uuid, text, text, text, text, text, uuid, integer, text, text, text, text,
  text, text, text, text, boolean, text, text
) to service_role;

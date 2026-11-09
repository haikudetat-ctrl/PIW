-- The rebuilt website is explicitly opted in through its server-side intake URL.
-- Reuse the existing ledger while keeping its campaign destinations separate.
alter table public.lead_distribution_deliveries
  drop constraint lead_distribution_deliveries_destination_check,
  drop constraint lead_distribution_deliveries_source_label_check,
  add constraint lead_distribution_deliveries_destination_source_check check (
    (destination = 'activeprospect_web' and source_label in ('Web Solar', 'Web Roofing'))
    or (
      destination in ('activeprospect_existing', 'activeprospect_secondary', 'internal_email')
      and source_label in ('Meta70', 'Meta30')
    )
  );

create function public.submit_all_season_web_lead(
  p_company_id uuid,
  p_submission_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_submitted_address text,
  p_service_requested text,
  p_submitted_at timestamptz,
  p_attribution jsonb,
  p_disclosure_version text,
  p_ip_address text,
  p_user_agent text,
  p_pipeline_version integer,
  p_phone_e164 text,
  p_email_normalized text,
  p_google_place_id text
) returns table (
  lead_id uuid,
  property_id uuid,
  pipeline_run_id uuid,
  is_duplicate boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  accepted record;
begin
  select * into strict accepted
  from public.submit_all_season_lead(
    p_company_id, p_submission_id, p_name, p_phone, p_email,
    p_submitted_address, p_service_requested, p_submitted_at,
    p_attribution - '_campaign_slug', p_disclosure_version, p_ip_address,
    p_user_agent, p_pipeline_version, p_phone_e164, p_email_normalized, p_google_place_id
  );

  -- Use the saved interest even if a retry changes the submitted selection.
  insert into public.lead_distribution_deliveries (
    company_id, lead_id, pipeline_run_id, destination, source_label
  )
  select p_company_id, lead.id, accepted.pipeline_run_id, 'activeprospect_web',
         case when lead.service_requested = 'roofing' then 'Web Roofing' else 'Web Solar' end
  from public.leads as lead
  where lead.id = accepted.lead_id
    and lead.company_id = p_company_id
    and lead.source_system = 'all-season-website'
    and lead.service_requested in ('solar', 'both', 'roofing')
  on conflict (lead_id, destination) do nothing;

  return query select accepted.lead_id, accepted.property_id,
                      accepted.pipeline_run_id, accepted.is_duplicate;
end;
$$;

revoke all on function public.submit_all_season_web_lead(
  uuid, uuid, text, text, text, text, text, timestamptz, jsonb, text, text, text, integer, text, text, text
) from public, anon, authenticated;
grant execute on function public.submit_all_season_web_lead(
  uuid, uuid, text, text, text, text, text, timestamptz, jsonb, text, text, text, integer, text, text, text
) to service_role;

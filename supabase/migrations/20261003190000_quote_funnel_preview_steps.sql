-- Adds the value-first funnel to the server-side baseline view. Existing
-- columns keep their order (create or replace can only append).
--
-- * value_first_*_visitor_days: the subset of non-bot visitor-days served the
--   value-first flow (arrivals tagged experiment_arm = 'value_first').
-- * previews_*: preview cohorts by the day the preview was created, so step
--   rates (reveal → contact step → conversion) compare like with like.

create or replace view public.quote_funnel_daily
with (security_invoker = true) as
with arrival_days as (
  select
    arrival.company_id,
    (arrival.occurred_at at time zone 'America/New_York')::date as funnel_date,
    count(distinct arrival.visitor_hash)
      filter (where arrival.campaign_slug is not null) as campaign_visitor_days,
    count(distinct arrival.visitor_hash)
      filter (where arrival.campaign_slug is null) as main_site_visitor_days,
    count(distinct arrival.visitor_hash)
      filter (where arrival.campaign_slug is not null and arrival.experiment_arm = 'value_first')
      as value_first_campaign_visitor_days,
    count(distinct arrival.visitor_hash)
      filter (where arrival.campaign_slug is null and arrival.experiment_arm = 'value_first')
      as value_first_main_site_visitor_days
  from public.website_arrivals as arrival
  where not arrival.is_likely_bot
  group by 1, 2
),
lead_days as (
  select
    lead.company_id,
    (lead.created_at at time zone 'America/New_York')::date as funnel_date,
    count(distinct lead.id)
      filter (where touch.entry_point like 'campaign:%') as campaign_leads,
    count(distinct lead.id)
      filter (where touch.entry_point like 'main-%') as main_site_leads
  from public.leads as lead
  join public.lead_attribution_touches as touch
    on touch.company_id = lead.company_id
   and touch.lead_id = lead.id
  group by 1, 2
),
preview_days as (
  select
    preview.company_id,
    (preview.created_at at time zone 'America/New_York')::date as funnel_date,
    count(*) as previews_created,
    count(preview.revealed_at) as previews_revealed,
    count(preview.contact_viewed_at) as previews_contact_viewed,
    count(preview.saved_email) as reports_saved,
    count(*) filter (where preview.status = 'converted') as previews_converted
  from public.property_previews as preview
  group by 1, 2
),
funnel_keys as (
  select company_id, funnel_date from arrival_days
  union
  select company_id, funnel_date from lead_days
  union
  select company_id, funnel_date from preview_days
)
select
  funnel_keys.company_id,
  funnel_keys.funnel_date,
  coalesce(arrival_days.campaign_visitor_days, 0) as campaign_visitor_days,
  coalesce(arrival_days.main_site_visitor_days, 0) as main_site_visitor_days,
  coalesce(lead_days.campaign_leads, 0) as campaign_leads,
  coalesce(lead_days.main_site_leads, 0) as main_site_leads,
  coalesce(arrival_days.value_first_campaign_visitor_days, 0) as value_first_campaign_visitor_days,
  coalesce(arrival_days.value_first_main_site_visitor_days, 0) as value_first_main_site_visitor_days,
  coalesce(preview_days.previews_created, 0) as previews_created,
  coalesce(preview_days.previews_revealed, 0) as previews_revealed,
  coalesce(preview_days.previews_contact_viewed, 0) as previews_contact_viewed,
  coalesce(preview_days.reports_saved, 0) as reports_saved,
  coalesce(preview_days.previews_converted, 0) as previews_converted
from funnel_keys
left join arrival_days
  on arrival_days.company_id = funnel_keys.company_id
 and arrival_days.funnel_date = funnel_keys.funnel_date
left join lead_days
  on lead_days.company_id = funnel_keys.company_id
 and lead_days.funnel_date = funnel_keys.funnel_date
left join preview_days
  on preview_days.company_id = funnel_keys.company_id
 and preview_days.funnel_date = funnel_keys.funnel_date;

revoke all on public.quote_funnel_daily from public, anon, authenticated;
grant select on public.quote_funnel_daily to service_role;

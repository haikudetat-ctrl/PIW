-- Google Ads click IDs, captured so sold jobs can be imported back to Google
-- Ads as offline conversions keyed on the click that produced the lead.
--
-- gclid is the ordinary click ID. gbraid and wbraid replace it on iOS app and
-- web-to-app traffic where Apple's tracking rules withhold gclid; an offline
-- conversion upload accepts exactly one of the three.
--
-- 1. leads gains first-touch gclid/gbraid/wbraid columns. The intake RPCs
--    already write the full attribution object to lead_attribution_touches,
--    so a trigger there copies the click IDs onto the lead instead of
--    redefining start_or_resume_roof_assessment. First touch wins: a resumed
--    assessment never overwrites the click that created the lead.
-- 2. website_arrivals gains the same columns, accepts the roof-replacement
--    campaign slug, and website_arrivals_daily counts Google paid arrivals
--    alongside Meta's.

alter table public.leads
  add column gclid text check (gclid is null or pg_catalog.length(gclid) <= 500),
  add column gbraid text check (gbraid is null or pg_catalog.length(gbraid) <= 500),
  add column wbraid text check (wbraid is null or pg_catalog.length(wbraid) <= 500);

comment on column public.leads.gclid is
  'First-touch Google Ads click ID. Keys offline conversion imports.';
comment on column public.leads.gbraid is
  'First-touch Google Ads iOS app-campaign click ID, sent when gclid is withheld.';
comment on column public.leads.wbraid is
  'First-touch Google Ads iOS web-to-app click ID, sent when gclid is withheld.';

create index leads_google_click_idx
  on public.leads (company_id, created_at desc)
  where gclid is not null or gbraid is not null or wbraid is not null;

create function public.copy_google_click_ids_to_lead()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_gclid text := nullif(pg_catalog.btrim(new.attribution ->> 'gclid'), '');
  v_gbraid text := nullif(pg_catalog.btrim(new.attribution ->> 'gbraid'), '');
  v_wbraid text := nullif(pg_catalog.btrim(new.attribution ->> 'wbraid'), '');
begin
  if v_gclid is null and v_gbraid is null and v_wbraid is null then
    return new;
  end if;

  update public.leads as lead
  set gclid = pg_catalog.left(v_gclid, 500),
      gbraid = pg_catalog.left(v_gbraid, 500),
      wbraid = pg_catalog.left(v_wbraid, 500)
  where lead.id = new.lead_id
    and lead.company_id = new.company_id
    and lead.gclid is null
    and lead.gbraid is null
    and lead.wbraid is null;

  return new;
end;
$$;

revoke all on function public.copy_google_click_ids_to_lead() from public, anon, authenticated;

create trigger lead_attribution_touches_copy_google_click_ids
  after insert on public.lead_attribution_touches
  for each row execute function public.copy_google_click_ids_to_lead();

alter table public.website_arrivals
  add column gclid text check (gclid is null or pg_catalog.length(gclid) <= 500),
  add column gbraid text check (gbraid is null or pg_catalog.length(gbraid) <= 500),
  add column wbraid text check (wbraid is null or pg_catalog.length(wbraid) <= 500);

alter table public.website_arrivals
  drop constraint website_arrivals_campaign_slug_check;

alter table public.website_arrivals
  add constraint website_arrivals_campaign_slug_check check (
    campaign_slug is null or campaign_slug in (
      'weather-report', 'seasonal-shield', 'for-every-season', 'roof-replacement'
    )
  );

-- Columns are appended so create or replace keeps the existing view contract.
create or replace view public.website_arrivals_daily
with (security_invoker = true) as
select
  company_id,
  (occurred_at at time zone 'America/New_York')::date as arrival_date,
  campaign_slug,
  utm_content as ad_name,
  meta_placement,
  count(*) filter (where not is_likely_bot) as arrivals,
  count(*) filter (where not is_likely_bot and fbclid is not null) as paid_arrivals,
  count(distinct visitor_hash) filter (where not is_likely_bot) as distinct_visitors,
  count(*) filter (where is_likely_bot) as bot_arrivals,
  count(*) filter (
    where not is_likely_bot
      and (gclid is not null or gbraid is not null or wbraid is not null)
  ) as google_paid_arrivals
from public.website_arrivals
group by 1, 2, 3, 4, 5;

comment on view public.website_arrivals_daily is
  'Day-level arrival rollup in America/New_York. paid_arrivals counts Meta clicks (fbclid); google_paid_arrivals counts Google Ads clicks.';

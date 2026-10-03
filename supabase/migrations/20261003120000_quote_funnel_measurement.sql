-- Measurement hygiene for the value-first quote flow rollout.
--
-- 1. Vulnerability scanners (/wp-admin, /.env, /.git, *.php, ...) request the
--    site with ordinary browser agents, so the user-agent heuristic missed them
--    and they were counted as visitors. The site serves no PHP, dotfiles or CGI,
--    so a request for one is never a homeowner. The rule lives here so it covers
--    rows from any website deploy, and the website mirrors it.
-- 2. experiment_arm records which quote flow served the arrival. Null means the
--    arrival predates the flag and was served the legacy flow.
-- 3. quote_funnel_daily is the server-side baseline: non-bot visitor-days and
--    leads per surface, independent of browser analytics consent.

create function public.is_scanner_request_path(p_path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_path ~* '^/(wp-admin|wp-includes|wp-content|vendor|cgi-bin|\.git)(/|$)'
      or p_path ~* '^/\.env'
      or p_path ~* '\.php$',
    false
  );
$$;

comment on function public.is_scanner_request_path(text) is
  'True for request paths only vulnerability scanners request. Mirrored by SCANNER_PATH in apps/website/lib/arrival-beacon.ts.';

create function public.flag_scanner_website_arrival()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_scanner_request_path(new.request_path) then
    new.is_likely_bot := true;
  end if;
  return new;
end;
$$;

create trigger website_arrivals_flag_scanner
  before insert on public.website_arrivals
  for each row execute function public.flag_scanner_website_arrival();

update public.website_arrivals
set is_likely_bot = true
where not is_likely_bot
  and public.is_scanner_request_path(request_path);

alter table public.website_arrivals
  add column experiment_arm text
    check (experiment_arm is null or experiment_arm in ('legacy', 'value_first'));

comment on column public.website_arrivals.experiment_arm is
  'Quote flow that served this arrival. Null predates the flag and means legacy.';

create view public.quote_funnel_daily
with (security_invoker = true) as
with arrival_days as (
  select
    arrival.company_id,
    (arrival.occurred_at at time zone 'America/New_York')::date as funnel_date,
    count(distinct arrival.visitor_hash)
      filter (where arrival.campaign_slug is not null) as campaign_visitor_days,
    count(distinct arrival.visitor_hash)
      filter (where arrival.campaign_slug is null) as main_site_visitor_days
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
)
select
  coalesce(arrival_days.company_id, lead_days.company_id) as company_id,
  coalesce(arrival_days.funnel_date, lead_days.funnel_date) as funnel_date,
  coalesce(arrival_days.campaign_visitor_days, 0) as campaign_visitor_days,
  coalesce(arrival_days.main_site_visitor_days, 0) as main_site_visitor_days,
  coalesce(lead_days.campaign_leads, 0) as campaign_leads,
  coalesce(lead_days.main_site_leads, 0) as main_site_leads
from arrival_days
full join lead_days
  on lead_days.company_id = arrival_days.company_id
 and lead_days.funnel_date = arrival_days.funnel_date;

comment on view public.quote_funnel_daily is
  'Server-side quote funnel baseline in America/New_York: non-bot visitor-days and leads per surface.';

revoke all on function public.is_scanner_request_path(text) from public, anon, authenticated;
grant execute on function public.is_scanner_request_path(text) to service_role;
revoke all on function public.flag_scanner_website_arrival() from public, anon, authenticated;
revoke all on public.quote_funnel_daily from public, anon, authenticated;
grant select on public.quote_funnel_daily to service_role;

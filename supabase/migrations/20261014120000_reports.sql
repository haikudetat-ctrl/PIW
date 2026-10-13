-- Reports: step 3 of merging 2stack-roof-quote into PIW.
--
-- The funnel reads the customer journey, which already joins PIW leads and
-- JobNimbus jobs into one customer. Revenue, reps and production read
-- JobNimbus jobs and the stages their journey events reached. Accuracy
-- compares a lead's Google Solar estimate with the Roofr report on the same
-- customer's JobNimbus job. The census records JobNimbus field fill rates and
-- unmapped statuses after every warehouse sync (ported from roof-quote).
--
-- Report functions are security invoker: they read through the caller's row
-- level security and scope to current_company_id().

-- -----------------------------------------------------------------------------
-- Census
-- -----------------------------------------------------------------------------

create table public.jobnimbus_census (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  captured_at timestamptz not null default now(),
  jobs integer not null check (jobs >= 0),
  contacts integer not null check (contacts >= 0),
  -- {"address_line1": 2597, "zip": 2585, ...}: jobs with the field filled.
  job_field_counts jsonb not null check (jsonb_typeof(job_field_counts) = 'object'),
  contact_field_counts jsonb not null check (jsonb_typeof(contact_field_counts) = 'object'),
  -- [{"status": "Lead", "jobs": 1261}]: job statuses with no journey stage.
  unmapped_statuses jsonb not null default '[]'::jsonb check (jsonb_typeof(unmapped_statuses) = 'array')
);

create index jobnimbus_census_company_idx on public.jobnimbus_census(company_id, captured_at desc);

alter table public.jobnimbus_census enable row level security;
revoke all on public.jobnimbus_census from anon, authenticated;
grant select on public.jobnimbus_census to authenticated;
grant select, insert, delete on public.jobnimbus_census to service_role;

create policy "managers read jobnimbus census" on public.jobnimbus_census
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create function public.capture_jobnimbus_census(p_company_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.jobnimbus_census (company_id, jobs, contacts, job_field_counts, contact_field_counts, unmapped_statuses)
  select
    p_company_id,
    (select count(*) from public.jn_jobs where company_id = p_company_id),
    (select count(*) from public.jn_contacts where company_id = p_company_id),
    (
      select jsonb_build_object(
        'address_line1', count(*) filter (where nullif(btrim(address_line1), '') is not null),
        'city', count(*) filter (where nullif(btrim(city), '') is not null),
        'zip', count(*) filter (where nullif(btrim(zip), '') is not null),
        'status_name', count(*) filter (where nullif(btrim(status_name), '') is not null),
        'sales_rep_name', count(*) filter (where nullif(btrim(sales_rep_name), '') is not null),
        'shingle_line', count(*) filter (where nullif(btrim(shingle_line), '') is not null),
        'job_type', count(*) filter (where nullif(btrim(job_type), '') is not null),
        'approved_total', count(*) filter (where approved_total > 0)
      )
      from public.jn_jobs where company_id = p_company_id
    ),
    (
      select jsonb_build_object(
        'phone_normalized', count(*) filter (where phone_normalized is not null),
        'email_normalized', count(*) filter (where email_normalized is not null),
        'address_line1', count(*) filter (where nullif(btrim(address_line1), '') is not null),
        'source_name', count(*) filter (where nullif(btrim(source_name), '') is not null)
      )
      from public.jn_contacts where company_id = p_company_id
    ),
    coalesce((
      select jsonb_agg(jsonb_build_object('status', unmapped.status_name, 'jobs', unmapped.jobs)
        order by unmapped.jobs desc, unmapped.status_name)
      from (
        select job.status_name, count(*)::integer as jobs
        from public.jn_jobs as job
        where job.company_id = p_company_id
          and nullif(btrim(job.status_name), '') is not null
          and not exists (
            select 1 from public.jobnimbus_status_stages as mapping
            where mapping.status_name = job.status_name
              and (mapping.company_id = p_company_id or mapping.company_id is null)
              and mapping.stage is not null
          )
        group by job.status_name
      ) as unmapped
    ), '[]'::jsonb)
  returning id into v_id;

  -- Hourly syncs; 90 days of history is enough to see a field regress.
  delete from public.jobnimbus_census
  where company_id = p_company_id and captured_at < now() - interval '90 days';

  return v_id;
end;
$$;

revoke execute on function public.capture_jobnimbus_census(uuid) from public, anon, authenticated;
grant execute on function public.capture_jobnimbus_census(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Funnel: customers who entered in the window, by the furthest stage reached
-- -----------------------------------------------------------------------------

create function public.report_funnel(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with company as (
    select public.current_company_id() as id
  ),
  events as (
    select event.customer_id, event.stage, event.occurred_at, event.is_approximate,
      event.source_system, event.source_ref,
      case
        when event.stage in ('lead_received', 'ap_intake', 'ap_delivered', 'ap_filtered', 'handoff') then 1
        when event.stage = 'contacted' then 2
        when event.stage in ('appointment_set', 'appointment_ran', 'appointment_no_show') then 3
        when event.stage = 'quoted' then 4
        when event.stage in ('sold', 'in_production') then 5
        when event.stage = 'completed' then 6
      end as stage_rank
    from public.customer_journey_events as event
    join company on event.company_id = company.id
  ),
  journeys as (
    select customer_id,
      min(occurred_at) as entered_at,
      coalesce(max(stage_rank), 1) as furthest,
      bool_or(stage = 'lost') as lost,
      min(occurred_at) filter (where stage = 'quoted' and not is_approximate) as quoted_at,
      min(occurred_at) filter (where stage = 'sold' and not is_approximate) as sold_at,
      min(occurred_at) filter (where stage = 'completed' and not is_approximate) as completed_at
    from events
    group by customer_id
  ),
  cohort as (
    select * from journeys where entered_at >= p_from and entered_at < p_to
  ),
  sold_jobs as (
    select distinct events.customer_id, events.source_ref as jnid
    from events
    join cohort using (customer_id)
    where events.source_system = 'jobnimbus_job' and events.stage_rank >= 5
  ),
  sold_revenue as (
    select sold_jobs.customer_id, count(*) filter (where job.approved_total > 0) as jobs,
      coalesce(sum(job.approved_total) filter (where job.approved_total > 0), 0) as revenue
    from sold_jobs
    join public.jn_jobs as job
      on job.company_id = (select id from company) and job.jnid = sold_jobs.jnid
    group by sold_jobs.customer_id
  ),
  sources as (
    select coalesce(nullif(btrim(customer.source_name), ''), 'Unknown') as source,
      count(*) as leads,
      count(*) filter (where cohort.furthest >= 4) as quoted,
      count(*) filter (where cohort.furthest >= 5) as sold,
      coalesce(sum(sold_revenue.revenue), 0) as revenue
    from cohort
    join public.customers as customer on customer.id = cohort.customer_id
    left join sold_revenue using (customer_id)
    group by 1
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'leads', (select count(*) from cohort),
    'prior_leads', (
      select count(*) from journeys
      where entered_at >= p_from - (p_to - p_from) and entered_at < p_from
    ),
    'steps', jsonb_build_array(
      jsonb_build_object('key', 'lead', 'customers', (select count(*) from cohort)),
      jsonb_build_object('key', 'appointment', 'customers', (select count(*) from cohort where furthest >= 3)),
      jsonb_build_object('key', 'quoted', 'customers', (select count(*) from cohort where furthest >= 4)),
      jsonb_build_object('key', 'sold', 'customers', (select count(*) from cohort where furthest >= 5)),
      jsonb_build_object('key', 'completed', 'customers', (select count(*) from cohort where furthest >= 6))
    ),
    'lost', (select count(*) from cohort where lost and furthest < 5),
    'sold_jobs', (select coalesce(sum(jobs), 0) from sold_revenue),
    'revenue', (select coalesce(sum(revenue), 0) from sold_revenue),
    'median_days', jsonb_build_object(
      'lead_to_quoted', (
        select percentile_cont(0.5) within group (order by (extract(epoch from quoted_at - entered_at) / 86400)::double precision)
        from cohort where quoted_at > entered_at
      ),
      'quoted_to_sold', (
        select percentile_cont(0.5) within group (order by (extract(epoch from sold_at - quoted_at) / 86400)::double precision)
        from cohort where sold_at > quoted_at
      ),
      'sold_to_completed', (
        select percentile_cont(0.5) within group (order by (extract(epoch from completed_at - sold_at) / 86400)::double precision)
        from cohort where completed_at > sold_at
      )
    ),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source', source, 'leads', leads, 'quoted', quoted, 'sold', sold, 'revenue', revenue
      ) order by leads desc, source)
      from sources
    ), '[]'::jsonb)
  );
$$;

-- -----------------------------------------------------------------------------
-- JobNimbus jobs created in the window: revenue, reps, territory, mixes
-- -----------------------------------------------------------------------------

create function public.report_jobs(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with company as (
    select public.current_company_id() as id
  ),
  job_stages as (
    select event.source_ref as jnid,
      bool_or(event.stage in ('quoted', 'sold', 'in_production', 'completed')) as quoted,
      bool_or(event.stage in ('sold', 'in_production', 'completed')) as sold
    from public.customer_journey_events as event
    join company on event.company_id = company.id
    where event.source_system = 'jobnimbus_job'
    group by event.source_ref
  ),
  jobs as (
    select job.jnid,
      to_char(date_trunc('month', job.jn_created_at at time zone 'America/New_York'), 'YYYY-MM') as month,
      coalesce(nullif(btrim(job.sales_rep_name), ''), 'Unassigned') as rep,
      coalesce(nullif(btrim(job.shingle_line), ''), 'Not set') as shingle_line,
      coalesce(nullif(btrim(job.job_type), ''), 'Not set') as job_type,
      coalesce(nullif(btrim(job.record_type_name), ''), 'Not set') as record_type,
      coalesce(initcap(nullif(btrim(job.city), '')), 'Unknown') as city,
      coalesce(job_stages.quoted, false) as quoted,
      coalesce(job_stages.sold, false) as sold,
      case when coalesce(job_stages.sold, false) and job.approved_total > 0 then job.approved_total else 0 end as revenue,
      measurement.job_jnid is not null as measured
    from public.jn_jobs as job
    join company on job.company_id = company.id
    left join job_stages on job_stages.jnid = job.jnid
    left join public.jobnimbus_job_roof_measurements as measurement
      on measurement.company_id = job.company_id and measurement.job_jnid = job.jnid
    where job.jn_created_at >= p_from and job.jn_created_at < p_to
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'jobs', (select count(*) from jobs),
    'quoted', (select count(*) from jobs where quoted),
    'sold', (select count(*) from jobs where sold),
    'revenue', (select coalesce(sum(revenue), 0) from jobs),
    'measured', (select count(*) from jobs where measured),
    'monthly', coalesce((
      select jsonb_agg(jsonb_build_object('month', month, 'jobs', jobs, 'sold', sold, 'revenue', revenue) order by month)
      from (
        select month, count(*) as jobs, count(*) filter (where sold) as sold, sum(revenue) as revenue
        from jobs where month is not null group by month
      ) as by_month
    ), '[]'::jsonb),
    'reps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rep', rep, 'jobs', jobs, 'quoted', quoted, 'sold', sold, 'revenue', revenue
      ) order by revenue desc, jobs desc, rep)
      from (
        select rep, count(*) as jobs, count(*) filter (where quoted) as quoted,
          count(*) filter (where sold) as sold, sum(revenue) as revenue
        from jobs group by rep
      ) as by_rep
    ), '[]'::jsonb),
    'shingle_lines', coalesce((
      select jsonb_agg(jsonb_build_object('label', shingle_line, 'jobs', jobs, 'revenue', revenue) order by jobs desc, shingle_line)
      from (
        select shingle_line, count(*) as jobs, sum(revenue) as revenue from jobs where sold group by shingle_line
      ) as by_line
    ), '[]'::jsonb),
    'job_types', coalesce((
      select jsonb_agg(jsonb_build_object('label', job_type, 'jobs', jobs) order by jobs desc, job_type)
      from (select job_type, count(*) as jobs from jobs group by job_type) as by_type
    ), '[]'::jsonb),
    'record_types', coalesce((
      select jsonb_agg(jsonb_build_object('label', record_type, 'jobs', jobs) order by jobs desc, record_type)
      from (select record_type, count(*) as jobs from jobs group by record_type) as by_record
    ), '[]'::jsonb),
    'territory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'city', city, 'jobs', jobs, 'sold', sold, 'measured', measured
      ) order by jobs desc, city)
      from (
        select city, count(*) as jobs, count(*) filter (where sold) as sold,
          count(*) filter (where measured) as measured
        from jobs group by city order by count(*) desc, city limit 25
      ) as by_city
    ), '[]'::jsonb)
  );
$$;

-- -----------------------------------------------------------------------------
-- Measurements: Google Solar vs Roofr on the same customer
-- -----------------------------------------------------------------------------

create function public.report_measurements()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with company as (
    select public.current_company_id() as id
  )
  select jsonb_build_object(
    'estimates', coalesce((
      select jsonb_object_agg(status, total)
      from (
        select estimate.status, count(*) as total
        from public.roof_estimates as estimate
        join company on estimate.company_id = company.id
        join public.leads as lead on lead.company_id = estimate.company_id and lead.id = estimate.lead_id
        where not lead.is_test
        group by estimate.status
      ) as by_status
    ), '{}'::jsonb),
    'roofr', coalesce((
      select jsonb_object_agg(outcome, total)
      from (
        select report.outcome, count(*) as total
        from public.jobnimbus_roofr_reports as report
        join company on report.company_id = company.id
        group by report.outcome
      ) as by_outcome
    ), '{}'::jsonb),
    'pairs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lead_id', pair.lead_id,
        'lead_name', pair.lead_name,
        'job_jnid', pair.job_jnid,
        'estimate_squares', pair.estimate_squares,
        'roofr_squares', pair.roofr_squares
      ) order by pair.lead_name, pair.job_jnid)
      from (
        select distinct on (lead.id, measurement.job_jnid)
          lead.id as lead_id, lead.name as lead_name, measurement.job_jnid,
          estimate.roof_squares as estimate_squares, measurement.total_squares as roofr_squares
        from public.customer_identities as lead_identity
        join company on lead_identity.company_id = company.id
        join public.customer_identities as job_identity
          on job_identity.company_id = lead_identity.company_id
         and job_identity.customer_id = lead_identity.customer_id
         and job_identity.source_system = 'jobnimbus_job'
        join public.leads as lead
          on lead.company_id = lead_identity.company_id and lead.id::text = lead_identity.external_id
        join public.roof_estimates as estimate
          on estimate.company_id = lead.company_id and estimate.lead_id = lead.id
         and estimate.status = 'ready' and estimate.roof_squares > 0
        join public.jobnimbus_job_roof_measurements as measurement
          on measurement.company_id = job_identity.company_id and measurement.job_jnid = job_identity.external_id
        where lead_identity.source_system = 'piw_lead' and not lead.is_test
      ) as pair
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.report_funnel(timestamptz, timestamptz) from public, anon;
revoke execute on function public.report_jobs(timestamptz, timestamptz) from public, anon;
revoke execute on function public.report_measurements() from public, anon;
grant execute on function public.report_funnel(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.report_jobs(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.report_measurements() to authenticated, service_role;

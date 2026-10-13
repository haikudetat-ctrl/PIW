-- JobNimbus jobs on the Pipeline board, next to PIW leads.
--
-- JobNimbus stays the system of record for its jobs: the board shows them
-- read-only, placed in the lead stage their JobNimbus status maps to. Only
-- jobs with activity since p_since (default: the last 180 days) count, so
-- years-old quotes do not pad the pipeline. A job whose customer already has
-- a PIW lead is shown once, as that lead, which is listed in linked_leads.
--
-- Security invoker: jn_jobs RLS decides which jobs a member sees.

-- The status-to-stage map is configuration, not customer data: members read
-- the shared defaults and their own company's overrides.
grant select on public.jobnimbus_status_stages to authenticated;
create policy "members read jobnimbus status stages"
  on public.jobnimbus_status_stages
  for select
  to authenticated
  using (company_id is null or company_id = (select public.current_member_company_id()));

create function public.pipeline_jobnimbus(
  p_stage text default null,
  p_limit integer default 50,
  p_since timestamptz default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with company as (
    select public.current_member_company_id() as id
  ),
  window_start as (
    select coalesce(p_since, now() - interval '180 days') as since
  ),
  linked as (
    select distinct on (job_identity.external_id)
      job_identity.external_id as job_jnid,
      lead.id as lead_id
    from public.customer_identities as job_identity
    join company on job_identity.company_id = company.id
    join public.customer_identities as lead_identity
      on lead_identity.company_id = job_identity.company_id
      and lead_identity.customer_id = job_identity.customer_id
      and lead_identity.source_system = 'piw_lead'
    join public.leads as lead
      on lead.company_id = lead_identity.company_id
      and lead.id::text = lead_identity.external_id
    where job_identity.source_system = 'jobnimbus_job'
      and not lead.is_test
    order by job_identity.external_id, lead.created_at desc
  ),
  jobs as (
    select
      job.jnid,
      job.number,
      job.status_name,
      job.sales_rep_name,
      nullif(concat_ws(', ', nullif(btrim(job.address_line1), ''), nullif(btrim(job.city), '')), '') as address,
      contact.display_name,
      coalesce(nullif(job.approved_total, 0), job.estimate_total) as value,
      coalesce(job.status_changed_at, job.jn_updated_at, job.jn_created_at) as activity_at,
      case
        when status_map.stage in ('appointment_set', 'appointment_no_show') then 'appointment_set'
        when status_map.stage = 'quoted' then 'proposal_sent'
        when status_map.stage in ('sold', 'in_production', 'completed') then 'won'
        when status_map.stage = 'lost' then 'lost'
        when job.status_name = 'Estimating' then 'estimating'
        else 'new'
      end as stage,
      (
        select report.total_squares
        from public.jobnimbus_roofr_reports as report
        where report.company_id = job.company_id
          and report.job_jnid = job.jnid
          and report.outcome = 'ingested'
        order by report.processed_at desc
        limit 1
      ) as roofr_squares
    from public.jn_jobs as job
    join company on job.company_id = company.id
    cross join window_start
    left join public.jn_contacts as contact
      on contact.company_id = job.company_id
      and contact.jnid = job.primary_contact_jnid
    left join lateral (
      select map.stage
      from public.jobnimbus_status_stages as map
      where map.status_name = job.status_name
        and (map.company_id is null or map.company_id = job.company_id)
      order by map.company_id nulls last
      limit 1
    ) as status_map on true
    where not coalesce(job.is_archived, false)
      and coalesce(job.status_changed_at, job.jn_updated_at, job.jn_created_at) >= window_start.since
      and not exists (select 1 from linked where linked.job_jnid = job.jnid)
  ),
  ranked as (
    select
      jobs.*,
      row_number() over (partition by jobs.stage order by jobs.activity_at desc, jobs.jnid) as position
    from jobs
    where p_stage is null or jobs.stage = p_stage
  )
  select jsonb_build_object(
    'since', (select since from window_start),
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object('stage', by_stage.stage, 'jobs', by_stage.jobs, 'value', by_stage.value)
        order by by_stage.stage)
      from (
        select jobs.stage, count(*) as jobs, coalesce(sum(jobs.value), 0) as value
        from jobs
        group by jobs.stage
      ) as by_stage
    ), '[]'::jsonb),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'jnid', ranked.jnid,
        'number', ranked.number,
        'name', ranked.display_name,
        'address', ranked.address,
        'status_name', ranked.status_name,
        'stage', ranked.stage,
        'sales_rep_name', ranked.sales_rep_name,
        'value', ranked.value,
        'roofr_squares', ranked.roofr_squares,
        'activity_at', ranked.activity_at
      ) order by ranked.stage, ranked.position)
      from ranked
      where ranked.position <= greatest(coalesce(p_limit, 50), 0)
    ), '[]'::jsonb),
    'linked_leads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lead_id', linked.lead_id,
        'jnid', linked.job_jnid,
        'status_name', job.status_name
      ) order by linked.lead_id, linked.job_jnid)
      from linked
      join company on true
      join public.jn_jobs as job on job.company_id = company.id and job.jnid = linked.job_jnid
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.pipeline_jobnimbus(text, integer, timestamptz) from public, anon;
grant execute on function public.pipeline_jobnimbus(text, integer, timestamptz) to authenticated, service_role;

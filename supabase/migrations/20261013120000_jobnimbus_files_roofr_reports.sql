-- JobNimbus files and Roofr report measurements.
--
-- Files are synced like jobs and estimates: raw payloads land in
-- jobnimbus_records and project into jn_files. Roofr measurement reports
-- attached to a job are downloaded, read, and recorded in
-- jobnimbus_roofr_reports: one row per processed file, carrying the
-- measurement when the report was readable. Measurements key on the JobNimbus
-- job, so every readable report counts without first matching a quote.
--
-- Ported from 2stack-roof-quote (jn_files, jobnimbus_report_ingestions and
-- measurement_truth), where measurements could only attach to a quote.

create table public.jn_files (
  company_id uuid not null references public.companies(id) on delete cascade,
  jnid text not null,
  filename text,
  content_type text,
  size bigint check (size is null or size >= 0),
  pages integer check (pages is null or pages >= 0),
  related_job_jnid text,
  jn_created_at timestamptz,
  jn_updated_at timestamptz,
  projected_at timestamptz not null default now(),
  primary key (company_id, jnid)
);

create index jn_files_related_job_idx on public.jn_files(company_id, related_job_jnid);
create index jn_files_roofr_idx on public.jn_files(company_id, related_job_jnid, jn_created_at desc)
  where filename ~* 'roofr';

create table public.jobnimbus_roofr_reports (
  company_id uuid not null,
  file_jnid text not null,
  job_jnid text not null check (length(btrim(job_jnid)) > 0),
  outcome text not null check (outcome in (
    'ingested', 'non_pdf', 'corrupt_pdf', 'invalid_report', 'outbuilding',
    'invalid_candidate', 'provider_terminal'
  )),
  total_squares numeric(10, 2) check (total_squares is null or total_squares between 6 and 99999999.99),
  predominant_pitch_12 numeric(5, 2) check (predominant_pitch_12 is null or predominant_pitch_12 between 0 and 100),
  area_weighted_pitch_12 numeric(5, 2) check (area_weighted_pitch_12 is null or area_weighted_pitch_12 between 0 and 100),
  max_pitch_12 numeric(5, 2) check (max_pitch_12 is null or max_pitch_12 between 0 and 100),
  facets integer check (facets is null or facets between 0 and 10000),
  two_layer_squares numeric(10, 2) check (two_layer_squares is null or two_layer_squares >= 0),
  two_story_squares numeric(10, 2) check (two_story_squares is null or two_story_squares >= 0),
  flat_squares numeric(10, 2) check (flat_squares is null or flat_squares >= 0),
  -- [{"pitch12": 6, "areaSqft": 1200}, ...] and waste percentages by step.
  pitch_area jsonb not null default '[]'::jsonb check (jsonb_typeof(pitch_area) = 'array'),
  waste_ladder jsonb not null default '[]'::jsonb check (jsonb_typeof(waste_ladder) = 'array'),
  api_calls integer not null default 0 check (api_calls >= 0),
  transient_error_count integer not null default 0 check (transient_error_count >= 0),
  rate_limit_response_count integer not null default 0 check (rate_limit_response_count >= 0),
  processed_at timestamptz not null default now(),
  primary key (company_id, file_jnid),
  foreign key (company_id, file_jnid) references public.jn_files(company_id, jnid) on delete cascade,
  -- A measurement exists exactly when the report was ingested.
  check ((outcome = 'ingested') = (total_squares is not null))
);

create index jobnimbus_roofr_reports_job_idx
  on public.jobnimbus_roofr_reports(company_id, job_jnid, processed_at desc);

-- The measurement of record for a job: its newest ingested Roofr report.
create view public.jobnimbus_job_roof_measurements
with (security_invoker = true) as
select distinct on (report.company_id, report.job_jnid)
  report.company_id,
  report.job_jnid,
  report.file_jnid,
  file.filename,
  file.jn_created_at as report_created_at,
  report.total_squares,
  report.predominant_pitch_12,
  report.area_weighted_pitch_12,
  report.max_pitch_12,
  report.facets,
  report.two_layer_squares,
  report.two_story_squares,
  report.flat_squares,
  report.pitch_area,
  report.waste_ladder,
  report.processed_at
from public.jobnimbus_roofr_reports report
join public.jn_files file
  on file.company_id = report.company_id and file.jnid = report.file_jnid
where report.outcome = 'ingested'
order by report.company_id, report.job_jnid,
  file.jn_created_at desc nulls last, report.file_jnid desc;

alter table public.jn_files enable row level security;
alter table public.jobnimbus_roofr_reports enable row level security;

revoke all on public.jn_files, public.jobnimbus_roofr_reports, public.jobnimbus_job_roof_measurements
  from anon, authenticated;
grant select on public.jn_files, public.jobnimbus_roofr_reports, public.jobnimbus_job_roof_measurements
  to authenticated;
grant select, insert, update, delete on public.jn_files, public.jobnimbus_roofr_reports to service_role;
grant select on public.jobnimbus_job_roof_measurements to service_role;

-- Same visibility as jn_estimates: managers see the company, reps see the
-- files and reports on JobNimbus jobs assigned to them.
create policy "members read visible jobnimbus files" on public.jn_files
  for select to authenticated
  using (
    company_id = (select public.current_member_company_id())
    and (
      (select public.has_company_role('manager'))
      or exists (
        select 1 from public.jn_jobs as job
        where job.company_id = jn_files.company_id
          and job.jnid = jn_files.related_job_jnid
          and public.is_assigned_jobnimbus_rep(job.company_id, job.sales_rep_jnid)
      )
    )
  );

create policy "members read visible roofr reports" on public.jobnimbus_roofr_reports
  for select to authenticated
  using (
    company_id = (select public.current_member_company_id())
    and (
      (select public.has_company_role('manager'))
      or exists (
        select 1 from public.jn_jobs as job
        where job.company_id = jobnimbus_roofr_reports.company_id
          and job.jnid = jobnimbus_roofr_reports.job_jnid
          and public.is_assigned_jobnimbus_rep(job.company_id, job.sales_rep_jnid)
      )
    )
  );

-- Read every Roofr report on a JobNimbus job, whatever it is named, and keep
-- its edge footage.
--
-- Until now only files with "roofr" in the name that were attached to a job
-- were read. Most All Season reports are saved under the property address
-- (Roofr's default export name), as "Roof R", or on the contact instead of the
-- job, so about 20 of roughly 280 measured jobs were read.
--
-- 1. jn_files keeps the file's contact, so a report attached to a contact can
--    be matched to that contact's job.
-- 2. jobnimbus_roofr_report_candidates lists every file that could be a Roofr
--    report, with the job it belongs to and how likely it is to be one. The
--    importer reads the text and records 'not_roofr' for files that are not.
-- 3. Reports store eave, rake, ridge, hip, valley and flashing footage.

alter table public.jn_files add column related_contact_jnid text;

-- Backfill from the raw landing zone; the projection sets it from now on.
update public.jn_files as file
set related_contact_jnid = coalesce(
  case when raw.payload->'primary'->>'type' = 'contact'
    then nullif(btrim(raw.payload->'primary'->>'id'), '') end,
  (
    select nullif(btrim(relation->>'id'), '')
    from jsonb_array_elements(
      case when jsonb_typeof(raw.payload->'related') = 'array' then raw.payload->'related' else '[]'::jsonb end
    ) as relation
    where relation->>'type' = 'contact'
    limit 1
  )
)
from public.jobnimbus_records as raw
where raw.company_id = file.company_id
  and raw.jnid = file.jnid
  and raw.record_type = 'file';

create index jn_files_related_contact_idx on public.jn_files(company_id, related_contact_jnid)
  where related_job_jnid is null and related_contact_jnid is not null;

alter table public.jobnimbus_roofr_reports
  drop constraint jobnimbus_roofr_reports_outcome_check,
  add constraint jobnimbus_roofr_reports_outcome_check check (outcome in (
    'ingested', 'non_pdf', 'corrupt_pdf', 'invalid_report', 'outbuilding',
    'invalid_candidate', 'provider_terminal', 'not_roofr'
  )),
  add column eaves_ft numeric(10, 2) check (eaves_ft is null or eaves_ft between 0 and 999999),
  add column rakes_ft numeric(10, 2) check (rakes_ft is null or rakes_ft between 0 and 999999),
  add column ridges_ft numeric(10, 2) check (ridges_ft is null or ridges_ft between 0 and 999999),
  add column hips_ft numeric(10, 2) check (hips_ft is null or hips_ft between 0 and 999999),
  add column valleys_ft numeric(10, 2) check (valleys_ft is null or valleys_ft between 0 and 999999),
  add column wall_flashing_ft numeric(10, 2) check (wall_flashing_ft is null or wall_flashing_ft between 0 and 999999),
  add column step_flashing_ft numeric(10, 2) check (step_flashing_ft is null or step_flashing_ft between 0 and 999999);

-- New columns go last so the view can be replaced in place.
create or replace view public.jobnimbus_job_roof_measurements
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
  report.processed_at,
  report.eaves_ft,
  report.rakes_ft,
  report.ridges_ft,
  report.hips_ft,
  report.valleys_ft,
  report.wall_flashing_ft,
  report.step_flashing_ft
from public.jobnimbus_roofr_reports report
join public.jn_files file
  on file.company_id = report.company_id and file.jnid = report.file_jnid
where report.outcome = 'ingested'
order by report.company_id, report.job_jnid,
  file.jn_created_at desc nulls last, report.file_jnid desc;

-- Files that could be a Roofr report, on the job they belong to.
-- match_rank orders the backlog: 0 named like a Roofr report or measurement,
-- 1 named after an address (Roofr's default export name), 2 any other PDF of
-- a Roofr report's size and page count that is not a known document type.
-- A contact-only file belongs to that contact's job: the newest one created
-- by the time of the file, else the newest.
create view public.jobnimbus_roofr_report_candidates
with (security_invoker = true) as
select
  file.company_id,
  file.jnid as file_jnid,
  file.filename,
  file.jn_created_at,
  coalesce(file.related_job_jnid, contact_job.jnid) as job_jnid,
  case
    when file.filename ~* 'roofr|roof[ _-]?r\M|roof[ _-]?report|measurement' then 0
    when file.filename ~* ', [a-z ]+, united states|, [a-z]{2} [0-9]{5}' then 1
    else 2
  end as match_rank
from public.jn_files file
left join lateral (
  select job.jnid
  from public.jn_jobs job
  where file.related_job_jnid is null
    and file.related_contact_jnid is not null
    and job.company_id = file.company_id
    and job.primary_contact_jnid = file.related_contact_jnid
  order by (job.jn_created_at <= file.jn_created_at) desc nulls last, job.jn_created_at desc nulls last, job.jnid
  limit 1
) contact_job on true
where coalesce(file.content_type, '') !~* '^(image|video)/'
  and (
    coalesce(file.filename, '') ~* 'roofr|roof[ _-]?r\M|roof[ _-]?report|measurement'
    or (
      coalesce(file.content_type, '') ~* 'pdf'
      and file.pages between 5 and 14
      and coalesce(file.size, 0) < 3000000
      and coalesce(file.filename, '') !~* '^estimate [0-9]+\.pdf$|srs distribution|roofing & solar quote|worksheet|material.order|contract|agreement|warranty|invoice|permit|proof of delivery'
    )
  )
  and coalesce(file.related_job_jnid, contact_job.jnid) is not null;

revoke all on public.jobnimbus_roofr_report_candidates from anon, authenticated;
grant select on public.jobnimbus_roofr_report_candidates to service_role;

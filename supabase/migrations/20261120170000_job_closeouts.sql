-- Production closeout package.
--
-- When an installed job is ready to close, the production manager opens a
-- closeout that PIW has already filled from JobNimbus: the supplier's
-- delivery date, the install days read from photo timestamps, the Roofr
-- measurement and the job's own fields. He confirms what happened, picks the
-- photos for the package and works through the checklist. At the final
-- walkthrough the homeowner signs on his phone: completion, photo release and
-- whether a review link is welcome. On submit PIW renders the package PDF,
-- attaches it to the JobNimbus job and moves the job to its completed status.
--
-- Writes to JobNimbus stay off per company until its API key is confirmed to
-- have write access; queued writes wait and go out once it is switched on.

-- -----------------------------------------------------------------------------
-- Settings
-- -----------------------------------------------------------------------------

create table public.job_closeout_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  jobnimbus_writeback_enabled boolean not null default false,
  completed_status_name text not null default 'Job Completed'
    check (length(btrim(completed_status_name)) between 1 and 80),
  -- File names that prove materials reached the job. SRS names its receipts
  -- "SRS Distribution Proof of Delivery"; other suppliers differ.
  delivery_receipt_pattern text not null default 'proof of delivery'
    check (length(btrim(delivery_receipt_pattern)) between 3 and 200),
  -- Supplier paperwork listed in the package (receipts, invoices, orders).
  package_document_pattern text not null default 'proof of delivery|distribution invoice|material order'
    check (length(btrim(package_document_pattern)) between 3 and 200),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp()
);

-- -----------------------------------------------------------------------------
-- Closeouts
-- -----------------------------------------------------------------------------

create table public.job_closeouts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_jnid text not null check (length(btrim(job_jnid)) > 0),
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  version integer not null default 1 check (version > 0),
  -- What PIW knew when the closeout started. The form shows it as the
  -- source of each suggested value.
  prefill jsonb not null default '{}'::jsonb check (jsonb_typeof(prefill) = 'object'),

  install_started_on date,
  install_completed_on date,
  crew text check (crew is null or length(crew) <= 120),
  squares_installed numeric(7, 2)
    check (squares_installed is null or (squares_installed > 0 and squares_installed < 1000)),
  layers_removed smallint check (layers_removed is null or layers_removed between 0 and 5),
  decking_sheets_replaced smallint
    check (decking_sheets_replaced is null or decking_sheets_replaced between 0 and 500),
  checklist jsonb not null default '{}'::jsonb check (jsonb_typeof(checklist) = 'object'),
  punch_items text check (punch_items is null or length(punch_items) <= 2000),
  production_notes text check (production_notes is null or length(production_notes) <= 4000),
  -- One plain line about the job, for the project page if the homeowner
  -- allows photos.
  feature_note text check (feature_note is null or length(feature_note) <= 280),
  selected_photo_jnids text[] not null default '{}'
    check (cardinality(selected_photo_jnids) <= 12),

  homeowner_name text check (homeowner_name is null or length(btrim(homeowner_name)) between 1 and 120),
  homeowner_outcome text check (homeowner_outcome in ('complete', 'complete_with_items')),
  photo_release text not null default 'not_asked'
    check (photo_release in ('not_asked', 'granted', 'declined')),
  review_request_ok boolean,
  -- Signature strokes as an SVG path in a 600×200 box: no markup is stored.
  homeowner_signature_path text check (
    homeowner_signature_path is null
    or (length(homeowner_signature_path) between 20 and 200000
      and homeowner_signature_path ~ '^[ML0-9., -]+$')
  ),
  homeowner_terms_version text check (homeowner_terms_version is null or length(homeowner_terms_version) <= 40),
  homeowner_signed_at timestamptz,
  homeowner_signed_user_agent text check (homeowner_signed_user_agent is null or length(homeowner_signed_user_agent) <= 400),
  homeowner_unavailable_reason text
    check (homeowner_unavailable_reason is null or length(btrim(homeowner_unavailable_reason)) between 1 and 500),

  photos_status text not null default 'queued'
    check (photos_status in ('queued', 'preparing', 'ready', 'failed')),
  photos_attempts smallint not null default 0 check (photos_attempts >= 0),
  photos_claimed_until timestamptz,
  photos_prepared_at timestamptz,
  photos_error text check (photos_error is null or length(photos_error) <= 500),

  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp(),

  unique (company_id, job_jnid),
  unique (company_id, id),
  check (install_started_on is null or install_completed_on is null or install_completed_on >= install_started_on),
  check (
    (homeowner_signed_at is null
      and homeowner_signature_path is null
      and homeowner_outcome is null
      and homeowner_terms_version is null)
    or (homeowner_signed_at is not null
      and homeowner_signature_path is not null
      and homeowner_name is not null
      and homeowner_outcome is not null
      and homeowner_terms_version is not null
      and photo_release <> 'not_asked'
      and review_request_ok is not null)
  ),
  check (homeowner_signed_at is null or homeowner_unavailable_reason is null),
  check (
    status = 'draft'
    or (submitted_at is not null
      and install_started_on is not null
      and install_completed_on is not null
      and (homeowner_signed_at is not null or homeowner_unavailable_reason is not null))
  )
);

create index job_closeouts_open on public.job_closeouts(company_id, updated_at desc) where status = 'draft';
create index job_closeouts_photo_work on public.job_closeouts(photos_status, updated_at)
  where photos_status in ('queued', 'preparing', 'failed');

-- Photos PIW resized for the form and the package. The originals stay in
-- JobNimbus; resizing drops their EXIF, location included.
create table public.job_closeout_photos (
  company_id uuid not null references public.companies(id) on delete cascade,
  closeout_id uuid not null references public.job_closeouts(id) on delete cascade,
  file_jnid text not null check (length(btrim(file_jnid)) > 0),
  filename text,
  taken_at timestamptz,
  uploaded_at timestamptz,
  outcome text not null check (outcome in ('ready', 'unsupported', 'failed')),
  thumb_path text,
  print_path text,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  prepared_at timestamptz not null default clock_timestamp(),
  primary key (closeout_id, file_jnid),
  check (outcome <> 'ready' or (thumb_path is not null and print_path is not null))
);

create index job_closeout_photos_company on public.job_closeout_photos(company_id, closeout_id);

-- One row per JobNimbus write a submitted closeout needs. The status write
-- waits for the package so a completed job always has its package attached.
create table public.job_closeout_jobnimbus_writes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  closeout_id uuid not null references public.job_closeouts(id) on delete cascade,
  kind text not null check (kind in ('attach_package', 'set_completed_status')),
  status text not null default 'queued'
    check (status in ('queued', 'in_progress', 'succeeded', 'skipped', 'failed')),
  attempts smallint not null default 0 check (attempts >= 0),
  not_before timestamptz not null default clock_timestamp(),
  claimed_until timestamptz,
  jobnimbus_file_jnid text,
  package_sha256 text check (package_sha256 is null or package_sha256 ~ '^[0-9a-f]{64}$'),
  package_path text,
  outcome_detail text check (outcome_detail is null or length(outcome_detail) <= 500),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (closeout_id, kind),
  check ((status in ('succeeded', 'skipped')) = (completed_at is not null))
);

create index job_closeout_writes_due on public.job_closeout_jobnimbus_writes(not_before)
  where status in ('queued', 'in_progress');

-- -----------------------------------------------------------------------------
-- Access: managers read their company's closeouts; every change goes
-- through the functions below.
-- -----------------------------------------------------------------------------

alter table public.job_closeout_settings enable row level security;
alter table public.job_closeouts enable row level security;
alter table public.job_closeout_photos enable row level security;
alter table public.job_closeout_jobnimbus_writes enable row level security;

revoke all on public.job_closeout_settings, public.job_closeouts, public.job_closeout_photos,
  public.job_closeout_jobnimbus_writes from public, anon, authenticated;
grant select on public.job_closeout_settings, public.job_closeouts, public.job_closeout_photos,
  public.job_closeout_jobnimbus_writes to authenticated;
grant all on public.job_closeout_settings, public.job_closeouts, public.job_closeout_photos,
  public.job_closeout_jobnimbus_writes to service_role;

create policy "managers read closeout settings" on public.job_closeout_settings
  for select to authenticated using (company_id = (select public.current_company_id()));
create policy "managers read closeouts" on public.job_closeouts
  for select to authenticated using (company_id = (select public.current_company_id()));
create policy "managers read closeout photos" on public.job_closeout_photos
  for select to authenticated using (company_id = (select public.current_company_id()));
create policy "managers read closeout writes" on public.job_closeout_jobnimbus_writes
  for select to authenticated using (company_id = (select public.current_company_id()));

-- Resized photos and package PDFs. Private: only the service role reads
-- them, and pages hand out short-lived signed URLs after their own checks.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-closeouts', 'job-closeouts', false, 20971520, array['image/webp', 'image/jpeg', 'application/pdf'])
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create function private.closeout_manager_company() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v_company uuid := public.current_company_id();
begin
  if auth.uid() is null or v_company is null then
    raise exception 'Manager access required' using errcode = '42501';
  end if;
  return v_company;
end $$;

create function private.lock_draft_closeout(p_company uuid, p_closeout_id uuid, p_expected_version integer)
returns public.job_closeouts
language plpgsql set search_path = '' as $$
declare
  v_closeout public.job_closeouts%rowtype;
begin
  select * into v_closeout from public.job_closeouts
  where id = p_closeout_id and company_id = p_company
  for update;
  if not found then
    raise exception 'Closeout access required' using errcode = '42501';
  end if;
  if v_closeout.status <> 'draft' then
    raise exception 'This closeout was already submitted' using errcode = '22023';
  end if;
  if p_expected_version is distinct from v_closeout.version then
    raise exception 'This closeout changed on another screen. Reload to see the latest.' using errcode = '40001';
  end if;
  return v_closeout;
end $$;

-- What JobNimbus already says about a job, for the form to start from.
create function private.job_closeout_prefill(p_company uuid, p_job_jnid text) returns jsonb
language sql stable set search_path = '' as $$
  with settings as (
    select
      coalesce(s.delivery_receipt_pattern, 'proof of delivery') as receipt_pattern,
      coalesce(s.package_document_pattern, 'proof of delivery|distribution invoice|material order') as document_pattern
    from (select 1) as one
    left join public.job_closeout_settings as s on s.company_id = p_company
  ),
  job as (
    select j.*, contact.display_name as customer_name
    from public.jn_jobs as j
    left join public.jn_contacts as contact
      on contact.company_id = j.company_id and contact.jnid = j.primary_contact_jnid
    where j.company_id = p_company and j.jnid = p_job_jnid
  ),
  delivery as (
    select min(f.jn_created_at) as delivered_at
    from public.jn_files as f, settings
    where f.company_id = p_company and f.related_job_jnid = p_job_jnid
      and f.filename ~* settings.receipt_pattern
  ),
  documents as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'jnid', f.jnid, 'filename', f.filename, 'created_at', f.jn_created_at
    ) order by f.jn_created_at), '[]'::jsonb) as list
    from public.jn_files as f, settings
    where f.company_id = p_company and f.related_job_jnid = p_job_jnid
      and f.filename ~* settings.document_pattern
  ),
  -- Days with five or more photos taken on or after delivery are the days
  -- the crew was on the roof.
  photo_days as (
    select (to_timestamp((r.payload ->> 'date_file_created')::bigint) at time zone 'America/New_York')::date as day,
      count(*) as photos
    from public.jn_files as f
    join public.jobnimbus_records as r on r.company_id = f.company_id and r.jnid = f.jnid
    cross join delivery
    where f.company_id = p_company and f.related_job_jnid = p_job_jnid
      and f.content_type like 'image/%'
      and r.payload ->> 'date_file_created' ~ '^[0-9]{9,11}$'
      and (delivery.delivered_at is null
        or to_timestamp((r.payload ->> 'date_file_created')::bigint) >= delivery.delivered_at - interval '1 day')
    group by 1
  ),
  install as (
    select min(day) as first_day, max(day) as last_day, coalesce(sum(photos), 0) as photos
    from photo_days where photos >= 5
  ),
  roofr as (
    select r.total_squares, r.predominant_pitch_12
    from public.jobnimbus_roofr_reports as r
    where r.company_id = p_company and r.job_jnid = p_job_jnid and r.outcome = 'ingested'
    order by r.processed_at desc limit 1
  )
  select jsonb_build_object(
    'job', jsonb_build_object(
      'jnid', job.jnid, 'number', job.number, 'status_name', job.status_name,
      'record_type_name', job.record_type_name, 'job_type', job.job_type,
      'shingle_line', job.shingle_line, 'sales_rep_name', job.sales_rep_name,
      'address_line1', job.address_line1, 'city', job.city, 'state', job.state_text, 'zip', job.zip,
      'customer_name', job.customer_name
    ),
    'delivered_at', (select delivered_at from delivery),
    'delivery_documents', (select list from documents),
    'install_photo_days', jsonb_build_object(
      'first', (select first_day from install), 'last', (select last_day from install),
      'photos', (select photos from install)
    ),
    'roofr', (select jsonb_build_object('squares', total_squares, 'pitch_12', predominant_pitch_12) from roofr),
    'captured_at', clock_timestamp()
  )
  from job
$$;

-- -----------------------------------------------------------------------------
-- Manager actions
-- -----------------------------------------------------------------------------

create function public.start_job_closeout(p_job_jnid text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.closeout_manager_company();
  v_prefill jsonb;
  v_id uuid;
begin
  select id into v_id from public.job_closeouts where company_id = v_company and job_jnid = p_job_jnid;
  if found then return v_id; end if;

  v_prefill := private.job_closeout_prefill(v_company, p_job_jnid);
  if v_prefill is null then
    raise exception 'Job not found' using errcode = '42501';
  end if;

  insert into public.job_closeouts (
    company_id, job_jnid, prefill, install_started_on, install_completed_on, squares_installed,
    created_by, updated_by
  )
  values (
    v_company, p_job_jnid, v_prefill,
    nullif(v_prefill #>> '{install_photo_days,first}', '')::date,
    nullif(v_prefill #>> '{install_photo_days,last}', '')::date,
    nullif(v_prefill #>> '{roofr,squares}', '')::numeric,
    auth.uid(), auth.uid()
  )
  on conflict (company_id, job_jnid) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.job_closeouts where company_id = v_company and job_jnid = p_job_jnid;
    return v_id;
  end if;

  insert into public.audit_log (company_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_company, auth.uid(), 'job_closeout_started', 'job_closeout', v_id,
    jsonb_build_object('job_jnid', p_job_jnid));
  return v_id;
end $$;

create function public.save_job_closeout(p_closeout_id uuid, p_expected_version integer, p_fields jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.closeout_manager_company();
  v_closeout public.job_closeouts%rowtype;
  v_completed date;
  v_punch text;
  v_reason text;
  v_photos text[];
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'Closeout fields are required' using errcode = '22023';
  end if;
  v_closeout := private.lock_draft_closeout(v_company, p_closeout_id, p_expected_version);

  v_completed := nullif(p_fields ->> 'install_completed_on', '')::date;
  v_punch := nullif(btrim(coalesce(p_fields ->> 'punch_items', '')), '');
  v_reason := nullif(btrim(coalesce(p_fields ->> 'homeowner_unavailable_reason', '')), '');

  -- The homeowner signed a completion date and a list of open items.
  if v_closeout.homeowner_signed_at is not null
    and (v_completed is distinct from v_closeout.install_completed_on
      or v_punch is distinct from v_closeout.punch_items) then
    raise exception 'Clear the homeowner sign-off before changing what they signed' using errcode = '22023';
  end if;
  if v_closeout.homeowner_signed_at is not null and v_reason is not null then
    raise exception 'The homeowner already signed' using errcode = '22023';
  end if;

  select coalesce(array_agg(value order by ordinality), '{}') into v_photos
  from jsonb_array_elements_text(coalesce(p_fields -> 'selected_photo_jnids', '[]'::jsonb)) with ordinality;
  if exists (
    select 1 from unnest(v_photos) as chosen(file_jnid)
    where not exists (
      select 1 from public.job_closeout_photos as photo
      where photo.closeout_id = v_closeout.id and photo.file_jnid = chosen.file_jnid and photo.outcome = 'ready'
    )
  ) then
    raise exception 'Choose photos from this job' using errcode = '22023';
  end if;

  update public.job_closeouts set
    install_started_on = nullif(p_fields ->> 'install_started_on', '')::date,
    install_completed_on = v_completed,
    crew = nullif(btrim(coalesce(p_fields ->> 'crew', '')), ''),
    squares_installed = nullif(p_fields ->> 'squares_installed', '')::numeric,
    layers_removed = nullif(p_fields ->> 'layers_removed', '')::smallint,
    decking_sheets_replaced = nullif(p_fields ->> 'decking_sheets_replaced', '')::smallint,
    checklist = coalesce(p_fields -> 'checklist', '{}'::jsonb),
    punch_items = v_punch,
    production_notes = nullif(btrim(coalesce(p_fields ->> 'production_notes', '')), ''),
    feature_note = nullif(btrim(coalesce(p_fields ->> 'feature_note', '')), ''),
    selected_photo_jnids = v_photos,
    homeowner_unavailable_reason = v_reason,
    version = version + 1,
    updated_by = auth.uid(),
    updated_at = clock_timestamp()
  where id = v_closeout.id;

  return v_closeout.version + 1;
end $$;

create function public.record_job_closeout_signoff(
  p_closeout_id uuid,
  p_expected_version integer,
  p_homeowner_name text,
  p_outcome text,
  p_photo_release text,
  p_review_request_ok boolean,
  p_signature_path text,
  p_terms_version text,
  p_user_agent text
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.closeout_manager_company();
  v_closeout public.job_closeouts%rowtype;
begin
  v_closeout := private.lock_draft_closeout(v_company, p_closeout_id, p_expected_version);
  if v_closeout.install_completed_on is null then
    raise exception 'Save the completion date before the homeowner signs' using errcode = '22023';
  end if;
  if p_outcome = 'complete_with_items' and v_closeout.punch_items is null then
    raise exception 'List the open items before the homeowner signs for them' using errcode = '22023';
  end if;
  if p_photo_release is null or p_photo_release not in ('granted', 'declined') or p_review_request_ok is null then
    raise exception 'Answer the photo and review questions' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_homeowner_name, ''))) not between 1 and 120
    or p_outcome is null or p_outcome not in ('complete', 'complete_with_items')
    or length(btrim(coalesce(p_terms_version, ''))) = 0 then
    raise exception 'Add the homeowner name and confirmation' using errcode = '22023';
  end if;
  if p_signature_path is null or length(p_signature_path) not between 20 and 200000
    or p_signature_path !~ '^[ML0-9., -]+$' then
    raise exception 'Add a signature' using errcode = '22023';
  end if;

  update public.job_closeouts set
    homeowner_name = btrim(p_homeowner_name),
    homeowner_outcome = p_outcome,
    photo_release = p_photo_release,
    review_request_ok = p_review_request_ok,
    homeowner_signature_path = p_signature_path,
    homeowner_terms_version = p_terms_version,
    homeowner_signed_at = clock_timestamp(),
    homeowner_signed_user_agent = left(p_user_agent, 400),
    homeowner_unavailable_reason = null,
    version = version + 1,
    updated_by = auth.uid(),
    updated_at = clock_timestamp()
  where id = v_closeout.id;

  insert into public.audit_log (company_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_company, auth.uid(), 'job_closeout_homeowner_signed', 'job_closeout', v_closeout.id,
    jsonb_build_object('outcome', p_outcome, 'photo_release', p_photo_release,
      'review_request_ok', p_review_request_ok, 'terms_version', p_terms_version));
  return v_closeout.version + 1;
end $$;

create function public.clear_job_closeout_signoff(p_closeout_id uuid, p_expected_version integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.closeout_manager_company();
  v_closeout public.job_closeouts%rowtype;
begin
  v_closeout := private.lock_draft_closeout(v_company, p_closeout_id, p_expected_version);
  if v_closeout.homeowner_signed_at is null then return v_closeout.version; end if;

  update public.job_closeouts set
    homeowner_name = null, homeowner_outcome = null, photo_release = 'not_asked',
    review_request_ok = null, homeowner_signature_path = null, homeowner_terms_version = null,
    homeowner_signed_at = null, homeowner_signed_user_agent = null,
    version = version + 1, updated_by = auth.uid(), updated_at = clock_timestamp()
  where id = v_closeout.id;

  insert into public.audit_log (company_id, actor_id, action, entity_type, entity_id)
  values (v_company, auth.uid(), 'job_closeout_signoff_cleared', 'job_closeout', v_closeout.id);
  return v_closeout.version + 1;
end $$;

create function public.submit_job_closeout(p_closeout_id uuid, p_expected_version integer)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.closeout_manager_company();
  v_closeout public.job_closeouts%rowtype;
begin
  v_closeout := private.lock_draft_closeout(v_company, p_closeout_id, p_expected_version);
  if v_closeout.install_started_on is null or v_closeout.install_completed_on is null then
    raise exception 'Add the install dates' using errcode = '22023';
  end if;
  if v_closeout.homeowner_signed_at is null and v_closeout.homeowner_unavailable_reason is null then
    raise exception 'Get the homeowner sign-off or note why they could not sign' using errcode = '22023';
  end if;

  update public.job_closeouts set
    status = 'submitted', submitted_by = auth.uid(), submitted_at = clock_timestamp(),
    version = version + 1, updated_by = auth.uid(), updated_at = clock_timestamp()
  where id = v_closeout.id;

  insert into public.job_closeout_jobnimbus_writes (company_id, closeout_id, kind)
  values (v_company, v_closeout.id, 'attach_package'), (v_company, v_closeout.id, 'set_completed_status')
  on conflict (closeout_id, kind) do nothing;

  insert into public.audit_log (company_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_company, auth.uid(), 'job_closeout_submitted', 'job_closeout', v_closeout.id,
    jsonb_build_object('job_jnid', v_closeout.job_jnid,
      'homeowner_signed', v_closeout.homeowner_signed_at is not null));
end $$;

create function public.retry_job_closeout_write(p_write_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.closeout_manager_company();
begin
  update public.job_closeout_jobnimbus_writes set
    status = 'queued', attempts = 0, not_before = clock_timestamp(), claimed_until = null,
    updated_at = clock_timestamp()
  where id = p_write_id and company_id = v_company and status = 'failed';
  if not found then
    raise exception 'Only a failed write can be retried' using errcode = '22023';
  end if;
  insert into public.audit_log (company_id, actor_id, action, entity_type, entity_id)
  values (v_company, auth.uid(), 'job_closeout_write_retried', 'job_closeout_write', p_write_id);
end $$;

-- The production queue: jobs with a delivery receipt in the window, plus
-- every closeout still open or recently submitted. Security invoker, so the
-- JobNimbus tables' own policies decide what a member sees.
create function public.list_job_closeout_queue(p_days integer default 60)
returns table (
  job_jnid text,
  job_number text,
  status_name text,
  status_stage text,
  customer_name text,
  city text,
  sales_rep_name text,
  job_type text,
  delivered_at timestamptz,
  photo_count integer,
  closeout_id uuid,
  closeout_status text,
  homeowner_signed boolean,
  submitted_at timestamptz,
  writeback_state text
)
language sql stable security invoker set search_path = '' as $$
  with company as (
    select public.current_company_id() as id,
      make_interval(days => greatest(1, least(coalesce(p_days, 60), 365))) as window_length
  ),
  settings as (
    select coalesce(s.delivery_receipt_pattern, 'proof of delivery') as receipt_pattern
    from company left join public.job_closeout_settings as s on s.company_id = company.id
  ),
  deliveries as (
    select f.related_job_jnid as job_jnid, min(f.jn_created_at) as delivered_at
    from public.jn_files as f, company, settings
    where f.company_id = company.id and f.related_job_jnid is not null
      and f.filename ~* settings.receipt_pattern
    group by f.related_job_jnid
  ),
  scope as (
    select d.job_jnid from deliveries as d, company
    where d.delivered_at >= now() - company.window_length
    union
    select c.job_jnid from public.job_closeouts as c, company
    where c.company_id = company.id
      and (c.status = 'draft' or c.submitted_at >= now() - company.window_length)
  )
  select
    job.jnid, job.number, job.status_name, stage.stage, contact.display_name, job.city,
    job.sales_rep_name, job.job_type, d.delivered_at,
    (select count(*)::integer from public.jn_files as f
      where f.company_id = job.company_id and f.related_job_jnid = job.jnid
        and f.content_type like 'image/%'
        and f.jn_created_at >= coalesce(d.delivered_at - interval '2 days', now() - interval '45 days')),
    c.id, c.status, c.homeowner_signed_at is not null, c.submitted_at,
    (select case
        when count(*) = 0 then null
        when bool_or(w.status = 'failed') then 'failed'
        when bool_and(w.status in ('succeeded', 'skipped')) then 'done'
        else 'pending' end
      from public.job_closeout_jobnimbus_writes as w where w.closeout_id = c.id)
  from scope
  cross join company
  join public.jn_jobs as job on job.company_id = company.id and job.jnid = scope.job_jnid
  left join deliveries as d on d.job_jnid = job.jnid
  left join public.jn_contacts as contact
    on contact.company_id = job.company_id and contact.jnid = job.primary_contact_jnid
  left join public.job_closeouts as c on c.company_id = job.company_id and c.job_jnid = job.jnid
  left join lateral (
    select st.stage from public.jobnimbus_status_stages as st
    where st.status_name = job.status_name and (st.company_id = job.company_id or st.company_id is null)
    order by st.company_id nulls last limit 1
  ) as stage on true
  where c.id is not null or stage.stage is distinct from 'lost'
  order by c.submitted_at desc nulls first, d.delivered_at desc nulls last
$$;

-- -----------------------------------------------------------------------------
-- Worker claims (service role)
-- -----------------------------------------------------------------------------

create function public.claim_job_closeout_photo_prep(p_limit integer default 3)
returns setof public.job_closeouts
language sql security definer set search_path = '' as $$
  update public.job_closeouts as c set
    photos_status = 'preparing',
    photos_attempts = c.photos_attempts + 1,
    photos_claimed_until = clock_timestamp() + interval '15 minutes',
    photos_error = null
  where c.id in (
    select id from public.job_closeouts
    where photos_status = 'queued'
      or (photos_status = 'preparing' and photos_claimed_until < clock_timestamp())
      or (photos_status = 'failed' and photos_attempts < 3 and updated_at < clock_timestamp() - interval '10 minutes')
    order by created_at
    limit greatest(1, least(coalesce(p_limit, 3), 10))
    for update skip locked
  )
  returning c.*
$$;

create function public.claim_job_closeout_writes(p_limit integer default 5)
returns setof public.job_closeout_jobnimbus_writes
language sql security definer set search_path = '' as $$
  update public.job_closeout_jobnimbus_writes as w set
    status = 'in_progress',
    attempts = w.attempts + 1,
    claimed_until = clock_timestamp() + interval '10 minutes',
    updated_at = clock_timestamp()
  where w.id in (
    select pending.id
    from public.job_closeout_jobnimbus_writes as pending
    join public.job_closeout_settings as s
      on s.company_id = pending.company_id and s.jobnimbus_writeback_enabled
    -- The package waits for its photos, or goes without them once photo
    -- preparation has given up.
    join public.job_closeouts as c on c.id = pending.closeout_id
      and (c.photos_status = 'ready' or (c.photos_status = 'failed' and c.photos_attempts >= 3))
    where pending.not_before <= clock_timestamp()
      and (pending.status = 'queued'
        or (pending.status = 'in_progress' and pending.claimed_until < clock_timestamp()))
      and (pending.kind = 'attach_package' or exists (
        select 1 from public.job_closeout_jobnimbus_writes as package
        where package.closeout_id = pending.closeout_id and package.kind = 'attach_package'
          and package.status = 'succeeded'
      ))
    order by pending.created_at, pending.kind
    limit greatest(1, least(coalesce(p_limit, 5), 20))
    for update of pending skip locked
  )
  returning w.*
$$;

revoke all on function
  private.closeout_manager_company(),
  private.lock_draft_closeout(uuid, uuid, integer),
  private.job_closeout_prefill(uuid, text),
  public.start_job_closeout(text),
  public.save_job_closeout(uuid, integer, jsonb),
  public.record_job_closeout_signoff(uuid, integer, text, text, text, boolean, text, text, text),
  public.clear_job_closeout_signoff(uuid, integer),
  public.submit_job_closeout(uuid, integer),
  public.retry_job_closeout_write(uuid),
  public.list_job_closeout_queue(integer),
  public.claim_job_closeout_photo_prep(integer),
  public.claim_job_closeout_writes(integer)
from public, anon, authenticated;

grant execute on function
  public.start_job_closeout(text),
  public.save_job_closeout(uuid, integer, jsonb),
  public.record_job_closeout_signoff(uuid, integer, text, text, text, boolean, text, text, text),
  public.clear_job_closeout_signoff(uuid, integer),
  public.submit_job_closeout(uuid, integer),
  public.retry_job_closeout_write(uuid),
  public.list_job_closeout_queue(integer)
to authenticated;

grant execute on function
  public.claim_job_closeout_photo_prep(integer),
  public.claim_job_closeout_writes(integer)
to service_role;

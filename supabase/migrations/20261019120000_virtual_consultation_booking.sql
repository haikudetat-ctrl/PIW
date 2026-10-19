-- Virtual consultation self-booking.
--
-- Homeowners book a video consultation from a signed, per-lead booking link.
-- PIW is the source of truth for availability and bookings. Google Calendar
-- is a projection: the Inngest calendar sync reads the appointment and makes
-- the Google event match it (insert, move, cancel, add the assigned rep).
--
-- The slot engine in src/modules/booking only proposes times. Whether a time
-- can actually be booked is decided here, inside one transaction that holds a
-- per-company advisory lock, so two homeowners can never take the last seat
-- in the same slot. Bookings land unassigned; a manager assigns the rep.

-- -----------------------------------------------------------------------------
-- Settings, weekly hours, blackouts
-- -----------------------------------------------------------------------------

create table public.booking_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  is_enabled boolean not null default false,
  timezone text not null default 'America/New_York'
    check (pg_catalog.length(pg_catalog.btrim(timezone)) > 0),
  meeting_title text not null default 'Virtual roof consultation'
    check (pg_catalog.length(pg_catalog.btrim(meeting_title)) between 1 and 120),
  meeting_duration_minutes integer not null default 30
    check (meeting_duration_minutes between 15 and 120),
  slot_interval_minutes integer not null default 30
    check (slot_interval_minutes in (15, 20, 30, 45, 60)),
  buffer_minutes integer not null default 15
    check (buffer_minutes between 0 and 60),
  minimum_notice_minutes integer not null default 240
    check (minimum_notice_minutes between 0 and 10080),
  booking_horizon_days integer not null default 14
    check (booking_horizon_days between 1 and 60),
  -- How many virtual consultations the team can run at the same time. Rep
  -- assignment happens after booking, so capacity is a team-level number.
  concurrent_capacity integer not null default 1
    check (concurrent_capacity between 1 and 20),
  google_calendar_id text
    check (google_calendar_id is null or pg_catalog.length(pg_catalog.btrim(google_calendar_id)) between 3 and 320),
  send_calendar_invites boolean not null default true,
  support_phone text
    check (support_phone is null or pg_catalog.length(pg_catalog.btrim(support_phone)) between 7 and 40),
  updated_by uuid references public.admin_profiles(id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  check (not is_enabled or google_calendar_id is not null)
);

-- Weekday follows Postgres extract(dow): 0 = Sunday. Minutes are local wall
-- clock minutes in booking_settings.timezone.
create table public.booking_availability_windows (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.booking_settings(company_id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_minute integer not null check (start_minute between 0 and 1439),
  end_minute integer not null check (end_minute between 1 and 1440),
  created_at timestamptz not null default pg_catalog.now(),
  check (end_minute > start_minute)
);

create index booking_availability_windows_company_idx
  on public.booking_availability_windows(company_id, weekday, start_minute);

create table public.booking_blackouts (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.booking_settings(company_id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text check (reason is null or pg_catalog.length(pg_catalog.btrim(reason)) between 1 and 200),
  created_by uuid references public.admin_profiles(id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  check (ends_at > starts_at)
);

create index booking_blackouts_company_idx on public.booking_blackouts(company_id, starts_at);

-- -----------------------------------------------------------------------------
-- Booking links and attempts
-- -----------------------------------------------------------------------------

-- A booking link is a capability for one lead. The URL carries the link ID
-- plus an HMAC (see src/modules/booking/booking-link-token.ts); the database
-- stores no secret, so a leaked row cannot be turned into a working URL.
create table public.booking_links (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null,
  source text not null check (source in ('staff', 'estimate_result', 'proposal')),
  created_by uuid references public.admin_profiles(id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_opened_at timestamptz,
  unique (company_id, id),
  foreign key (company_id, lead_id) references public.leads(company_id, id) on delete cascade,
  check (expires_at > created_at)
);

create index booking_links_lead_idx
  on public.booking_links(company_id, lead_id, expires_at desc)
  where revoked_at is null;

create table public.booking_attempts (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  booking_link_id uuid not null references public.booking_links(id) on delete cascade,
  action text not null check (action in ('book', 'reschedule', 'cancel')),
  request_ip inet not null,
  reserved_at timestamptz not null default pg_catalog.now()
);

create index booking_attempts_link_idx on public.booking_attempts(booking_link_id, reserved_at desc);
create index booking_attempts_ip_idx on public.booking_attempts(request_ip, reserved_at desc);

-- -----------------------------------------------------------------------------
-- Appointments: virtual consultation fields
-- -----------------------------------------------------------------------------

alter table public.reps
  add column email text
    check (email is null or (pg_catalog.length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));

alter table public.appointments
  add column meeting_type text check (meeting_type in ('in_person', 'virtual')),
  add column booking_source text check (booking_source in ('staff', 'self_service')),
  add column booking_link_id uuid references public.booking_links(id) on delete set null,
  add column attendee_email text
    check (attendee_email is null or (pg_catalog.length(attendee_email) <= 254 and attendee_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  add column customer_notes text
    check (customer_notes is null or pg_catalog.length(customer_notes) between 1 and 1000),
  add column revision bigint not null default 1 check (revision > 0),
  add column reschedule_count integer not null default 0 check (reschedule_count >= 0),
  add column cancelled_at timestamptz,
  add column cancelled_by text check (cancelled_by in ('customer', 'staff')),
  add column calendar_event_id text
    check (calendar_event_id is null or calendar_event_id ~ '^[a-v0-9]{5,1024}$'),
  add column meeting_url text
    check (meeting_url is null or meeting_url like 'https://%'),
  add column calendar_sync_status text
    check (calendar_sync_status in ('pending', 'synced', 'failed', 'not_configured')),
  add column calendar_synced_revision bigint,
  add column calendar_synced_at timestamptz,
  add column calendar_sync_error text
    check (calendar_sync_error is null or pg_catalog.length(calendar_sync_error) <= 500);

alter table public.appointments
  add constraint appointments_virtual_shape check (
    meeting_type is distinct from 'virtual'
    or (duration_minutes is not null and calendar_sync_status is not null)
  ),
  add constraint appointments_cancellation_shape check (
    (status = 'cancelled') = (cancelled_at is not null)
    or (cancelled_at is null and cancelled_by is null)
  );

-- One live self-booked consultation per lead. Rescheduling moves it; a
-- second booking would only double the rep's work.
create unique index appointments_one_active_self_booking_idx
  on public.appointments(lead_id)
  where booking_source = 'self_service' and status in ('scheduled', 'confirmed');

create index appointments_virtual_upcoming_idx
  on public.appointments(company_id, scheduled_at)
  where meeting_type = 'virtual' and status in ('scheduled', 'confirmed');

create index appointments_booking_link_idx on public.appointments(booking_link_id);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

-- Staff can still edit notes, confirm, and record outcomes on a virtual
-- consultation through the existing column grants. Moving or cancelling it
-- must go through the functions below, which bump the revision and queue the
-- calendar sync; a direct edit would leave Google Calendar wrong.
create function private.guard_virtual_appointment_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.revision < old.revision then
    raise exception 'Appointment revision cannot go backwards';
  end if;
  if old.meeting_type = 'virtual' and new.revision = old.revision and (
    new.scheduled_at is distinct from old.scheduled_at
    or new.duration_minutes is distinct from old.duration_minutes
    or new.meeting_type is distinct from old.meeting_type
    or new.lead_id is distinct from old.lead_id
    or new.company_id is distinct from old.company_id
    or (new.status = 'cancelled' and old.status <> 'cancelled')
    or (old.status = 'cancelled' and new.status <> 'cancelled')
  ) then
    raise exception 'Virtual consultations are moved or cancelled through the booking functions';
  end if;
  return new;
end;
$$;

create trigger appointments_guard_virtual_changes
  before update on public.appointments
  for each row execute function private.guard_virtual_appointment_changes();

-- -----------------------------------------------------------------------------
-- Internal helpers
-- -----------------------------------------------------------------------------

-- Why a start time cannot be booked, or null when it can. The caller holds
-- the company's booking lock so the capacity count cannot go stale.
create function public.virtual_consultation_slot_problem(
  p_company_id uuid,
  p_starts_at timestamptz,
  p_exclude_appointment_id uuid,
  p_now timestamptz
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.booking_settings%rowtype;
  v_ends_at timestamptz;
  v_local_start timestamp;
  v_local_end timestamp;
  v_start_minute integer;
  v_end_minute integer;
  v_taken integer;
  v_buffer interval;
begin
  select settings.* into v_settings
  from public.booking_settings settings
  where settings.company_id = p_company_id;
  if not found or not v_settings.is_enabled then
    return 'booking_disabled';
  end if;
  if p_starts_at is null then
    return 'outside_hours';
  end if;

  v_ends_at := p_starts_at + pg_catalog.make_interval(mins => v_settings.meeting_duration_minutes);
  v_buffer := pg_catalog.make_interval(mins => v_settings.buffer_minutes);

  if p_starts_at < p_now + pg_catalog.make_interval(mins => v_settings.minimum_notice_minutes) then
    return 'too_soon';
  end if;
  if p_starts_at > p_now + pg_catalog.make_interval(days => v_settings.booking_horizon_days) then
    return 'too_far';
  end if;

  v_local_start := p_starts_at at time zone v_settings.timezone;
  v_local_end := v_ends_at at time zone v_settings.timezone;
  if extract(second from v_local_start) <> 0 then
    return 'outside_hours';
  end if;

  v_start_minute := (extract(hour from v_local_start) * 60 + extract(minute from v_local_start))::integer;
  -- The meeting must finish on the same local day (or exactly at midnight).
  if v_local_end::date = v_local_start::date then
    v_end_minute := (extract(hour from v_local_end) * 60 + extract(minute from v_local_end))::integer;
  elsif v_local_end = (v_local_start::date + 1)::timestamp then
    v_end_minute := 1440;
  else
    return 'outside_hours';
  end if;

  if not exists (
    select 1
    from public.booking_availability_windows window_row
    where window_row.company_id = p_company_id
      and window_row.weekday = extract(dow from v_local_start)::smallint
      and window_row.start_minute <= v_start_minute
      and v_end_minute <= window_row.end_minute
      and (v_start_minute - window_row.start_minute) % v_settings.slot_interval_minutes = 0
  ) then
    return 'outside_hours';
  end if;

  if exists (
    select 1
    from public.booking_blackouts blackout
    where blackout.company_id = p_company_id
      and blackout.starts_at < v_ends_at
      and blackout.ends_at > p_starts_at
  ) then
    return 'blackout';
  end if;

  select pg_catalog.count(*)::integer into v_taken
  from public.appointments appointment
  where appointment.company_id = p_company_id
    and appointment.meeting_type = 'virtual'
    and appointment.status in ('scheduled', 'confirmed')
    and appointment.id is distinct from p_exclude_appointment_id
    and appointment.scheduled_at < v_ends_at + v_buffer
    and appointment.scheduled_at
      + pg_catalog.make_interval(mins => appointment.duration_minutes)
      + v_buffer > p_starts_at;
  if v_taken >= v_settings.concurrent_capacity then
    return 'full';
  end if;

  return null;
end;
$$;

create function private.virtual_consultation_event(
  p_name text,
  p_appointment public.appointments,
  p_now timestamptz,
  p_extra jsonb default '{}'::jsonb
) returns jsonb
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', extensions.gen_random_uuid(),
    'name', p_name,
    'schemaVersion', 1,
    'correlationId', p_appointment.id,
    'leadId', p_appointment.lead_id,
    'occurredAt', pg_catalog.to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'idempotencyKey', p_name || ':' || p_appointment.id::text || ':' || p_appointment.revision::text,
    'data', pg_catalog.jsonb_build_object(
      'appointmentId', p_appointment.id,
      'revision', p_appointment.revision
    ) || coalesce(p_extra, '{}'::jsonb)
  )
$$;

create function private.lock_virtual_booking(p_company_id uuid)
returns void
language sql
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('virtual-booking:' || p_company_id::text, 0)
  )
$$;

-- Ten booking changes per link and thirty per IP address in any hour. The
-- reservation commits with the call because the booking functions report
-- business failures as outcomes instead of raising.
create function private.reserve_booking_attempt(
  p_company_id uuid,
  p_link_id uuid,
  p_action text,
  p_request_ip inet,
  p_now timestamptz
) returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_request_ip is null then
    raise exception 'Booking request IP is required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('virtual-booking-ip:' || p_request_ip::text, 0)
  );
  if (select pg_catalog.count(*) from public.booking_attempts attempt
      where attempt.booking_link_id = p_link_id
        and attempt.reserved_at > p_now - interval '1 hour') >= 10 then
    raise exception 'Booking rate limit exceeded';
  end if;
  if (select pg_catalog.count(*) from public.booking_attempts attempt
      where attempt.request_ip = p_request_ip
        and attempt.reserved_at > p_now - interval '1 hour') >= 30 then
    raise exception 'Booking rate limit exceeded';
  end if;
  insert into public.booking_attempts(company_id, booking_link_id, action, request_ip, reserved_at)
  values (p_company_id, p_link_id, p_action, p_request_ip, p_now);
end;
$$;

create function private.lock_active_booking_link(p_link_id uuid, p_now timestamptz)
returns public.booking_links
language plpgsql
set search_path = ''
as $$
declare
  v_link public.booking_links%rowtype;
begin
  select link.* into v_link
  from public.booking_links link
  where link.id = p_link_id
  for update;
  if not found or v_link.revoked_at is not null then
    raise exception 'Booking link not found';
  end if;
  if v_link.expires_at <= p_now then
    raise exception 'Booking link expired';
  end if;
  return v_link;
end;
$$;

-- -----------------------------------------------------------------------------
-- Booking links
-- -----------------------------------------------------------------------------

-- Returns the lead's current link when it has at least a week left, otherwise
-- issues a new 30-day link. Staff and the estimate page can call it freely.
create function public.ensure_booking_link(
  p_company_id uuid,
  p_lead_id uuid,
  p_source text,
  p_created_by uuid
) returns table (link_id uuid, expires_at timestamptz, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.booking_links%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_source not in ('staff', 'estimate_result', 'proposal') then
    raise exception 'Unsupported booking link source';
  end if;
  if not exists (
    select 1 from public.leads lead
    where lead.id = p_lead_id and lead.company_id = p_company_id
  ) then
    raise exception 'Lead not found for company';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('booking-link:' || p_lead_id::text, 0)
  );

  select link.* into v_link
  from public.booking_links link
  where link.company_id = p_company_id
    and link.lead_id = p_lead_id
    and link.revoked_at is null
    and link.expires_at > v_now + interval '7 days'
  order by link.expires_at desc, link.id
  limit 1;

  if found then
    return query select v_link.id, v_link.expires_at, true;
    return;
  end if;

  insert into public.booking_links(company_id, lead_id, source, created_by, created_at, expires_at)
  values (p_company_id, p_lead_id, p_source, p_created_by, v_now, v_now + interval '30 days')
  returning * into v_link;

  return query select v_link.id, v_link.expires_at, false;
end;
$$;

-- -----------------------------------------------------------------------------
-- Customer actions
-- -----------------------------------------------------------------------------

-- Outcomes: booked, already_booked, unavailable (with problem set to the
-- slot problem code). Link and rate-limit failures raise.
create function public.book_virtual_consultation(
  p_link_id uuid,
  p_starts_at timestamptz,
  p_attendee_email text,
  p_customer_notes text,
  p_request_ip inet
) returns table (
  outcome text,
  problem text,
  appointment_id uuid,
  scheduled_at timestamptz,
  duration_minutes integer,
  revision bigint,
  event jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_link public.booking_links%rowtype;
  v_settings public.booking_settings%rowtype;
  v_lead public.leads%rowtype;
  v_existing public.appointments%rowtype;
  v_appointment public.appointments%rowtype;
  v_problem text;
  v_email text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_attendee_email, ''))), '');
  v_notes text := nullif(pg_catalog.btrim(coalesce(p_customer_notes, '')), '');
  v_event jsonb;
begin
  if v_notes is not null and pg_catalog.length(v_notes) > 1000 then
    raise exception 'Consultation notes are too long';
  end if;

  v_link := private.lock_active_booking_link(p_link_id, v_now);
  perform private.lock_virtual_booking(v_link.company_id);
  perform private.reserve_booking_attempt(v_link.company_id, v_link.id, 'book', p_request_ip, v_now);

  select lead.* into v_lead
  from public.leads lead
  where lead.id = v_link.lead_id and lead.company_id = v_link.company_id
  for update;
  if not found then
    raise exception 'Booking link not found';
  end if;

  select appointment.* into v_existing
  from public.appointments appointment
  where appointment.company_id = v_link.company_id
    and appointment.lead_id = v_link.lead_id
    and appointment.booking_source = 'self_service'
    and appointment.status in ('scheduled', 'confirmed');
  if found then
    return query select 'already_booked'::text, null::text, v_existing.id,
      v_existing.scheduled_at, v_existing.duration_minutes, v_existing.revision, null::jsonb;
    return;
  end if;

  v_problem := public.virtual_consultation_slot_problem(v_link.company_id, p_starts_at, null, v_now);
  if v_problem is not null then
    return query select 'unavailable'::text, v_problem, null::uuid, null::timestamptz,
      null::integer, null::bigint, null::jsonb;
    return;
  end if;

  select settings.* into v_settings
  from public.booking_settings settings
  where settings.company_id = v_link.company_id;

  v_email := coalesce(v_email, nullif(pg_catalog.lower(pg_catalog.btrim(v_lead.email)), ''));
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'A valid attendee email is required';
  end if;

  insert into public.appointments(
    company_id, lead_id, scheduled_at, duration_minutes, status, meeting_type,
    booking_source, booking_link_id, attendee_email, customer_notes,
    calendar_sync_status, created_at, updated_at
  ) values (
    v_link.company_id, v_link.lead_id, p_starts_at, v_settings.meeting_duration_minutes,
    'scheduled', 'virtual', 'self_service', v_link.id, v_email, v_notes,
    'pending', v_now, v_now
  ) returning * into v_appointment;

  update public.booking_links link
  set expires_at = greatest(link.expires_at, p_starts_at + interval '2 days')
  where link.id = v_link.id;

  if v_lead.stage in ('new', 'contacting', 'nurture') then
    update public.leads lead
    set stage = 'appointment_set', updated_at = v_now
    where lead.id = v_lead.id;
    insert into public.lead_stage_history(company_id, lead_id, from_stage, to_stage, changed_by, note, changed_at)
    values (v_lead.company_id, v_lead.id, v_lead.stage, 'appointment_set', null,
      'Homeowner booked a virtual consultation', v_now);
  end if;

  update public.consultation_requests request
  set status = 'booked', booking_reference = v_appointment.id::text, updated_at = v_now
  where request.company_id = v_link.company_id
    and request.lead_id = v_link.lead_id
    and request.status in ('requested', 'contacted');

  v_event := private.virtual_consultation_event('appointments/virtual.booked', v_appointment, v_now);
  perform public.enqueue_domain_event(v_link.company_id, v_event);

  return query select 'booked'::text, null::text, v_appointment.id, v_appointment.scheduled_at,
    v_appointment.duration_minutes, v_appointment.revision, v_event;
end;
$$;

-- Outcomes: rescheduled, unchanged, not_found, too_late, limit_reached,
-- unavailable (with problem).
create function public.reschedule_virtual_consultation(
  p_link_id uuid,
  p_starts_at timestamptz,
  p_request_ip inet
) returns table (
  outcome text,
  problem text,
  appointment_id uuid,
  scheduled_at timestamptz,
  duration_minutes integer,
  revision bigint,
  event jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_link public.booking_links%rowtype;
  v_appointment public.appointments%rowtype;
  v_previous timestamptz;
  v_problem text;
  v_event jsonb;
begin
  v_link := private.lock_active_booking_link(p_link_id, v_now);
  perform private.lock_virtual_booking(v_link.company_id);
  perform private.reserve_booking_attempt(v_link.company_id, v_link.id, 'reschedule', p_request_ip, v_now);

  select appointment.* into v_appointment
  from public.appointments appointment
  where appointment.company_id = v_link.company_id
    and appointment.lead_id = v_link.lead_id
    and appointment.booking_source = 'self_service'
    and appointment.status in ('scheduled', 'confirmed')
  for update;
  if not found then
    return query select 'not_found'::text, null::text, null::uuid, null::timestamptz,
      null::integer, null::bigint, null::jsonb;
    return;
  end if;
  if v_appointment.scheduled_at <= v_now then
    return query select 'too_late'::text, null::text, v_appointment.id, v_appointment.scheduled_at,
      v_appointment.duration_minutes, v_appointment.revision, null::jsonb;
    return;
  end if;
  if p_starts_at = v_appointment.scheduled_at then
    return query select 'unchanged'::text, null::text, v_appointment.id, v_appointment.scheduled_at,
      v_appointment.duration_minutes, v_appointment.revision, null::jsonb;
    return;
  end if;
  if v_appointment.reschedule_count >= 5 then
    return query select 'limit_reached'::text, null::text, v_appointment.id, v_appointment.scheduled_at,
      v_appointment.duration_minutes, v_appointment.revision, null::jsonb;
    return;
  end if;

  v_problem := public.virtual_consultation_slot_problem(v_link.company_id, p_starts_at, v_appointment.id, v_now);
  if v_problem is not null then
    return query select 'unavailable'::text, v_problem, v_appointment.id, v_appointment.scheduled_at,
      v_appointment.duration_minutes, v_appointment.revision, null::jsonb;
    return;
  end if;

  v_previous := v_appointment.scheduled_at;
  update public.appointments appointment
  set scheduled_at = p_starts_at,
      revision = appointment.revision + 1,
      reschedule_count = appointment.reschedule_count + 1,
      status = 'scheduled',
      calendar_sync_status = 'pending',
      updated_at = v_now
  where appointment.id = v_appointment.id
  returning * into v_appointment;

  update public.booking_links link
  set expires_at = greatest(link.expires_at, p_starts_at + interval '2 days')
  where link.id = v_link.id;

  v_event := private.virtual_consultation_event(
    'appointments/virtual.rescheduled', v_appointment, v_now,
    pg_catalog.jsonb_build_object(
      'previousScheduledAt',
      pg_catalog.to_char(v_previous at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
  perform public.enqueue_domain_event(v_link.company_id, v_event);

  return query select 'rescheduled'::text, null::text, v_appointment.id, v_appointment.scheduled_at,
    v_appointment.duration_minutes, v_appointment.revision, v_event;
end;
$$;

-- Outcomes: cancelled, not_found, too_late.
create function public.cancel_virtual_consultation(
  p_link_id uuid,
  p_request_ip inet
) returns table (
  outcome text,
  appointment_id uuid,
  revision bigint,
  event jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_link public.booking_links%rowtype;
  v_appointment public.appointments%rowtype;
  v_event jsonb;
begin
  v_link := private.lock_active_booking_link(p_link_id, v_now);
  perform private.lock_virtual_booking(v_link.company_id);
  perform private.reserve_booking_attempt(v_link.company_id, v_link.id, 'cancel', p_request_ip, v_now);

  select appointment.* into v_appointment
  from public.appointments appointment
  where appointment.company_id = v_link.company_id
    and appointment.lead_id = v_link.lead_id
    and appointment.booking_source = 'self_service'
    and appointment.status in ('scheduled', 'confirmed')
  for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint, null::jsonb;
    return;
  end if;
  if v_appointment.scheduled_at <= v_now then
    return query select 'too_late'::text, v_appointment.id, v_appointment.revision, null::jsonb;
    return;
  end if;

  update public.appointments appointment
  set status = 'cancelled',
      cancelled_at = v_now,
      cancelled_by = 'customer',
      revision = appointment.revision + 1,
      calendar_sync_status = 'pending',
      updated_at = v_now
  where appointment.id = v_appointment.id
  returning * into v_appointment;

  v_event := private.virtual_consultation_event('appointments/virtual.cancelled', v_appointment, v_now,
    pg_catalog.jsonb_build_object('cancelledBy', 'customer'));
  perform public.enqueue_domain_event(v_link.company_id, v_event);

  return query select 'cancelled'::text, v_appointment.id, v_appointment.revision, v_event;
end;
$$;

-- -----------------------------------------------------------------------------
-- Staff actions
-- -----------------------------------------------------------------------------

-- Outcomes: cancelled, not_found.
create function public.staff_cancel_virtual_consultation(
  p_company_id uuid,
  p_appointment_id uuid
) returns table (outcome text, revision bigint, event jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_appointment public.appointments%rowtype;
  v_event jsonb;
begin
  perform private.lock_virtual_booking(p_company_id);
  select appointment.* into v_appointment
  from public.appointments appointment
  where appointment.id = p_appointment_id
    and appointment.company_id = p_company_id
    and appointment.meeting_type = 'virtual'
    and appointment.status in ('scheduled', 'confirmed')
  for update;
  if not found then
    return query select 'not_found'::text, null::bigint, null::jsonb;
    return;
  end if;

  update public.appointments appointment
  set status = 'cancelled',
      cancelled_at = v_now,
      cancelled_by = 'staff',
      revision = appointment.revision + 1,
      calendar_sync_status = 'pending',
      updated_at = v_now
  where appointment.id = v_appointment.id
  returning * into v_appointment;

  v_event := private.virtual_consultation_event('appointments/virtual.cancelled', v_appointment, v_now,
    pg_catalog.jsonb_build_object('cancelledBy', 'staff'));
  perform public.enqueue_domain_event(p_company_id, v_event);

  return query select 'cancelled'::text, v_appointment.revision, v_event;
end;
$$;

-- Replaces a company's settings and weekly hours in one step. Windows are a
-- JSON array of {"weekday", "startMinute", "endMinute"}; overlaps are refused.
create function public.save_booking_settings(
  p_company_id uuid,
  p_settings jsonb,
  p_windows jsonb,
  p_updated_by uuid
) returns table (is_enabled boolean, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_settings public.booking_settings%rowtype;
  v_timezone text := pg_catalog.btrim(coalesce(p_settings->>'timezone', 'America/New_York'));
begin
  if not exists (select 1 from public.companies company where company.id = p_company_id) then
    raise exception 'Company not found';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names zone where zone.name = v_timezone) then
    raise exception 'Unknown booking time zone';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(p_windows, '[]'::jsonb)) <> 'array' then
    raise exception 'Weekly hours must be a list';
  end if;
  if coalesce((p_settings->>'isEnabled')::boolean, false)
     and nullif(pg_catalog.btrim(coalesce(p_settings->>'googleCalendarId', '')), '') is null then
    raise exception 'Add the Google Calendar ID before turning on booking';
  end if;

  insert into public.booking_settings as current_settings (
    company_id, is_enabled, timezone, meeting_title, meeting_duration_minutes,
    slot_interval_minutes, buffer_minutes, minimum_notice_minutes,
    booking_horizon_days, concurrent_capacity, google_calendar_id,
    send_calendar_invites, support_phone, updated_by, created_at, updated_at
  ) values (
    p_company_id,
    coalesce((p_settings->>'isEnabled')::boolean, false),
    v_timezone,
    coalesce(nullif(pg_catalog.btrim(p_settings->>'meetingTitle'), ''), 'Virtual roof consultation'),
    coalesce((p_settings->>'meetingDurationMinutes')::integer, 30),
    coalesce((p_settings->>'slotIntervalMinutes')::integer, 30),
    coalesce((p_settings->>'bufferMinutes')::integer, 15),
    coalesce((p_settings->>'minimumNoticeMinutes')::integer, 240),
    coalesce((p_settings->>'bookingHorizonDays')::integer, 14),
    coalesce((p_settings->>'concurrentCapacity')::integer, 1),
    nullif(pg_catalog.btrim(p_settings->>'googleCalendarId'), ''),
    coalesce((p_settings->>'sendCalendarInvites')::boolean, true),
    nullif(pg_catalog.btrim(p_settings->>'supportPhone'), ''),
    p_updated_by, v_now, v_now
  )
  on conflict (company_id) do update set
    is_enabled = excluded.is_enabled,
    timezone = excluded.timezone,
    meeting_title = excluded.meeting_title,
    meeting_duration_minutes = excluded.meeting_duration_minutes,
    slot_interval_minutes = excluded.slot_interval_minutes,
    buffer_minutes = excluded.buffer_minutes,
    minimum_notice_minutes = excluded.minimum_notice_minutes,
    booking_horizon_days = excluded.booking_horizon_days,
    concurrent_capacity = excluded.concurrent_capacity,
    google_calendar_id = excluded.google_calendar_id,
    send_calendar_invites = excluded.send_calendar_invites,
    support_phone = excluded.support_phone,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  returning * into v_settings;

  delete from public.booking_availability_windows window_row
  where window_row.company_id = p_company_id;

  insert into public.booking_availability_windows(company_id, weekday, start_minute, end_minute, created_at)
  select p_company_id,
         (item->>'weekday')::smallint,
         (item->>'startMinute')::integer,
         (item->>'endMinute')::integer,
         v_now
  from pg_catalog.jsonb_array_elements(coalesce(p_windows, '[]'::jsonb)) item;

  if exists (
    select 1
    from (
      select window_row.start_minute,
             pg_catalog.lag(window_row.end_minute) over (
               partition by window_row.weekday order by window_row.start_minute
             ) as previous_end_minute
      from public.booking_availability_windows window_row
      where window_row.company_id = p_company_id
    ) ordered
    where ordered.start_minute < ordered.previous_end_minute
  ) then
    raise exception 'Weekly hours overlap';
  end if;

  if v_settings.is_enabled and not exists (
    select 1 from public.booking_availability_windows window_row
    where window_row.company_id = p_company_id
  ) then
    raise exception 'Add weekly hours before turning on booking';
  end if;

  return query select v_settings.is_enabled, v_settings.updated_at;
end;
$$;

create function public.prune_booking_attempts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.booking_attempts attempt
  where attempt.reserved_at < pg_catalog.now() - interval '2 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- -----------------------------------------------------------------------------
-- Access
-- -----------------------------------------------------------------------------

alter table public.booking_settings enable row level security;
alter table public.booking_availability_windows enable row level security;
alter table public.booking_blackouts enable row level security;
alter table public.booking_links enable row level security;
alter table public.booking_attempts enable row level security;

revoke all on public.booking_settings from anon, authenticated;
revoke all on public.booking_availability_windows from anon, authenticated;
revoke all on public.booking_blackouts from anon, authenticated;
revoke all on public.booking_links from anon, authenticated;
revoke all on public.booking_attempts from anon, authenticated;

grant all on public.booking_settings to service_role;
grant all on public.booking_availability_windows to service_role;
grant all on public.booking_blackouts to service_role;
grant all on public.booking_links to service_role;
grant all on public.booking_attempts to service_role;

grant select on public.booking_settings to authenticated;
grant select on public.booking_availability_windows to authenticated;
grant select on public.booking_blackouts to authenticated;
grant select on public.booking_links to authenticated;

create policy "company members read booking settings" on public.booking_settings
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company members read booking hours" on public.booking_availability_windows
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company members read booking blackouts" on public.booking_blackouts
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company members read booking links" on public.booking_links
  for select to authenticated
  using (company_id = (select public.current_company_id()));

revoke execute on function private.guard_virtual_appointment_changes() from public, anon, authenticated;
revoke execute on function private.virtual_consultation_event(text, public.appointments, timestamptz, jsonb)
  from public, anon, authenticated;
revoke execute on function private.lock_virtual_booking(uuid) from public, anon, authenticated;
revoke execute on function private.reserve_booking_attempt(uuid, uuid, text, inet, timestamptz)
  from public, anon, authenticated;
revoke execute on function private.lock_active_booking_link(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.virtual_consultation_slot_problem(uuid, timestamptz, uuid, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.ensure_booking_link(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.book_virtual_consultation(uuid, timestamptz, text, text, inet)
  from public, anon, authenticated;
revoke execute on function public.reschedule_virtual_consultation(uuid, timestamptz, inet)
  from public, anon, authenticated;
revoke execute on function public.cancel_virtual_consultation(uuid, inet) from public, anon, authenticated;
revoke execute on function public.staff_cancel_virtual_consultation(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.save_booking_settings(uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.prune_booking_attempts() from public, anon, authenticated;

grant execute on function public.virtual_consultation_slot_problem(uuid, timestamptz, uuid, timestamptz) to service_role;
grant execute on function public.ensure_booking_link(uuid, uuid, text, uuid) to service_role;
grant execute on function public.book_virtual_consultation(uuid, timestamptz, text, text, inet) to service_role;
grant execute on function public.reschedule_virtual_consultation(uuid, timestamptz, inet) to service_role;
grant execute on function public.cancel_virtual_consultation(uuid, inet) to service_role;
grant execute on function public.staff_cancel_virtual_consultation(uuid, uuid) to service_role;
grant execute on function public.save_booking_settings(uuid, jsonb, jsonb, uuid) to service_role;
grant execute on function public.prune_booking_attempts() to service_role;

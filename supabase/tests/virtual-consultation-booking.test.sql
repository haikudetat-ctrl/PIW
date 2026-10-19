begin;

create extension if not exists pgtap with schema extensions;

select plan(57);

-- -----------------------------------------------------------------------------
-- Shape and access
-- -----------------------------------------------------------------------------

select has_table('public', 'booking_settings', 'booking settings exist');
select has_table('public', 'booking_availability_windows', 'weekly booking hours exist');
select has_table('public', 'booking_blackouts', 'booking blackouts exist');
select has_table('public', 'booking_links', 'booking links exist');
select has_table('public', 'booking_attempts', 'booking attempts exist');
select has_column('public', 'appointments', 'meeting_type', 'appointments record the meeting type');
select has_column('public', 'reps', 'email', 'reps carry an email for calendar invites');

select is(has_table_privilege('anon', 'public.booking_links', 'select'), false, 'anon cannot read booking links');
select is(has_table_privilege('authenticated', 'public.booking_settings', 'update'), false, 'members cannot write booking settings directly');
select is(has_table_privilege('authenticated', 'public.booking_attempts', 'select'), false, 'members cannot read booking attempts');
select is(has_column_privilege('authenticated', 'public.appointments', 'meeting_url', 'update'), false, 'members cannot write the meeting link');
select is(has_function_privilege('anon', 'public.book_virtual_consultation(uuid, timestamptz, text, text, inet)', 'execute'), false, 'anon cannot book directly');
select is(has_function_privilege('authenticated', 'public.ensure_booking_link(uuid, uuid, text, uuid)', 'execute'), false, 'members cannot mint links directly');
select is(has_function_privilege('service_role', 'public.book_virtual_consultation(uuid, timestamptz, text, text, inet)', 'execute'), true, 'the server books through the service role');

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------

insert into public.companies(id, name) values
  ('97000000-0000-4000-8000-000000000001', 'Booking Company'),
  ('97000000-0000-4000-8000-000000000002', 'Other Booking Company');
insert into auth.users(id, email) values
  ('97000000-0000-4000-8000-000000000101', 'booking-admin@example.com'),
  ('97000000-0000-4000-8000-000000000102', 'other-booking-admin@example.com');
insert into public.admin_profiles(id, company_id, display_name) values
  ('97000000-0000-4000-8000-000000000101', '97000000-0000-4000-8000-000000000001', 'Booking Admin'),
  ('97000000-0000-4000-8000-000000000102', '97000000-0000-4000-8000-000000000002', 'Other Admin');
insert into public.properties(id, company_id, canonical_address, resolution_status) values
  ('97000000-0000-4000-8000-000000000011', '97000000-0000-4000-8000-000000000001', '1 Book St, Cherry Hill, NJ 08002', 'resolved');
insert into public.leads(id, company_id, property_id, name, phone, email, submitted_address, stage) values
  ('97000000-0000-4000-8000-000000000021', '97000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000011',
   'Jordan Rivera', '+16095550101', 'Jordan@Example.com', '1 Book St, Cherry Hill, NJ 08002', 'new'),
  ('97000000-0000-4000-8000-000000000022', '97000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000011',
   'Sam Lee', '+16095550102', 'sam@example.com', '1 Book St, Cherry Hill, NJ 08002', 'proposal_sent');

-- Slots used below, in Eastern wall-clock time five days out.
create temporary table booking_fixture as
select
  (((pg_catalog.now() at time zone 'America/New_York')::date + 5) + time '10:00') at time zone 'America/New_York' as ten_am,
  (((pg_catalog.now() at time zone 'America/New_York')::date + 5) + time '10:30') at time zone 'America/New_York' as ten_thirty,
  (((pg_catalog.now() at time zone 'America/New_York')::date + 5) + time '11:00') at time zone 'America/New_York' as eleven_am,
  (((pg_catalog.now() at time zone 'America/New_York')::date + 5) + time '10:10') at time zone 'America/New_York' as misaligned,
  (((pg_catalog.now() at time zone 'America/New_York')::date + 5) + time '18:00') at time zone 'America/New_York' as evening,
  (((pg_catalog.now() at time zone 'America/New_York')::date + 6) + time '10:00') at time zone 'America/New_York' as blackout_day,
  (((pg_catalog.now() at time zone 'America/New_York')::date + 40) + time '10:00') at time zone 'America/New_York' as far_out;
grant select on booking_fixture to public;

select throws_ok(
  $$select * from public.save_booking_settings('97000000-0000-4000-8000-000000000001',
    '{"isEnabled": true}'::jsonb, '[]'::jsonb, null)$$,
  'P0001', 'Add the Google Calendar ID before turning on booking',
  'booking cannot be turned on without a calendar'
);
select throws_ok(
  $$select * from public.save_booking_settings('97000000-0000-4000-8000-000000000001',
    '{"isEnabled": false, "googleCalendarId": "consults@group.calendar.google.com"}'::jsonb,
    '[{"weekday": 1, "startMinute": 540, "endMinute": 720}, {"weekday": 1, "startMinute": 700, "endMinute": 900}]'::jsonb, null)$$,
  'P0001', 'Weekly hours overlap',
  'overlapping weekly hours are refused'
);
select throws_ok(
  $$select * from public.save_booking_settings('97000000-0000-4000-8000-000000000001',
    '{"isEnabled": false, "timezone": "Mars/Olympus"}'::jsonb, '[]'::jsonb, null)$$,
  'P0001', 'Unknown booking time zone',
  'unknown time zones are refused'
);

select is(
  (select is_enabled from public.save_booking_settings(
    '97000000-0000-4000-8000-000000000001',
    '{"isEnabled": true, "googleCalendarId": "consults@group.calendar.google.com", "meetingDurationMinutes": 30,
      "slotIntervalMinutes": 30, "bufferMinutes": 0, "minimumNoticeMinutes": 60, "bookingHorizonDays": 14,
      "concurrentCapacity": 1}'::jsonb,
    (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('weekday', day, 'startMinute', 540, 'endMinute', 1020))
     from pg_catalog.generate_series(0, 6) day),
    '97000000-0000-4000-8000-000000000101'
  )),
  true,
  'settings save with seven days of 9 to 5'
);
select is(
  (select pg_catalog.count(*)::int from public.booking_availability_windows
   where company_id = '97000000-0000-4000-8000-000000000001'),
  7,
  'weekly hours replace the previous set'
);

insert into public.booking_blackouts(company_id, starts_at, ends_at, reason)
select '97000000-0000-4000-8000-000000000001', blackout_day - interval '1 hour', blackout_day + interval '6 hours', 'Team offsite'
from booking_fixture;

-- -----------------------------------------------------------------------------
-- Booking links
-- -----------------------------------------------------------------------------

create temporary table booking_link_fixture as
select link_id, reused from public.ensure_booking_link(
  '97000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000021', 'staff',
  '97000000-0000-4000-8000-000000000101');
grant select on booking_link_fixture to public;

select is((select reused from booking_link_fixture), false, 'the first link is issued');
select is(
  (select link_id from public.ensure_booking_link(
    '97000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000021', 'estimate_result', null)),
  (select link_id from booking_link_fixture),
  'a live link is reused instead of minting another'
);
select throws_ok(
  $$select * from public.ensure_booking_link(
    '97000000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000021', 'staff', null)$$,
  'P0001', 'Lead not found for company',
  'links never cross companies'
);

-- -----------------------------------------------------------------------------
-- Slot rules
-- -----------------------------------------------------------------------------

select is(public.virtual_consultation_slot_problem('97000000-0000-4000-8000-000000000001', (select ten_am from booking_fixture), null, pg_catalog.now()), null, 'an aligned slot inside hours is bookable');
select is(public.virtual_consultation_slot_problem('97000000-0000-4000-8000-000000000001', (select misaligned from booking_fixture), null, pg_catalog.now()), 'outside_hours', 'off-grid start times are refused');
select is(public.virtual_consultation_slot_problem('97000000-0000-4000-8000-000000000001', (select evening from booking_fixture), null, pg_catalog.now()), 'outside_hours', 'times outside weekly hours are refused');
select is(public.virtual_consultation_slot_problem('97000000-0000-4000-8000-000000000001', (select far_out from booking_fixture), null, pg_catalog.now()), 'too_far', 'times past the horizon are refused');
select is(public.virtual_consultation_slot_problem('97000000-0000-4000-8000-000000000001', pg_catalog.now() + interval '10 minutes', null, pg_catalog.now()), 'too_soon', 'times inside the notice window are refused');
select is(public.virtual_consultation_slot_problem('97000000-0000-4000-8000-000000000001', (select blackout_day from booking_fixture), null, pg_catalog.now()), 'blackout', 'blackouts remove slots');
select is(public.virtual_consultation_slot_problem('97000000-0000-4000-8000-000000000002', (select ten_am from booking_fixture), null, pg_catalog.now()), 'booking_disabled', 'companies without settings cannot be booked');

-- -----------------------------------------------------------------------------
-- Booking
-- -----------------------------------------------------------------------------

create temporary table booking_result as
select * from public.book_virtual_consultation(
  (select link_id from booking_link_fixture), (select ten_am from booking_fixture), null, '  Hail damage on the back slope  ', '203.0.113.10');
grant select on booking_result to public;

select is((select outcome from booking_result), 'booked', 'the homeowner books the slot');
select is(
  (select attendee_email from public.appointments where id = (select appointment_id from booking_result)),
  'jordan@example.com',
  'the invite defaults to the lead''s email, normalized'
);
select is(
  (select customer_notes from public.appointments where id = (select appointment_id from booking_result)),
  'Hail damage on the back slope',
  'the homeowner''s notes are kept, trimmed'
);
select is(
  (select row(meeting_type, booking_source, status::text, calendar_sync_status, rep_id is null)::text
   from public.appointments where id = (select appointment_id from booking_result)),
  '(virtual,self_service,scheduled,pending,t)',
  'the booking lands as an unassigned virtual consultation awaiting calendar sync'
);
select is(
  (select stage::text from public.leads where id = '97000000-0000-4000-8000-000000000021'),
  'appointment_set',
  'booking moves an early-stage lead to appointment set'
);
select is(
  (select pg_catalog.count(*)::int from public.lead_stage_history
   where lead_id = '97000000-0000-4000-8000-000000000021' and to_stage = 'appointment_set'),
  1,
  'the stage change is recorded'
);
select is(
  (select event_name from public.domain_events where id = ((select event from booking_result)->>'id')::uuid),
  'appointments/virtual.booked',
  'booking queues the calendar sync event'
);
select ok(
  (select expires_at >= (select ten_am from booking_fixture) + interval '2 days'
   from public.booking_links where id = (select link_id from booking_link_fixture)),
  'the link stays valid past the meeting so it can manage the booking'
);

select is(
  (select outcome from public.book_virtual_consultation(
    (select link_id from booking_link_fixture), (select eleven_am from booking_fixture), null, null, '203.0.113.10')),
  'already_booked',
  'a lead holds one live self-booked consultation'
);

-- A second lead competes for the same and the adjacent slots.
create temporary table second_link as
select link_id from public.ensure_booking_link(
  '97000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000022', 'staff', null);
grant select on second_link to public;

select is(
  (select row(outcome, problem)::text from public.book_virtual_consultation(
    (select link_id from second_link), (select ten_am from booking_fixture), null, null, '203.0.113.11')),
  '(unavailable,full)',
  'a full slot is refused'
);
select is(
  (select stage::text from public.leads where id = '97000000-0000-4000-8000-000000000022'),
  'proposal_sent',
  'a refused booking changes nothing on the lead'
);

update public.booking_settings set buffer_minutes = 15 where company_id = '97000000-0000-4000-8000-000000000001';
select is(
  public.virtual_consultation_slot_problem('97000000-0000-4000-8000-000000000001', (select ten_thirty from booking_fixture), null, pg_catalog.now()),
  'full',
  'the buffer keeps back-to-back meetings apart'
);
update public.booking_settings set buffer_minutes = 0, concurrent_capacity = 2 where company_id = '97000000-0000-4000-8000-000000000001';

select is(
  (select outcome from public.book_virtual_consultation(
    (select link_id from second_link), (select ten_am from booking_fixture), 'sam.alt@example.com', null, '203.0.113.11')),
  'booked',
  'raising capacity lets a second meeting share the slot'
);
select is(
  (select stage::text from public.leads where id = '97000000-0000-4000-8000-000000000022'),
  'proposal_sent',
  'booking never moves a lead backwards'
);

-- -----------------------------------------------------------------------------
-- Guard, reschedule, cancel
-- -----------------------------------------------------------------------------

select throws_ok(
  format($$update public.appointments set scheduled_at = scheduled_at + interval '1 hour' where id = %L$$,
    (select appointment_id from booking_result)),
  'P0001', 'Virtual consultations are moved or cancelled through the booking functions',
  'a direct move would leave the calendar wrong, so it is refused'
);
select lives_ok(
  format($$update public.appointments set status = 'confirmed', notes = 'Confirmed by phone' where id = %L$$,
    (select appointment_id from booking_result)),
  'staff can still confirm and annotate a virtual consultation'
);

select is(
  (select row(outcome, revision)::text from public.reschedule_virtual_consultation(
    (select link_id from booking_link_fixture), (select eleven_am from booking_fixture), '203.0.113.10')),
  '(rescheduled,2)',
  'the homeowner moves the consultation and the revision advances'
);
select is(
  (select row(status::text, reschedule_count, calendar_sync_status)::text
   from public.appointments where id = (select appointment_id from booking_result)),
  '(scheduled,1,pending)',
  'a moved consultation is scheduled again and re-synced'
);
select is(
  (select outcome from public.reschedule_virtual_consultation(
    (select link_id from booking_link_fixture), (select eleven_am from booking_fixture), '203.0.113.10')),
  'unchanged',
  'picking the same time again is a no-op'
);

select is(
  (select outcome from public.cancel_virtual_consultation((select link_id from booking_link_fixture), '203.0.113.10')),
  'cancelled',
  'the homeowner cancels from the same link'
);
select is(
  (select row(status::text, cancelled_by, revision)::text
   from public.appointments where id = (select appointment_id from booking_result)),
  '(cancelled,customer,3)',
  'the cancellation is attributed and versioned'
);
select is(
  (select pg_catalog.count(*)::int from public.domain_events
   where correlation_id = (select appointment_id from booking_result)),
  3,
  'book, move and cancel each queue one calendar sync'
);
select is(
  (select outcome from public.cancel_virtual_consultation((select link_id from booking_link_fixture), '203.0.113.10')),
  'not_found',
  'cancelling twice finds nothing to cancel'
);

-- -----------------------------------------------------------------------------
-- Rate limits, expiry
-- -----------------------------------------------------------------------------

insert into public.booking_attempts(company_id, booking_link_id, action, request_ip)
select '97000000-0000-4000-8000-000000000001', link_id, 'book', '198.51.100.7'
from booking_link_fixture, pg_catalog.generate_series(1, 10);
select throws_ok(
  format($$select * from public.book_virtual_consultation(%L, %L, null, null, '198.51.100.8')$$,
    (select link_id from booking_link_fixture), (select eleven_am from booking_fixture)),
  'P0001', 'Booking rate limit exceeded',
  'a link is limited to ten changes an hour'
);

update public.booking_links
set created_at = pg_catalog.now() - interval '40 days', expires_at = pg_catalog.now() - interval '1 day'
where id = (select link_id from second_link);
select throws_ok(
  format($$select * from public.cancel_virtual_consultation(%L, '203.0.113.11')$$, (select link_id from second_link)),
  'P0001', 'Booking link expired',
  'expired links stop working'
);

-- -----------------------------------------------------------------------------
-- Tenant isolation
-- -----------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"97000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
set local role authenticated;
select is((select pg_catalog.count(*)::int from public.booking_settings), 1, 'company admins read their booking settings');
select is((select pg_catalog.count(*)::int from public.booking_links), 2, 'company admins read their booking links');
reset role;

select set_config('request.jwt.claims', '{"sub":"97000000-0000-4000-8000-000000000102","role":"authenticated"}', true);
set local role authenticated;
select is((select pg_catalog.count(*)::int from public.booking_links), 0, 'other companies see no booking links');
reset role;

select * from finish();
rollback;

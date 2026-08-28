# Cal.com Post-Assessment Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every completed roof assessment book, display, reschedule, cancel, and rebook one Cal.com-managed 30-minute phone consultation while PIW maintains an idempotent operational appointment projection.

**Architecture:** The assessment result creates a two-hour opaque booking session and mounts Cal.com's React embed inside an accessible PIW modal. Browser events drive loading and immediate feedback; an HMAC-verified Cal.com webhook is authoritative and calls one transactional database function that records the inbound event, updates the appointment projection, and appends lifecycle/timeline events. Public appointment status is token-scoped and contains only fields required by the homeowner.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Zod 4, `@calcom/embed-react` 1.5.3, Supabase/Postgres with pgTAP, Inngest outbox, Vitest, Testing Library, Node `crypto`.

**Spec:** `docs/superpowers/specs/2026-08-28-calcom-post-assessment-scheduling-design.md`

**Prerequisite:** Complete `docs/superpowers/plans/2026-08-28-privacy-consent-foundation.md` first. This plan consumes `VerifiedConsent`, `verifyConsentCookie()`, and the `piw-privacy-v1` cookie.

## Global Constraints

- Scheduling appears only after `roof_assessments.status = 'completed'`.
- It appears for ready, manual-review, pending calculation, and unavailable-estimate results.
- Event duration is exactly 30 minutes.
- Display timezone is always `America/New_York`; do not detect or substitute browser timezone.
- Availability is configured in Cal.com: Monday–Friday, 9:00 AM–5:00 PM Eastern, 24-hour minimum notice, 15-minute buffer, rolling 14-day horizon.
- All Season calls the appointment-specific homeowner phone number.
- Only one `scheduled` or `confirmed` appointment may exist per assessment.
- A cancelled appointment remains historical and permits a new appointment row.
- Cal.com emails confirmation immediately and reminders 24 hours and 1 hour before; PIW sends no duplicate booking reminder.
- Webhook signature header is `X-Cal-Signature-256`; verification is HMAC-SHA256 over the exact raw body.
- Accepted launch triggers are exactly `BOOKING_CREATED`, `BOOKING_RESCHEDULED`, and `BOOKING_CANCELLED`.
- Booking-session lifetime is exactly two hours.
- Embed load timeout is 12 seconds; confirmation polling is every 500 ms for at most 10 seconds.
- Preserve existing user-owned uncommitted changes, especially in `globals.css`, middleware, lead intake, and campaign files.

---

## File Map

- `package.json`, `package-lock.json` — pin `@calcom/embed-react` 1.5.3.
- `src/lib/env/server.ts`, `src/lib/env/shared.test.ts` — all-or-none Cal.com server configuration.
- `supabase/migrations/20260828130000_calcom_scheduling.sql` — booking sessions, provider UID history, appointment extensions, active uniqueness, interaction linkage, transactional RPCs.
- `supabase/tests/calcom-scheduling.test.sql` — database and concurrency contract.
- `src/modules/appointments/calcom-contracts.ts` — strict webhook and public response schemas.
- `src/modules/appointments/calcom-signature.ts` — raw-body HMAC verification.
- `src/modules/appointments/calcom-links.ts` — hosted management URL generation.
- `src/modules/appointments/calcom-repository.ts` — booking session, webhook, and status repository.
- `src/modules/appointments/calcom-webhook.ts` — pure verified-payload normalization and application service.
- `src/domain/events.ts`, `src/domain/events.test.ts` — appointment lifecycle domain events.
- `src/app/api/integrations/calcom/webhook/route.ts` — bounded raw webhook endpoint.
- `src/app/api/integrations/calcom/webhook/route.test.ts` — signature, schema, and response tests.
- `src/app/api/roof-estimate/[token]/booking-session/route.ts` — token-scoped embed session endpoint.
- `src/app/api/roof-estimate/[token]/booking-session/route.test.ts` — authorization and public shape tests.
- `src/app/api/roof-estimate/[token]/appointment/route.ts` — no-store appointment status endpoint.
- `src/app/api/roof-estimate/[token]/appointment/route.test.ts` — public-safe state tests.
- `src/app/roof-estimate/[token]/consultation-preference-form.tsx` — existing callback UI extracted intact.
- `src/app/roof-estimate/[token]/appointment-card.tsx` — confirmed appointment state.
- `src/app/roof-estimate/[token]/calcom-scheduling-modal.tsx` — embed lifecycle and fallbacks.
- `src/app/roof-estimate/[token]/assessment-scheduling.tsx` — primary/secondary CTA orchestration.
- `src/app/roof-estimate/[token]/assessment-result.tsx` — delegates scheduling instead of owning its form.
- `src/app/roof-estimate/[token]/page.tsx` — loads public-safe active appointment.
- `src/app/roof-estimate/[token]/assessment.css` — scheduling styles appended within the existing scoped design.
- `src/app/roof-estimate/[token]/*.test.tsx` — focused component and integration tests.
- `src/lib/database.types.ts` — regenerated schema types.
- `docs/runbooks/calcom-scheduling.md` — account, event, webhook, smoke-test, and emergency-disable procedure.

### Task 1: Pin the Cal.com embed and validate configuration

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/lib/env/server.ts`
- Modify: `src/lib/env/shared.test.ts`

**Interfaces:**
- Produces: `ServerEnv` fields `CALCOM_SCHEDULING_ENABLED`, `CALCOM_ORIGIN`, `CALCOM_EVENT_LINK`, `CALCOM_EVENT_TYPE_ID`, `CALCOM_ORGANIZER_EMAIL`, `CALCOM_API_KEY`, `CALCOM_WEBHOOK_SECRET`, and `CALCOM_BOOKING_SESSION_SECRET`.

- [ ] **Step 1: Write failing environment tests**

```ts
test("Cal.com scheduling requires its complete configuration", () => {
  expect(() => parseServerEnv({
    ...validServerEnv,
    CALCOM_SCHEDULING_ENABLED: "true",
    CALCOM_ORIGIN: "https://cal.com",
    CALCOM_EVENT_LINK: "all-season/roof-consultation",
    CALCOM_EVENT_TYPE_ID: "12345",
  })).toThrow(/Cal.com scheduling requires/i);
});

test("accepts complete Cal.com configuration", () => {
  expect(parseServerEnv({
    ...validServerEnv,
    CALCOM_SCHEDULING_ENABLED: "true",
    CALCOM_ORIGIN: "https://cal.com",
    CALCOM_EVENT_LINK: "all-season/roof-consultation",
    CALCOM_EVENT_TYPE_ID: "12345",
    CALCOM_ORGANIZER_EMAIL: "appointments@example.com",
    CALCOM_API_KEY: "cal_test_key",
    CALCOM_WEBHOOK_SECRET: "0123456789abcdef0123456789abcdef",
    CALCOM_BOOKING_SESSION_SECRET: "abcdef0123456789abcdef0123456789",
  }).CALCOM_EVENT_TYPE_ID).toBe(12345);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:run -- src/lib/env/shared.test.ts`

Expected: FAIL because Cal.com fields are absent.

- [ ] **Step 3: Install and implement the environment schema**

Run: `npm install @calcom/embed-react@1.5.3 --save-exact`

Add optional preprocessors for URL, positive integer, email, and minimum-32-byte secrets. `CALCOM_ORIGIN` defaults to `https://cal.com` only after parsing. In `superRefine`, when `CALCOM_SCHEDULING_ENABLED` is true, require every listed field and require `ROOF_ASSESSMENT_ENABLED`.

```ts
CALCOM_SCHEDULING_ENABLED: booleanString,
CALCOM_ORIGIN: optionalUrl,
CALCOM_EVENT_LINK: optionalString,
CALCOM_EVENT_TYPE_ID: z.preprocess(
  value => value === "" || value === undefined ? undefined : Number(value),
  z.number().int().positive().optional(),
),
CALCOM_ORGANIZER_EMAIL: z.preprocess(
  value => value === "" ? undefined : value,
  z.email().optional(),
),
CALCOM_API_KEY: optionalString,
CALCOM_WEBHOOK_SECRET: optionalSigningSecret,
CALCOM_BOOKING_SESSION_SECRET: optionalSigningSecret,
```

- [ ] **Step 4: Run tests and dependency checks**

Run: `npm run test:run -- src/lib/env/shared.test.ts`

Expected: PASS.

Run: `npm ls @calcom/embed-react`

Expected: exactly `@calcom/embed-react@1.5.3`.

- [ ] **Step 5: Commit configuration**

```bash
git add package.json package-lock.json src/lib/env/server.ts src/lib/env/shared.test.ts
git commit -m "build: configure Cal.com scheduling"
```

### Task 2: Add booking persistence and transactional lifecycle RPCs

**Files:**
- Create: `supabase/migrations/20260828130000_calcom_scheduling.sql`
- Create: `supabase/tests/calcom-scheduling.test.sql`

**Interfaces:**
- Produces: `calcom_booking_sessions`, `appointment_provider_refs`, extended `appointments`, `interactions.source_event_id`, `reserve_calcom_booking_session(uuid,uuid,bytea,timestamptz,uuid,text,boolean,boolean,jsonb,inet,text)`, and `apply_calcom_booking_event(uuid,text,bigint,text,text,bytea,timestamptz,integer,text,text,text,text,text,text,timestamptz,text,jsonb)`.
- Consumes: `piw-privacy-v1` consent snapshot, `integration_events`, `domain_events`, and `event_outbox`.

- [ ] **Step 1: Write the failing pgTAP contract**

```sql
begin;
select extensions.no_plan();

select has_table('public', 'calcom_booking_sessions');
select has_table('public', 'appointment_provider_refs');
select has_column('public', 'appointments', 'assessment_id');
select has_column('public', 'appointments', 'provider_booking_uid');
select has_column('public', 'appointments', 'contact_review_required');
select has_column('public', 'interactions', 'source_event_id');

insert into public.companies(id, name)
values ('f9000000-0000-4000-8000-000000000001', 'Cal.com Test Company');

create temp table calcom_assessment_fixture as
select * from public.start_or_resume_roof_assessment(
  'f9000000-0000-4000-8000-000000000001',
  'f9000000-0000-4000-8000-000000000002',
  'Cal Homeowner', '+17325550123', 'owner@example.com',
  '28 Test Lane, Red Bank, NJ 07701', 'ChIJ-calcom-test',
  'all-season-main', 'main-home',
  '{"utm_source":"facebook","fbp":"fb.1.100.200"}'::jsonb,
  null, 'all-season-assessment-v1', '2026-08-28T12:00:00Z',
  '127.0.0.1', 'pgTAP'
);

update public.roof_assessments
set status='completed', recommendation='professional_inspection',
    completed_at='2026-08-28T12:05:00Z'
where id=(select assessment_id from public.roof_assessment_access_attempts
          where id=(select attempt_id from calcom_assessment_fixture));

select lives_ok($$
  select * from public.reserve_calcom_booking_session(
    'f9000000-0000-4000-8000-000000000001',
    (select assessment_id from public.roof_assessment_access_attempts
     where id=(select attempt_id from calcom_assessment_fixture)),
    decode(repeat('ab', 32), 'hex'),
    '2026-08-28T14:00:00Z',
    null, 'piw-privacy-v1', false, false, '{}'::jsonb, null, null
  )
$$, 'completed assessment can reserve a booking session');

select throws_ok($$
  select * from public.reserve_calcom_booking_session(
    'f9000000-0000-4000-8000-000000000001',
    'f9000000-0000-4000-8000-000000000099',
    decode(repeat('cd', 32), 'hex'),
    '2026-08-28T14:00:00Z',
    null, 'piw-privacy-v1', false, false, '{}'::jsonb, null, null
  )
$$, 'P0001', 'Completed assessment not found', 'incomplete or unknown assessment fails closed');

select lives_ok($$select * from public.apply_calcom_booking_event(
  'f9000000-0000-4000-8000-000000000001', 'BOOKING_CREATED', 12345,
  'appointments@example.com', 'booking-uid-1', decode(repeat('ab',32),'hex'),
  '2026-08-29T14:00:00Z', 30, 'America/New_York',
  'Cal Homeowner', 'owner@example.com', '+17325550123',
  'https://cal.com/reschedule/booking-uid-1',
  'https://cal.com/booking/booking-uid-1?cancel=true',
  '2026-08-28T12:10:00Z', 'calcom-created-booking-uid-1-20260828',
  '{"triggerEvent":"BOOKING_CREATED","uid":"booking-uid-1"}'::jsonb
)$$, 'creates the appointment projection');

select lives_ok($$select * from public.apply_calcom_booking_event(
  'f9000000-0000-4000-8000-000000000001', 'BOOKING_CREATED', 12345,
  'appointments@example.com', 'booking-uid-1', decode(repeat('ab',32),'hex'),
  '2026-08-29T14:00:00Z', 30, 'America/New_York',
  'Cal Homeowner', 'owner@example.com', '+17325550123',
  'https://cal.com/reschedule/booking-uid-1',
  'https://cal.com/booking/booking-uid-1?cancel=true',
  '2026-08-28T12:10:00Z', 'calcom-created-booking-uid-1-20260828',
  '{"triggerEvent":"BOOKING_CREATED","uid":"booking-uid-1"}'::jsonb
)$$, 'replayed create returns the canonical result');

select is((select count(*) from public.appointments where source='calcom'), 1::bigint,
          'create retry leaves one appointment');
select is((select count(*) from public.integration_events where source_system='calcom'), 1::bigint,
          'create retry leaves one integration event');
select is((select count(*) from public.domain_events where event_name='appointments/scheduled'), 1::bigint,
          'create retry leaves one scheduled domain event');

select lives_ok($$select * from public.apply_calcom_booking_event(
  'f9000000-0000-4000-8000-000000000001', 'BOOKING_RESCHEDULED', 12345,
  'appointments@example.com', 'booking-uid-2', decode(repeat('ab',32),'hex'),
  '2026-08-30T15:00:00Z', 30, 'America/New_York',
  'Cal Homeowner', 'owner@example.com', '+17325550123',
  'https://cal.com/reschedule/booking-uid-2',
  'https://cal.com/booking/booking-uid-2?cancel=true',
  '2026-08-28T13:00:00Z', 'calcom-rescheduled-booking-uid-2-20260828',
  '{"triggerEvent":"BOOKING_RESCHEDULED","uid":"booking-uid-2"}'::jsonb
)$$, 'reschedules the same appointment');
select is((select count(*) from public.appointments where source='calcom'), 1::bigint,
          'reschedule does not create another appointment');
select is((select scheduled_at from public.appointments where source='calcom'),
          '2026-08-30T15:00:00Z'::timestamptz, 'reschedule updates the time');

select lives_ok($$select * from public.apply_calcom_booking_event(
  'f9000000-0000-4000-8000-000000000001', 'BOOKING_CANCELLED', 12345,
  'appointments@example.com', 'booking-uid-2', null,
  '2026-08-30T15:00:00Z', 30, 'America/New_York',
  'Cal Homeowner', 'owner@example.com', '+17325550123',
  'https://cal.com/reschedule/booking-uid-2',
  'https://cal.com/booking/booking-uid-2?cancel=true',
  '2026-08-28T13:30:00Z', 'calcom-cancelled-booking-uid-2-20260828',
  '{"triggerEvent":"BOOKING_CANCELLED","uid":"booking-uid-2"}'::jsonb
)$$, 'cancels through the historical provider UID');
select is((select status from public.appointments where source='calcom'),
          'cancelled'::public.appointment_status, 'appointment is cancelled');

select * from finish();
rollback;
```

Add this concurrency block after reserving hashes `ef…ef` and `12…12` for the same completed assessment:

```sql
select lives_ok($$select * from public.reserve_calcom_booking_session(
  'f9000000-0000-4000-8000-000000000001',
  (select assessment_id from public.roof_assessment_access_attempts
   where id=(select attempt_id from calcom_assessment_fixture)),
  decode(repeat('ef',32),'hex'),'2026-08-28T16:00:00Z',null,
  'piw-privacy-v1',false,false,'{}'::jsonb,null,null
)$$, 'reserves first race session');
select lives_ok($$select * from public.reserve_calcom_booking_session(
  'f9000000-0000-4000-8000-000000000001',
  (select assessment_id from public.roof_assessment_access_attempts
   where id=(select attempt_id from calcom_assessment_fixture)),
  decode(repeat('12',32),'hex'),'2026-08-28T16:00:00Z',null,
  'piw-privacy-v1',false,false,'{}'::jsonb,null,null
)$$, 'reserves second race session');
select lives_ok($$select extensions.dblink_connect(
  'calcom_race_gate','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres'
)$$, 'Cal.com race gate connects');
select lives_ok($$select extensions.dblink_connect(
  'calcom_race_a','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres'
)$$, 'first Cal.com worker connects');
select lives_ok($$select extensions.dblink_connect(
  'calcom_race_b','host=host.docker.internal port=56322 dbname=postgres user=postgres password=postgres'
)$$, 'second Cal.com worker connects');
select is(extensions.dblink_exec('calcom_race_gate', $$begin; do $lock$ begin
  perform 1 from public.roof_assessments
  where company_id='f9000000-0000-4000-8000-000000000001'
  for update;
end $lock$;$$), 'DO', 'race gate locks the assessment');
select is(extensions.dblink_send_query('calcom_race_a', $$
  select appointment_id from public.apply_calcom_booking_event(
    'f9000000-0000-4000-8000-000000000001','BOOKING_CREATED',12345,
    'appointments@example.com','race-uid-a',decode(repeat('ef',32),'hex'),
    '2026-09-01T14:00:00Z',30,'America/New_York','Cal Homeowner',
    'owner@example.com','+17325550123','https://cal.com/reschedule/race-uid-a',
    'https://cal.com/booking/race-uid-a?cancel=true','2026-08-28T14:00:00Z',
    'calcom-race-a','{"triggerEvent":"BOOKING_CREATED","uid":"race-uid-a"}'::jsonb)
$$), 1, 'first worker dispatched');
select is(extensions.dblink_send_query('calcom_race_b', $$
  select appointment_id from public.apply_calcom_booking_event(
    'f9000000-0000-4000-8000-000000000001','BOOKING_CREATED',12345,
    'appointments@example.com','race-uid-b',decode(repeat('12',32),'hex'),
    '2026-09-01T15:00:00Z',30,'America/New_York','Cal Homeowner',
    'owner@example.com','+17325550123','https://cal.com/reschedule/race-uid-b',
    'https://cal.com/booking/race-uid-b?cancel=true','2026-08-28T14:00:01Z',
    'calcom-race-b','{"triggerEvent":"BOOKING_CREATED","uid":"race-uid-b"}'::jsonb)
$$), 1, 'second worker dispatched');
select is(extensions.dblink_is_busy('calcom_race_a'), 1, 'first worker waits');
select is(extensions.dblink_is_busy('calcom_race_b'), 1, 'second worker waits');
select is(extensions.dblink_exec('calcom_race_gate','commit'), 'COMMIT', 'gate releases workers');
create temp table calcom_race_results(appointment_id uuid);
insert into calcom_race_results
  select appointment_id from extensions.dblink_get_result('calcom_race_a') as row(appointment_id uuid);
insert into calcom_race_results
  select appointment_id from extensions.dblink_get_result('calcom_race_b') as row(appointment_id uuid);
select is((select count(distinct appointment_id) from calcom_race_results), 1::bigint,
          'concurrent creates return one canonical appointment');
select ok(extensions.dblink_disconnect('calcom_race_a')='OK', 'first worker disconnects');
select ok(extensions.dblink_disconnect('calcom_race_b')='OK', 'second worker disconnects');
select ok(extensions.dblink_disconnect('calcom_race_gate')='OK', 'gate disconnects');
```

- [ ] **Step 2: Run the focused database test and verify failure**

Run: `npx supabase test db supabase/tests/calcom-scheduling.test.sql`

Expected: FAIL because the scheduling tables and functions do not exist.

- [ ] **Step 3: Implement the schema and functions**

Add nullable columns for legacy appointments and strict checks for Cal.com rows:

```sql
alter table public.appointments
  add column property_id uuid,
  add column estimate_id uuid,
  add column assessment_id uuid,
  add column source text not null default 'manual'
    check (source in ('manual','calcom')),
  add column provider_booking_uid text,
  add column provider_event_type_id bigint,
  add column timezone text,
  add column attendee_name text,
  add column attendee_email_normalized text,
  add column attendee_phone_e164 text,
  add column reschedule_url text,
  add column cancellation_url text,
  add column provider_synced_at timestamptz,
  add column contact_review_required boolean not null default false,
  add column meta_event_id uuid not null default extensions.gen_random_uuid();

create unique index appointments_calcom_uid_idx
  on public.appointments(company_id, provider_booking_uid)
  where provider_booking_uid is not null;
create unique index appointments_one_active_assessment_idx
  on public.appointments(company_id, assessment_id)
  where assessment_id is not null and status in ('scheduled','confirmed');
```

Create `calcom_booking_sessions` with SHA-256 `secret_hash`, derived relationship IDs, event type, two-hour expiry, consumption fields, consent ID/version/booleans, bounded JSON attribution snapshot, nullable `client_ip_address inet`, and a user agent capped at 512 characters. Store IP/user agent only when Advertising consent is true; otherwise store null. Create `appointment_provider_refs` so old and new UIDs from reschedules both resolve to one appointment. Add `interactions.source_event_id uuid unique references domain_events(id)`.

`reserve_calcom_booking_session` must lock the completed assessment, reject an existing active appointment, derive all relationship IDs server-side, and store no raw secret.

`apply_calcom_booking_event` must run as one security-definer transaction. It must:

1. Validate trigger, event type, organizer email, duration, Eastern timezone contract, booking session or historical provider ref, and company relationships.
2. Insert minimized `integration_events` with a deterministic SHA-256 idempotency key.
3. Return the existing canonical result on duplicate integration delivery.
4. Insert on create, update the same row on reschedule, and mark cancelled on cancellation.
5. Add/update provider refs for every seen UID.
6. Compare normalized attendee phone/email to the lead and set `contact_review_required` without changing `leads`.
7. Update an existing `consultation_requests` row to `booked` and set `booking_reference`; do not create one.
8. Insert one appointment domain event and `event_outbox` row.
9. Insert one `interactions(type='note')` row linked by `source_event_id` with a human-readable Eastern timestamp.
10. Return public-safe appointment fields and never return internal relationship IDs.

- [ ] **Step 4: Run focused, canonical journey, and full database tests**

Run: `npx supabase test db supabase/tests/calcom-scheduling.test.sql supabase/tests/canonical_roof_assessment_journey.test.sql supabase/tests/appointments-reps.test.sql`

Expected: PASS.

Run: `npm run db:test`

Expected: PASS.

- [ ] **Step 5: Commit persistence**

```bash
git add supabase/migrations/20260828130000_calcom_scheduling.sql supabase/tests/calcom-scheduling.test.sql
git commit -m "feat: persist Cal.com appointment lifecycle"
```

### Task 3: Define strict Cal.com contracts and signature verification

**Files:**
- Create: `src/modules/appointments/calcom-contracts.ts`
- Create: `src/modules/appointments/calcom-contracts.test.ts`
- Create: `src/modules/appointments/calcom-signature.ts`
- Create: `src/modules/appointments/calcom-signature.test.ts`
- Create: `src/modules/appointments/calcom-links.ts`
- Create: `src/modules/appointments/calcom-links.test.ts`

**Interfaces:**
- Produces: `parseCalcomWebhook()`, `verifyCalcomSignature()`, `CalcomBookingEvent`, `PublicAppointment`, and `calcomManagementLinks()`.

- [ ] **Step 1: Write failing contract and HMAC tests**

```ts
test("verifies X-Cal-Signature-256 against the exact raw body", () => {
  const raw = JSON.stringify({triggerEvent: "BOOKING_CREATED"});
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  expect(verifyCalcomSignature(raw, signature, secret)).toBe(true);
  expect(verifyCalcomSignature(`${raw}\n`, signature, secret)).toBe(false);
});

test("normalizes an accepted booking with PIW metadata", () => {
  expect(parseCalcomWebhook(createdFixture)).toEqual(expect.objectContaining({
    trigger: "BOOKING_CREATED",
    bookingUid: "bFJeNb2uX8ANpT3JL5EfXw",
    eventTypeId: 12345,
    durationMinutes: 30,
    bookingSessionSecret: "opaque-session-secret",
    attendee: expect.objectContaining({email: "owner@example.com"}),
  }));
});

test.each(["BOOKING_PAID", "FORM_SUBMITTED", "MEETING_STARTED"])(
  "rejects unsupported trigger %s",
  trigger => expect(() => parseCalcomWebhook({...createdFixture, triggerEvent: trigger}))
    .toThrow(/Unsupported Cal.com trigger/),
);

test("builds hosted management links", () => {
  expect(calcomManagementLinks("https://cal.com", "abc/123")).toEqual({
    rescheduleUrl: "https://cal.com/reschedule/abc%2F123",
    cancellationUrl: "https://cal.com/booking/abc%2F123?cancel=true",
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:run -- src/modules/appointments/calcom-contracts.test.ts src/modules/appointments/calcom-signature.test.ts src/modules/appointments/calcom-links.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement strict parsing and helpers**

```ts
export type CalcomBookingEvent = {
  trigger: "BOOKING_CREATED" | "BOOKING_RESCHEDULED" | "BOOKING_CANCELLED";
  occurredAt: string;
  bookingUid: string;
  eventTypeId: number;
  organizerEmail: string;
  startTime: string;
  endTime: string;
  durationMinutes: 30;
  status: string;
  bookingSessionSecret: string | null;
  attendee: {name: string; email: string; phone: string};
};
```

Use strict Zod schemas for the nested booking payload documented by Cal.com. Accept attendee phone from the configured phone booking question or `responses.location.value.optionValue` when `location.value === 'phone'`. Require one attendee, ISO times, a positive event type ID, nonempty UID, and exactly 30 calculated minutes.

`verifyCalcomSignature` must reject missing, non-hex, or wrong-length headers before `timingSafeEqual`. `calcomManagementLinks` must accept only `https:` Cal.com origin and URL-encode the UID.

- [ ] **Step 4: Run focused tests**

Run: `npm run test:run -- src/modules/appointments/calcom-contracts.test.ts src/modules/appointments/calcom-signature.test.ts src/modules/appointments/calcom-links.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit contracts**

```bash
git add src/modules/appointments/calcom-contracts.ts src/modules/appointments/calcom-contracts.test.ts src/modules/appointments/calcom-signature.ts src/modules/appointments/calcom-signature.test.ts src/modules/appointments/calcom-links.ts src/modules/appointments/calcom-links.test.ts
git commit -m "feat: validate Cal.com booking events"
```

### Task 4: Implement booking session and appointment status services

**Files:**
- Create: `src/modules/appointments/calcom-repository.ts`
- Create: `src/modules/appointments/public-scheduling.ts`
- Create: `src/modules/appointments/public-scheduling.test.ts`
- Create: `src/app/api/roof-estimate/[token]/booking-session/route.ts`
- Create: `src/app/api/roof-estimate/[token]/booking-session/route.test.ts`
- Create: `src/app/api/roof-estimate/[token]/appointment/route.ts`
- Create: `src/app/api/roof-estimate/[token]/appointment/route.test.ts`

**Interfaces:**
- Produces: `startPublicBookingSession(token, context, repository)`, `getPublicAppointment(token, repository)`, `POST /api/roof-estimate/[token]/booking-session`, and `GET /api/roof-estimate/[token]/appointment`.
- Consumes: verified privacy cookie and the database RPCs from Task 2.

- [ ] **Step 1: Write failing service and route tests**

```ts
test("returns editable prefill and opaque metadata for a completed assessment", async () => {
  const result = await startPublicBookingSession(token, {
    calLink: "all-season/roof-consultation",
    eventTypeId: 12345,
    sessionSecret: () => "opaque-session-secret-with-enough-entropy",
    now: () => new Date("2026-08-28T12:00:00Z"),
    consent: rejectedConsent,
    currentAttribution: {utm_source: "facebook"},
  }, repository);
  expect(result).toEqual({
    calLink: "all-season/roof-consultation",
    namespace: "roof-consultation",
    timeoutMs: 12000,
    config: expect.objectContaining({
      name: "Home Owner",
      email: "owner@example.com",
      "metadata[piwBookingSession]": "opaque-session-secret-with-enough-entropy",
    }),
  });
  expect(JSON.stringify(result)).not.toContain(assessmentId);
  expect(JSON.stringify(result)).not.toContain(token);
});

test("fails closed for an incomplete assessment", async () => {
  await expect(startPublicBookingSession(token, context, missingRepository))
    .rejects.toMatchObject({status: 404});
});

test("returns only public appointment fields", async () => {
  const response = await handleAppointmentStatus(token, repository);
  expect(await response.json()).toEqual({appointment: {
    status: "confirmed",
    scheduledAt: "2026-08-29T14:00:00.000Z",
    durationMinutes: 30,
    timezone: "America/New_York",
    phone: "+17325550123",
    rescheduleUrl: "https://cal.com/reschedule/uid",
    cancellationUrl: "https://cal.com/booking/uid?cancel=true",
    metaEvent: null,
  }});
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:run -- src/modules/appointments/public-scheduling.test.ts 'src/app/api/roof-estimate/[token]/booking-session/route.test.ts' 'src/app/api/roof-estimate/[token]/appointment/route.test.ts'`

Expected: FAIL because the services and routes do not exist.

- [ ] **Step 3: Implement services and routes**

Define repository methods with exact signatures:

```ts
export interface CalcomSchedulingRepository {
  findCompletedProfileByToken(token: string): Promise<CompletedBookingProfile | null>;
  reserveSession(input: ReserveBookingSessionInput): Promise<void>;
  findPublicAppointmentByToken(token: string): Promise<PublicAppointment | null>;
  applyWebhook(input: ApplyCalcomWebhookInput): Promise<PublicAppointment>;
}
```

Generate 32 random bytes with `randomBytes(32).toString('base64url')`, hash with SHA-256 for persistence, and set expiry to `now + 2 hours`. Read the verified privacy cookie server-side and snapshot consent ID/version/booleans plus current UTM, referrer, `_fbp`, and `_fbc` only when permitted. When Advertising is granted, also snapshot the trusted request IP and a user agent truncated to 512 characters; otherwise pass null for both.

Prefill Cal.com with:

```ts
config: {
  name: profile.name,
  email: profile.email,
  attendeePhoneNumber: profile.phoneE164,
  propertyAddress: profile.address,
  timezone: "America/New_York",
  "metadata[piwBookingSession]": rawSessionSecret,
}
```

Both routes use `cache-control: no-store`, strict token validation, generic 404 for invalid/incomplete tokens, 409 when an active appointment exists, and 503 when disabled or unavailable.

- [ ] **Step 4: Run focused tests**

Run: `npm run test:run -- src/modules/appointments/public-scheduling.test.ts 'src/app/api/roof-estimate/[token]/booking-session/route.test.ts' 'src/app/api/roof-estimate/[token]/appointment/route.test.ts'`

Expected: PASS.

- [ ] **Step 5: Commit public scheduling services**

```bash
git add src/modules/appointments/calcom-repository.ts src/modules/appointments/public-scheduling.ts src/modules/appointments/public-scheduling.test.ts 'src/app/api/roof-estimate/[token]/booking-session' 'src/app/api/roof-estimate/[token]/appointment'
git commit -m "feat: expose public booking session state"
```

### Task 5: Add authoritative webhook ingestion and appointment events

**Files:**
- Create: `src/modules/appointments/calcom-webhook.ts`
- Create: `src/modules/appointments/calcom-webhook.test.ts`
- Create: `src/app/api/integrations/calcom/webhook/route.ts`
- Create: `src/app/api/integrations/calcom/webhook/route.test.ts`
- Modify: `src/domain/events.ts`
- Modify: `src/domain/events.test.ts`

**Interfaces:**
- Produces: appointment event schemas `appointments/scheduled`, `appointments/rescheduled`, `appointments/cancelled`; `handleCalcomWebhookRequest()`.
- Consumes: `verifyCalcomSignature()`, `parseCalcomWebhook()`, `calcomManagementLinks()`, and `repository.applyWebhook()`.

- [ ] **Step 1: Write failing event and route tests**

```ts
test.each([
  ["appointments/scheduled", "scheduled"],
  ["appointments/rescheduled", "rescheduled"],
  ["appointments/cancelled", "cancelled"],
] as const)("creates %s", (name, lifecycle) => {
  const event = makeDomainEvent({
    name,
    correlationId,
    leadId,
    data: {appointmentId, assessmentId, providerBookingUid: "uid", lifecycle},
    now,
  });
  expect(eventEnvelopeSchema.parse(event).name).toBe(name);
});

test("rejects an invalid signature before parsing or persistence", async () => {
  const applyWebhook = vi.fn();
  const response = await handleCalcomWebhookRequest(request(rawFixture, "bad"), {
    secret,
    expectedEventTypeId: 12345,
    expectedOrganizerEmail: "appointments@example.com",
    origin: "https://cal.com",
    applyWebhook,
  });
  expect(response.status).toBe(401);
  expect(applyWebhook).not.toHaveBeenCalled();
});

test("accepts a valid booking exactly once", async () => {
  const response = await handleCalcomWebhookRequest(signedRequest(createdFixture), dependencies);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({accepted: true});
  expect(dependencies.applyWebhook).toHaveBeenCalledWith(expect.objectContaining({
    trigger: "BOOKING_CREATED",
    rescheduleUrl: "https://cal.com/reschedule/bFJeNb2uX8ANpT3JL5EfXw",
  }));
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:run -- src/domain/events.test.ts src/modules/appointments/calcom-webhook.test.ts src/app/api/integrations/calcom/webhook/route.test.ts`

Expected: FAIL because lifecycle events and webhook handler do not exist.

- [ ] **Step 3: Implement lifecycle events and webhook handler**

Add a strict shared payload:

```ts
const appointmentLifecycleDataSchema = z.object({
  appointmentId: uuidSchema,
  assessmentId: uuidSchema,
  providerBookingUid: z.string().min(1),
  lifecycle: z.enum(["scheduled", "rescheduled", "cancelled"]),
}).strict();
```

Use an event envelope with required `leadId`, optional `pipelineRunId`, and no attendee PII. Add all three schemas to `eventEnvelopeSchema` and all three inputs to `EventInput`.

The route reads `request.text()`, rejects declared or actual bodies over 256 KiB with 413, verifies `x-cal-signature-256`, parses only after verification, validates expected event type and organizer, and calls the application service. Map failures to 400 malformed, 401 signature, 409 lifecycle conflict, and 503 retryable persistence error. All responses use `cache-control: no-store`.

Do not log the raw payload, attendee fields, signature, booking-session secret, or API key.

- [ ] **Step 4: Run focused and integration-event tests**

Run: `npm run test:run -- src/domain/events.test.ts src/modules/appointments/calcom-webhook.test.ts src/app/api/integrations/calcom/webhook/route.test.ts src/modules/integrations/record-integration-event.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit webhook ingestion**

```bash
git add src/domain/events.ts src/domain/events.test.ts src/modules/appointments/calcom-webhook.ts src/modules/appointments/calcom-webhook.test.ts src/app/api/integrations/calcom/webhook
git commit -m "feat: ingest signed Cal.com webhooks"
```

### Task 6: Build the modal, appointment card, and callback orchestration

**Files:**
- Create: `src/app/roof-estimate/[token]/consultation-preference-form.tsx`
- Create: `src/app/roof-estimate/[token]/appointment-card.tsx`
- Create: `src/app/roof-estimate/[token]/appointment-card.test.tsx`
- Create: `src/app/roof-estimate/[token]/calcom-scheduling-modal.tsx`
- Create: `src/app/roof-estimate/[token]/calcom-scheduling-modal.test.tsx`
- Create: `src/app/roof-estimate/[token]/assessment-scheduling.tsx`
- Create: `src/app/roof-estimate/[token]/assessment-scheduling.test.tsx`
- Modify: `src/app/roof-estimate/[token]/assessment.css`

**Interfaces:**
- Produces: `AssessmentScheduling({token, initialAppointment, consultationIntro, phoneDisplay, phoneHref})`.
- Consumes: booking-session/status APIs, `@calcom/embed-react`, and the existing consultation endpoint.

- [ ] **Step 1: Write failing component tests**

```tsx
test("shows scheduling primary and callback secondary", () => {
  render(<AssessmentScheduling {...props} initialAppointment={null} />);
  expect(screen.getByRole("button", {name: "Schedule a 30-minute phone consultation"})).toBeVisible();
  expect(screen.getByRole("button", {name: "Request a callback"})).toBeVisible();
});

test("opens an accessible full-screen modal and restores focus", async () => {
  render(<AssessmentScheduling {...props} initialAppointment={null} />);
  const trigger = screen.getByRole("button", {name: /Schedule a 30-minute/});
  fireEvent.click(trigger);
  expect(await screen.findByRole("dialog", {name: "Schedule your phone consultation"})).toBeVisible();
  fireEvent.keyDown(document, {key: "Escape"});
  expect(trigger).toHaveFocus();
});

test("switches to fallback after embed failure", async () => {
  render(<CalcomSchedulingModal {...modalProps} open />);
  fireCalEvent("linkFailed", {code: "LOAD_FAILED", msg: "failed"});
  expect(await screen.findByRole("button", {name: "Request a callback"})).toBeVisible();
  expect(screen.getByRole("link", {name: /Call/})).toHaveAttribute("href", props.phoneHref);
});

test("polls until PIW confirms and renders the appointment card", async () => {
  vi.useFakeTimers();
  mockFetch
    .mockResolvedValueOnce(Response.json(sessionFixture))
    .mockResolvedValueOnce(Response.json({appointment: null}))
    .mockResolvedValueOnce(Response.json({appointment: appointmentFixture}));
  render(<AssessmentScheduling {...props} initialAppointment={null} />);
  fireEvent.click(screen.getByRole("button", {name: /Schedule a 30-minute/}));
  fireCalEvent("bookingSuccessfulV2", bookingSuccessFixture);
  await vi.advanceTimersByTimeAsync(500);
  expect(await screen.findByText("Appointment scheduled")).toBeVisible();
});
```

- [ ] **Step 2: Run component tests and verify failure**

Run: `npm run test:run -- 'src/app/roof-estimate/[token]/appointment-card.test.tsx' 'src/app/roof-estimate/[token]/calcom-scheduling-modal.test.tsx' 'src/app/roof-estimate/[token]/assessment-scheduling.test.tsx'`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the focused components**

Move `ConsultationPreferenceForm` and its `callWindows` constant out of `assessment-result.tsx` without behavior changes.

Use Cal.com's namespaced React embed:

```tsx
<Cal
  namespace={session.namespace}
  calLink={session.calLink}
  config={session.config}
  style={{width: "100%", height: "100%", overflow: "auto"}}
/>
```

Register namespaced `linkReady`, `linkFailed`, and `bookingSuccessfulV2` listeners through `getCalApi`. Ignore internal events beginning with `__`. Clear the 12-second timer on ready/unmount. On success, render `Confirming your appointment`, poll at 500 ms for 10 seconds, then either commit the canonical appointment or show the provider-returned Eastern time with the email-confirmation explanation.

The modal must use `role="dialog"`, `aria-modal="true"`, focus sentinels or a tested focus-trap hook, Escape handling, focus restoration, background scroll lock, and reduced-motion-safe transitions. Keep fallback callback and phone controls inside the modal footer even when the embed is ready.

`AppointmentCard` formats with:

```ts
new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long", month: "long", day: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
})
```

- [ ] **Step 4: Run focused tests**

Run: `npm run test:run -- 'src/app/roof-estimate/[token]/appointment-card.test.tsx' 'src/app/roof-estimate/[token]/calcom-scheduling-modal.test.tsx' 'src/app/roof-estimate/[token]/assessment-scheduling.test.tsx'`

Expected: PASS.

- [ ] **Step 5: Commit scheduling UI**

```bash
git add 'src/app/roof-estimate/[token]/consultation-preference-form.tsx' 'src/app/roof-estimate/[token]/appointment-card.tsx' 'src/app/roof-estimate/[token]/appointment-card.test.tsx' 'src/app/roof-estimate/[token]/calcom-scheduling-modal.tsx' 'src/app/roof-estimate/[token]/calcom-scheduling-modal.test.tsx' 'src/app/roof-estimate/[token]/assessment-scheduling.tsx' 'src/app/roof-estimate/[token]/assessment-scheduling.test.tsx' 'src/app/roof-estimate/[token]/assessment.css'
git commit -m "feat: add branded Cal.com scheduling modal"
```

### Task 7: Integrate scheduling into every completed assessment result

**Files:**
- Modify: `src/app/roof-estimate/[token]/assessment-result.tsx`
- Modify: `src/app/roof-estimate/[token]/assessment-result.test.tsx`
- Modify: `src/app/roof-estimate/[token]/page.tsx`
- Modify: `src/app/roof-estimate/[token]/page.test.tsx`
- Modify: `src/app/roof-estimate/[token]/public-estimate-flow.test.ts`

**Interfaces:**
- Consumes: `getPublicAppointment()` and `AssessmentScheduling`.
- Produces: one scheduling entry point for every completed assessment result state.

- [ ] **Step 1: Extend failing result/page tests**

```tsx
test.each([
  {status: "ready", source: "google", lowCents: 1800000, highCents: 2600000, roofSquares: 23, generatedAt: now},
  {status: "pending"},
  {status: "review_required", reason: "low_confidence"},
] as CalculationState[])("shows scheduling for completed result %o", calculation => {
  renderResult(calculation);
  expect(screen.getByRole("button", {name: "Schedule a 30-minute phone consultation"})).toBeVisible();
  expect(screen.getByRole("button", {name: "Request a callback"})).toBeVisible();
});

test("server renders an existing active appointment", async () => {
  database.results.set("appointments", result([appointmentRow]));
  const page = await RoofEstimateResultPage({params: Promise.resolve({token})});
  render(page);
  expect(screen.getByText("Appointment scheduled")).toBeVisible();
  expect(screen.queryByRole("button", {name: /Schedule a 30-minute/})).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:run -- 'src/app/roof-estimate/[token]/assessment-result.test.tsx' 'src/app/roof-estimate/[token]/page.test.tsx' 'src/app/roof-estimate/[token]/public-estimate-flow.test.ts'`

Expected: FAIL because the old recommendation CTA still owns the flow.

- [ ] **Step 3: Replace old CTA orchestration**

Keep recommendation/result copy unchanged. Replace `consultationOpen` state and inline form ownership with:

```tsx
<AssessmentScheduling
  token={token}
  initialAppointment={initialAppointment}
  consultationIntro={context.consultationIntro}
  phoneDisplay={roofEstimateBrand.phoneDisplay}
  phoneHref={roofEstimateBrand.phoneHref}
/>
```

Add `initialAppointment: PublicAppointment | null` to `AssessmentResult`. In `page.tsx`, load the active appointment alongside property, lead, assessment, and insight queries, validate it with the public schema, and pass only the public projection. A disabled or unconfigured scheduler must render callback and direct-call actions, not a broken primary button.

- [ ] **Step 4: Run all assessment and canonical integration tests**

Run: `npm run test:run -- 'src/app/roof-estimate/[token]' src/integration/canonical-assessment-journey.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit result integration**

```bash
git add 'src/app/roof-estimate/[token]/assessment-result.tsx' 'src/app/roof-estimate/[token]/assessment-result.test.tsx' 'src/app/roof-estimate/[token]/page.tsx' 'src/app/roof-estimate/[token]/page.test.tsx' 'src/app/roof-estimate/[token]/public-estimate-flow.test.ts'
git commit -m "feat: schedule from completed roof assessments"
```

### Task 8: Regenerate types, document setup, and verify end to end

**Files:**
- Modify: `src/lib/database.types.ts`
- Create: `docs/runbooks/calcom-scheduling.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: all prior scheduling tasks.
- Produces: generated types and an exact production configuration/smoke-test procedure.

- [ ] **Step 1: Regenerate and inspect Supabase types**

Run: `npx supabase gen types typescript --local > /tmp/piw-calcom-database.types.ts`

Expected: exit 0. Diff against `src/lib/database.types.ts`, confirm booking tables/RPCs and appointment columns are present, then replace the generated file through the approved edit workflow.

- [ ] **Step 2: Write the Cal.com runbook**

```markdown
# Cal.com Scheduling Runbook

## Event configuration

- Link: value configured as `CALCOM_EVENT_LINK`.
- Duration: 30 minutes.
- Location: attendee phone; organizer calls attendee.
- Timezone: America/New_York.
- Availability: Monday–Friday, 9:00 AM–5:00 PM.
- Minimum notice: 24 hours.
- Buffer: 15 minutes.
- Horizon: rolling 14 days.
- Email reminders: 24 hours and 1 hour.
- Property address booking question identifier: `propertyAddress`.

## Webhook

- URL: `https://<production-host>/api/integrations/calcom/webhook`.
- Triggers: BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED.
- Secret: same server-only value as `CALCOM_WEBHOOK_SECRET`.
- Verify `X-Cal-Signature-256` in a smoke delivery before enabling scheduling.

## Emergency disable

Set `CALCOM_SCHEDULING_ENABLED=false` and redeploy. Existing appointment cards and hosted management links remain readable; new booking CTA becomes callback/direct-call fallback.
```

Document all Cal.com environment variables in `README.md` without example secrets.

- [ ] **Step 3: Run full automated verification**

Run: `npm run lint`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run test:run`

Expected: PASS.

Run: `npm run db:test`

Expected: PASS.

Run: `npm run test:integration`

Expected: PASS with the local Supabase environment.

Run: `npm run build`

Expected: PASS with complete Cal.com and privacy configuration.

- [ ] **Step 4: Perform the real-provider smoke test**

In a production test assessment:

1. Open the modal and confirm an interactive scheduler appears within 12 seconds.
2. Confirm editable name, email, phone, and property address.
3. Book one slot and verify exactly one PIW appointment and timeline note.
4. Reload and verify the appointment card replaces both CTAs.
5. Use the hosted reschedule link; verify the same appointment row changes and one reschedule event is appended.
6. Use the hosted cancellation link; verify status is cancelled and the scheduling CTA returns.
7. Rebook and verify a second historical appointment is created without changing the cancelled row.
8. Disable scheduling and verify callback/direct-call fallback while existing appointment details remain readable.

- [ ] **Step 5: Commit generated types and operations docs**

```bash
git add src/lib/database.types.ts docs/runbooks/calcom-scheduling.md README.md
git commit -m "docs: add Cal.com scheduling operations"
```

## Plan Acceptance

- Every completed assessment result has a primary scheduling action and secondary callback.
- Every confirmed Cal.com booking creates exactly one PIW appointment.
- Reschedule updates the appointment; cancellation restores rebooking; history remains append-only.
- Invalid webhooks fail before persistence and retries are idempotent.
- Homeowners see only public-safe appointment state in Eastern time.
- Scheduler failure always yields callback and direct-call options.

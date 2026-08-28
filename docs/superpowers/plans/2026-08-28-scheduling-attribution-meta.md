# Scheduling Attribution and Meta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure the scheduling funnel under consent and send each consented confirmed appointment to Meta exactly once as a browser/server-deduplicated standard `Schedule` conversion.

**Architecture:** Anonymous daily counters measure scheduler load reliability without identifiers. Detailed funnel events require Analytics consent and use a token-scoped, allowlisted ingestion path. Advertising-consented booking sessions expose one server-generated Meta event ID after durable confirmation; the browser Pixel and a retryable Inngest CAPI worker send the same `Schedule` name/ID, while a delivery table proves idempotency and stores no raw contact data.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Zod 4, Supabase/Postgres with pgTAP, Inngest 4, Meta Pixel, Meta Conversions API Graph v26.0, Vitest, Testing Library, Node `crypto`.

**Spec:** `docs/superpowers/specs/2026-08-28-calcom-post-assessment-scheduling-design.md`

**Prerequisites:** Complete `docs/superpowers/plans/2026-08-28-privacy-consent-foundation.md` and `docs/superpowers/plans/2026-08-28-calcom-post-assessment-scheduling.md` first.

## Global Constraints

- Meta event name is exactly `Schedule`; quote submission remains `Lead`.
- CTA, scheduler-load, reschedule, and cancellation events never send Meta standard or custom events.
- Pixel and CAPI use the exact same `event_id` stored on the appointment.
- Meta Graph API version is pinned to `v26.0`.
- No Meta script, `_fbp`/`_fbc` capture, Pixel call, or CAPI call occurs without Advertising consent.
- Detailed PIW funnel events require Analytics consent.
- Scheduler reliability counters contain only UTC date, `opened`/`ready`/`failed`, and count; no token, cookie, IP, user agent, lead, or session identifier.
- Email is trimmed/lowercased before SHA-256; phone is normalized to digits-only E.164 before SHA-256; external lead UUID is trimmed/lowercased before SHA-256.
- Original lead attribution is primary; current booking-session attribution is retained separately.
- Granting consent after booking does not send a retroactive conversion.
- A Meta failure never blocks or rolls back a Cal.com booking.

---

## File Map

- `supabase/migrations/20260828140000_scheduling_attribution_meta.sql` — reliability counters, detailed funnel events, Meta delivery ledger, and RPCs.
- `supabase/tests/scheduling-attribution-meta.test.sql` — consent gates, deduplication, and privacy tests.
- `src/modules/analytics/scheduling-events.ts` — event allowlist and consent-aware application service.
- `src/modules/analytics/scheduling-events.test.ts` — service tests.
- `src/modules/analytics/scheduling-repository.ts` — Supabase adapters for counters and detailed events.
- `src/app/api/diagnostics/scheduler-load/route.ts` — identifier-free reliability counter.
- `src/app/api/diagnostics/scheduler-load/route.test.ts` — strict counter tests.
- `src/app/api/roof-estimate/[token]/scheduling-event/route.ts` — token-scoped consented funnel endpoint.
- `src/app/api/roof-estimate/[token]/scheduling-event/route.test.ts` — consent and allowlist tests.
- `src/modules/marketing/meta-conversions.ts` — normalization, hashing, payload, and HTTP adapter.
- `src/modules/marketing/meta-conversions.test.ts` — exact payload tests.
- `src/modules/marketing/meta-repository.ts` — pending-delivery reservation and status updates.
- `src/inngest/functions/meta-schedule-sender.ts` — retryable CAPI delivery.
- `src/inngest/functions/meta-schedule-sender.test.ts` — consent, retry, and idempotency tests.
- `src/inngest/client.ts`, `src/app/api/inngest/route.ts` — register appointment-scheduled consumer.
- `src/components/marketing/meta-pixel-provider.tsx` — advertising-consent-gated Pixel loader and tracker.
- `src/components/marketing/meta-pixel-provider.test.tsx` — no-load/no-fire and dedup tests.
- `src/app/layout.tsx` — mount provider inside privacy consent context.
- `src/app/roof-estimate/[token]/assessment-scheduling.tsx` and `calcom-scheduling-modal.tsx` — emit funnel/reliability events and browser `Schedule`.
- `src/app/roof-estimate/[token]/*.test.tsx` — UI event integration tests.
- `src/lib/env/server.ts`, `src/lib/env/client.ts`, `src/lib/env/shared.test.ts` — Meta configuration.
- `src/lib/database.types.ts` — regenerated schema.
- `docs/runbooks/meta-scheduling-conversions.md` — Events Manager setup and verification.

### Task 1: Persist privacy-safe scheduling analytics and Meta deliveries

**Files:**
- Create: `supabase/migrations/20260828140000_scheduling_attribution_meta.sql`
- Create: `supabase/tests/scheduling-attribution-meta.test.sql`

**Interfaces:**
- Produces: `scheduling_load_daily`, `scheduling_funnel_events`, `meta_conversion_deliveries`, `increment_scheduling_load(text,date)`, `record_scheduling_funnel_event(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamptz)`, and `reserve_meta_schedule_delivery(uuid)`.

- [ ] **Step 1: Write the failing pgTAP test**

```sql
begin;
select plan(18);

select has_table('public', 'scheduling_load_daily');
select has_table('public', 'scheduling_funnel_events');
select has_table('public', 'meta_conversion_deliveries');

select lives_ok(
  $$select public.increment_scheduling_load('opened', '2026-08-28')$$,
  'records one anonymous opened counter'
);
select lives_ok(
  $$select public.increment_scheduling_load('ready', '2026-08-28')$$,
  'records one anonymous ready counter'
);
select is(
  (select event_count from public.scheduling_load_daily
   where bucket_date='2026-08-28' and outcome='opened'),
  1::bigint,
  'counter stores only aggregate opened count'
);
select throws_ok(
  $$select public.increment_scheduling_load('clicked', '2026-08-28')$$,
  '23514', null, 'counter rejects non-load outcomes'
);

select hasnt_column('public', 'scheduling_load_daily', 'lead_id',
  'aggregate table has no lead identifier');
select hasnt_column('public', 'scheduling_load_daily', 'consent_id',
  'aggregate table has no consent identifier');

insert into public.companies(id, name)
values ('fa000000-0000-4000-8000-000000000001', 'Meta Test Company');

create temp table meta_assessment_fixture as
select * from public.start_or_resume_roof_assessment(
  'fa000000-0000-4000-8000-000000000001',
  'fa000000-0000-4000-8000-000000000002',
  'Meta Homeowner', '+17325550124', 'meta-owner@example.com',
  '29 Test Lane, Red Bank, NJ 07701', 'ChIJ-meta-test',
  'all-season-main', 'main-home',
  '{"utm_source":"facebook","fbp":"fb.1.100.200","fbc":"fb.1.100.click"}'::jsonb,
  null, 'all-season-assessment-v1', '2026-08-28T12:00:00Z',
  '127.0.0.2', 'pgTAP'
);

update public.roof_assessments
set status='completed', recommendation='professional_inspection',
    completed_at='2026-08-28T12:05:00Z'
where id=(select assessment_id from public.roof_assessment_access_attempts
          where id=(select attempt_id from meta_assessment_fixture));

select * from public.reserve_calcom_booking_session(
  'fa000000-0000-4000-8000-000000000001',
  (select assessment_id from public.roof_assessment_access_attempts
   where id=(select attempt_id from meta_assessment_fixture)),
  decode(repeat('34',32),'hex'), '2026-08-28T14:00:00Z',
  'fa000000-0000-4000-8000-000000000020', 'piw-privacy-v1', true, true,
  '{"utm_source":"email"}'::jsonb, '203.0.113.10', 'Mozilla/5.0 Test'
);

select * from public.apply_calcom_booking_event(
  'fa000000-0000-4000-8000-000000000001', 'BOOKING_CREATED', 12345,
  'appointments@example.com', 'meta-booking-1', decode(repeat('34',32),'hex'),
  '2026-08-29T14:00:00Z', 30, 'America/New_York',
  'Meta Homeowner', 'meta-owner@example.com', '+17325550124',
  'https://cal.com/reschedule/meta-booking-1',
  'https://cal.com/booking/meta-booking-1?cancel=true',
  '2026-08-28T12:10:00Z', 'calcom-created-meta-booking-1',
  '{"triggerEvent":"BOOKING_CREATED","uid":"meta-booking-1"}'::jsonb
);

select lives_ok($$select * from public.record_scheduling_funnel_event(
  'fa000000-0000-4000-8000-000000000010',
  'fa000000-0000-4000-8000-000000000001',
  (select lead_id from public.appointments where provider_booking_uid='meta-booking-1'),
  (select assessment_id from public.appointments where provider_booking_uid='meta-booking-1'),
  (select id from public.appointments where provider_booking_uid='meta-booking-1'),
  'booking_confirmed', 'fa000000-0000-4000-8000-000000000020',
  'piw-privacy-v1', '{}'::jsonb, '{}'::jsonb, '2026-08-28T12:10:00Z'
)$$, 'records a consented booking event');
select lives_ok($$select * from public.record_scheduling_funnel_event(
  'fa000000-0000-4000-8000-000000000010',
  'fa000000-0000-4000-8000-000000000001',
  (select lead_id from public.appointments where provider_booking_uid='meta-booking-1'),
  (select assessment_id from public.appointments where provider_booking_uid='meta-booking-1'),
  (select id from public.appointments where provider_booking_uid='meta-booking-1'),
  'booking_confirmed', 'fa000000-0000-4000-8000-000000000020',
  'piw-privacy-v1', '{}'::jsonb, '{}'::jsonb, '2026-08-28T12:10:00Z'
)$$, 'funnel retry is accepted');
select is((select count(*) from public.scheduling_funnel_events
           where event_id='fa000000-0000-4000-8000-000000000010'),
          1::bigint, 'funnel retry is idempotent');

select lives_ok($$select * from public.reserve_meta_schedule_delivery(
  (select id from public.appointments where provider_booking_uid='meta-booking-1')
)$$, 'reserves a consented Meta delivery');
select lives_ok($$select * from public.reserve_meta_schedule_delivery(
  (select id from public.appointments where provider_booking_uid='meta-booking-1')
)$$, 'Meta reservation retry is accepted');
select is((select count(*) from public.meta_conversion_deliveries),
          1::bigint, 'one appointment has one Schedule delivery');
select is((select event_name from public.meta_conversion_deliveries),
          'Schedule', 'delivery event name is fixed');

select throws_ok($$set local role anon; select * from public.scheduling_funnel_events$$,
  '42501', null, 'anonymous cannot read funnel events');
select throws_ok($$set local role authenticated; select * from public.meta_conversion_deliveries$$,
  '42501', null, 'authenticated cannot read Meta deliveries');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the focused database test and verify failure**

Run: `npx supabase test db supabase/tests/scheduling-attribution-meta.test.sql`

Expected: FAIL because analytics tables/functions do not exist.

- [ ] **Step 3: Implement tables and RPCs**

```sql
create table public.scheduling_load_daily (
  bucket_date date not null,
  outcome text not null check (outcome in ('opened','ready','failed')),
  event_count bigint not null default 0 check (event_count >= 0),
  primary key (bucket_date, outcome)
);

create table public.scheduling_funnel_events (
  event_id uuid primary key,
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id) on delete cascade,
  assessment_id uuid not null references public.roof_assessments(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  event_name text not null check (event_name in (
    'schedule_cta_viewed','schedule_cta_clicked','scheduler_loaded',
    'booking_confirmed','booking_rescheduled','booking_cancelled'
  )),
  consent_id uuid not null,
  policy_version text not null check (policy_version='piw-privacy-v1'),
  original_attribution jsonb not null check (jsonb_typeof(original_attribution)='object'),
  current_attribution jsonb not null check (jsonb_typeof(current_attribution)='object'),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.meta_conversion_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  event_name text not null default 'Schedule' check (event_name='Schedule'),
  event_id uuid not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  payload_hash text,
  last_error_category text,
  last_attempted_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (appointment_id, event_name),
  unique (event_id, event_name)
);
```

Enable RLS, revoke public/anon/authenticated access, and grant service-role access. `increment_scheduling_load` accepts only `opened`, `ready`, or `failed`, accepts only the current date or one day of clock skew, and performs an upsert increment. It accepts no request metadata. Operational success is `ready / opened`; `failed` is a diagnostic subset, not the denominator.

`record_scheduling_funnel_event` verifies the company/lead/assessment/appointment relationship and uses `ON CONFLICT (event_id) DO NOTHING`. The application calls it only after verifying Analytics consent.

`reserve_meta_schedule_delivery` locks the appointment and associated booking session, returns no row when Advertising was false, and otherwise inserts/returns one pending delivery using `appointments.meta_event_id`.

- [ ] **Step 4: Run focused and full database tests**

Run: `npx supabase test db supabase/tests/scheduling-attribution-meta.test.sql supabase/tests/calcom-scheduling.test.sql supabase/tests/privacy-consent.test.sql`

Expected: PASS.

Run: `npm run db:test`

Expected: PASS.

- [ ] **Step 5: Commit analytics persistence**

```bash
git add supabase/migrations/20260828140000_scheduling_attribution_meta.sql supabase/tests/scheduling-attribution-meta.test.sql
git commit -m "feat: persist scheduling attribution events"
```

### Task 2: Add consent-aware funnel and anonymous reliability endpoints

**Files:**
- Create: `src/modules/analytics/scheduling-events.ts`
- Create: `src/modules/analytics/scheduling-events.test.ts`
- Create: `src/modules/analytics/scheduling-repository.ts`
- Create: `src/app/api/diagnostics/scheduler-load/route.ts`
- Create: `src/app/api/diagnostics/scheduler-load/route.test.ts`
- Create: `src/app/api/roof-estimate/[token]/scheduling-event/route.ts`
- Create: `src/app/api/roof-estimate/[token]/scheduling-event/route.test.ts`

**Interfaces:**
- Produces: `recordSchedulerLoad(outcome)`, `recordSchedulingEvent(token,input,consent,repository)`, `POST /api/diagnostics/scheduler-load`, and `POST /api/roof-estimate/[token]/scheduling-event`.

- [ ] **Step 1: Write failing service and route tests**

```ts
test("does not persist a detailed event without Analytics consent", async () => {
  const record = vi.fn();
  const result = await recordSchedulingEvent(token, validEvent, rejectedConsent, {record});
  expect(result).toEqual({recorded: false, reason: "consent_denied"});
  expect(record).not.toHaveBeenCalled();
});

test("records an allowlisted event with canonical attribution", async () => {
  const record = vi.fn(async () => undefined);
  await recordSchedulingEvent(token, {
    eventId,
    eventName: "schedule_cta_clicked",
    occurredAt: "2026-08-28T12:00:00Z",
  }, analyticsConsent, {resolveContext, record});
  expect(record).toHaveBeenCalledWith(expect.objectContaining({
    eventName: "schedule_cta_clicked",
    originalAttribution: {utm_source: "facebook"},
    currentAttribution: {utm_source: "email"},
  }));
});

test("scheduler-load endpoint accepts only opened, ready, or failed", async () => {
  expect((await handleSchedulerLoad(request({outcome: "opened"}), repository)).status).toBe(202);
  expect((await handleSchedulerLoad(request({outcome: "ready"}), repository)).status).toBe(202);
  expect((await handleSchedulerLoad(request({outcome: "clicked"}), repository)).status).toBe(400);
});

test("reliability repository receives no request identifiers", async () => {
  await handleSchedulerLoad(request({outcome: "failed"}), repository);
  expect(repository.increment).toHaveBeenCalledWith({
    outcome: "failed",
    bucketDate: "2026-08-28",
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:run -- src/modules/analytics/scheduling-events.test.ts src/app/api/diagnostics/scheduler-load/route.test.ts 'src/app/api/roof-estimate/[token]/scheduling-event/route.test.ts'`

Expected: FAIL because the modules/routes do not exist.

- [ ] **Step 3: Implement strict services and routes**

```ts
export const schedulingEventNameSchema = z.enum([
  "schedule_cta_viewed",
  "schedule_cta_clicked",
  "scheduler_loaded",
  "booking_confirmed",
  "booking_rescheduled",
  "booking_cancelled",
]);

export const publicSchedulingEventSchema = z.object({
  eventId: z.uuid(),
  eventName: schedulingEventNameSchema.extract([
    "schedule_cta_viewed", "schedule_cta_clicked", "scheduler_loaded",
  ]),
  occurredAt: z.iso.datetime({offset: true}),
}).strict();
```

The public detailed route verifies the signed privacy cookie, returns 204 without resolving the estimate token when Analytics is false, and otherwise resolves the completed assessment server-side. It does not accept attribution, company, lead, assessment, or appointment identifiers from the client.

The reliability route accepts a body no larger than 1 KiB, does not read cookies, token, referrer, IP, or user agent, and calls the aggregate RPC with the server's UTC date. Both routes use `cache-control: no-store`.

Lifecycle events are server-authored from the verified Cal.com webhook service after `applyWebhook()` returns. Modify that service to call `recordSchedulingEvent` with the booking session's Analytics consent snapshot and deterministic event ID; a failure is logged by safe category and does not fail appointment reconciliation.

- [ ] **Step 4: Run focused tests**

Run: `npm run test:run -- src/modules/analytics/scheduling-events.test.ts src/app/api/diagnostics/scheduler-load/route.test.ts 'src/app/api/roof-estimate/[token]/scheduling-event/route.test.ts' src/modules/appointments/calcom-webhook.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit analytics services**

```bash
git add src/modules/analytics src/app/api/diagnostics/scheduler-load 'src/app/api/roof-estimate/[token]/scheduling-event' src/modules/appointments/calcom-webhook.ts src/modules/appointments/calcom-webhook.test.ts
git commit -m "feat: record consented scheduling funnel"
```

### Task 3: Configure Meta and build the CAPI payload adapter

**Files:**
- Modify: `src/lib/env/server.ts`
- Modify: `src/lib/env/client.ts`
- Modify: `src/lib/env/shared.test.ts`
- Create: `src/modules/marketing/meta-conversions.ts`
- Create: `src/modules/marketing/meta-conversions.test.ts`

**Interfaces:**
- Produces: `normalizeMetaEmail()`, `normalizeMetaPhone()`, `sha256MatchKey()`, `buildMetaSchedulePayload()`, and `MetaConversionsClient.sendSchedule()`.
- Environment: `META_TRACKING_ENABLED`, `NEXT_PUBLIC_META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`, optional `META_TEST_EVENT_CODE`, fixed `META_GRAPH_API_VERSION='v26.0'`.

- [ ] **Step 1: Write failing configuration and payload tests**

```ts
test("Meta tracking requires Pixel and CAPI credentials", () => {
  expect(() => parseServerEnv({...validServerEnv, META_TRACKING_ENABLED: "true"}))
    .toThrow(/Meta tracking requires/i);
});

test("normalizes and hashes matching keys", () => {
  expect(normalizeMetaEmail(" Owner@Example.COM ")).toBe("owner@example.com");
  expect(normalizeMetaPhone("+1 (732) 555-0123")).toBe("17325550123");
  expect(sha256MatchKey("owner@example.com")).toMatch(/^[a-f0-9]{64}$/);
});

test("builds one Schedule event with the shared event id", () => {
  expect(buildMetaSchedulePayload(context)).toEqual({
    data: [{
      event_name: "Schedule",
      event_time: 1787928000,
      event_id: context.metaEventId,
      action_source: "website",
      event_source_url: context.eventSourceUrl,
      user_data: {
        em: [sha256MatchKey("owner@example.com")],
        ph: [sha256MatchKey("17325550123")],
        external_id: [sha256MatchKey(context.leadId)],
        client_ip_address: "203.0.113.10",
        client_user_agent: "Mozilla/5.0 Test",
        fbp: "fb.1.100.200",
        fbc: "fb.1.100.click",
      },
    }],
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:run -- src/lib/env/shared.test.ts src/modules/marketing/meta-conversions.test.ts`

Expected: FAIL because Meta configuration and adapter do not exist.

- [ ] **Step 3: Implement configuration, normalization, and HTTP client**

Require Meta fields only when `META_TRACKING_ENABLED=true`; also require privacy signing and Cal.com scheduling. Client env exposes only `NEXT_PUBLIC_META_PIXEL_ID`. Server env pins Graph API with `z.literal('v26.0').default('v26.0')`.

```ts
export type MetaScheduleContext = {
  metaEventId: string;
  occurredAt: string;
  eventSourceUrl: string;
  leadId: string;
  email: string;
  phoneE164: string;
  clientIpAddress: string | null;
  clientUserAgent: string | null;
  fbp: string | null;
  fbc: string | null;
};

export interface MetaConversionsClient {
  sendSchedule(context: MetaScheduleContext): Promise<{
    eventsReceived: number;
    responseId: string | null;
    payloadHash: string;
  }>;
}
```

The fetch adapter posts JSON to `https://graph.facebook.com/v26.0/{pixelId}/events` with the access token in the request URL, never logs the URL/token, uses a 10-second abort timeout, includes `test_event_code` only when configured, validates Meta's response, and throws categorized errors containing no payload or PII. Hash the canonical JSON payload for the delivery ledger.

- [ ] **Step 4: Run focused tests**

Run: `npm run test:run -- src/lib/env/shared.test.ts src/modules/marketing/meta-conversions.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the Meta adapter**

```bash
git add src/lib/env/server.ts src/lib/env/client.ts src/lib/env/shared.test.ts src/modules/marketing/meta-conversions.ts src/modules/marketing/meta-conversions.test.ts
git commit -m "feat: build Meta Schedule conversion payload"
```

### Task 4: Deliver CAPI conversions through the durable event workflow

**Files:**
- Create: `src/modules/marketing/meta-repository.ts`
- Create: `src/inngest/functions/meta-schedule-sender.ts`
- Create: `src/inngest/functions/meta-schedule-sender.test.ts`
- Modify: `src/inngest/client.ts`
- Modify: `src/app/api/inngest/route.ts`
- Create: `src/app/api/inngest/route.test.ts`

**Interfaces:**
- Consumes: `appointments/scheduled` domain events and `MetaConversionsClient`.
- Produces: `sendMetaScheduleEventData(event, repository, client)` and registered `metaScheduleSender` Inngest function.

- [ ] **Step 1: Write failing worker tests**

```ts
test("skips appointments without Advertising consent", async () => {
  repository.reserve.mockResolvedValue(null);
  const result = await sendMetaScheduleEventData(event, repository, client);
  expect(result).toEqual({sent: false, reason: "consent_denied"});
  expect(client.sendSchedule).not.toHaveBeenCalled();
});

test("sends one reserved Schedule conversion", async () => {
  repository.reserve.mockResolvedValue(deliveryContext);
  client.sendSchedule.mockResolvedValue({
    eventsReceived: 1, responseId: "meta-response", payloadHash: "abc123",
  });
  const result = await sendMetaScheduleEventData(event, repository, client);
  expect(client.sendSchedule).toHaveBeenCalledWith(expect.objectContaining({
    metaEventId: deliveryContext.metaEventId,
  }));
  expect(repository.markSent).toHaveBeenCalledWith(expect.objectContaining({
    deliveryId: deliveryContext.deliveryId,
    payloadHash: "abc123",
  }));
  expect(result).toEqual({sent: true});
});

test("a sent delivery is idempotent", async () => {
  repository.reserve.mockResolvedValue({kind: "already_sent"});
  expect(await sendMetaScheduleEventData(event, repository, client))
    .toEqual({sent: false, reason: "already_sent"});
  expect(client.sendSchedule).not.toHaveBeenCalled();
});

test("records safe failure and rethrows for Inngest retry", async () => {
  repository.reserve.mockResolvedValue(deliveryContext);
  client.sendSchedule.mockRejectedValue(new MetaDeliveryError("timeout"));
  await expect(sendMetaScheduleEventData(event, repository, client)).rejects.toThrow("timeout");
  expect(repository.markFailed).toHaveBeenCalledWith({
    deliveryId: deliveryContext.deliveryId,
    category: "timeout",
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:run -- src/inngest/functions/meta-schedule-sender.test.ts`

Expected: FAIL because the repository and worker do not exist.

- [ ] **Step 3: Implement repository and Inngest function**

```ts
export interface MetaDeliveryRepository {
  reserve(appointmentId: string): Promise<MetaDeliveryContext | {kind: "already_sent"} | null>;
  markSent(input: {deliveryId: string; payloadHash: string; sentAt: string}): Promise<void>;
  markFailed(input: {deliveryId: string; category: string}): Promise<void>;
}
```

`reserve` calls `reserve_meta_schedule_delivery`, then loads only the consented appointment, lead match keys, original attribution touch, booking-session current attribution, and consent snapshot. It must never return a context when Advertising was false.

Register `appointmentsScheduled = eventType("appointments/scheduled", {schema: staticSchema<AppointmentScheduledData>()})` in `src/inngest/client.ts`. Create the function with ID `meta-schedule-sender`, trigger `appointments/scheduled`, and use `step.run` for reserve, send, and mark-sent. Add it to the served function list. Let categorized delivery failures throw so Inngest retries; unique delivery keys prevent logical duplication.

- [ ] **Step 4: Run worker, outbox, and route tests**

Run: `npm run test:run -- src/inngest/functions/meta-schedule-sender.test.ts src/modules/events/publish-pending-events.test.ts src/app/api/inngest/route.test.ts`

`src/app/api/inngest/route.test.ts` must assert `metaScheduleSender` is present in the function registration exported through a testable `registeredFunctions` array.

Expected: PASS.

- [ ] **Step 5: Commit durable delivery**

```bash
git add src/modules/marketing/meta-repository.ts src/inngest/functions/meta-schedule-sender.ts src/inngest/functions/meta-schedule-sender.test.ts src/inngest/client.ts src/app/api/inngest/route.ts src/app/api/inngest/route.test.ts
git commit -m "feat: deliver Meta Schedule conversions"
```

### Task 5: Add the consent-gated browser Pixel and UI events

**Files:**
- Create: `src/components/marketing/meta-pixel-provider.tsx`
- Create: `src/components/marketing/meta-pixel-provider.test.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/roof-estimate/[token]/assessment-scheduling.tsx`
- Modify: `src/app/roof-estimate/[token]/assessment-scheduling.test.tsx`
- Modify: `src/app/roof-estimate/[token]/calcom-scheduling-modal.tsx`
- Modify: `src/app/roof-estimate/[token]/calcom-scheduling-modal.test.tsx`
- Modify: `src/modules/appointments/calcom-contracts.ts`

**Interfaces:**
- Produces: `useMetaPixel().trackSchedule(eventId)` and UI event emission.
- Consumes: `usePrivacyConsent()`, public appointment `metaEvent`, detailed funnel endpoint, and reliability endpoint.

- [ ] **Step 1: Write failing Pixel and scheduling tests**

```tsx
test("does not load Meta before Advertising consent", () => {
  render(<PrivacyHarness advertising={false}>
    <MetaPixelProvider pixelId="123456"><div /></MetaPixelProvider>
  </PrivacyHarness>);
  expect(document.querySelector('script[src*="connect.facebook.net"]')).toBeNull();
  expect(document.querySelector('img[src*="facebook.com/tr"]')).toBeNull();
});

test("loads and initializes one Pixel after consent", async () => {
  const {rerender} = renderPixel(false);
  rerender(renderPixelTree(true));
  await waitFor(() => expect(document.querySelectorAll(
    'script[src="https://connect.facebook.net/en_US/fbevents.js"]'
  )).toHaveLength(1));
  expect(window.fbq).toHaveBeenCalledWith("init", "123456");
});

test("tracks Schedule once with the server event id", async () => {
  render(<AdvertisingHarness><ScheduleProbe /></AdvertisingHarness>);
  fireEvent.click(screen.getByRole("button", {name: "Track"}));
  fireEvent.click(screen.getByRole("button", {name: "Track"}));
  expect(window.fbq).toHaveBeenCalledTimes(2); // init + one track
  expect(window.fbq).toHaveBeenLastCalledWith(
    "track", "Schedule", {}, {eventID: "11111111-1111-4111-8111-111111111111"},
  );
});

test("emits one CTA view, click, scheduler ready, and anonymous load-ready counter", async () => {
  render(<AssessmentScheduling {...props} initialAppointment={null} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    expect.stringEndingWith("/scheduling-event"), expect.objectContaining({method: "POST"}),
  ));
  fireEvent.click(screen.getByRole("button", {name: /Schedule a 30-minute/}));
  fireCalEvent("linkReady", {});
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/diagnostics/scheduler-load",
    expect.objectContaining({body: JSON.stringify({outcome: "ready"})}),
  );
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:run -- src/components/marketing/meta-pixel-provider.test.tsx 'src/app/roof-estimate/[token]/assessment-scheduling.test.tsx' 'src/app/roof-estimate/[token]/calcom-scheduling-modal.test.tsx'`

Expected: FAIL because Pixel provider and emitters do not exist.

- [ ] **Step 3: Implement Pixel provider and UI emitters**

The provider injects Meta's standard bootstrap script only after Advertising consent, initializes the configured Pixel once, removes no historical cookie itself, and stops future calls immediately after revocation. Do not render a `<noscript>` image because it cannot honor runtime consent.

```ts
function trackSchedule(eventId: string) {
  const storageKey = `piw_meta_schedule_${eventId}`;
  if (!advertisingGranted || sentEventIds.current.has(eventId)
      || sessionStorage.getItem(storageKey) === "sent" || !window.fbq) return;
  sentEventIds.current.add(eventId);
  sessionStorage.setItem(storageKey, "sent");
  window.fbq("track", "Schedule", {}, {eventID: eventId});
}
```

Mount `MetaPixelProvider` inside `PrivacyConsentProvider` in the root layout. Pixel ID may be null when disabled.

In `AssessmentScheduling`, send `schedule_cta_viewed` once per mounted result and `schedule_cta_clicked` once per click with fresh `crypto.randomUUID()` event IDs. Send one anonymous `opened` counter as soon as the modal opens. In the modal, send `scheduler_loaded` after `linkReady` plus one anonymous `ready` counter. Send one anonymous `failed` counter for `linkFailed` or the 12-second timeout, but never include error text in the request.

Extend `PublicAppointment` with:

```ts
metaEvent: z.object({
  eventName: z.literal("Schedule"),
  eventId: z.uuid(),
}).strict().nullable()
```

The appointment status service returns `metaEvent` only when the booking-session Advertising snapshot was true. After durable confirmation, call `trackSchedule(metaEvent.eventId)`. Reschedules, cancellations, reloads, and rebooking with a different appointment ID cannot resend an already seen event ID in the same browser session; server delivery remains authoritative when the browser never fires.

- [ ] **Step 4: Run focused and full UI tests**

Run: `npm run test:run -- src/components/marketing/meta-pixel-provider.test.tsx 'src/app/roof-estimate/[token]/assessment-scheduling.test.tsx' 'src/app/roof-estimate/[token]/calcom-scheduling-modal.test.tsx' 'src/app/roof-estimate/[token]/appointment-card.test.tsx'`

Expected: PASS.

Run: `npm run test:run`

Expected: PASS.

- [ ] **Step 5: Commit browser tracking**

```bash
git add src/components/marketing/meta-pixel-provider.tsx src/components/marketing/meta-pixel-provider.test.tsx src/app/layout.tsx 'src/app/roof-estimate/[token]/assessment-scheduling.tsx' 'src/app/roof-estimate/[token]/assessment-scheduling.test.tsx' 'src/app/roof-estimate/[token]/calcom-scheduling-modal.tsx' 'src/app/roof-estimate/[token]/calcom-scheduling-modal.test.tsx' src/modules/appointments/calcom-contracts.ts
git commit -m "feat: track consented Schedule conversions"
```

### Task 6: Regenerate types, document Meta setup, and verify the complete patch

**Files:**
- Modify: `src/lib/database.types.ts`
- Create: `docs/runbooks/meta-scheduling-conversions.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: all three implementation plans.
- Produces: final generated types, Meta setup checklist, and release evidence.

- [ ] **Step 1: Regenerate database types**

Run: `npx supabase gen types typescript --local > /tmp/piw-meta-database.types.ts`

Expected: exit 0. Confirm the diff contains all privacy, scheduling, analytics, and Meta delivery schema added by the three plans, then replace `src/lib/database.types.ts` through the approved edit workflow.

- [ ] **Step 2: Write the Meta runbook**

```markdown
# Meta Scheduling Conversion Runbook

## Asset setup

1. Create the business Dataset/Pixel in Meta Events Manager.
2. Associate and verify the production domain.
3. Create a Conversions API access token with the minimum required asset access.
4. Configure `NEXT_PUBLIC_META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`,
   `META_GRAPH_API_VERSION=v26.0`, and `META_TRACKING_ENABLED=true`.
5. Configure `META_TEST_EVENT_CODE` only during Test Events verification.

## Required verification

1. Reject Advertising and confirm no Meta script, `_fbp`, Pixel request, or CAPI delivery.
2. Grant Advertising, book one appointment, and locate browser and server `Schedule` events.
3. Confirm both events show the same event ID and Meta reports them as deduplicated.
4. Confirm email, phone, and external ID are hashed in the server payload test harness.
5. Reschedule and cancel; confirm no additional `Schedule` event.
6. Remove `META_TEST_EVENT_CODE` before production traffic.
```

Document all environment names in `README.md`, never credential values.

- [ ] **Step 3: Run the complete verification suite**

Run: `npm run lint`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run test:run`

Expected: PASS.

Run: `npm run db:test`

Expected: PASS.

Run: `npm run test:integration`

Expected: PASS.

Run: `npm run build`

Expected: PASS with complete privacy, Cal.com, and Meta configuration.

- [ ] **Step 4: Perform final production acceptance**

1. Exercise Accept, Reject, Customize, revocation, and GPC in clean browser profiles.
2. Confirm scheduler ready/failed aggregate rows contain no identifying columns or request data.
3. Book, reschedule, cancel, and rebook using the Cal.com runbook.
4. Confirm every provider booking maps to exactly one PIW appointment.
5. Confirm the appointment-specific corrected phone is shown and the lead remains unchanged with `contact_review_required=true`.
6. In Meta Test Events, confirm one deduplicated `Schedule` for the consented booking.
7. Repeat with Advertising denied and confirm zero Pixel/CAPI activity.
8. Inspect monitoring for webhook errors, scheduler-load rate, unmatched bookings, and CAPI failures.

- [ ] **Step 5: Commit generated types and operations docs**

```bash
git add src/lib/database.types.ts docs/runbooks/meta-scheduling-conversions.md README.md
git commit -m "docs: add scheduling conversion operations"
```

## Plan Acceptance

- At least 95% scheduler-load success can be calculated as `ready / opened` from identifier-free daily counters.
- Detailed funnel measurement occurs only under Analytics consent.
- Meta loads and sends only under Advertising consent.
- Browser and CAPI `Schedule` events share one event ID and deduplicate.
- Each appointment has at most one logical Meta delivery despite retries.
- Reschedule and cancellation never create another Meta conversion.
- The booking experience remains successful when Meta is unavailable.

# All Season Meta Conversion Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver consent-aware Meta Pixel and Conversions API tracking for All Season `PageView`, `Lead`, and `AssessmentCompleted` events across the main website, campaign routes, and PIW quote flow.

**Architecture:** The browser loads Meta only after verified Advertising consent. PIW reserves conversion IDs and delivery state in Postgres, returns the same ID to the browser for Pixel deduplication, and uses Inngest plus a pending-delivery sweeper for reliable CAPI delivery. A signed consent handoff carries the approved preference from the public website origin into PIW without leaving consent data in the final assessment URL.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Zod 4, Supabase/Postgres with pgTAP, Inngest 4, Meta Pixel, Meta Conversions API, Vitest, Testing Library, Node `crypto`.

**Spec:** `docs/superpowers/specs/2026-09-01-all-season-meta-conversion-tracking-design.md`

## Global Constraints

- First execute and verify `docs/superpowers/plans/2026-08-28-privacy-consent-foundation.md`; its cookie contract, policy version `piw-privacy-v1`, and consent evidence table are prerequisites.
- Meta dataset / Pixel ID is exactly `3142520615938086`.
- Advertising consent defaults to denied and never blocks intake, assessment, CRM persistence, quote delivery, consultation requests, or Slack alerts.
- No Meta script, `_fbp` / `_fbc` access, Pixel call, or CAPI call occurs without verified Advertising consent.
- `Lead` is emitted only after canonical lead persistence succeeds.
- `AssessmentCompleted` is emitted only after a trusted completed quote has rendered and its result-view acknowledgement succeeds.
- Browser and CAPI copies use the exact same persisted `event_id`.
- Meta receives hashed normalized email and phone plus consented IP, user agent, `_fbp`, and `_fbc` when available.
- Meta never receives name, property address, imagery, assessment answers, geometry, quote amounts, or package selections.
- `AssessmentCompleted` is a custom event. Do not substitute `Purchase` or attach value/currency.
- Granting consent later does not backfill earlier events. Revocation prevents future events.
- Meta failures are observable and retryable but never roll back the business transaction.
- Preserve unrelated user changes in the dirty worktree and stage only files owned by each task.

---

## File Map

### Privacy handoff and website consent

- `apps/website/lib/privacy-consent.ts` — website-side compatible signed-cookie primitives.
- `apps/website/lib/privacy-consent.test.ts` — signature, expiry, and tamper tests.
- `apps/website/app/api/privacy/consent/route.ts` — set/revoke the website consent cookie.
- `apps/website/app/api/privacy/consent/route.test.ts` — consent endpoint contract.
- `apps/website/components/privacy-consent-provider.tsx` — client consent state.
- `apps/website/components/privacy-consent-banner.tsx` — accessible consent controls.
- `apps/website/components/privacy-consent.test.tsx` — default-denied and preference tests.
- `apps/website/app/layout.tsx` — verify cookie and mount website consent/Pixel providers.
- `apps/website/app/api/intake/route.ts` — forward signed consent and Meta event envelope.
- `apps/website/app/api/campaign-estimate/route.ts` — forward consent and add a continuation-bound, single-use PIW handoff.
- `src/app/roof-estimate/continue/[continuation]/route.ts` — consume handoff and set the PIW consent cookie.
- `src/modules/privacy/consent-handoff.ts` — validate a short-lived handoff token.
- `src/modules/privacy/consent-handoff.test.ts` — expiry, tamper, and redirect cleanup tests.

### Persistence and server delivery

- `supabase/migrations/20260901150000_meta_event_deliveries.sql` — delivery ledger and reservation/claim/result RPCs.
- `supabase/tests/meta-event-deliveries.test.sql` — consent gates, uniqueness, eligibility, RLS, and state transitions.
- `src/modules/marketing/meta-events.ts` — event envelope, normalization, hashing, payload, and retry classification.
- `src/modules/marketing/meta-events.test.ts` — exact pure-function contracts.
- `src/modules/marketing/meta-repository.ts` — Supabase reservation and delivery-state adapter.
- `src/modules/marketing/meta-conversions.ts` — Graph API HTTP adapter.
- `src/modules/marketing/meta-conversions.test.ts` — request and sanitized-response tests.
- `src/inngest/functions/meta-conversion-sender.ts` — event-triggered delivery worker.
- `src/inngest/functions/meta-conversion-sender.test.ts` — success, retry, idempotency, and permanent failure.
- `src/inngest/functions/meta-conversion-sweeper.ts` — scheduled recovery of pending deliveries.
- `src/inngest/functions/meta-conversion-sweeper.test.ts` — stale-pending recovery.
- `src/inngest/client.ts` — typed `marketing/meta.delivery.requested` event.
- `src/app/api/inngest/route.ts` — register both Meta functions.

### Browser and flow integration

- `src/components/marketing/meta-pixel-provider.tsx` — consent-gated PIW Pixel loader.
- `src/components/marketing/meta-pixel-provider.test.tsx` — script and event gates.
- `apps/website/components/meta-pixel-provider.tsx` — consent-gated website Pixel loader.
- `apps/website/components/meta-pixel-provider.test.tsx` — website Pixel tests.
- `src/app/layout.tsx` — mount PIW privacy and Pixel providers.
- `apps/website/app/campaigns/campaign-estimate-form.tsx` — emit returned `Lead` envelope before redirect.
- `apps/website/components/lead-webhook-form.tsx` — emit returned `Lead` envelope on legacy intake.
- `src/app/api/integrations/all-season/intake/route.ts` — verify consent, reserve `Lead`, and return envelope.
- `src/app/api/integrations/all-season/campaign-estimate/route.ts` — verify consent, reserve `Lead`, and return envelope.
- `src/app/api/roof-estimate/[token]/result-view/route.ts` — reserve `AssessmentCompleted` after result-view persistence.
- `src/app/roof-estimate/[token]/assessment-result.tsx` — emit completion envelope once.

### Configuration and operations

- `src/lib/env/server.ts`, `src/lib/env/client.ts`, `src/lib/env/shared.test.ts` — PIW Meta configuration.
- `apps/website/.env.example` — website Pixel and shared consent configuration.
- `.env.example` — PIW Meta and consent configuration.
- `src/lib/database.types.ts` — regenerated database types.
- `docs/runbooks/all-season-meta-conversions.md` — Events Manager, Vercel, validation, monitoring, and rollback.

---

### Task 1: Complete and verify the privacy-consent prerequisite

**Files:**
- Execute: `docs/superpowers/plans/2026-08-28-privacy-consent-foundation.md`
- Verify: `supabase/migrations/20260828120000_privacy_consent.sql`
- Verify: `src/modules/privacy/consent.ts`
- Verify: `src/components/privacy/privacy-consent-provider.tsx`
- Verify: `src/app/api/privacy/consent/route.ts`

**Interfaces:**
- Produces: `VerifiedConsent`, `verifyConsentCookie()`, `signConsentCookie()`, `usePrivacyConsent()`, and append-only `privacy_consent_evidence`.
- Required cookie: `piw_privacy`, policy `piw-privacy-v1`, 180-day lifetime, `HttpOnly`, `SameSite=Lax`, `Secure` in production.

- [ ] **Step 1: Execute the prerequisite plan in its documented TDD order**

Run every task in `docs/superpowers/plans/2026-08-28-privacy-consent-foundation.md`. Do not merge Meta work into those commits.

- [ ] **Step 2: Verify the privacy database boundary**

Run:

```bash
npx supabase test db supabase/tests/privacy-consent.test.sql
```

Expected: PASS; anonymous and authenticated roles cannot read or write evidence directly.

- [ ] **Step 3: Verify the consent application boundary**

Run:

```bash
npm run test:run -- src/modules/privacy/consent.test.ts src/app/api/privacy/consent/route.test.ts src/components/privacy/privacy-consent-provider.test.tsx
```

Expected: PASS; defaults are denied, GPC denies Advertising, tampered cookies fail closed, and lead/assessment flows remain available.

- [ ] **Step 4: Record the prerequisite commit**

Run:

```bash
git log -1 --oneline -- supabase/migrations/20260828120000_privacy_consent.sql
```

Expected: one committed privacy-foundation change. Do not proceed if the files remain untracked.

---

### Task 2: Add a signed cross-origin consent handoff

**Files:**
- Create: `apps/website/lib/privacy-consent.ts`
- Create: `apps/website/lib/privacy-consent.test.ts`
- Create: `apps/website/app/api/privacy/consent/route.ts`
- Create: `apps/website/app/api/privacy/consent/route.test.ts`
- Create: `apps/website/components/privacy-consent-provider.tsx`
- Create: `apps/website/components/privacy-consent-banner.tsx`
- Create: `apps/website/components/privacy-consent.test.tsx`
- Modify: `apps/website/app/layout.tsx`
- Modify: `apps/website/app/api/intake/route.ts`
- Modify: `apps/website/app/api/intake/route.test.ts`
- Modify: `apps/website/app/api/campaign-estimate/route.ts`
- Modify: `apps/website/app/api/campaign-estimate/route.test.ts`
- Create: `src/modules/privacy/consent-handoff.ts`
- Create: `src/modules/privacy/consent-handoff.test.ts`
- Modify: `src/app/roof-estimate/continue/[continuation]/route.ts`
- Modify: `src/app/roof-estimate/continue/[continuation]/route.test.ts`

**Interfaces:**
- Consumes: `PRIVACY_CONSENT_SIGNING_SECRET`, signed `piw_privacy` cookie, policy `piw-privacy-v1`.
- Produces: `VerifiedWebsiteConsent`, `readWebsiteConsent()`, `createConsentHandoff()`, `verifyConsentHandoff()`, header `x-piw-privacy-consent`, and query parameter `privacy_handoff` consumed once.

- [ ] **Step 1: Write failing compatibility and handoff tests**

```ts
test("a consent handoff is short-lived and tamper evident", async () => {
  const token = await createConsentHandoff({
    consentId: "11111111-1111-4111-8111-111111111111",
    policyVersion: "piw-privacy-v1",
    analytics: false,
    advertising: true,
    issuedAt: "2026-09-01T16:00:00.000Z",
  }, "signed-continuation-value", signingSecret);

  expect(await verifyConsentHandoff(token, "signed-continuation-value", signingSecret, new Date("2026-09-01T16:04:59Z")))
    .toMatchObject({advertising: true});
  await expect(verifyConsentHandoff(`${token}x`, "signed-continuation-value", signingSecret)).rejects.toThrow("Invalid consent handoff");
  await expect(verifyConsentHandoff(token, "signed-continuation-value", signingSecret, new Date("2026-09-01T16:05:01Z")))
    .rejects.toThrow("Expired consent handoff");
});

test("campaign proxy forwards consent and places only the signed handoff on the redirect", async () => {
  const response = await handleCampaignEstimateRequest(requestWithConsent, forward, "https://piw.example", "production");
  expect(forward).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    consentToken: expect.any(String),
  }));
  const body = await response.json();
  const url = new URL(body.estimateUrl);
  expect(url.searchParams.get("privacy_handoff")).toEqual(expect.any(String));
  expect(url.search).not.toContain("advertising=true");
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
npm --prefix apps/website test -- lib/privacy-consent.test.ts app/api/privacy/consent/route.test.ts app/api/campaign-estimate/route.test.ts
npm run test:run -- src/modules/privacy/consent-handoff.test.ts 'src/app/roof-estimate/continue/[continuation]/route.test.ts'
```

Expected: FAIL because website consent and handoff modules do not exist.

- [ ] **Step 3: Implement the portable token contract**

Use a versioned base64url JSON payload and HMAC-SHA256 signature:

```ts
export type ConsentHandoff = {
  version: "piw-privacy-v1";
  consentId: string;
  analytics: boolean;
  advertising: boolean;
  gpc: boolean;
  continuationHash: string;
  issuedAt: string;
};

export async function createConsentHandoff(
  consent: VerifiedConsent,
  continuation: string,
  secret: string,
): Promise<string>;

export async function verifyConsentHandoff(
  token: string,
  continuation: string,
  secret: string,
  now?: Date,
): Promise<ConsentHandoff>;
```

Reject malformed payloads, signatures with unequal length before `timingSafeEqual`, policy mismatches, future timestamps beyond 30 seconds of skew, tokens older than five minutes, and a `continuationHash` that does not equal the SHA-256 hash of the continuation in the current route. The existing continuation is itself consumed by `authorizeAssessmentContinuation`, so binding the handoff to it makes the handoff single-use without adding a second replay table.

- [ ] **Step 4: Implement website consent UI and endpoint**

Mirror the approved privacy-provider interface:

```ts
type PrivacyConsentContextValue = {
  preferences: {necessary: true; analytics: boolean; advertising: boolean};
  decided: boolean;
  acceptAll(): Promise<void>;
  rejectNonessential(): Promise<void>;
  savePreferences(value: {analytics: boolean; advertising: boolean}): Promise<void>;
};
```

The route signs `piw_privacy`; the browser never reads or writes the HttpOnly cookie. Render equally prominent Accept all, Reject nonessential, and Customize controls. Initialize from the server-verified cookie in `apps/website/app/layout.tsx`. Anonymous website decisions need not call Supabase immediately; the verified consent snapshot is appended to `privacy_consent_evidence` with the canonical lead inside Task 6 before any server conversion can be reserved.

- [ ] **Step 5: Forward consent and consume the handoff**

In both website proxy routes, read the signed cookie server-side and forward it only through `x-piw-privacy-consent`. For campaign estimates, append the short-lived `privacy_handoff` token to the existing PIW continuation URL.

In `src/app/roof-estimate/continue/[continuation]/route.ts`, validate the handoff against the current continuation, allow `authorizeAssessmentContinuation` to consume that continuation, set the PIW-origin `piw_privacy` cookie only on a successful start redirect, and redirect to the clean assessment URL with no query string. Invalid or missing handoff fails closed to Advertising denied but does not block the assessment.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm --prefix apps/website test -- lib/privacy-consent.test.ts app/api/privacy/consent/route.test.ts components/privacy-consent.test.tsx app/api/intake/route.test.ts app/api/campaign-estimate/route.test.ts
npm run test:run -- src/modules/privacy/consent-handoff.test.ts 'src/app/roof-estimate/continue/[continuation]/route.test.ts'
```

Expected: PASS.

- [ ] **Step 7: Commit the consent handoff**

```bash
git add apps/website/lib/privacy-consent.ts apps/website/lib/privacy-consent.test.ts apps/website/app/api/privacy/consent apps/website/components/privacy-consent-provider.tsx apps/website/components/privacy-consent-banner.tsx apps/website/components/privacy-consent.test.tsx apps/website/app/layout.tsx apps/website/app/api/intake/route.ts apps/website/app/api/intake/route.test.ts apps/website/app/api/campaign-estimate/route.ts apps/website/app/api/campaign-estimate/route.test.ts src/modules/privacy/consent-handoff.ts src/modules/privacy/consent-handoff.test.ts 'src/app/roof-estimate/continue/[continuation]/route.ts' 'src/app/roof-estimate/continue/[continuation]/route.test.ts'
git commit -m "feat: hand off advertising consent to assessments"
```

---

### Task 3: Persist idempotent Meta delivery state

**Files:**
- Create: `supabase/migrations/20260901150000_meta_event_deliveries.sql`
- Create: `supabase/tests/meta-event-deliveries.test.sql`
- Regenerate later: `src/lib/database.types.ts`

**Interfaces:**
- Produces: `meta_event_deliveries`, `reserve_meta_lead_delivery(uuid,uuid,uuid,text,timestamptz)`, `reserve_meta_assessment_delivery(uuid,uuid,uuid,text,timestamptz)`, `claim_meta_delivery(uuid,timestamptz)`, `list_pending_meta_deliveries(integer,timestamptz)`, and `complete_meta_delivery(uuid,text,integer,text,text,timestamptz)`.

- [ ] **Step 1: Write the failing pgTAP contract**

Create fixtures using the canonical All Season assessment helpers, then assert:

```sql
begin;
select plan(20);

select has_table('public', 'meta_event_deliveries');
select has_column('public', 'meta_event_deliveries', 'consent_id');
select has_column('public', 'meta_event_deliveries', 'payload_hash');
select hasnt_column('public', 'meta_event_deliveries', 'email');
select hasnt_column('public', 'meta_event_deliveries', 'phone');
select hasnt_column('public', 'meta_event_deliveries', 'payload');

select is(
  (select count(*) from public.reserve_meta_lead_delivery(
    :'lead_id', :'company_id', :'advertising_denied_consent_id',
    'piw-privacy-v1', now()
  )), 0::bigint, 'advertising denial reserves nothing'
);

select lives_ok($$select * from public.reserve_meta_lead_delivery(
  :'lead_id', :'company_id', :'advertising_granted_consent_id',
  'piw-privacy-v1', now()
)$$, 'granted consent reserves Lead');
select lives_ok($$select * from public.reserve_meta_lead_delivery(
  :'lead_id', :'company_id', :'advertising_granted_consent_id',
  'piw-privacy-v1', now()
)$$, 'Lead retry is idempotent');
select is((select count(*) from public.meta_event_deliveries where event_name='Lead'), 1::bigint,
  'one Lead delivery exists');

select is(
  (select count(*) from public.reserve_meta_assessment_delivery(
    :'incomplete_assessment_id', :'company_id', :'advertising_granted_consent_id',
    'piw-privacy-v1', now()
  )), 0::bigint, 'incomplete assessment reserves nothing'
);

select throws_ok($$set local role anon; select * from public.meta_event_deliveries$$,
  '42501', null, 'anonymous cannot read delivery ledger');
select throws_ok($$set local role authenticated; insert into public.meta_event_deliveries default values$$,
  '42501', null, 'authenticated cannot write delivery ledger');

select * from finish();
rollback;
```

Complete the fixture and plan count with assertions for completed trusted pricing, duplicate assessment reservation, cross-company rejection, claim transitions, retryable failure, permanent failure, and successful completion.

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
npx supabase test db supabase/tests/meta-event-deliveries.test.sql
```

Expected: FAIL because `meta_event_deliveries` does not exist.

- [ ] **Step 3: Implement the table and indexes**

```sql
create table public.meta_event_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id) on delete cascade,
  assessment_id uuid references public.roof_assessments(id) on delete cascade,
  consent_id uuid not null,
  policy_version text not null check (policy_version='piw-privacy-v1'),
  event_name text not null check (event_name in ('Lead','AssessmentCompleted')),
  event_id uuid not null default extensions.gen_random_uuid(),
  event_time timestamptz not null,
  status text not null default 'pending' check (status in (
    'pending','sending','sent','retryable_failed','permanent_failed'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  payload_hash text,
  meta_http_status integer check (meta_http_status is null or meta_http_status between 100 and 599),
  meta_trace_id text,
  last_error_category text,
  last_attempted_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id)
);

create unique index meta_event_one_lead_idx
  on public.meta_event_deliveries(lead_id, event_name)
  where event_name='Lead';
create unique index meta_event_one_assessment_idx
  on public.meta_event_deliveries(assessment_id, event_name)
  where event_name='AssessmentCompleted';
create index meta_event_pending_idx
  on public.meta_event_deliveries(status, updated_at)
  where status in ('pending','retryable_failed','sending');
```

Enable RLS, revoke all from `public`, `anon`, and `authenticated`, and grant service-role access only.

- [ ] **Step 4: Implement security-definer RPCs**

Reservation functions must join `privacy_consent_evidence` using `consent_id`, require `advertising_granted=true`, verify company and lead relationships, and use `ON CONFLICT` to return the existing row. The assessment reservation must additionally require:

```sql
roof_assessments.status = 'completed'
and roof_estimates.status = 'ready'
and roof_estimates.roof_squares > 0
and roof_estimates.range_low_cents > 0
and roof_estimates.range_high_cents >= roof_estimates.range_low_cents
```

Join `roof_assessments.estimate_id` to `roof_estimates.id` under the same `company_id` before evaluating those predicates. If the current Good/Better/Best migration adds package rows, require all three trusted package rows in addition to—not instead of—the `roof_estimates` measurement predicates above.

`claim_meta_delivery` uses `FOR UPDATE SKIP LOCKED`, increments `attempt_count`, and moves only eligible rows to `sending`. `list_pending_meta_deliveries` returns at most 50 IDs and treats a `sending` row older than ten minutes as abandoned. `complete_meta_delivery` accepts only `sent`, `retryable_failed`, or `permanent_failed` and stores sanitized metadata.

- [ ] **Step 5: Run focused and regression database tests**

Run:

```bash
npx supabase test db supabase/tests/meta-event-deliveries.test.sql supabase/tests/privacy-consent.test.sql supabase/tests/canonical_roof_assessment_journey.test.sql
npm run db:test
```

Expected: PASS.

- [ ] **Step 6: Commit persistence**

```bash
git add supabase/migrations/20260901150000_meta_event_deliveries.sql supabase/tests/meta-event-deliveries.test.sql
git commit -m "feat: persist consented Meta deliveries"
```

---

### Task 4: Build the Meta event and Conversions API adapters

**Files:**
- Create: `src/modules/marketing/meta-events.ts`
- Create: `src/modules/marketing/meta-events.test.ts`
- Create: `src/modules/marketing/meta-conversions.ts`
- Create: `src/modules/marketing/meta-conversions.test.ts`
- Create: `src/modules/marketing/meta-repository.ts`
- Modify: `src/lib/env/server.ts`
- Modify: `src/lib/env/client.ts`
- Modify: `src/lib/env/shared.test.ts`

**Interfaces:**
- Produces: `MetaEventName`, `MetaBrowserEventEnvelope`, `normalizeMetaEmail()`, `normalizeMetaPhone()`, `hashMetaValue()`, `buildMetaCapiPayload()`, `classifyMetaResponse()`, `MetaConversionClient.send()`, and `SupabaseMetaRepository`.

- [ ] **Step 1: Write failing pure-function tests**

```ts
test("normalizes and hashes matching fields", () => {
  expect(normalizeMetaEmail(" Chris@Example.COM ")).toBe("chris@example.com");
  expect(normalizeMetaPhone("(732) 555-0124", "US")).toBe("17325550124");
  expect(hashMetaValue("chris@example.com")).toBe(
    "b4b5b0add35b4959f546b421b30cee70dad83efbce876d4a4d927f9a085efc78",
  );
});

test("payload contains no property or pricing data", () => {
  const payload = buildMetaCapiPayload(fixture);
  expect(payload.data[0]).toMatchObject({
    event_name: "Lead",
    event_id: fixture.eventId,
    action_source: "website",
  });
  expect(JSON.stringify(payload)).not.toMatch(/address|roof|price|package|answer/i);
  expect(payload.data[0].user_data.em[0]).toMatch(/^[a-f0-9]{64}$/);
  expect(payload.data[0].user_data.ph[0]).toMatch(/^[a-f0-9]{64}$/);
});

test.each([
  [429, "retryable"], [500, "retryable"], [503, "retryable"],
  [400, "permanent"], [401, "permanent"], [403, "permanent"],
])("classifies Meta HTTP %i as %s", (status, expected) => {
  expect(classifyMetaResponse(status)).toBe(expected);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm run test:run -- src/modules/marketing/meta-events.test.ts src/modules/marketing/meta-conversions.test.ts src/lib/env/shared.test.ts
```

Expected: FAIL because the modules and environment fields do not exist.

- [ ] **Step 3: Implement exact types and normalization**

```ts
export type MetaEventName = "Lead" | "AssessmentCompleted";

export type MetaBrowserEventEnvelope = {
  name: MetaEventName;
  eventId: string;
  issuedAt: string;
};

export type MetaDeliverySource = {
  deliveryId: string;
  eventName: MetaEventName;
  eventId: string;
  eventTime: string;
  eventSourceUrl: string;
  email: string;
  phone: string;
  clientIpAddress: string | null;
  clientUserAgent: string | null;
  fbp: string | null;
  fbc: string | null;
};
```

Email is trimmed and lowercased. US phone input is converted to digits-only E.164 with country code `1`; reject ambiguous or invalid lengths instead of guessing. Hash only normalized values with SHA-256. Build no Meta `custom_data` object.

- [ ] **Step 4: Implement the HTTP adapter**

```ts
export class MetaConversionClient {
  constructor(private readonly config: {
    pixelId: string;
    accessToken: string;
    graphApiVersion: string;
    testEventCode?: string;
    fetchImpl?: typeof fetch;
  }) {}

  async send(source: MetaDeliverySource): Promise<{
    outcome: "sent" | "retryable_failed" | "permanent_failed";
    httpStatus: number | null;
    traceId: string | null;
    errorCategory: string | null;
    payloadHash: string;
  }>;
}
```

POST to `https://graph.facebook.com/${graphApiVersion}/${pixelId}/events` with the access token in the request body or authorization mechanism required by the token generated in Events Manager. Apply an eight-second timeout. Parse only `events_received`, `fbtrace_id`, and sanitized error code/type; never return or log the response body verbatim.

- [ ] **Step 5: Add fail-closed environment validation**

Add:

```ts
META_TRACKING_ENABLED: booleanString,
META_PIXEL_ID: optionalString,
META_CAPI_ACCESS_TOKEN: optionalString,
META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).optional(),
META_TEST_EVENT_CODE: optionalString,
NEXT_PUBLIC_META_PIXEL_ID: optionalString,
```

When `META_TRACKING_ENABLED=true`, require server Pixel ID, token, Graph version, and matching public Pixel ID. Permit `META_TEST_EVENT_CODE` only outside production. Client configuration exposes only the public Pixel ID and enabled flag.

- [ ] **Step 6: Implement the repository adapter**

`SupabaseMetaRepository` must expose:

```ts
type ReservedMetaEvent = {
  deliveryId: string;
  envelope: MetaBrowserEventEnvelope;
};

reserveLead(input: {leadId: string; companyId: string; consentId: string; occurredAt: string}): Promise<ReservedMetaEvent | null>;
reserveAssessment(input: {assessmentId: string; companyId: string; consentId: string; occurredAt: string}): Promise<ReservedMetaEvent | null>;
claim(deliveryId: string): Promise<MetaDeliverySource | null>;
listPending(limit: number): Promise<string[]>;
complete(deliveryId: string, result: MetaDeliveryResult): Promise<void>;
```

Validate every RPC result with strict Zod schemas. `claim()` resolves contact/attribution data only after the RPC has atomically claimed the delivery.

- [ ] **Step 7: Run tests**

Run:

```bash
npm run test:run -- src/modules/marketing/meta-events.test.ts src/modules/marketing/meta-conversions.test.ts src/lib/env/shared.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the adapters**

```bash
git add src/modules/marketing/meta-events.ts src/modules/marketing/meta-events.test.ts src/modules/marketing/meta-conversions.ts src/modules/marketing/meta-conversions.test.ts src/modules/marketing/meta-repository.ts src/lib/env/server.ts src/lib/env/client.ts src/lib/env/shared.test.ts
git commit -m "feat: add Meta Conversions API adapter"
```

---

### Task 5: Add reliable Inngest delivery and recovery

**Files:**
- Create: `src/inngest/functions/meta-conversion-sender.ts`
- Create: `src/inngest/functions/meta-conversion-sender.test.ts`
- Create: `src/inngest/functions/meta-conversion-sweeper.ts`
- Create: `src/inngest/functions/meta-conversion-sweeper.test.ts`
- Modify: `src/inngest/client.ts`
- Modify: `src/app/api/inngest/route.ts`

**Interfaces:**
- Consumes: `SupabaseMetaRepository.claim/listPending/complete`, `MetaConversionClient.send`.
- Produces: typed event `marketing/meta.delivery.requested` with `{deliveryId: string}` and registered functions `metaConversionSender`, `metaConversionSweeper`.

- [ ] **Step 1: Write failing worker tests**

```ts
test("sends one claimed delivery and records success", async () => {
  repository.claim.mockResolvedValue(source);
  client.send.mockResolvedValue({
    outcome: "sent", httpStatus: 200, traceId: "trace-1",
    errorCategory: null, payloadHash: "hash-1",
  });

  await runSender({deliveryId: source.deliveryId}, {repository, client});

  expect(client.send).toHaveBeenCalledOnce();
  expect(repository.complete).toHaveBeenCalledWith(source.deliveryId, expect.objectContaining({outcome: "sent"}));
});

test("an already claimed or completed delivery is a no-op", async () => {
  repository.claim.mockResolvedValue(null);
  await runSender({deliveryId}, {repository, client});
  expect(client.send).not.toHaveBeenCalled();
});

test("sweeper republishes pending IDs only", async () => {
  repository.listPending.mockResolvedValue(["delivery-1", "delivery-2"]);
  await runSweeper({repository, send});
  expect(send).toHaveBeenCalledWith([
    {name: "marketing/meta.delivery.requested", data: {deliveryId: "delivery-1"}},
    {name: "marketing/meta.delivery.requested", data: {deliveryId: "delivery-2"}},
  ]);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm run test:run -- src/inngest/functions/meta-conversion-sender.test.ts src/inngest/functions/meta-conversion-sweeper.test.ts
```

Expected: FAIL because the workers do not exist.

- [ ] **Step 3: Implement the typed event and sender**

```ts
export const metaDeliveryRequested = eventType("marketing/meta.delivery.requested", {
  schema: staticSchema<{deliveryId: string}>(),
});
```

The sender calls `claim`, exits successfully when no row is claimable, sends via CAPI, and persists the sanitized result. Throw after recording `retryable_failed` so Inngest retries. Do not throw for `permanent_failed`.

- [ ] **Step 4: Implement the recovery sweep**

Create a cron-triggered function running every five minutes. It asks the repository for at most 50 pending/retryable/stale-sending IDs and publishes one typed event per ID. Database claim semantics remain the concurrency lock.

- [ ] **Step 5: Register and test**

Add both functions to `src/app/api/inngest/route.ts`, then run:

```bash
npm run test:run -- src/inngest/functions/meta-conversion-sender.test.ts src/inngest/functions/meta-conversion-sweeper.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the workers**

```bash
git add src/inngest/client.ts src/inngest/functions/meta-conversion-sender.ts src/inngest/functions/meta-conversion-sender.test.ts src/inngest/functions/meta-conversion-sweeper.ts src/inngest/functions/meta-conversion-sweeper.test.ts src/app/api/inngest/route.ts
git commit -m "feat: deliver Meta events through Inngest"
```

---

### Task 6: Reserve and return `Lead` from canonical intake

**Files:**
- Modify: `src/app/api/integrations/all-season/intake/route.ts`
- Modify: `src/app/api/integrations/all-season/intake/route.test.ts`
- Modify: `src/app/api/integrations/all-season/campaign-estimate/route.ts`
- Modify: `src/app/api/integrations/all-season/campaign-estimate/route.test.ts`
- Modify: `apps/website/app/api/intake/route.ts`
- Modify: `apps/website/app/api/intake/route.test.ts`
- Modify: `apps/website/app/api/campaign-estimate/route.ts`
- Modify: `apps/website/app/api/campaign-estimate/route.test.ts`

**Interfaces:**
- Consumes: verified `x-piw-privacy-consent`, `SupabaseMetaRepository.reserveLead`, `inngest.send`.
- Produces: optional response field `metaEvent: MetaBrowserEventEnvelope | null`.

- [ ] **Step 1: Write failing intake tests**

```ts
test("returns Lead only after canonical persistence under advertising consent", async () => {
  accept.mockResolvedValue({leadId, duplicate: false});
  reserveLead.mockResolvedValue({name: "Lead", eventId, issuedAt});

  const response = await handleAllSeasonIntakeRequest(consentedRequest, dependencies);

  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({accepted: true, metaEvent: {name: "Lead", eventId}});
  expect(accept.mock.invocationCallOrder[0]).toBeLessThan(reserveLead.mock.invocationCallOrder[0]);
});

test("denied consent saves the lead but returns no Meta event", async () => {
  const response = await handleAllSeasonCampaignEstimateRequest(deniedRequest, dependencies);
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({accepted: true, metaEvent: null});
  expect(accept).toHaveBeenCalledOnce();
});

test("persistence failure emits no Meta delivery", async () => {
  accept.mockRejectedValue(new Error("database unavailable"));
  await handleAllSeasonIntakeRequest(consentedRequest, dependencies);
  expect(reserveLead).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run route tests and verify failure**

Run:

```bash
npm run test:run -- src/app/api/integrations/all-season/intake/route.test.ts src/app/api/integrations/all-season/campaign-estimate/route.test.ts
npm --prefix apps/website test -- app/api/intake/route.test.ts app/api/campaign-estimate/route.test.ts
```

Expected: FAIL because intake responses do not include `metaEvent`.

- [ ] **Step 3: Verify consent and reserve after persistence**

Extend each handler dependency contract with:

```ts
verifyAdvertisingConsent(request: NextRequest): Promise<VerifiedConsent | null>;
recordConsent(input: {leadId: string; companyId: string; consent: VerifiedConsent; occurredAt: string}): Promise<void>;
reserveLead(input: {leadId: string; companyId: string; consentId: string; occurredAt: string}): Promise<ReservedMetaEvent | null>;
requestDelivery(deliveryId: string): Promise<void>;
```

Call `accept` first. Only then verify the signed consent header and append the linked snapshot through `record_privacy_consent`; the server supplies `company_id`, `lead_id`, request IP, and user agent rather than trusting those relationships from the website. Reserve Meta only after evidence persistence succeeds. A consent-recording or reservation exception is caught and converted to `metaEvent: null`; the already accepted lead remains a 202. If reservation succeeds but immediate Inngest publication fails, still return `reserved.envelope`; the pending ledger and sweeper will recover server delivery while the browser uses the stable event ID.

For duplicate submissions, return the existing Lead envelope only when the same persisted consented lead owns it; database uniqueness prevents another conversion.

- [ ] **Step 4: Propagate the optional envelope through website proxies**

Extend strict upstream schemas to accept:

```ts
metaEvent: z.object({
  name: z.literal("Lead"),
  eventId: z.uuid(),
  issuedAt: z.iso.datetime({offset: true}),
}).nullable(),
```

Never synthesize an envelope at the website layer. Return the PIW-issued envelope unchanged.

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test:run -- src/app/api/integrations/all-season/intake/route.test.ts src/app/api/integrations/all-season/campaign-estimate/route.test.ts
npm --prefix apps/website test -- app/api/intake/route.test.ts app/api/campaign-estimate/route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit intake integration**

```bash
git add src/app/api/integrations/all-season/intake/route.ts src/app/api/integrations/all-season/intake/route.test.ts src/app/api/integrations/all-season/campaign-estimate/route.ts src/app/api/integrations/all-season/campaign-estimate/route.test.ts apps/website/app/api/intake/route.ts apps/website/app/api/intake/route.test.ts apps/website/app/api/campaign-estimate/route.ts apps/website/app/api/campaign-estimate/route.test.ts
git commit -m "feat: reserve Meta Lead after intake"
```

---

### Task 7: Add consent-gated Pixel providers and browser `Lead`

**Files:**
- Create: `src/components/marketing/meta-pixel-provider.tsx`
- Create: `src/components/marketing/meta-pixel-provider.test.tsx`
- Create: `apps/website/components/meta-pixel-provider.tsx`
- Create: `apps/website/components/meta-pixel-provider.test.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `apps/website/app/layout.tsx`
- Modify: `apps/website/app/campaigns/campaign-estimate-form.tsx`
- Modify: `apps/website/components/lead-webhook-form.tsx`
- Test: the nearest existing form tests for both components.

**Interfaces:**
- Consumes: `usePrivacyConsent()`, `NEXT_PUBLIC_META_PIXEL_ID`, server-issued `MetaBrowserEventEnvelope`.
- Produces: `MetaPixelProvider`, `useMetaPixel().trackConversion(envelope)`, consented `PageView`, and deduplicated browser `Lead`.

- [ ] **Step 1: Write failing Pixel-provider tests**

```tsx
test("does not load or touch Meta while advertising is denied", () => {
  render(<MetaPixelProvider consent={{advertising: false}}><Child /></MetaPixelProvider>);
  expect(document.querySelector('script[src*="connect.facebook.net"]')).toBeNull();
  expect(window.fbq).toBeUndefined();
});

test("grant loads once and tracks the current PageView once", async () => {
  const {rerender} = render(<MetaPixelProvider consent={{advertising: true}}><Child /></MetaPixelProvider>);
  await waitFor(() => expect(document.querySelectorAll('script[src*="connect.facebook.net"]')).toHaveLength(1));
  rerender(<MetaPixelProvider consent={{advertising: true}}><Child /></MetaPixelProvider>);
  expect(fbq).toHaveBeenCalledWith("track", "PageView");
  expect(fbq.mock.calls.filter(call => call[1] === "PageView")).toHaveLength(1);
});

test("tracks a server envelope once with eventID", () => {
  const {trackConversion} = renderMeta({advertising: true});
  trackConversion({name: "Lead", eventId, issuedAt});
  trackConversion({name: "Lead", eventId, issuedAt});
  expect(fbq).toHaveBeenCalledWith("track", "Lead", {}, {eventID: eventId});
  expect(conversionCalls()).toHaveLength(1);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
npm run test:run -- src/components/marketing/meta-pixel-provider.test.tsx
npm --prefix apps/website test -- components/meta-pixel-provider.test.tsx
```

Expected: FAIL because providers do not exist.

- [ ] **Step 3: Implement providers**

Initialize with:

```ts
fbq("init", pixelId);
fbq("track", "PageView");
```

Track standard `Lead` with `fbq("track", "Lead", {}, {eventID})` and custom `AssessmentCompleted` with `fbq("trackCustom", "AssessmentCompleted", {}, {eventID})`. Keep an in-memory `Set<string>` of emitted `eventId` values. Reject expired envelopes older than ten minutes, unknown event names, invalid UUIDs, missing Pixel ID, and all calls while Advertising is denied. The website provider tracks all public website routes. The PIW provider checks `usePathname()` and loads/tracks only paths beginning `/roof-estimate`; it never loads Meta in authenticated CRM routes.

- [ ] **Step 4: Emit returned `Lead` before navigation**

After a successful form response, call `trackConversion(body.metaEvent)` when present. For campaign forms, emit before assigning `window.location` to the PIW URL. Do not delay navigation for Meta network completion; the matching CAPI event remains authoritative.

- [ ] **Step 5: Run form and provider tests**

Run:

```bash
npm run test:run -- src/components/marketing/meta-pixel-provider.test.tsx
npm --prefix apps/website test -- components/meta-pixel-provider.test.tsx app/campaigns/campaign-estimate-form.test.tsx components/lead-webhook-form.test.tsx
npm --prefix apps/website run typecheck
npm run typecheck
```

Neither form currently has a sibling test. Create exactly `apps/website/app/campaigns/campaign-estimate-form.test.tsx` and `apps/website/components/lead-webhook-form.test.tsx` with success, denied-consent, missing-envelope, and failed-submission cases.

Expected: PASS.

- [ ] **Step 6: Commit browser tracking**

```bash
git add src/components/marketing/meta-pixel-provider.tsx src/components/marketing/meta-pixel-provider.test.tsx src/app/layout.tsx apps/website/components/meta-pixel-provider.tsx apps/website/components/meta-pixel-provider.test.tsx apps/website/app/layout.tsx apps/website/app/campaigns/campaign-estimate-form.tsx apps/website/components/lead-webhook-form.tsx apps/website/app/campaigns/campaign-estimate-form.test.tsx apps/website/components/lead-webhook-form.test.tsx
git commit -m "feat: track consented Meta browser events"
```

---

### Task 8: Reserve and emit `AssessmentCompleted`

**Files:**
- Modify: `src/modules/roof-assessment/request-consultation.ts`
- Modify: `src/modules/roof-assessment/request-consultation.test.ts`
- Modify: `src/app/api/roof-estimate/[token]/result-view/route.ts`
- Modify: `src/app/api/roof-estimate/[token]/result-view/route.test.ts`
- Modify: `src/app/roof-estimate/[token]/assessment-result.tsx`
- Modify: `src/app/roof-estimate/[token]/assessment-result.test.tsx`

**Interfaces:**
- Consumes: result-view persistence, verified current Advertising consent, `SupabaseMetaRepository.reserveAssessment`.
- Produces: `{resultViewed: true, metaEvent: MetaBrowserEventEnvelope | null}` and one browser/server `AssessmentCompleted` pair.

- [ ] **Step 1: Write failing result-view tests**

```ts
test("returns AssessmentCompleted only for a consented trusted rendered result", async () => {
  repository.findCompletedByToken.mockResolvedValue(completedTrustedContext);
  repository.markResultViewed.mockResolvedValue({resultViewedAt: occurredAt});
  reserveAssessment.mockResolvedValue({name: "AssessmentCompleted", eventId, issuedAt: occurredAt});

  const response = await handleResultViewRequest({
    token, repository, consent: advertisingGranted, reserveAssessment,
  });

  expect(await response.json()).toEqual({
    resultViewed: true,
    metaEvent: {name: "AssessmentCompleted", eventId, issuedAt: occurredAt},
  });
});

test.each(["pending", "failed", "untrusted"])("%s pricing returns no Meta event", async (state) => {
  repository.findCompletedByToken.mockResolvedValue(contextFor(state));
  const response = await handleResultViewRequest(input);
  expect((await response.json()).metaEvent).toBeNull();
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
npm run test:run -- 'src/app/api/roof-estimate/[token]/result-view/route.test.ts' 'src/app/roof-estimate/[token]/assessment-result.test.tsx'
```

Expected: FAIL because the result-view response has no Meta envelope.

- [ ] **Step 3: Extend completed assessment context**

Return the linked `leadId`, calculation status, and trusted pricing-presence booleans from `findCompletedByToken`. Do not return amounts to the browser Meta integration. The route first records `resultViewed`; only after success does it reserve the Meta event.

- [ ] **Step 4: Emit once from the rendered result**

Replace the fire-and-forget result-view effect with a response-aware call:

```ts
useEffect(() => {
  if (preview || recorded.current) return;
  recorded.current = true;
  void fetch(`/api/roof-estimate/${token}/result-view`, {method: "POST"})
    .then(response => response.ok ? response.json() : null)
    .then(body => {
      const parsed = resultViewResponseSchema.safeParse(body);
      if (parsed.success && parsed.data.metaEvent) trackConversion(parsed.data.metaEvent);
    })
    .catch(() => undefined);
}, [preview, token, trackConversion]);
```

Keep the quote visible regardless of acknowledgement or Meta failure. Preview/dev assessment routes never emit.

- [ ] **Step 5: Run focused and assessment regression tests**

Run:

```bash
npm run test:run -- 'src/app/api/roof-estimate/[token]/result-view/route.test.ts' 'src/app/roof-estimate/[token]/assessment-result.test.tsx' 'src/app/roof-estimate/[token]/assessment-experience.test.tsx' src/modules/roof-assessment/request-consultation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit assessment conversion tracking**

```bash
git add src/modules/roof-assessment/request-consultation.ts src/modules/roof-assessment/request-consultation.test.ts 'src/app/api/roof-estimate/[token]/result-view/route.ts' 'src/app/api/roof-estimate/[token]/result-view/route.test.ts' 'src/app/roof-estimate/[token]/assessment-result.tsx' 'src/app/roof-estimate/[token]/assessment-result.test.tsx'
git commit -m "feat: track completed roof assessments"
```

---

### Task 9: Regenerate types and add the operator runbook

**Files:**
- Modify: `src/lib/database.types.ts`
- Modify: `.env.example`
- Modify: `apps/website/.env.example`
- Create: `docs/runbooks/all-season-meta-conversions.md`

**Interfaces:**
- Consumes: completed database schema and Meta environment contract.
- Produces: checked-in types and an exact setup/rollback runbook.

- [ ] **Step 1: Regenerate database types**

Run:

```bash
npm run db:reset
npm run db:types > /tmp/piw-meta-database.types.ts
```

Review the generated file, then replace `src/lib/database.types.ts` using the repository's established generated-type workflow. Confirm `meta_event_deliveries` and all five RPCs appear.

- [ ] **Step 2: Document environment variables**

Add to PIW `.env.example`:

```dotenv
PRIVACY_CONSENT_SIGNING_SECRET=
META_TRACKING_ENABLED=false
META_PIXEL_ID=3142520615938086
NEXT_PUBLIC_META_PIXEL_ID=3142520615938086
META_CAPI_ACCESS_TOKEN=
META_GRAPH_API_VERSION=
META_TEST_EVENT_CODE=
```

Add to `apps/website/.env.example`:

```dotenv
PRIVACY_CONSENT_SIGNING_SECRET=
NEXT_PUBLIC_META_TRACKING_ENABLED=false
NEXT_PUBLIC_META_PIXEL_ID=3142520615938086
```

- [ ] **Step 3: Write the runbook with exact operator commands**

The runbook must contain:

1. Events Manager path for dataset `3142520615938086`.
2. Pixel plus Conversions API partner/manual configuration steps.
3. Access-token generation and rotation without pasting it into Git, Slack, screenshots, or browser code.
4. How to select and pin the supported Graph API version shown during token setup.
5. Vercel environment mapping for `piw` and `rake-website`.
6. Test Events code installation and removal.
7. The consented and denied QA journeys.
8. Queries for pending, retryable, permanent-failed, and sent delivery counts.
9. Deduplication and Event Match Quality checks in Events Manager.
10. Rollback: set both tracking flags false and redeploy; do not delete delivery rows.

- [ ] **Step 4: Run documentation/config tests**

Run:

```bash
npm run typecheck
npm --prefix apps/website run typecheck
npm run test:run -- src/lib/env/shared.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit generated types and runbook**

```bash
git add src/lib/database.types.ts .env.example apps/website/.env.example docs/runbooks/all-season-meta-conversions.md
git commit -m "docs: add Meta conversion operations runbook"
```

---

### Task 10: Verify locally, configure Meta/Vercel, and roll out

**Files:**
- No source files unless a test exposes a defect.
- Evidence update: `docs/runbooks/all-season-meta-conversions.md`

**Interfaces:**
- Consumes: Meta dataset credentials, Vercel environments, Supabase migration, deployed website and PIW.
- Produces: verified consented/denied production behavior and recorded operational evidence.

- [ ] **Step 1: Run full local verification**

Run:

```bash
npm run lint
npm run typecheck
npm run test:run
npm run db:test
npm run test:integration
npm run build
npm --prefix apps/website run lint
npm --prefix apps/website run typecheck
npm --prefix apps/website test
npm --prefix apps/website run build
```

Expected: every command exits 0.

- [ ] **Step 2: Apply the database migration before enabling traffic**

Run:

```bash
npx supabase migration list --linked
npx supabase db push --linked
npx supabase migration list --linked
```

Expected: `20260901150000_meta_event_deliveries.sql` appears in both local and remote columns after the push. Verify remotely that `meta_event_deliveries` and all reservation/claim/result RPCs exist. Do not enable Meta if migration verification fails.

- [ ] **Step 3: Configure Events Manager Test Events**

In the All Season Roofing dataset:

- Finish Meta Pixel setup for `3142520615938086`.
- Generate the Conversions API token.
- Record the supported Graph API version.
- Open Test Events and obtain the temporary test code.

Never paste the access token into task commentary, a commit, the runbook, or Slack.

- [ ] **Step 4: Configure Vercel with tracking disabled**

Set the shared consent secret identically on `piw` and `rake-website`. Set PIW server token/version/test code and both public Pixel IDs. Keep `META_TRACKING_ENABLED=false` and `NEXT_PUBLIC_META_TRACKING_ENABLED=false`, then deploy both projects.

- [ ] **Step 5: Enable preview Test Events and run the consented journey**

Enable both flags in preview only. Verify:

```text
PageView (browser)
Lead (browser + server, deduplicated to one)
AssessmentCompleted (browser + server, deduplicated to one)
```

Also verify the lead exists in PIW CRM, quote has trusted pricing, customer delivery succeeds, and the Slack alert retains PIW Context Dialer format.

- [ ] **Step 6: Run the denied-consent journey**

Reject nonessential tracking, submit the full form, complete the assessment, and verify:

- no request to `connect.facebook.net` or `graph.facebook.com` from the browser;
- no Meta delivery ledger row;
- no activity in Test Events;
- lead, quote, CRM, customer delivery, and Slack still succeed.

- [ ] **Step 7: Promote and enable production**

Remove the Test Events code from production, deploy both projects, enable both production flags together, and repeat one explicit consented QA journey. Do not send synthetic historical events.

- [ ] **Step 8: Record rollout evidence and commit**

Append only non-secret evidence to the runbook: deployment URLs, commit SHA, migration version, test timestamps, dedup result, and delivery counts.

```bash
git add docs/runbooks/all-season-meta-conversions.md
git commit -m "docs: record Meta conversion rollout"
```

## Final Acceptance Checklist

- [ ] Privacy-consent prerequisite is implemented and deployed.
- [ ] Public website consent safely transfers to PIW and disappears from the final URL.
- [ ] Consented pages record `PageView`; denied pages load no Meta code.
- [ ] Saved leads record one deduplicated `Lead`.
- [ ] Trusted rendered quotes record one deduplicated `AssessmentCompleted`.
- [ ] Errors, fallback results, unavailable tokens, and untrusted pricing record no completion event.
- [ ] Browser code and logs contain no CAPI token.
- [ ] Meta payloads contain no property, answer, geometry, package, or price data.
- [ ] Pending and retryable deliveries recover through the sweeper.
- [ ] Meta downtime cannot change customer-facing or CRM outcomes.
- [ ] Test Events code is absent from production.
- [ ] Production flags can disable browser and server delivery together.

# All Season Canonical Post-Submit Assessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every All Season quote form into one secure, resumable, campaign-aware roof assessment that progressively saves answers, shows only trustworthy calculated ranges, and captures consultation preferences.

**Architecture:** Consolidate intake behind a single `startOrResumeRoofAssessment` domain service and atomic Supabase transaction. Both the PIW server action and the main-site server-to-server adapter return a short-lived continuation URL; the continuation route on the PIW origin uses a signed session cookie for same-browser resume and Twilio Verify v2 SMS for cross-device resume. The existing token-scoped assessment remains the canonical questionnaire and gains lifecycle, presentation, result-state, and consultation boundaries.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod 4, Supabase Postgres/RPC/RLS, Inngest, Vitest, Testing Library, pgTAP, Twilio Verify v2 REST API, GSAP, static JavaScript main-site forms.

**Spec:** `docs/superpowers/specs/2026-08-26-all-season-post-submit-assessment-design.md`

## Global Constraints

- All seven approved entry points must redirect through the canonical assessment continuation contract.
- Questions, response identifiers, scoring, and persistence are shared; only presentation and result framing vary by campaign.
- The analysis screen remains visible for at least five seconds, while imagery and calculations never block questionnaire entry.
- A dollar range appears only for a ready, trustworthy Google-derived calculation; no answer-only or placeholder production range is allowed.
- Every answer saves before advancing, and failed saves keep the local selection available for retry.
- Same-browser resume is immediate; cross-device resume requires Twilio Verify v2 SMS and rotates the public token after approval.
- An inactive incomplete assessment becomes abandoned after 24 hours and may return to in-progress after authorized resume.
- Consultation methods are call, text, and email. Call windows are `asap`, `morning`, `midday`, `afternoon`, and `evening` in `America/New_York`.
- A high-intent event fires once when completed or progressive scores first satisfy `intent >= 3` or `urgency >= 3`.
- Calendar booking and automated abandonment reminders are out of scope.
- All schema changes remain tenant-scoped, RLS-protected, additive through rollout, and idempotent under retries.

## File Structure

### Database

- Create `supabase/migrations/20260826190000_canonical_roof_assessment_journey.sql`: lifecycle columns, attribution touches, consultation requests, access attempts, indexes, constraints, and transactional RPCs.
- Create `supabase/tests/canonical_roof_assessment_journey.test.sql`: tenant isolation, intake idempotency, resume matching, lifecycle, token rotation, and consultation pgTAP coverage.
- Regenerate `src/lib/database.types.ts`: generated Supabase types only.

### Intake and access

- Create `src/modules/roof-assessment/start-or-resume.ts`: normalized domain contract and orchestration.
- Create `src/modules/roof-assessment/start-or-resume.test.ts`: domain behavior tests.
- Create `src/modules/roof-assessment/supabase-assessment-intake-repository.ts`: RPC adapter.
- Create `src/modules/roof-assessment/continuation-token.ts`: signed, expiring continuation token.
- Create `src/modules/roof-assessment/continuation-token.test.ts`: tamper and expiry tests.
- Create `src/modules/roof-assessment/assessment-session.ts`: signed HTTP-only assessment session cookie.
- Create `src/modules/roof-assessment/assessment-session.test.ts`: binding, expiry, and rotation tests.
- Create `src/app/roof-estimate/continue/[continuation]/route.ts`: same-origin continuation resolution.
- Create `src/app/roof-estimate/continue/[continuation]/route.test.ts`: new, resume, and verification routing tests.

### Verification

- Create `src/modules/roof-assessment/resume-verification.ts`: provider-neutral start/check use cases.
- Create `src/modules/roof-assessment/resume-verification.test.ts`: enumeration-safe and rotation tests.
- Create `src/modules/roof-assessment/twilio-verify-provider.ts`: Twilio Verify v2 REST adapter.
- Create `src/modules/roof-assessment/twilio-verify-provider.test.ts`: request and failure mapping tests.
- Create `src/app/roof-estimate/resume/[attempt]/page.tsx`: OTP entry page.
- Create `src/app/roof-estimate/resume/[attempt]/resume-verification-form.tsx`: accessible client form.
- Create `src/app/api/roof-estimate/resume/[attempt]/route.ts`: start and check API.
- Create `src/app/api/roof-estimate/resume/[attempt]/route.test.ts`: API validation and privacy tests.

### Assessment lifecycle and result

- Modify `src/domain/roof-assessment.ts`: presentation, lifecycle, calculation state, and consultation schemas.
- Modify `src/domain/roof-assessment.test.ts`: schema and high-intent cases.
- Modify `src/domain/events.ts` and `src/domain/events.test.ts`: sparse assessment events.
- Modify `src/modules/roof-assessment/public-assessment.ts` and tests: progressive timestamps, resume, and event boundary.
- Modify `src/modules/roof-assessment/supabase-public-assessment-repository.ts`: new fields and event persistence.
- Create `src/inngest/functions/assessment-abandonment-worker.ts` and test: 24-hour lifecycle sweep.
- Modify `src/app/api/inngest/route.ts`: register the worker.
- Modify `src/config/roof-assessment.ts` and tests: `all-season-main` plus campaign presentation definitions.
- Modify `src/app/roof-estimate/[token]/page.tsx`: presentation and explicit calculation state.
- Modify `src/app/roof-estimate/[token]/assessment-result.tsx` and tests: ready/pending/review states and inline consultation panel.
- Create `src/modules/roof-assessment/request-consultation.ts` and test: validated idempotent intent use case.
- Create `src/app/api/roof-estimate/[token]/consultation/route.ts` and test: token-scoped consultation endpoint.
- Create `src/app/api/roof-estimate/[token]/result-view/route.ts` and test: idempotent result-view timestamp and event.

### Entry-point adapters

- Modify `src/app/roof-estimate/actions.ts`, `src/app/roof-estimate/form-data.ts`, and tests: use shared intake and continuation URL.
- Modify `src/app/api/integrations/all-season/campaign-estimate/route.ts` and tests: use shared intake and return continuation path.
- Modify `apps/website/app/api/campaign-estimate/route.ts` and tests: accept only safe PIW continuation paths.
- Modify `apps/website/app/campaigns/campaign-estimate-form.tsx` and campaign tests: send entry point and redirect.
- Modify `apps/website/public/script.js`, `apps/website/public/quote-drawer.js`, `apps/website/public/lead-forms.test.ts`, `apps/website/public/index.html`, and `apps/website/public/contact.html`: label main-site entry points and consume the canonical URL.
- Modify `.env.example`, `apps/website/.env.example`, `src/lib/env/server.ts`, and env tests: Twilio and signing configuration.
- Modify `apps/website/README.md`: continuation contract and operational configuration.

---

### Task 1: Add the canonical assessment lifecycle schema

**Files:**
- Create: `supabase/migrations/20260826190000_canonical_roof_assessment_journey.sql`
- Create: `supabase/tests/canonical_roof_assessment_journey.test.sql`
- Modify: `src/lib/database.types.ts` only through `supabase gen types`

**Interfaces:**
- Consumes: existing `companies`, `leads`, `properties`, `roof_estimates`, `roof_assessments`, `lead_consents`, and `domain_events` tables.
- Produces: lifecycle-enabled `roof_assessments`; `lead_attribution_touches`; `consultation_requests`; operational `roof_assessment_access_attempts`; RPCs `start_or_resume_roof_assessment`, `rotate_roof_estimate_public_token`, and `request_roof_consultation`.

- [ ] **Step 1: Write failing pgTAP tests for the new schema**

```sql
select has_column('public', 'roof_assessments', 'presentation_key');
select has_column('public', 'roof_assessments', 'last_answered_at');
select has_table('public', 'lead_attribution_touches');
select has_table('public', 'consultation_requests');
select has_table('public', 'roof_assessment_access_attempts');
select has_function('public', 'start_or_resume_roof_assessment');
select has_function('public', 'rotate_roof_estimate_public_token');
select has_function('public', 'request_roof_consultation');
```

Add behavioral cases proving that the same submission UUID returns the same continuation attempt; an incomplete same-property/contact assessment inside 30 days becomes a resume candidate; a 31-day-old assessment creates a new journey; and a completed assessment is never resumed.

- [ ] **Step 2: Run the database test and verify RED**

Run: `DOCKER_CONFIG=/tmp/piw-assessment-docker npx supabase test db supabase/tests/canonical_roof_assessment_journey.test.sql`

Expected: FAIL because the columns, tables, and RPCs do not exist.

- [ ] **Step 3: Implement the additive migration**

The migration must add the explicit lifecycle constraint and business tables:

```sql
alter table public.roof_assessments
  add column presentation_key text not null default 'all-season-main',
  add column entry_point text not null default 'roof-estimate',
  add column last_answered_at timestamptz,
  add column result_viewed_at timestamptz,
  add column abandoned_at timestamptz;

create table public.lead_attribution_touches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  estimate_id uuid references public.roof_estimates(id) on delete set null,
  assessment_id uuid references public.roof_assessments(id) on delete set null,
  submission_id uuid not null,
  entry_point text not null,
  presentation_key text not null,
  attribution jsonb not null default '{}'::jsonb check (jsonb_typeof(attribution) = 'object'),
  referrer text,
  occurred_at timestamptz not null default now(),
  unique (company_id, submission_id)
);

create table public.consultation_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  estimate_id uuid not null references public.roof_estimates(id) on delete cascade,
  assessment_id uuid not null references public.roof_assessments(id) on delete cascade,
  contact_method text not null check (contact_method in ('call', 'text', 'email')),
  call_window text check (call_window in ('asap', 'morning', 'midday', 'afternoon', 'evening')),
  timezone text not null default 'America/New_York',
  status text not null default 'requested' check (status in ('requested', 'contacted', 'booked', 'closed')),
  booking_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id)
);
```

`roof_assessment_access_attempts` stores a hashed opaque attempt token, assessment candidate, normalized destination phone, request IP, `new`/`resume_candidate` kind, verification timestamps, send count, expiry, and consumption timestamp. Enable RLS and revoke anonymous/authenticated writes for all three tables. The RPC must acquire an advisory transaction lock, append consent and attribution evidence, and return only an access-attempt ID plus raw one-time continuation secret generated inside the transaction.

- [ ] **Step 4: Run migration tests and database advisors**

Run:

```bash
DOCKER_CONFIG=/tmp/piw-assessment-docker npx supabase db reset --local
DOCKER_CONFIG=/tmp/piw-assessment-docker npx supabase test db supabase/tests/canonical_roof_assessment_journey.test.sql
DOCKER_CONFIG=/tmp/piw-assessment-docker npx supabase db lint --local --schema public --level warning --fail-on warning
```

Expected: all pgTAP cases pass and lint exits 0.

- [ ] **Step 5: Regenerate types and commit**

```bash
DOCKER_CONFIG=/tmp/piw-assessment-docker npx supabase gen types typescript --local > /tmp/piw-assessment-types.ts
cp /tmp/piw-assessment-types.ts src/lib/database.types.ts
git add supabase/migrations/20260826190000_canonical_roof_assessment_journey.sql supabase/tests/canonical_roof_assessment_journey.test.sql src/lib/database.types.ts
git commit -m "feat: add canonical assessment journey schema"
```

### Task 2: Build the shared start-or-resume domain service

**Files:**
- Create: `src/modules/roof-assessment/start-or-resume.ts`
- Create: `src/modules/roof-assessment/start-or-resume.test.ts`
- Create: `src/modules/roof-assessment/supabase-assessment-intake-repository.ts`

**Interfaces:**
- Consumes: `start_or_resume_roof_assessment` RPC from Task 1.
- Produces:

```ts
type AssessmentEntryPoint = "main-home" | "main-contact" | "main-drawer" | "roof-estimate" | `campaign:${CampaignSlug}`;
type StartAssessmentInput = {
  submissionId: string;
  companyId: string;
  name: string;
  email: string;
  phone: string;
  submittedAddress: string;
  googlePlaceId?: string;
  campaign: CampaignSlug | null;
  presentationKey: RoofAssessmentPresentationKey;
  entryPoint: AssessmentEntryPoint;
  attribution: CampaignAttribution;
  referrer: string | null;
  consent: { disclosureVersion: string; ipAddress: string; userAgent: string; grantedAt: string };
};
type StartAssessmentResult = { kind: "continue"; continuationPath: `/roof-estimate/continue/${string}` };
interface ContinuationTokenIssuer {
  issue(input: {attemptId: string; secret: string; expiresAt: string}): Promise<string>;
}
```

- [ ] **Step 1: Write failing domain tests**

Cover exact normalization, disclosure propagation, RPC result validation, and the invariant that neither lead IDs nor public estimate tokens appear in `StartAssessmentResult`.

```ts
expect(await startOrResumeRoofAssessment(input, deps)).toEqual({
  kind: "continue",
  continuationPath: expect.stringMatching(/^\/roof-estimate\/continue\/[A-Za-z0-9_-]+$/),
});
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/modules/roof-assessment/start-or-resume.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the use case and Supabase adapter**

Use Zod at the domain boundary, normalize email to lowercase and phone to E.164 before repository invocation, and pass the database-returned `{attemptId, secret, expiresAt}` through the injected `ContinuationTokenIssuer`. Tests use a deterministic fake issuer; Task 3 supplies the HMAC implementation. Reject malformed RPC output as an internal error; do not fall back to a direct public token.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm run test:run -- src/modules/roof-assessment/start-or-resume.test.ts
git add src/modules/roof-assessment/start-or-resume.ts src/modules/roof-assessment/start-or-resume.test.ts src/modules/roof-assessment/supabase-assessment-intake-repository.ts
git commit -m "feat: centralize assessment intake"
```

### Task 3: Add signed continuation and same-browser session access

**Files:**
- Create: `src/modules/roof-assessment/continuation-token.ts`
- Create: `src/modules/roof-assessment/continuation-token.test.ts`
- Create: `src/modules/roof-assessment/assessment-session.ts`
- Create: `src/modules/roof-assessment/assessment-session.test.ts`
- Create: `src/app/roof-estimate/continue/[continuation]/route.ts`
- Create: `src/app/roof-estimate/continue/[continuation]/route.test.ts`
- Modify: `src/lib/env/server.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: access-attempt record from Task 1 and `continuationPath` from Task 2.
- Produces: `signContinuation`, `verifyContinuation`, `readAssessmentSession`, `setAssessmentSession`, and the continuation HTTP route.

- [ ] **Step 1: Write failing cryptographic and routing tests**

```ts
const token = await signContinuation({attemptId, secret, expiresAt}, signingKey);
expect(await verifyContinuation(token, signingKey, now)).toEqual({attemptId, secret, expiresAt});
await expect(verifyContinuation(`${token}x`, signingKey, now)).rejects.toThrow("Invalid continuation");
```

Route cases: new journey sets `as_roof_assessment` with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/roof-estimate`, and redirects to the token route; a resume candidate with the bound cookie redirects immediately; a candidate without the cookie redirects to `/roof-estimate/resume/[attempt]`; expired and consumed attempts return the same generic invalid-link response.

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/modules/roof-assessment/continuation-token.test.ts src/modules/roof-assessment/assessment-session.test.ts 'src/app/roof-estimate/continue/[continuation]/route.test.ts'`

- [ ] **Step 3: Implement signing, cookie binding, and continuation routing**

Add `ROOF_ASSESSMENT_SIGNING_SECRET` as a minimum 32-byte server secret. Sign canonical JSON with HMAC-SHA256 and compare signatures with `timingSafeEqual`. Store only assessment ID, token version, issued-at, and 30-day expiry in the signed cookie payload. Never place phone, email, or raw database IDs in browser-visible error copy.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm run test:run -- src/modules/roof-assessment/continuation-token.test.ts src/modules/roof-assessment/assessment-session.test.ts 'src/app/roof-estimate/continue/[continuation]/route.test.ts'
git add src/modules/roof-assessment/continuation-token* src/modules/roof-assessment/assessment-session* 'src/app/roof-estimate/continue/[continuation]' src/lib/env/server.ts .env.example
git commit -m "feat: secure assessment continuation"
```

### Task 4: Implement Twilio Verify cross-device resume

**Files:**
- Create: `src/modules/roof-assessment/resume-verification.ts`
- Create: `src/modules/roof-assessment/resume-verification.test.ts`
- Create: `src/modules/roof-assessment/twilio-verify-provider.ts`
- Create: `src/modules/roof-assessment/twilio-verify-provider.test.ts`
- Create: `src/app/api/roof-estimate/resume/[attempt]/route.ts`
- Create: `src/app/api/roof-estimate/resume/[attempt]/route.test.ts`
- Create: `src/app/roof-estimate/resume/[attempt]/page.tsx`
- Create: `src/app/roof-estimate/resume/[attempt]/resume-verification-form.tsx`
- Modify: `src/lib/env/server.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: access attempts and `rotate_roof_estimate_public_token` from Task 1; session cookie from Task 3.
- Produces:

```ts
interface ResumeVerificationProvider {
  start(input: {to: string}): Promise<{providerAttemptId: string; status: "pending"}>;
  check(input: {to: string; code: string}): Promise<{approved: boolean}>;
}
```

- [ ] **Step 1: Write failing provider and use-case tests**

Prove Twilio requests use `POST /v2/Services/{ServiceSid}/Verifications` with `To` and `Channel=sms`, and `POST /VerificationCheck` with `To` and `Code`. Prove the use case enforces one send per minute, five starts per phone/IP/hour, generic responses for unknown attempts, and token rotation only after `approved`.

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/modules/roof-assessment/resume-verification.test.ts src/modules/roof-assessment/twilio-verify-provider.test.ts 'src/app/api/roof-estimate/resume/[attempt]/route.test.ts'`

- [ ] **Step 3: Implement the Twilio adapter and verification flow**

Configure `TWILIO_VERIFY_ENABLED`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, and `TWILIO_VERIFY_SERVICE_SID`. Use HTTP Basic authentication server-side. Treat Twilio `approved` as success; map pending, expired, max-attempt, 404, timeout, and network failures to privacy-safe domain errors. On approval, rotate the estimate public token, consume the attempt, set the assessment session cookie, and return the new assessment URL.

- [ ] **Step 4: Implement the OTP page**

Render one mobile-fit card with a six-digit `inputMode="numeric"` field, generic masked-phone copy, resend cooldown status, error live region, and submit button that redirects only after approval.

- [ ] **Step 5: Run GREEN and commit**

```bash
npm run test:run -- src/modules/roof-assessment/resume-verification.test.ts src/modules/roof-assessment/twilio-verify-provider.test.ts 'src/app/api/roof-estimate/resume/[attempt]/route.test.ts'
git add src/modules/roof-assessment/resume-verification* src/modules/roof-assessment/twilio-verify-provider* 'src/app/api/roof-estimate/resume/[attempt]' 'src/app/roof-estimate/resume/[attempt]' src/lib/env/server.ts .env.example
git commit -m "feat: verify cross-device assessment resume"
```

### Task 5: Cut both intake transports over to the shared contract

**Files:**
- Modify: `src/app/roof-estimate/form-data.ts`
- Modify: `src/app/roof-estimate/form-data.test.ts`
- Modify: `src/app/roof-estimate/actions.ts`
- Modify: `src/app/api/integrations/all-season/campaign-estimate/route.ts`
- Modify: `src/app/api/integrations/all-season/campaign-estimate/route.test.ts`
- Modify: `src/modules/leads/accept-all-season-campaign-estimate.ts`
- Modify: `src/modules/leads/accept-all-season-campaign-estimate.test.ts`
- Modify: `apps/website/app/api/campaign-estimate/route.ts`
- Modify: `apps/website/app/api/campaign-estimate/route.test.ts`

**Interfaces:**
- Consumes: `startOrResumeRoofAssessment` from Task 2.
- Produces: `{accepted: true, continuationPath}` internally and `{accepted: true, estimateUrl}` at the main-site boundary.

- [ ] **Step 1: Update tests first**

Require `entry_point` and `presentation_key` in forwarded input. Replace assertions for `/roof-estimate/{uuid}` with a safe `/roof-estimate/continue/{base64url}` path. Add tests rejecting absolute upstream URLs, path traversal, and non-continuation success bodies.

- [ ] **Step 2: Run RED**

Run:

```bash
npm run test:run -- src/app/roof-estimate/form-data.test.ts src/app/api/integrations/all-season/campaign-estimate/route.test.ts src/modules/leads/accept-all-season-campaign-estimate.test.ts
npm --prefix apps/website test -- app/api/campaign-estimate/route.test.ts
```

- [ ] **Step 3: Replace duplicate creation logic with the shared service**

The server action redirects to the continuation path. The authenticated integration route maps the external payload into `StartAssessmentInput`. The main-site proxy accepts only `^/roof-estimate/continue/[A-Za-z0-9_-]+$`, resolves it against `PIW_PUBLIC_APP_URL`, and returns `estimateUrl`.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm run test:run -- src/app/roof-estimate/form-data.test.ts src/app/api/integrations/all-season/campaign-estimate/route.test.ts src/modules/leads/accept-all-season-campaign-estimate.test.ts
npm --prefix apps/website test -- app/api/campaign-estimate/route.test.ts
git add src/app/roof-estimate/form-data* src/app/roof-estimate/actions.ts src/app/api/integrations/all-season/campaign-estimate src/modules/leads/accept-all-season-campaign-estimate* apps/website/app/api/campaign-estimate
git commit -m "refactor: unify assessment intake adapters"
```

### Task 6: Add campaign presentation and progressive lifecycle events

**Files:**
- Modify: `src/config/roof-assessment.ts`
- Create: `src/config/roof-assessment.test.ts`
- Modify: `src/domain/roof-assessment.ts`
- Modify: `src/domain/roof-assessment.test.ts`
- Modify: `src/domain/events.ts`
- Modify: `src/domain/events.test.ts`
- Modify: `src/modules/roof-assessment/public-assessment.ts`
- Modify: `src/modules/roof-assessment/public-assessment.test.ts`
- Modify: `src/modules/roof-assessment/supabase-public-assessment-repository.ts`
- Create: `src/inngest/functions/assessment-abandonment-worker.ts`
- Create: `src/inngest/functions/assessment-abandonment-worker.test.ts`
- Modify: `src/app/api/inngest/route.ts`

**Interfaces:**
- Consumes: lifecycle columns from Task 1.
- Produces: `RoofAssessmentPresentationKey`, explicit `CalculationState`, restored abandoned assessments, and sparse assessment event envelopes.

- [ ] **Step 1: Write failing presentation and lifecycle tests**

Assert `getRoofAssessmentContext("all-season-main")` is distinct from all campaigns while question IDs remain unchanged. Assert each progress save sets `lastAnsweredAt`; an abandoned assessment resumes to in-progress; completion emits one event; and a high-intent event is emitted once when progressive or completed scores first satisfy `intent >= 3` or `urgency >= 3`.

- [ ] **Step 2: Write the failing abandonment worker test**

At `2026-08-27T13:00:00Z`, an assessment last active at `2026-08-26T12:59:59Z` is marked abandoned and produces one `roof/assessment.abandoned` event; a record active at `2026-08-26T13:00:01Z` remains in progress.

- [ ] **Step 3: Run RED**

Run: `npm run test:run -- src/config/roof-assessment.test.ts src/domain/roof-assessment.test.ts src/domain/events.test.ts src/modules/roof-assessment/public-assessment.test.ts src/inngest/functions/assessment-abandonment-worker.test.ts`

- [ ] **Step 4: Implement lifecycle state and sparse events**

Add `calculateProgressSignals(responses: Partial<RoofAssessmentResponses>)` so high-intent evaluation never pretends an incomplete assessment is complete. Add event names `roof/assessment.started`, `.high_intent`, `.abandoned`, `.resumed`, `.completed`, `.result_viewed`, and `.consultation_requested` to the discriminated union. Use assessment ID plus event name for idempotency. Register an Inngest cron worker that runs every hour and calls an atomic abandonment RPC for rows inactive at least 24 hours.

- [ ] **Step 5: Run GREEN and commit**

```bash
npm run test:run -- src/config/roof-assessment.test.ts src/domain/roof-assessment.test.ts src/domain/events.test.ts src/modules/roof-assessment/public-assessment.test.ts src/inngest/functions/assessment-abandonment-worker.test.ts
git add src/config/roof-assessment* src/domain/roof-assessment* src/domain/events* src/modules/roof-assessment src/inngest/functions/assessment-abandonment-worker* src/app/api/inngest/route.ts
git commit -m "feat: persist assessment lifecycle signals"
```

### Task 7: Implement trustworthy result states and consultation capture

**Files:**
- Modify: `src/app/roof-estimate/[token]/public-estimate-flow.ts`
- Modify: `src/app/roof-estimate/[token]/public-estimate-flow.test.ts`
- Modify: `src/app/roof-estimate/[token]/page.tsx`
- Modify: `src/app/roof-estimate/[token]/assessment-result.tsx`
- Modify: `src/app/roof-estimate/[token]/assessment-result.test.tsx`
- Create: `src/modules/roof-assessment/request-consultation.ts`
- Create: `src/modules/roof-assessment/request-consultation.test.ts`
- Create: `src/app/api/roof-estimate/[token]/consultation/route.ts`
- Create: `src/app/api/roof-estimate/[token]/consultation/route.test.ts`
- Create: `src/app/api/roof-estimate/[token]/result-view/route.ts`
- Create: `src/app/api/roof-estimate/[token]/result-view/route.test.ts`
- Modify: `src/app/roof-estimate/[token]/assessment.css`

**Interfaces:**
- Consumes: assessment presentation and calculation state from Task 6; `request_roof_consultation` RPC from Task 1.
- Produces: inline `ConsultationPreferenceForm` and idempotent token-scoped consultation endpoint.

- [ ] **Step 1: Write failing result-state tests**

```ts
expect(getAssessmentResultRange({status: "pending", lowCents: null, highCents: null, roofSquares: null})).toBeNull();
expect(getAssessmentResultRange({status: "review_required", lowCents: 1, highCents: 2, roofSquares: 20})).toBeNull();
expect(getAssessmentResultRange({status: "ready", lowCents: 1800000, highCents: 2600000, roofSquares: 23})).toEqual(expect.objectContaining({source: "google"}));
```

Delete production support for `source: "sample"`; keep any preview sample construction isolated to the dev sandbox. Component tests must prove the result outlook stays visible in all three states and no dollar text renders for pending or review-required.

- [ ] **Step 2: Write failing consultation tests**

Prove call requires a window, text/email reject a call window, retries return the same request, and the result CTA opens the preference panel without navigation or loader replay. Prove the result-view endpoint sets `result_viewed_at` and emits `roof/assessment.result_viewed` only once across repeated calls.

- [ ] **Step 3: Run RED**

Run: `npm run test:run -- 'src/app/roof-estimate/[token]/public-estimate-flow.test.ts' 'src/app/roof-estimate/[token]/assessment-result.test.tsx' src/modules/roof-assessment/request-consultation.test.ts 'src/app/api/roof-estimate/[token]/consultation/route.test.ts' 'src/app/api/roof-estimate/[token]/result-view/route.test.ts'`

- [ ] **Step 4: Implement the three-state payoff and contact preference panel**

Use `aria-live="polite"` for calculation transitions. When the completed result mounts, POST once to the idempotent result-view endpoint. Render call/text/email as one choice group. Conditionally render the five call windows. POST `{contactMethod, callWindow}` and replace the controls with a confirmation summary after success; preserve selections and announce the error after failure.

- [ ] **Step 5: Run GREEN and commit**

```bash
npm run test:run -- 'src/app/roof-estimate/[token]/public-estimate-flow.test.ts' 'src/app/roof-estimate/[token]/assessment-result.test.tsx' src/modules/roof-assessment/request-consultation.test.ts 'src/app/api/roof-estimate/[token]/consultation/route.test.ts' 'src/app/api/roof-estimate/[token]/result-view/route.test.ts'
git add 'src/app/roof-estimate/[token]' src/modules/roof-assessment/request-consultation* 'src/app/api/roof-estimate/[token]/consultation' 'src/app/api/roof-estimate/[token]/result-view'
git commit -m "feat: capture consultation intent from assessment results"
```

### Task 8: Cut over all main-site and campaign forms

**Files:**
- Modify: `apps/website/app/campaigns/campaign-estimate-form.tsx`
- Modify: `apps/website/app/campaigns/campaigns.ts`
- Modify: `apps/website/app/campaigns/campaigns.test.ts`
- Modify: `apps/website/public/script.js`
- Modify: `apps/website/public/quote-drawer.js`
- Modify: `apps/website/public/lead-forms.test.ts`
- Modify: `apps/website/public/index.html`
- Modify: `apps/website/public/contact.html`
- Modify: `apps/website/README.md`

**Interfaces:**
- Consumes: `{accepted: true, estimateUrl}` main-site API response from Task 5.
- Produces: correct `entry_point` and `presentation_key` from homepage, contact, drawer, and each campaign.

- [ ] **Step 1: Write failing contract tests for every entry point**

Use a table with these literal mappings:

```ts
[
  ["homepage", "main-home", "all-season-main"],
  ["contact", "main-contact", "all-season-main"],
  ["drawer", "main-drawer", "all-season-main"],
  ["weather-report", "campaign:weather-report", "weather-report"],
  ["seasonal-shield", "campaign:seasonal-shield", "seasonal-shield"],
  ["for-every-season", "campaign:for-every-season", "for-every-season"],
]
```

The `/roof-estimate` mapping remains covered by root form-data tests as `roof-estimate`/`all-season-main`.

- [ ] **Step 2: Run RED**

Run: `npm --prefix apps/website test -- public/lead-forms.test.ts app/campaigns/campaigns.test.ts`

- [ ] **Step 3: Add literal source metadata and redirect behavior**

Give homepage and contact forms distinct `data-entry-point` values. Pass the drawer’s literal source in its payload. Campaign React forms derive both values from the selected campaign. Keep the same validated consent and structured address fields everywhere, and redirect only to the same-origin API’s returned `estimateUrl`.

- [ ] **Step 4: Run GREEN, site checks, and commit**

```bash
npm --prefix apps/website test
npm --prefix apps/website run typecheck
npm --prefix apps/website run lint
git add apps/website/app/campaigns apps/website/public/script.js apps/website/public/quote-drawer.js apps/website/public/lead-forms.test.ts apps/website/public/index.html apps/website/public/contact.html apps/website/README.md
git commit -m "feat: route all website forms into roof assessment"
```

### Task 9: Add full-route browser and integration coverage

**Files:**
- Create: `src/integration/canonical-assessment-journey.test.ts`
- Modify: `apps/website/scripts/visual-test.py`
- Modify: `src/app/roof-estimate/dev-assessment/assessment-sandbox.tsx`
- Modify: `src/app/roof-estimate/dev-assessment/assessment-sandbox.test.tsx`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: production-like verification for intake, resume, questionnaire, result, consultation, and viewport fit.

- [ ] **Step 1: Write failing integration scenarios**

Cover new intake, duplicate submission idempotency, same-browser resume, Twilio-approved cross-device resume with a fake provider, progressive abandonment/resume, ready result, pending result, review-required result, and idempotent consultation request.

- [ ] **Step 2: Run RED**

Run: `npm run test:integration -- src/integration/canonical-assessment-journey.test.ts`

- [ ] **Step 3: Extend the dev sandbox and visual harness**

Add query-controlled result states `pending`, `ready`, and `review_required`, presentation keys, and consultation success/error. The visual harness must exercise 320×568, 375×667, 390×844, 768×1024, and 1440×900. At every questionnaire step assert:

```js
document.documentElement.scrollHeight <= window.innerHeight &&
document.querySelector('.assessment-question-actions').getBoundingClientRect().bottom <= window.innerHeight
```

Capture the loader, property confirmation, representative single/multi-select questions, all result states, consultation choices, and confirmation.

- [ ] **Step 4: Run integration and visual verification**

```bash
npm run test:integration -- src/integration/canonical-assessment-journey.test.ts
python3 apps/website/scripts/visual-test.py
```

Expected: all scenarios pass; no supported mobile screen requires page scrolling to reach the next action.

- [ ] **Step 5: Commit**

```bash
git add src/integration/canonical-assessment-journey.test.ts apps/website/scripts/visual-test.py src/app/roof-estimate/dev-assessment
git commit -m "test: cover canonical assessment journey"
```

### Task 10: Run release gates and document rollout

**Files:**
- Modify: `.env.example`
- Modify: `apps/website/.env.example`
- Modify: `apps/website/README.md`
- Create: `docs/runbooks/all-season-assessment-rollout.md`

**Interfaces:**
- Consumes: completed system.
- Produces: deployable configuration and reversible rollout checklist.

- [ ] **Step 1: Write the runbook with exact configuration and rollback gates**

Document `ROOF_ASSESSMENT_ENABLED`, `ROOF_ASSESSMENT_SIGNING_SECRET`, `TWILIO_VERIFY_ENABLED`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_VERIFY_SERVICE_SID`, `ALL_SEASON_INTAKE_SHARED_SECRET`, `ALL_SEASON_INTAKE_COMPANY_ID`, `CAMPAIGN_ESTIMATE_WEBHOOK_URL`, and `PIW_PUBLIC_APP_URL`. The rollout order is migration → PIW deploy → main-site deploy → smoke tests → traffic enablement. Rollback disables new entry adapters but does not remove additive records.

- [ ] **Step 2: Run complete root verification**

```bash
npm run lint
npm run typecheck
npm run test:run
DOCKER_CONFIG=/tmp/piw-assessment-docker npx supabase test db
npm run test:integration
npm run build
```

Expected: every command exits 0 with no new warnings.

- [ ] **Step 3: Run complete main-site verification**

```bash
npm --prefix apps/website run lint
npm --prefix apps/website run typecheck
npm --prefix apps/website test
npm --prefix apps/website run build
```

Expected: every command exits 0.

- [ ] **Step 4: Perform final browser smoke tests**

Submit homepage, contact, drawer, weather-report, seasonal-shield, for-every-season, and `/roof-estimate` forms. For each, confirm the continuation URL, five-second loader, correct presentation, property confirmation, progressive save, trustworthy result behavior, and consultation confirmation. Run one same-browser resume and one Twilio sandbox cross-device verification.

- [ ] **Step 5: Commit release documentation**

```bash
git add .env.example apps/website/.env.example apps/website/README.md docs/runbooks/all-season-assessment-rollout.md
git commit -m "docs: add assessment rollout runbook"
```

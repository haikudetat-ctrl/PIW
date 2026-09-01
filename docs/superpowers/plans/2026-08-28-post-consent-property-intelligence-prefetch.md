# Post-Consent Property Intelligence Prefetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve a user-selected Google Place immediately after consent so the aerial image and Google Solar calculation start before the assessment reveal, while preserving the accepted lead when the fast path is unavailable.

**Architecture:** Keep canonical intake as the transaction boundary, then run a strictly bounded server-side Place Details fast path only for a newly issued assessment attempt with a Google Place ID. Persist exact validation evidence in the authoritative `property_addresses` observation model through a service-role-only, attempt-bound RPC that updates the property and enqueues the existing `property/discovery_requested` event atomically. The public intake contract remains unchanged; replay, resume, manual-address, timeout, and provider-failure cases continue through the existing asynchronous path. The assessment loader provides an eight-second premium buffer, waits no longer than twelve seconds, and uses an in-box property-imagery loading treatment until the real aerial is available.

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19, Supabase/Postgres/PostGIS, pgTAP, Inngest, Google Places API (New), Google Static Maps, Google Solar API, Vitest, Testing Library, Playwright/Chromium Python harnesses, Vercel.

**Spec:** [`docs/superpowers/specs/2026-08-28-post-consent-property-intelligence-prefetch-design.md`](../specs/2026-08-28-post-consent-property-intelligence-prefetch-design.md)

## Global Constraints

- Consent, lead, assessment, access-attempt, attribution, and `roof/assessment.started` writes must commit before any Google request begins.
- The fast path runs only for `isReplay=false`, `attempt_kind='new'`, a nonblank Google Place ID, an enabled feature flag, and configured paid Google providers.
- The browser remains untrusted. Do not add latitude or longitude to website, campaign, or public PIW request schemas.
- Place Details receives a 2,500 ms abort budget. Timeout, malformed response, non-NJ result, non-exact result, persistence failure, or disabled configuration must not undo intake or prevent continuation issuance.
- The new evidence and mutation boundary is tenant-, attempt-, assessment-, estimate-, pipeline-, and property-scoped. Only `service_role` may execute it.
- Never log names, email addresses, phone numbers, street addresses, Place IDs, coordinates, public tokens, continuation capabilities, or signing material.
- Preserve the Google-only quote rule, CRM projection, consent ledger, Context Dialer payload, Slack notification, result delivery, resume/OTP behavior, and all campaign presentation mappings.
- Do not insert invented imagery or sample dollar ranges. When real imagery is pending, show a neutral branded loading treatment inside the property box.
- Use TDD for every task: write the failing test, witness the intended RED, implement the smallest production change, witness GREEN, then commit the scoped files.
- Preserve unrelated user changes. Stage only the files listed for the active task and inspect `git diff --cached --check` before every commit.

---

## Task 1: Add attempt-bound provenance to property evidence and an atomic RPC

**Files**

- Create via `npx supabase migration new roof_assessment_property_prefetch`: the CLI-named `roof_assessment_property_prefetch.sql` file under `supabase/migrations/` (record the emitted path in the task report before editing it)
- Create: `supabase/tests/post_consent_property_prefetch.test.sql`
- Modify after migration reset: `src/lib/database.types.ts`

**Interfaces**

```sql
create function public.apply_roof_assessment_property_prefetch(
  p_company_id uuid,
  p_attempt_id uuid,
  p_google_place_id text,
  p_submitted_address text,
  p_canonical_address text,
  p_latitude double precision,
  p_longitude double precision,
  p_municipality text,
  p_county text,
  p_state_code text,
  p_zip text,
  p_match_method public.address_match_method,
  p_confidence smallint,
  p_provider text,
  p_source_identifier text,
  p_retrieved_at timestamptz,
  p_provider_duration_ms integer
) returns table (
  assessment_id uuid,
  property_id uuid,
  pipeline_run_id uuid,
  side_effects_applied boolean
);
```

Alter `public.property_addresses` so its provenance is exactly one of the existing `worker_run_id` or a new `assessment_access_attempt_id`. Make `worker_run_id` nullable, add the tenant-bound attempt foreign key, add a partial unique `(company_id, assessment_access_attempt_id)` index, and add nullable `evidence_source`, `source_identifier`, `retrieved_at`, and `provider_duration_ms` columns. A check constraint must require all fast-path provenance fields when `assessment_access_attempt_id` is present, while preserving every legacy worker-backed row. Do not create a second coordinate/evidence table.

- [ ] Generate the migration file with the Supabase CLI; do not hand-invent a migration ledger timestamp.
- [ ] Write pgTAP structural RED assertions for the new `property_addresses` provenance columns, exactly-one-origin check, composite attempt foreign key, partial unique attempt evidence, coordinate/NJ/exact-match checks, unchanged RLS/table privileges, empty RPC `search_path`, and service-role-only RPC execution.
- [ ] Add behavioral RED fixtures proving the RPC rejects a foreign tenant, resume candidate, mismatched attempt/property/estimate/assessment, mismatched Place ID, non-NJ or non-exact evidence, invalid coordinate pair, and uncommitted/nonexistent attempt.
- [ ] Add RED property-identity fixtures for zero candidates, one same-tenant candidate with the same Google Place ID, normalized-address fallback when one side lacks a Place ID, multiple conflicting candidates, and cross-tenant lookalikes. The single candidate must retain the existing duplicate semantics: mark the placeholder property `duplicate`, repoint the lead/pipeline/estimate/access attempt to the canonical property, and bind the fast-path observation/discovery event to that canonical property. Multiple candidates must fail closed to the asynchronous review path without partial mutation.
- [ ] Add RED assertions proving a valid call locks and resolves the exact access attempt, derives the pipeline from the attempt's lead, stores one immutable `property_addresses` observation tied to that access attempt, updates `properties.canonical_address`, municipality/county/state/location, and creates exactly one `property/discovery_requested` domain event plus one outbox row.
- [ ] Use this event envelope and stable idempotency key:

```sql
v_event := jsonb_build_object(
  'id', extensions.gen_random_uuid(),
  'name', 'property/discovery_requested',
  'schemaVersion', 1,
  'correlationId', v_pipeline.correlation_id,
  'causationEventId', v_started_event_id,
  'leadId', v_attempt.lead_id,
  'propertyId', v_attempt.property_id,
  'pipelineRunId', v_pipeline.id,
  'occurredAt', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'idempotencyKey', 'property/discovery_requested:assessment-prefetch:' || v_attempt.assessment_id,
  'data', jsonb_build_object(
    'leadId', v_attempt.lead_id,
    'propertyId', v_attempt.property_id,
    'canonicalAddress', p_canonical_address,
    'latitude', p_latitude,
    'longitude', p_longitude,
    'attempt', 1
  )
);
perform public.enqueue_domain_event(p_company_id, v_event);
```

- [ ] Add idempotency RED coverage: an identical second call returns `side_effects_applied=false` without changing timestamps or duplicating evidence/event/outbox; conflicting evidence for the same assessment fails closed without mutation.
- [ ] Add rollback RED coverage by forcing `enqueue_domain_event` to fail and proving the evidence row and property coordinate update both roll back.
- [ ] Add a two-session `dblink` race where identical calls block on the same attempt/assessment; prove one applies and one returns the canonical no-op, with one evidence/event/outbox record.
- [ ] Implement the `property_addresses` provenance extension and `SECURITY DEFINER SET search_path=''` RPC. Lock the access attempt, assessment, estimate, property, and pipeline rows before checking or writing. Validate `attempt_kind='new'`, the estimate's stored Place ID, high-confidence `exact_single_match`, `state_code='NJ'`, finite bounds, and all company-scoped identity links. Acquire the same tenant+Place-ID and tenant+normalized-address advisory locks used by canonical intake before candidate lookup, prefer Place ID, and preserve the existing 180-day normalized-address fallback and duplicate-property semantics.
- [ ] Run the focused RED/GREEN cycle:

```bash
DOCKER_CONFIG=/tmp/piw-prefetch-docker npx supabase db reset --local
DOCKER_CONFIG=/tmp/piw-prefetch-docker npx supabase test db supabase/tests/post_consent_property_prefetch.test.sql
```

- [ ] Run the full database suite, regenerate types, and ensure the generated type contains the new `property_addresses` columns and RPC:

```bash
DOCKER_CONFIG=/tmp/piw-prefetch-docker npx supabase test db
DOCKER_CONFIG=/tmp/piw-prefetch-docker npx supabase gen types typescript --local > /tmp/piw-prefetch-database.types.ts
diff -u src/lib/database.types.ts /tmp/piw-prefetch-database.types.ts
```

- [ ] Replace `src/lib/database.types.ts` with the generated output only after reviewing the diff, then commit:

```bash
git add supabase/migrations supabase/tests/post_consent_property_prefetch.test.sql src/lib/database.types.ts
git diff --cached --check
git commit -m "feat: persist assessment property prefetch"
```

---

## Task 2: Build the bounded server-side Place Details fast path

**Files**

- Create: `src/modules/roof-assessment/post-consent-property-prefetch.ts`
- Create: `src/modules/roof-assessment/post-consent-property-prefetch.test.ts`
- Create: `src/modules/roof-assessment/supabase-property-prefetch-repository.ts`
- Create: `src/modules/roof-assessment/supabase-property-prefetch-repository.test.ts`
- Modify: `src/modules/providers/adapters/google-places.ts`
- Modify: `src/modules/providers/adapters/google-places.test.ts`

**Interfaces**

```ts
export type PostConsentPropertyPrefetchInput = {
  companyId: string;
  attemptId: string;
  submittedAddress: string;
  googlePlaceId: string;
};

export type PostConsentPropertyPrefetchResult =
  | {kind: "applied" | "already_applied"; providerDurationMs: number; totalDurationMs: number}
  | {kind: "skipped"; reason: "disabled" | "not_exact" | "not_new"}
  | {kind: "deferred"; reason: "timeout" | "provider_failed" | "persistence_failed"};

export interface PropertyPrefetchRepository {
  apply(input: {
    companyId: string;
    attemptId: string;
    evidence: AddressValidationResult;
    provider: "google_places";
    sourceIdentifier: string;
    retrievedAt: string;
    providerDurationMs: number;
  }): Promise<{sideEffectsApplied: boolean}>;
}
```

- [ ] Write RED tests proving the use case never calls Google when disabled or when no selected Place ID is present; manual addresses return `skipped` for the existing async path.
- [ ] Extend `fetchGooglePlaceDetails` with an explicit `signal?: AbortSignal` and optional injected `fetchFn` for tests. Pass the signal directly to `fetch`; do not implement an unbounded `Promise.race` that leaves a provider call running after timeout.
- [ ] Write RED adapter tests for an already-aborted signal, a fetch aborted at 2,500 ms, invalid JSON, non-OK Google response, Place ID encoding, API-key header isolation, and a precise NJ response.
- [ ] Write RED use-case tests using fake timers and injected clocks for: success under budget, exact duplicate, 2,500 ms abort, provider rejection, malformed/non-NJ/non-exact evidence, and repository rejection. Every failure must return `deferred`/`skipped`, not throw contact/property data into logs.
- [ ] Implement `runPostConsentPropertyPrefetch` with `AbortSignal.timeout(2_500)` supplied by a dependency seam in tests. Parse the returned value through `addressValidationResultSchema` and require `googlePlaceId` equality, `exact_single_match`, NJ, confidence at least 95, and non-null finite coordinates before persistence.
- [ ] Emit one structured completion log from the orchestration boundary with only `outcome`, `reason`, `providerDurationMs`, `persistenceDurationMs`, and `totalDurationMs`. Do not include identifiers or provider error messages.
- [ ] Implement `SupabasePropertyPrefetchRepository.apply` as one call to `apply_roof_assessment_property_prefetch`. Strictly parse the one-row snake_case RPC response before projecting it; sanitize all Supabase errors to `PropertyPrefetchPersistenceError`.
- [ ] Run focused tests and typecheck:

```bash
npm run test:run -- src/modules/providers/adapters/google-places.test.ts src/modules/roof-assessment/post-consent-property-prefetch.test.ts src/modules/roof-assessment/supabase-property-prefetch-repository.test.ts
npm run typecheck
```

- [ ] Commit only the provider and prefetch service boundary:

```bash
git add src/modules/providers/adapters/google-places.ts src/modules/providers/adapters/google-places.test.ts src/modules/roof-assessment/post-consent-property-prefetch.ts src/modules/roof-assessment/post-consent-property-prefetch.test.ts src/modules/roof-assessment/supabase-property-prefetch-repository.ts src/modules/roof-assessment/supabase-property-prefetch-repository.test.ts
git diff --cached --check
git commit -m "feat: prefetch selected property intelligence"
```

---

## Task 3: Wire prefetch after committed intake without changing the public contract

**Files**

- Modify: `src/modules/roof-assessment/start-or-resume.ts`
- Modify: `src/modules/roof-assessment/start-or-resume.test.ts`
- Modify: `src/app/api/integrations/all-season/campaign-estimate/route.ts`
- Modify: `src/app/api/integrations/all-season/campaign-estimate/route.test.ts`
- Modify: `src/lib/env/server.ts`
- Create: `src/lib/env/server.test.ts`
- Modify: `.env.example`

**Interfaces**

```ts
export type StartAssessmentDependencies = {
  repository: AssessmentIntakeRepository;
  tokenIssuer: ContinuationTokenIssuer;
  postConsentPrefetch?: (input: PostConsentPropertyPrefetchInput) =>
    Promise<PostConsentPropertyPrefetchResult>;
};
```

- [ ] Add RED service tests proving call order is `repository.startOrResume` commit result, then prefetch, then token issue. The hook receives only `companyId`, returned `attemptId`, normalized submitted address, and the submitted Google Place ID.
- [ ] Add RED tests proving replay never invokes the hook; a missing Place ID never invokes it; timeout/provider/persistence outcomes still issue the continuation; an unexpected hook rejection is caught and still issues the continuation; token issuer failure remains a sanitized internal failure.
- [ ] Do not widen `StartAssessmentResult`, the strict `start_or_resume_roof_assessment` return schema, `allSeasonCampaignEstimateSchema`, website proxy schema, or the public `202` response. The only client-visible success field remains `continuationPath`.
- [ ] Add `ROOF_ASSESSMENT_PROPERTY_PREFETCH_ENABLED` to server env parsing and `.env.example`, defaulting to `false`. Add RED env tests proving enabled prefetch requires `ROOF_ASSESSMENT_ENABLED=true`, `PAID_PROVIDERS_ENABLED=true`, and `GOOGLE_MAPS_API_KEY`.
- [ ] In the production campaign route, construct `SupabasePropertyPrefetchRepository` from the same service client and inject the fast path only when the flag is enabled. The Google API key stays server-side.
- [ ] Add route RED tests for enabled first issue, disabled flag, manual address, duplicate `409`, fast-path timeout with successful `202`, and generic `503` for intake failure. Assert every response retains `cache-control: no-store` and never contains coordinates, evidence, Place ID, raw error, or continuation secret.
- [ ] Run focused root tests plus the existing website proxy contract to prove the server-to-server payload stayed strict:

```bash
npm run test:run -- src/modules/roof-assessment/start-or-resume.test.ts src/app/api/integrations/all-season/campaign-estimate/route.test.ts src/lib/env/server.test.ts
npm --prefix apps/website test -- src/app/api/campaign-estimate/route.test.ts
npm run typecheck
```

- [ ] Commit the intake wiring and flag:

```bash
git add src/modules/roof-assessment/start-or-resume.ts src/modules/roof-assessment/start-or-resume.test.ts src/app/api/integrations/all-season/campaign-estimate/route.ts src/app/api/integrations/all-season/campaign-estimate/route.test.ts src/lib/env/server.ts src/lib/env/server.test.ts .env.example
git diff --cached --check
git commit -m "feat: start property prefetch after consent"
```

---

## Task 4: Reconcile the fast path with existing async workers and aerial lookup

**Files**

- Modify: `src/inngest/functions/address-validation-worker.ts`
- Modify: `src/inngest/functions/address-validation-worker.test.ts`
- Modify: `src/app/api/roof-estimate/[token]/house-image/route.ts`
- Modify: `src/app/api/roof-estimate/[token]/house-image/route.test.ts`
- Modify: `src/integration/canonical-assessment-journey.test.ts`

**Interfaces**

```ts
export interface AddressValidationWorkerRepository {
  findExactAssessmentPrefetch(input: {
    pipelineRunId: string;
    leadId: string;
    propertyId: string;
  }): Promise<null | {
    canonicalAddress: string;
    latitude: number;
    longitude: number;
  }>;
}
```

- [ ] Add RED worker tests proving exact attempt-bound evidence causes address validation to mark its worker run complete and return `already_prefetched` without a second Place Details/Text Search request, `property_addresses` observation, discovery event, or review task.
- [ ] Keep manual and deferred cases on the existing provider/claim/review path unchanged. Add a regression proving non-exact or foreign-scope prefetch evidence is ignored.
- [ ] Query fast-path evidence from `property_addresses` only when `assessment_access_attempt_id` joins to the event's exact company/pipeline/lead/property scope. Do not select “latest by address,” and do not trust only a Place ID.
- [ ] Add route RED tests making coordinate priority explicit: ready `roof_insights`, then the latest same-company/same-property `property_addresses` row with a complete coordinate pair (fast-path or legacy), otherwise `404 coordinates_pending` with `Retry-After`. A newer null-coordinate observation must not hide older exact coordinates; foreign-tenant and foreign-property evidence must not be usable.
- [ ] Update the house-image query to ignore address observations without a complete coordinate pair while retaining exact estimate company/property scope. Keep the Google Static Maps timeout, private one-hour success cache, no-store errors, and generic public messages.
- [ ] Extend the real-local canonical journey integration test with a fake Place Details result. Assert one discovery event/outbox, one roof-estimate worker identity, no second address provider request, and image coordinates available immediately after prefetch persistence.
- [ ] Run the focused worker/route/integration gates:

```bash
npm run test:run -- src/inngest/functions/address-validation-worker.test.ts 'src/app/api/roof-estimate/[token]/house-image/route.test.ts'
RUN_SUPABASE_INTEGRATION=1 npm run test:run -- src/integration/canonical-assessment-journey.test.ts
npm run typecheck
```

- [ ] Commit the reconciliation boundary:

```bash
git add src/inngest/functions/address-validation-worker.ts src/inngest/functions/address-validation-worker.test.ts 'src/app/api/roof-estimate/[token]/house-image/route.ts' 'src/app/api/roof-estimate/[token]/house-image/route.test.ts' src/integration/canonical-assessment-journey.test.ts
git diff --cached --check
git commit -m "fix: reuse prefetched property evidence"
```

---

## Task 5: Make the assessment reveal obey the eight-to-twelve-second contract

**Files**

- Modify: `src/app/roof-estimate/[token]/assessment-loading.tsx`
- Modify: `src/app/roof-estimate/[token]/assessment-loading.test.tsx`
- Modify: `src/app/roof-estimate/[token]/assessment-experience.tsx`
- Modify: `src/app/roof-estimate/[token]/assessment-experience.test.tsx`
- Create: `src/app/roof-estimate/[token]/assessment-aerial-loader.ts`
- Create: `src/app/roof-estimate/[token]/assessment-aerial-loader.test.ts`
- Modify: `src/app/roof-estimate/[token]/assessment.css`
- Modify: `src/app/roof-estimate/dev-assessment/page.tsx`

**Interfaces**

```ts
const MINIMUM_ANALYSIS_MS = 8_000;
const AERIAL_HARD_CAP_MS = 12_000;
const DEFAULT_AERIAL_RETRY_MS = 2_500;
const REVEAL_RETRY_MS = 2_500;
const MAX_REVEAL_RETRIES = 36;
```

- [ ] Rewrite loader tests first. Prove: an image ready at 1 second reveals at exactly 8 seconds; an image ready at 9 seconds reveals immediately at 9 seconds; retryable image errors before 12 seconds do not reveal or become terminal; no image reveals at exactly 12 seconds; the four branded stages scroll across the full eight-second minimum.
- [ ] Write `assessment-aerial-loader.test.ts` RED coverage for a successful image blob, `404 coordinates_pending`, provider `502`, a valid integer `Retry-After`, an HTTP-date `Retry-After`, an invalid header falling back to 2,500 ms, and abort cleanup. The helper returns only `{kind: "ready", objectUrl}` or `{kind: "retry", delayMs}`/`{kind: "unavailable"}`; it never exposes provider JSON to the UI.
- [ ] Implement the shared fetch-based aerial loader so the client can read `Retry-After`, create a browser object URL only for a successful image response, and abort an in-flight request on unmount or source change. The parent `AssessmentExperience` owns and revokes the current object URL after replacement/unmount so the loading-to-reveal transition cannot invalidate it.
- [ ] Replace the loader's terminal-on-first-`error` behavior with cache-busted retries that honor a valid `Retry-After` and otherwise wait 2,500 ms until the hard cap. Reset timers and completion guards when `imageSrc` changes; clean every timer and abort controller on unmount.
- [ ] Add RED reveal tests proving a pending aerial never renders `context.fallbackImage`, an unrelated roof, or “Property confirmed” imagery semantics. It renders a single neutral branded in-box skeleton/status, retries the same token-scoped route every 2.5 seconds, swaps to the real aerial on load, and keeps the address-update link and question CTA usable.
- [ ] Implement an accessible in-box state with `role="status"` text such as “Finalizing your property imagery” and restrained premium motion. Respect `prefers-reduced-motion`; do not cartoonify the experience or add simulated progress percentages.
- [ ] Ensure the retry URL changes only by the existing `aerial_retry` cache-buster and never leaks a capability. Retain the maximum 36 post-reveal retries.
- [ ] Update the dev assessment sandbox so ready, slow, retry-then-ready, and persistent-pending imagery states can be reviewed without live Google calls.
- [ ] Run focused component tests and viewport type/lint gates:

```bash
npm run test:run -- 'src/app/roof-estimate/[token]/assessment-aerial-loader.test.ts' 'src/app/roof-estimate/[token]/assessment-loading.test.tsx' 'src/app/roof-estimate/[token]/assessment-experience.test.tsx'
npm run typecheck
npx eslint 'src/app/roof-estimate/[token]/assessment-loading.tsx' 'src/app/roof-estimate/[token]/assessment-experience.tsx' 'src/app/roof-estimate/dev-assessment/page.tsx'
```

- [ ] Commit the UI timing state machine:

```bash
git add 'src/app/roof-estimate/[token]/assessment-aerial-loader.ts' 'src/app/roof-estimate/[token]/assessment-aerial-loader.test.ts' 'src/app/roof-estimate/[token]/assessment-loading.tsx' 'src/app/roof-estimate/[token]/assessment-loading.test.tsx' 'src/app/roof-estimate/[token]/assessment-experience.tsx' 'src/app/roof-estimate/[token]/assessment-experience.test.tsx' 'src/app/roof-estimate/[token]/assessment.css' src/app/roof-estimate/dev-assessment/page.tsx
git diff --cached --check
git commit -m "fix: hold assessment reveal for real imagery"
```

---

## Task 6: Verify the complete journey and document the controlled rollout

**Files**

- Modify: `scripts/assessment-session.test.py`
- Modify: `scripts/assessment-viewport.test.py`
- Modify: `apps/website/scripts/visual-test.py`
- Modify: `docs/runbooks/all-season-assessment-rollout.md`
- Modify: `.env.example` only if Task 3 did not fully document the flag

**Interfaces**

No new production interface. This task verifies the released contracts and records the operational sequence.

- [ ] Add a real-browser journey using a fake Place Details provider and intercepted Static Maps response. Measure from accepted consent to first image request, first successful image response, reveal, question start, and completed result.
- [ ] Assert all seven entry points still navigate through the canonical continuation, preserve their entry/presentation framing, and never send browser coordinates: homepage, contact, quote drawer, three campaign routes, and PIW `/roof-estimate`.
- [ ] Cover these browser states at 320×568, 375×667, 390×844, 768×1024, and 1440×900: image ready before 8 seconds, image ready between 8 and 12 seconds, image still pending after 12 seconds, and retry success on the confirmation screen. The next action must remain visible without document scrolling.
- [ ] Prove end-to-end fake-provider behavior: consent evidence committed; assessment/access attempt created; one exact attempt-bound `property_addresses` observation stored; discovery and Solar calculation start in parallel with image retrieval; progressive answers persist; completed Google-backed range/outlook renders; consultation preference persists; PIW CRM record, delivery queues, Context Dialer payload, and Slack handoff each remain single and idempotent.
- [ ] Add log assertions or captured structured-log inspection proving the new timing logs contain durations/outcomes only and no address, Place ID, coordinates, contact data, or capability.
- [ ] Update the runbook configuration table with `ROOF_ASSESSMENT_PROPERTY_PREFETCH_ENABLED`, its dependency on the assessment/paid-provider/Google settings, and the exact rollout order: migration; PIW deployed with prefetch false; website adapters unchanged; preview smoke; enable prefetch; watch timing/error metrics; production promotion.
- [ ] Replace the old five-second loader language in the runbook with the eight-second minimum/twelve-second cap and neutral in-box pending state. Document rollback as flag-off only; manual and deferred submissions remain on the asynchronous pipeline.
- [ ] Define the initial release observation window and target: record at least 30 clean Google-selected journeys, then require at least 90% of successful aerials to be available by the eight-second reveal boundary. Track Place Details timeout/failure, prefetch persistence failure, coordinates-pending, Static Maps latency/failure, Solar completion latency, and async fallback rate separately.
- [ ] Run the complete verification matrix:

```bash
DOCKER_CONFIG=/tmp/piw-prefetch-docker npx supabase db reset --local
DOCKER_CONFIG=/tmp/piw-prefetch-docker npx supabase test db
npm run lint
npm run typecheck
npm run test:run
npm run test:integration
npm run build
npm --prefix apps/website run lint
npm --prefix apps/website run typecheck
npm --prefix apps/website test
npm --prefix apps/website run build
python3 scripts/assessment-session.test.py
python3 scripts/assessment-viewport.test.py
python3 apps/website/scripts/visual-test.py
```

- [ ] Run database lint/advisors and distinguish unchanged documented baseline findings from regressions:

```bash
DOCKER_CONFIG=/tmp/piw-prefetch-docker npx supabase db lint --local --schema public --level warning --fail-on warning
DOCKER_CONFIG=/tmp/piw-prefetch-docker npx supabase db advisors --local --type all --level warn --fail-on warn
```

- [ ] Perform final self-review against every spec requirement. Search the production diff for `TODO`, `FIXME`, placeholder ranges, fallback campaign imagery in the assessment reveal, browser coordinate fields, and sensitive logging. Confirm TypeScript/SQL names and generated RPC types match exactly.
- [ ] Commit verification and rollout guidance:

```bash
git add scripts/assessment-session.test.py scripts/assessment-viewport.test.py apps/website/scripts/visual-test.py docs/runbooks/all-season-assessment-rollout.md .env.example
git diff --cached --check
git commit -m "test: verify property intelligence prefetch rollout"
```

## Completion Criteria

- [ ] Consent and canonical intake succeed even when the fast path is disabled, times out, fails, or cannot persist.
- [ ] A first-issue Google-selected address starts exact property discovery only after consent commit and no later than the 2,500 ms provider budget.
- [ ] Replay/resume/manual submissions do not make a fast-path Google call.
- [ ] One assessment produces at most one exact prefetch evidence row and one canonical discovery event/outbox record under retry and concurrency.
- [ ] The aerial route can use prefetched evidence immediately without weakening tenant/token scope.
- [ ] The existing async validator reuses or skips exact evidence and never overwrites it or duplicates provider/discovery work.
- [ ] The branded analysis lasts at least eight seconds, caps its initial wait at twelve seconds, and never substitutes unrelated property imagery.
- [ ] Google-only calculation trust, CRM, delivery, Context Dialer, Slack, consent, resume, consultation, and campaign framing regressions are green.
- [ ] Migration-first, flag-disabled deployment, smoke, enablement, monitoring, and flag-only rollback are documented.

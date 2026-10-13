# JobNimbus PIW Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Automatically enrich JobNimbus jobs and linked contacts in PIW, backfill the preceding 30 days, and prepare Context Dialer.

**Architecture:** Add durable tenant-scoped job intake after the existing hourly warehouse projection. Atomically create/link PIW records and outbox events, then reuse validation and estimation workers under a verified internal-processing mode. Store terminal partial outcomes as well as successful results for Context Dialer.

**Tech Stack:** Node 24, Next.js 16.2.12, TypeScript, Inngest 4.13.0, Supabase Postgres, Vitest, pgTAP.

**Spec:** ../specs/2026-10-13-jobnimbus-piw-enrichment-design.md (user approved).

## Global Constraints

- Jobs with their linked contacts; contacts without jobs are excluded.
- At activation, persist an activation timestamp and a fixed start timestamp equal to activation minus 30 days for each enabled company.
- Select by job creation date, not last update; include every job status, record archived jobs explicitly, and retain pending work after the window ages.
- JobNimbus remains the source of job status.
- No fabricated consent or automatic homeowner outreach for imported runs.
- Preserve existing web intake, rep notes, completed quotes, provider enablement, rate limits and cost budgets.
- Internal enrichment requires a server-created bridge association; a source label alone is insufficient.
- Reuse property measurements while retaining distinct job associations and measurement provenance.
- Company + JobNimbus job identity is the intake idempotency key.
- Use existing dependencies and the configured internal handoff; add no messaging destination.
- Spec and plan approval precede product changes. Production completion requires observed backfill and ongoing-job evidence.

## Review Focus

- A second job for one contact at another property must not reuse the wrong PIW lead (Task 1).
- Missing phone/email must not fabricate contact values or block valid property enrichment (Tasks 1, 4, 5).
- A delayed projection or outage lasting over 30 days must not lose eligible jobs (Tasks 1, 2).
- An event replay after a successful paid request must reuse persisted evidence, not spend twice (Task 4).
- A completed/lost imported job must retain its JobNimbus status instead of appearing as a new prospect (Tasks 1, 5).

## File Structure

New intake code lives in src/modules/jobnimbus/enrichment-{types,intake,repository}.ts.
New run authorization and completion code lives in src/modules/enrichment/{run-policy,complete-jobnimbus-run}.ts.
Existing workers keep provider execution; avoid porting a second quote engine.
A generated Supabase migration owns state, atomic RPCs, constraints, privileges and RLS.
Tests follow existing colocated Vitest, src/integration and supabase/tests conventions.
The exact migration timestamp is generated with the Supabase CLI at execution time.

## Task 1: Durable, atomic job intake and identity

**Files**
- Create: src/modules/jobnimbus/enrichment-types.ts
- Create: src/modules/jobnimbus/enrichment-intake.ts
- Create: src/modules/jobnimbus/enrichment-repository.ts
- Create: src/modules/jobnimbus/enrichment-intake.test.ts
- Create: src/integration/jobnimbus-enrichment-intake.integration.test.ts
- Create: supabase/tests/jobnimbus-enrichment.test.sql
- Create: Supabase CLI-generated jobnimbus_enrichment migration
- Modify: src/lib/database.types.ts (generate), relevant lead display/types affected by nullable imported contact fields

**Interfaces**
- JobNimbusEnrichmentState: companyId, activatedAt, backfillStart, intakeEnabled, processingEnabled.
- JobNimbusIntakeResult: jobJnid, leadId: string|null, pipelineRunId: string|null, outcome:
  'queued'|'already_linked'|'needs_review'|'waiting_for_data'.
- activate_jobnimbus_enrichment(p_company_id uuid, p_activated_at timestamptz) returns persisted activation state; replay never resets its interval.
- intake_jobnimbus_job(p_company_id uuid, p_job_jnid text) returns JobNimbusIntakeResult; reads job/contact itself rather than trusting caller-supplied customer data.
- intakeJobNimbusJob(input: { companyId: string; jobJnid: string }, repository: JobNimbusEnrichmentRepository): Promise<JobNimbusIntakeResult>.

- [ ] Write database and integration tests named atomic_replay, tenant_isolation,
  shared_contact_different_properties, ambiguous_identity_review, preserve_consent_and_notes,
  late_arrival_after_thirty_days, and missing_creation_date_review.
  Assert two concurrent intakes produce one mapping/run/event; the same jnid in another
  company remains separate; phone-only matching cannot merge different properties.
  Freeze activation at 2026-10-13T12:00:00Z: start must equal
  2026-09-13T12:00:00Z, boundary included, one millisecond earlier excluded.
  A late-arriving eligible job discovered on November 20 remains eligible.
- [ ] Run npm run test:run -- src/modules/jobnimbus/enrichment-intake.test.ts and
  npx supabase test db supabase/tests/jobnimbus-enrichment.test.sql.
  Expect failure because the module/RPC does not exist.
- [ ] Implement jobnimbus_enrichment_settings and jobnimbus_enrichment_jobs, with unique
  (company_id, job_jnid), explicit archived flag, source timestamps, retry scheduling,
  sanitized outcome, PIW foreign keys and snapshot of original job status/rep.
  Lock intake per company/job in one transaction. Link an explicit existing job identity;
  otherwise reuse only an unambiguous normalized contact plus property match.
  Record identity conflict without assigning a wrong existing lead.
- [ ] Create/link lead, property, pipeline run, roof estimate and durable outbox event atomically.
  Existing completed estimates are preserved. Imported runs use mode jobnimbus_internal,
  web runs default to homeowner_request. Establish job/customer/PIW identity linkage
  compatible with the existing customer journey without creating duplicate customers.
  Missing addresses create review-visible records and skip validation until corrected;
  missing linked contacts do not prevent enrichment when the job address is present.
  Nullable imported contact/address fields use null, never synthetic email/phone/address.
  Keep ordinary intake validation strict; adjust impacted readers with explicit absence handling.
  Preserve source-submitted timestamps; map status through existing company-aware JobNimbus
  status mapping for new imported leads, and never replace an existing lead's rep-managed stage.
- [ ] RPCs use SECURITY INVOKER with service-role execution and same-company checks.
  Grant authenticated users only tenant-scoped reads needed for dialer context/settings
  summaries; anon cannot read or execute intake. Generate database types.
- [ ] Re-run tests plus npm run test:integration. Expect atomicity, RLS and existing intake
  regressions to pass; commit feat: add durable JobNimbus enrichment intake.

## Task 2: Post-sync dispatch, pagination and resumable backfill

**Files**
- Create: src/modules/jobnimbus/enrichment-dispatch.ts
- Create: src/modules/jobnimbus/enrichment-dispatch.test.ts
- Modify: src/inngest/functions/jobnimbus-warehouse-sync.ts
- Create: src/inngest/functions/jobnimbus-warehouse-sync.test.ts
- Modify: src/lib/env/server.ts and its test
- Modify: .env.example

**Interfaces**
- dispatchJobNimbusEnrichment(input: { companyId: string; limit: number },
  repository: JobNimbusEnrichmentRepository): Promise<{ selected: number; queued: number;
  alreadyLinked: number; needsReview: number; waitingForData: number }>.
- Repository supplies activation state, deterministic paginated eligibility, unfinished
  jobs and Task 1 intake RPC. Default limit is 50 per company per sync.
- INTEGRATIONS_JOBNIMBUS_ENRICHMENT_ENABLED defaults false.

- [ ] Write tests for more than 1,000 eligible jobs, an unfinished earlier page,
  same-created-time jobs, overlapping dispatches, contacts projection failure, and
  jobs projection failure. Assert only successful contact AND job projection permits
  dispatch, counters match durable outcomes, and completed jobs cannot starve pending ones.
  All statuses and archived records receive accounted outcomes.
- [ ] Run npm run test:run -- src/modules/jobnimbus/enrichment-dispatch.test.ts
  src/inngest/functions/jobnimbus-warehouse-sync.test.ts. Expect missing implementation failure.
- [ ] Implement dispatch after projection/Roofr processing, keeping external JobNimbus
  requests serial. Read the fixed activation window plus durable unfinished rows;
  page by (jn_created_at, jnid), never OFFSET against a mutating result.
  Persist selection/intake progress; queued work survives dispatcher crashes.
  Refresh waiting-for-data jobs on changed source data; backoff persistent incomplete rows
  so a bounded page cannot repeatedly select only unusable records.
  Disabled integration/intake/global flag produces zero new imports.
- [ ] Use the persisted outbox and existing relay for delivery; a publish failure cannot
  roll back imported records or acknowledge an unpublished event. Do not invoke providers here.
- [ ] Re-run tests and env regression checks; commit feat: dispatch JobNimbus enrichment after sync.

## Task 3: Verified processing mode and CRM-to-validation routing

**Files**
- Create: src/modules/enrichment/run-policy.ts
- Create: src/modules/enrichment/run-policy.test.ts
- Modify: src/inngest/functions/crm-writer.ts and crm-writer.test.ts
- Modify: src/domain/events.ts and events.test.ts only if an imported event requires a distinct shape
- Modify: src/inngest/functions/address-validation-worker.ts and its test

**Interfaces**
- resolveRunPolicy(input: { companyId: string; pipelineRunId: string; leadId: string },
  repository: RunPolicyRepository): Promise<{ mode: 'homeowner_request'|'jobnimbus_internal';
  mayProcess: boolean; mayDeliverToHomeowner: boolean }>.
- RunPolicyRepository verifies persisted same-company bridge, integration and processing flag,
  then evaluates the existing web consent path. Mode cannot be authorized from event data alone.

- [ ] Write tests asserting a verified internal job run without consent starts address
  validation, a forged source label fails, a cross-company mapping fails, and a paused
  internal run stays pending. Web intake still requires its existing consent.
  Missing phone/email must not prevent internal validation of a present address.
- [ ] Run npm run test:run -- src/modules/enrichment/run-policy.test.ts
  src/inngest/functions/crm-writer.test.ts. Expect the new internal cases to fail.
- [ ] Implement policy verification and use it in CRM routing. Internal import events
  need not satisfy web-form phone/email requirements: use an import-specific event
  if necessary rather than weakening the existing web schema. Route into the same
  addressValidationRequested event once a valid address exists.
  Do not create the web-specific 'Call new roof-estimate lead now' task for completed jobs.
- [ ] Authorize paused internal runs before provider calls in address validation.
  Preserve its evidence persistence and canonical merge logic; keep a linked roof
  estimate attached to the resulting canonical property and continue discovery.
- [ ] Re-run policy/CRM/address tests; commit feat: authorize internal JobNimbus enrichment.

## Task 4: Roof enrichment, idempotent provider steps and terminal dialer outcomes

**Files**
- Modify: src/inngest/functions/roof-estimate-worker.ts and its test
- Create: src/modules/enrichment/complete-jobnimbus-run.ts
- Create: src/modules/enrichment/complete-jobnimbus-run.test.ts
- Modify: src/inngest/functions/address-validation-worker.ts and its test
- Modify: src/app/api/inngest/route.ts if adding a final-failure/sweeper function
- Extend: Task 1 migration through a new CLI-generated migration when already committed

**Interfaces**
- Rename assertConsentedScope to assertProcessingScope and return the verified run policy
  alongside tenant/estimate/contact context; homeowner delivery is conditional on policy.
- completeJobNimbusRun(input: { companyId: string; pipelineRunId: string;
  outcome: 'completed'|'needs_review'|'failed'; reason?: string },
  repository: JobNimbusCompletionRepository): Promise<void>.
- Repository's atomic completion RPC updates bridge/run outcome and inserts at most one
  Context Dialer handoff per pipeline run. A paused run is pending, not terminal failed.

- [ ] Write tests for internal success, cached measurement, reused ready quote,
  9,500-call budget exhaustion, no coverage, address review, no address, final provider
  failure, absent phone/email, and replay after insight persistence.
  Assert internal runs never call queueDeliveries, always expose available dialer context
  on terminal outcomes, and repeated completion creates one handoff.
  Terminal failure must be distinguished from transient retry.
- [ ] Run npm run test:run -- src/inngest/functions/roof-estimate-worker.test.ts
  src/inngest/functions/address-validation-worker.test.ts
  src/modules/enrichment/complete-jobnimbus-run.test.ts. Expect new cases to fail.
- [ ] Implement verified policy at roof worker entry. Preserve web both-channel behavior.
  Reuse PIW measurements, pricing and budgets; persist/resume paid-request evidence before
  any replay can repeat a successful call, using durable Inngest steps and provider records.
  Do not overwrite a ready/sent quote. Display Roofr as separately sourced evidence.
- [ ] Route address review and missing address through completion. Retry transient
  provider failures; use an Inngest final-failure handler with verified original scope
  to record sanitized terminal outcomes and queue partial dialer context.
  Resume source-data waiting records through Task 2 rather than minting another lead.
- [ ] Add database tests for concurrent completion and pause/resume; run worker tests
  and npm run db:test. Commit feat: complete JobNimbus enrichment with dialer context.

## Task 5: Job context, missing data and reporting in the existing UI

**Files**
- Modify: src/app/(app)/leads/[leadId]/dialer/page.tsx
- Create: src/app/(app)/leads/[leadId]/dialer/page.test.tsx
- Modify: src/inngest/functions/context-dialer-slack-sender.ts and its test
- Modify: src/modules/leads/jobnimbus-pipeline.ts and its test if linkage needs it
- Create: src/modules/jobnimbus/enrichment-summary.ts and its test
- Modify: src/app/(app)/reports/quality/page.tsx
- Create: src/integration/jobnimbus-dialer-access.integration.test.ts

**Interfaces**
- In src/modules/jobnimbus/enrichment-summary.ts, loadJobNimbusDialerContext(client, input: { companyId: string; leadId: string })
  returns same-company linked job identities, original status/rep, Roofr evidence
  and enrichment outcome; no association yields null.
- loadJobNimbusEnrichmentSummary(client, companyId) returns activation/backfill interval
  and disjoint durable outcome counts, remaining backlog and invalid-date count.

- [ ] Write UI tests for absent phone/email/address, partial failure, multiple jobs at
  distinct properties, Roofr versus Solar provenance, completed/lost job status,
  verified job link and tenant-isolated imagery/context. Assert no tel/mailto action
  exists without a usable destination and no fabricated placeholder implies real data.
  Test pipeline/journey linkage prevents imported job plus PIW lead double-counting.
- [ ] Run focused dialer, sender and summary tests; expect new context assertions to fail.
- [ ] Show JobNimbus origin/job link, status/rep and partial-enrichment reason on the dialer.
  Use truthful missing-data text and omit unavailable actions. The configured internal
  notification payload identifies imported jobs accurately, including backfill origin;
  do not call live Slack in tests or add a new destination.
  Expose aggregate counters and fixed interval in the existing data-quality view.
- [ ] Run npm run lint, npm run typecheck, focused tests and tenant database tests.
  Perform the React best-practices review if multiple TSX components changed.
  Commit feat: show JobNimbus context and enrichment progress.

## Task 6: End-to-end verification and controlled production activation

**Files**
- Create: src/integration/jobnimbus-enrichment-flow.integration.test.ts
- Modify: docs/runbooks/jobnimbus-warehouse-sync.md
- Create: docs/qa/jobnimbus-piw-enrichment.md

**Interfaces**
- Test fixture uses Task 1 activation/intake, Task 2 dispatch, real local database and
  mocked provider responses, then reads the same data consumed by the dialer.
- Operational dry run queries eligibility/counts without activating state or calling providers.

- [ ] Add end-to-end tests for a newly synced job and an exact-boundary backfill job:
  atomic intake -> outbox -> address validation -> roof measurement -> pricing ->
  linked dialer output. Assert zero estimate_deliveries and unchanged consent rows.
  Add failed publication/replay, source-data correction and cross-company access cases.
- [ ] Run npm run verify with Node 24 and local Supabase; expect all checks to pass.
  If environment lacks a required runtime or network access, provision the authorized
  execution environment and report the actual missing capability; never claim checks ran.
- [ ] Review the complete diff against the approved spec and record test output.
  Check current Supabase docs/advisors and Vercel deployment skills for affected platform
  operations. Refresh repository main and resolve changes before shipping.
- [ ] Deploy with the enrichment flag disabled and verify migrations, tenant integration,
  provider budget, Inngest registration and existing internal handoff settings.
  Write a concrete read-only eligibility report using the proposed activation interval.
- [ ] Activate per-company fixed timestamps and process a small bounded live batch.
  Confirm one lead/run/job association, usable Context Dialer, correct costs and no
  homeowner-delivery records. Enable the backlog and ongoing hourly dispatch only after
  this observed path works; preserve the original activation timestamps.
- [ ] Record eligible/queued/completed/review/retry/failure counts and actual remaining
  backlog. Verify at least one newly created/synced job completes after activation.
  A scheduled backfill with remaining backlog is running, not complete.
  Document intake pause, processing pause, rollback and recovery; commit operational evidence.

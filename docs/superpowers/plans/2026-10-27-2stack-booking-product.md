# 2Stack Booking Product Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. This session executes the first managed-texting slice; later slices retain their own integration and acceptance gates.

**Goal:** Replace Booking-Bot through PIW, beginning with isolated, 2Stack-managed client texting.

**Architecture:** Extend existing company-scoped booking, messaging, intake and event modules. 2Stack owns the Twilio parent account; each client owns a distinct messaging identity inside its subaccount. PIW remains the operational record, ActiveProspect provides intake, and JobNimbus supports production.

**Tech Stack:** Next.js/TypeScript, Supabase/Postgres, Inngest, Twilio, Vitest.

**Spec:** ../specs/2026-10-27-2stack-booking-product-design.md

## Global constraints

- One client per Twilio subaccount; client-specific A2P registration, Messaging Service, number and secrets.
- No parent/global SMS credential fallback. Retain independent Twilio Verify configuration.
- No live texts or production traffic cutover during local verification.
- Approved templates and limited automatic replies; virtual-first booking with real capacity.
- PIW is the source of truth; LeadMaster access cannot block launch.

## Review focus

- Valid signatures from client A must not authorize client B's number or message status.
- Missing, malformed, or duplicate credential bindings must fail closed without exposing secrets.
- Outbound account selection must use the authorized lead's company, not user form input.
- Disabling outbound texting must preserve the ability to record opt-outs and delivery callbacks.
- Verify credentials must remain independent from SMS credentials.

## Slice 1: managed texting foundation (this session)

### Task 1: client credential resolution

**Files:** Create src/modules/sms/client-config.ts and client-config.test.ts; update src/lib/env/server.ts and server.test.ts.

**Interface:** resolveSmsClient({companyId} | {accountSid}, environment) returns a client binding or null. A binding contains companyId, accountSid, apiKeySid, apiKeySecret, authToken. Credentials come only from TWILIO_SMS_CLIENTS_JSON, a server-only array. The full registry is invalid when any entry is malformed or company/account IDs repeat.

- [x] Add failing tests for two-company resolution, missing/invalid configuration, duplicates, and no global fallback.
- [x] Run targeted tests and confirm the new behavior is absent.
- [x] Implement the registry parser and resolver with generic validation errors only.
- [x] Update environment validation for managed SMS without requiring global Verify credentials.
- [x] Run resolver and environment tests.

### Task 2: tenant-bound outbound and callbacks

**Files:** Update src/app/(app)/leads/[leadId]/sms-actions.ts, src/app/api/twilio/sms/route.ts, src/app/api/twilio/sms/status/route.ts, src/modules/sms/supabase-store.ts; add/update adjacent tests.

**Interfaces:** sendCompanySms(companyId, input, environment, fetchImpl?) uses Task 1's binding. createSmsWebhookStore(service, companyId) restricts all lookups and mutations. Each route resolves AccountSid, verifies its signature, then creates the scoped store.

- [x] Add failing transport tests proving separate account URLs/API keys and rejection without a binding.
- [x] Add failing inbound/status route tests for per-account signatures, unknown accounts and cross-company targets.
- [x] Implement outbound selection and company-scoped webhook reads/writes.
- [x] Keep callbacks active when SMS_ENABLED is false so opt-outs and delayed statuses remain recordable; absent registry still rejects callbacks.
- [x] Run SMS, route and environment tests; then lint, typecheck, complete unit suite and production build.

### Task 3: operating instructions and handoff

**Files:** Update .env.example; create docs/runbooks/2stack-managed-texting.md.

- [x] Document per-client provisioning, client registration, subaccount API keys, webhook configuration and server-only secret shape.
- [x] Document enable/disable behavior, rollback and migration from unused global SMS configuration.
- [x] Record test results and remaining production dependencies; review the complete branch diff.

## Remaining replacement slices

1. ActiveProspect operational intake: promote shadow receipts into canonical leads/events with consent evidence, source identity, idempotent replay, test isolation and exclusive contact ownership. Extend src/modules/access-route and existing LeadConduit route; prove duplicate delivery creates one workflow.
2. Setter queue and access: extend tasks and CRM roles for claiming, mandatory dispositions, callbacks, escalation, manual calling and manager coverage. Prove competing setters cannot claim the same task.
3. Capacity: extend src/modules/booking and reservation RPCs for appointment types, resources, rep schedules, in-home territories/travel buffers and staff rescheduling. Prove concurrent reservations cannot oversubscribe capacity.
4. Approved messaging/cadences: extend src/modules/sms and Inngest workers with tenant timezone, versioned templates, automation attribution, first touch, durable scheduling, suppression rechecks, ambiguous-send handling, reply pauses and takeover.
5. Appointment recovery: SMS confirmations/reminders, cancellation recovery, setter-confirmed no-shows, rebooking and outcome collection. Prove stale reminder jobs cannot send after rescheduling/cancellation.
6. Limited replies: approved acknowledgments, booking links and deterministic handoff; ambiguous intent goes to setters. Validate each allowed intent before enabling it.
7. Production handoff/reporting: extend JobNimbus integration beyond its read-only warehouse where production requires it, with explicit field ownership, outbound mapping/retries and reconciliation. Report unique held appointments per 100 leads, separately by type/source/cohort.
8. Owner proof/live pilot: rehearse intake through recovery and held outcome, then route an exclusive live cohort. Expand only after operational acceptance and reviewed sits per 100; migrate Booking-Bot ownership and suppression deliberately.

Each remaining slice requires a focused implementation plan with exact schema/API interfaces after inspecting the preceding slice. Client discovery (coverage, capacity, consent and production handoff) runs alongside development.

## Slice 1 verification and handoff

Implemented on `codex/2stack-managed-texting`, based on main at `c8ff4cb`.

- Resolver/environment tests: new behavior failed first, then passed.
- Webhook/store tests: eight assertions failed before company-scoped routing was implemented, then passed.
- Targeted managed SMS tests: 72 passed.
- Full application unit suite after review fix: 1,740 passed, 8 skipped (231 files passed, 7 skipped).
- Typecheck: passed. Full lint: zero errors, 13 warnings in unchanged files; changed-file lint: clean.
- Production build with Node 24 and synthetic CI configuration: passed. Network access was needed for the existing Google Fonts build dependency.
- Independent review: no concrete production correctness/security issue found; missing signed cross-company route coverage was identified and addressed with real routes/store plus a filter-aware database double.
- Isolation mutation check: temporarily removing company filters made both cross-company tests fail; filters were restored and the suite passed.
- No database migration; local database/integration suite was not run because the Docker socket was unavailable in the sandbox. Full database checks remain a CI gate.
- No live subaccounts, registrations, numbers, credentials, messages, production settings, or traffic ownership were changed.

Implementation decisions: deployment-secret registry is the initial credential store; automated client provisioning is deferred. Inbound callbacks intentionally remain active when outbound is disabled. These choices are documented in the design and runbook. Next slice is ActiveProspect operational intake.

# ActiveProspect Booking Intake Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans; use test-driven-development and a final independent code review.

**Goal:** Turn explicitly routed ActiveProspect submissions into durable, tenant-scoped PIW lead records and setter work without duplicate contact.

**Architecture:** Add `/api/integrations/activeprospect/[binding]` independently of legacy LeadConduit shadow checkpoints. Server-only deployment bindings select company, flow, appointment type, contact owner and bearer token. A service-only database RPC commits receipt, phone ownership, canonical lead graph, consent evidence, initial setter task and durable CRM event in one transaction. The existing outbox publishes the event, with a bounded immediate publish attempt.

**Tech Stack:** Next.js, TypeScript/Zod, Supabase/Postgres, Inngest, Vitest/pgTAP.

**Spec:** ../specs/2026-10-27-2stack-booking-product-design.md plus this slice's decisions below.

## Global constraints and decisions

- Existing shadow receivers and flow configuration remain unchanged. New bindings default to disabled and come from `ACTIVEPROSPECT_INTAKE_BINDINGS_JSON`.
- Payload schema is explicit version 1, with stable vendor lead ID, flow ID, submission timestamp, source identity, test boolean and optional contact/consent evidence. Maximum body is 64 KiB.
- Replay key is company + flow + vendor lead ID + test flag. Changed replay payload returns 409 and never overwrites evidence or creates work. Identical retries return the original receipt/result.
- Test submissions create receipts only. External-owned traffic creates no canonical lead/task/event. Ownership is company + normalized US phone and cannot be silently changed by a new flow or replay.
- PIW requires name, valid phone, email and address for canonical leads. Incomplete submissions are durably `needs_review`, not discarded or filled with invented contact values. A manager can inspect receipt statuses on `/intake`.
- SMS eligibility requires explicit granted consent, the exact tenant UUID, disclosure text, evidence URL and capture timestamp. A TrustedForm URL alone does not grant texting consent. Suppression and send-time checks remain authoritative.
- Repeated submissions for a phone already owned by PIW link to its existing lead without another initial task or CRM event. Conflicting owner configuration produces `ownership_conflict` for manager review.
- No live ActiveProspect flow edits, credential provisioning, traffic changes, external sends or production migrations in this slice.

## Review focus

1. Forged company/flow/owner input cannot cross the server binding; bad signatures, disabled bindings, malformed/oversized requests never reach persistence.
2. Duplicate delivery, changed payload replay and competing submissions cannot create duplicate lead graphs or setter work.
3. Same phone across different tenants remains independent; same phone across flows cannot acquire conflicting owners.
4. Test/external/incomplete submissions never enter live workers, sends or lead counts.
5. Missing consent evidence never grants SMS; prior suppression is never lifted by intake.

## Task 1: authenticated operational receiver

**Files:** src/modules/activeprospect/config.ts, payload.ts, intake-http.ts and adjacent tests; src/app/api/integrations/activeprospect/[binding]/route.ts.

**Interfaces:** `resolveIntakeBinding(slug, environment)` returns a validated binding or null. `handleActiveProspectIntake(request, slug, dependencies)` returns status/body after durable persistence. Dependencies provide binding resolution, atomic acceptance, and event publishing. No request field selects a company or owner.

- [x] Write failing config and HTTP tests for tenant/flow/token isolation, disabled bindings, optional consent, size/type guards, duplicate/conflicting replays and persistence/publish failures.
- [x] Implement strict payload normalization, fail-closed binding registry and constant-time bearer authentication.
- [x] Keep persistence failures retryable (503); acknowledge committed intake even when immediate event publishing fails.

## Task 2: atomic lead and setter-work creation

**Files:** Supabase CLI-created activeprospect_booking_intake migration; supabase/tests/activeprospect-booking-intake.test.sql; src/modules/activeprospect/repository.ts; src/lib/database.types.ts.

**Interface:** `accept_activeprospect_booking_intake(p_company_id uuid, p_flow_id text, p_appointment_type text, p_contact_owner text, p_payload jsonb)` returns receipt ID, state, lead ID, duplicate flag and persisted event JSON. Only service_role can execute. Receipts and phone ownership are company-scoped; manager reads use RLS.

- [x] Write and run failing pgTAP cases for atomic success/replay, changed payload rejection, test isolation, external ownership, incomplete contacts, consent and cross-tenant boundaries.
- [x] Implement serialized receipt/phone identity checks and reuse submit_lead_intake_from_source for new canonical graphs.
- [x] Persist one initial task and CRM domain event/outbox row in the same transaction as the lead.
- [x] Apply only to isolated local database; run pgTAP, including two-session competing submission tests; regenerate schema types and confirm parity.

## Task 3: operational visibility and verification

**Files:** src/app/(app)/intake/page.tsx; docs/runbooks/activeprospect-booking-intake.md; .env.example.

- [x] Add a manager-only read page for recent receipt status/type/ownership and canonical lead links; keep consent and raw contact evidence out of list output.
- [x] Document exact synthetic payloads, token rotation, accepted statuses, replay/ownership handling and client mapping requirements.
- [x] Run targeted tests, full unit suite, typecheck, lint, build and isolated database suite; independently review the branch.
- [ ] Publish draft PR and verify required CI; leave production enablement explicit.

## Verification record

- Prerequisite CI: #98 had already merged with a generated database-type mismatch. Follow-up #99 corrects that file; application, website and database CI all passed before intake implementation began.
- Unit tests: 1,757 passed, 8 skipped. Targeted intake module tests: 17 passed.
- Fresh isolated database reset: all migrations, including this migration, applied successfully. Full pgTAP suite: 1,652 checks passed across 51 files, including two-session phone/receipt races.
- Production build and typecheck passed. Changed-file lint clean; full lint has 13 pre-existing warnings and zero errors.
- Independent review found legacy manual phones were missing from existing-contact matching. Regression test failed before the fix; matching now also normalizes raw US phone spellings when phone_e164 is absent. Added manager/non-manager RLS and suppression/future-consent tests.
- Database static lint reports the existing enqueue_google_ads_conversions reference to a session-created temporary table; it reports no new intake function issue. Runtime database tests remain green.
- No production migration, ActiveProspect configuration, live credentials or external customer messages were changed.

Implementation decisions/limits: incomplete submissions stay immutable review receipts because existing leads require email/address; corrected submissions need a new stable source submission ID. Contact ownership is enforced within the new receiver, not inside Booking-Bot or every unrelated legacy intake transaction. Live mapping, exclusive cohort routing, evidence retention and ownership transfer remain operational launch work.

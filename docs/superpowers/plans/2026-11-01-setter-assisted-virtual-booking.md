# Setter-assisted Virtual Booking Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task in this session. The user authorized continued implementation; no additional planning approval is pending.

**Goal:** Let a setter book or move a claimed homeowner's virtual inspection inside the setter queue.

**Architecture:** Add a claim-authorized context RPC and a service-only commit wrapper around the existing reservation engine. Reuse server booking orchestration, calendar busy checks, events and revision safeguards. Add a focused picker inside the queue.

**Tech Stack:** Next.js/TypeScript, Supabase/Postgres, Vitest, pgTAP.

**Spec:** ../specs/2026-11-01-setter-assisted-virtual-booking-design.md

## Global Constraints

- Company/lead/link identity comes from authorized claim context, never browser fields.
- Commit is service-role-only and revalidates the live claim after external availability calls.
- Reuse existing virtual reservations, uniqueness, calendar events and reminder revisions. Do not auto-dispose calls.
- No production database changes, live messages or traffic enablement.
- Work follows green #104; release requires its merge. PR target stays main.

## Review Focus

- Membership or claim can change between listing and saving: commit must reject without changing an appointment.
- A stale reschedule must not move a replacement booking or overwrite a newer revision.
- Concurrent homeowner and setter bookings must share the same capacity lock.
- Google outage must not be treated as an empty busy calendar.
- A retry after a committed save must show the existing booking rather than create another.

### Task 1: Claim-scoped database boundaries

**Files:** New CLI-generated migration; new `supabase/tests/setter-virtual-booking.test.sql` and `setter-virtual-booking-race.test.sql`; regenerated `src/lib/database.types.ts`.

**Interfaces:** `get_setter_booking_context(p_task_id uuid,p_claim_token uuid)` returns `(company_id uuid,lead_id uuid,link_id uuid)` for the active caller's claim. `save_setter_virtual_booking(p_company_id uuid,p_user_id uuid,p_task_id uuid,p_claim_token uuid,p_link_id uuid,p_action text,p_starts_at timestamptz,p_appointment_id uuid,p_expected_revision bigint,p_attendee_email text,p_customer_notes text,p_request_ip inet)` returns the same seven columns as `book_virtual_consultation`; service-role-only. Actions are `book` and `reschedule`. Reschedule requires the observed appointment/revision. Append actor/task/revision audit metadata for changes.

- [x] Write pgTAP authorization, real booking, retry, stale-revision and stale-claim regressions; run against isolated DB and observe missing behavior.
- [x] Implement private claim assertion and the two public RPCs, explicit grants/revocations, delegation and audit; apply only to isolated DB.
- [x] Prove contested final capacity with two real sessions, including homeowner vs setter. Run focused and full SQL suite, security advisors, regenerate types and verify exact parity.
- [x] Commit database boundary and tests.

### Task 2: Server booking orchestration

**Files:** New `src/modules/booking/setter-booking-runtime.ts`, adjacent tests, `src/app/(setter)/setter-queue/booking-actions.ts` and tests; reuse outcome parsing in `supabase-booking-repository.ts`.

**Interfaces:** `runSetterBookingAction(formData)` accepts strict `load`, `book`, `reschedule` commands with taskId/token; mutation fields are startsAt, optional attendeeEmail/notes, and appointmentId/revision for reschedule. Returns `{ok,message,code?,availability?:{model,revision},booking?}`. Reuse `loadBookingPage`, `bookConsultation`, `rescheduleConsultation`; replace only repository mutation methods with the claim-bound service commit. Model is the existing open/booked model; no capability token in browser results.

- [x] Write and observe failing action/runtime tests for auth, malformed commands, company injection, configuration/calendar failures, slot loss, commit-time claim loss, expected revision and durable event handling.
- [x] Implement server composition, trusted IP selection, safe error mapping, model loading and existing-page revalidation.
- [x] Run targeted service/action tests, typecheck and commit.

### Task 3: In-queue picker and verification

**Files:** New `src/app/(setter)/setter-queue/virtual-booking.tsx` and tests; update queue workspace/tests and `docs/runbooks/setter-queue.md`.

**Interfaces:** `VirtualBooking({current,onSaved})` uses only current task/claim identity. Load real availability, choose date/time, confirm invite email/notes, show existing booking and explicit reschedule mode, preserve errors/refresh slot loss, and notify the queue to refresh after success. Required call outcomes remain unchanged.

- [x] Write and observe failing UI tests for real picker flow, reschedule identity/revision, unavailable/empty states, slot refresh and stale-claim denial.
- [x] Implement accessible labeled controls consistent with the queue; replace the primary link-only booking section and retain its fallback link action.
- [x] Run full application suite, lint/typecheck/build and full isolated SQL checks. Review desktop/mobile synthetic fixture in a browser; remove temporary fixture route.
- [x] Update runbook, request independent whole-branch review, address concrete findings with regressions, commit and open a draft PR targeting main. Watch CI and correct failures.

## Verification and handoff

- #104 merged as 14a38be; its production deployment is READY. Rebase this feature onto that main revision before opening the PR.
- New database behavior failed first; claim expiry during a capacity-lock wait separately failed three real-session assertions before the final rollback check.
- Fresh isolated reset: 57 SQL files / 1,778 assertions passed. Generated public types match exactly. Security advisors reported no issues at warning/error level. One initial existing shared-IP race assertion was transiently red; the full suite passed after a fresh reset and on subsequent runs.
- Complete application suite after review correction: 1,821 passed, 8 skipped. Typecheck/build passed; lint has only the same 13 existing warnings.
- Independent whole-branch review found one calendar-outage UX issue for existing bookings. Real runtime and picker regressions failed first, then passed after retaining explicit calendar availability with the current appointment. No deferred review findings.
- Desktop (1280px) and mobile (390px) synthetic rendered snapshots inspected: no horizontal overflow. Interactive picker flows are exercised by component tests; live Google/provider traffic and authenticated production booking were not exercised. Temporary fixture test removed.
- Hosted CI remains a release gate; final PR records its actual result. No production migration, booking, sender enablement or live message was performed.

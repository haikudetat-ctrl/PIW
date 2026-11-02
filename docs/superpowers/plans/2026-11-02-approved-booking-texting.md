# Approved Booking Texting Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for native implementation, then one independent whole-branch review. The user authorized continued implementation; do not pause for another planning approval.

**Goal:** Add company-approved setter texts and durable virtual-appointment confirmations/reminders.

**Architecture:** Versioned template approval, a tenant-scoped delivery ledger with SQL scheduling/guards, a bounded Inngest delivery worker using managed Twilio, signed attempt-correlated callbacks, and focused company/setter controls.

**Tech Stack:** Next.js/TypeScript, Supabase/Postgres, Inngest, Twilio, Vitest, pgTAP.

**Spec:** ../specs/2026-11-02-approved-booking-texting-design.md

## Global Constraints

- No live sends, template approvals, sender changes, automatic enablement or production texting migration during development.
- Company/lead identity is authorized on the server; no parent/global SMS credential fallback.
- Automatic work starts disabled, never backfills historical appointments, and must recheck revision/consent/pause immediately before the provider call.
- Network-started attempts are never automatically retried. Unknown acceptance requires callback or explicit audited operator reconciliation.
- Preserve existing manager manual texting and signed opt-out callbacks.

## Review Focus

- A reply, STOP, retirement, claim loss or reschedule during preparation must prevent dispatch.
- An accepted POST followed by a lost response must not generate another POST on worker retry.
- A signed callback arriving before HTTP settlement must bind only the correct company/job/attempt and preserve delivery progress.
- Quiet-hour deferral must respect tenant timezone/DST and expire rather than send an obsolete reminder.
- Reconciliation must neither invent provider delivery proof nor silently send again.

### Task 1: Template and delivery database lifecycle

**Files:** CLI-created `approved_booking_sms` migration, new focused pgTAP lifecycle/race tests, generated public types.

**Interfaces:** Admin RPCs `save_sms_template_draft(kind,body)`, `approve_sms_template(id)`, `retire_sms_template(id)`, `save_sms_automation_settings(enabled,timezone)`, `get_sms_control_panel()`, `resolve_sms_delivery(id,resolution,provider_sid,note)`. Claim RPCs `get_setter_texting_context(task,token)`, `queue_setter_template_sms(task,token,template)`, `set_setter_sms_pause(task,token,paused)`. Service RPCs `claim_approved_sms_delivery(id?)`, `start_approved_sms_delivery(id,token,template,body,to,from,service_sid,segments)`, `settle_approved_sms_delivery(id,token,outcome,sid,status,error_code)`, `apply_approved_sms_callback(company,delivery,token,sid,status,to,from,error_code)`, `sweep_approved_sms_deliveries()`. JSON payloads are validated by adjacent TS schemas. No browser writes to delivery/message tables.

- [ ] Write/observe failing SQL tests for approvals, isolation, guards, lifecycle, unique claims, revision scheduling and unknown outcomes.
- [ ] Implement tables, explicit grants/RLS, immutable template versions, scheduling/reply triggers, safe lease/send/settlement functions and audited reconciliation.
- [ ] Exercise two real sessions; fresh isolated reset/full SQL/security advisors/type parity; commit.

### Task 2: Managed transport, worker and callbacks

**Files:** New `src/modules/sms/approved-*.ts` modules/tests, `src/inngest/functions/approved-sms-worker.ts`; update Twilio transport/status route/tests, SMS unknown status, env example and Inngest registration.

**Interfaces:** `processApprovedSmsDelivery(id?,dependencies)` composes approved content and returns a delivery outcome; runtime supplies service RPCs, signed branded manage links, readiness and managed transport. `SMS_AUTOMATION_ENABLED=false` gates the cron; manual sends retain separate explicit intent. Add a transport acceptance discriminator to `SmsProviderError`. Callback correlation uses signed full URL query job/attempt IDs.

- [ ] Write/observe failing orchestration, transport and callback tests for no send on blockers, unknown/no retry, tenant routing and callback-before-response.
- [ ] Implement bounded worker/runtime, quiet-hour deadlines, current approved rendering, provider ambiguity and monotonic callback settlement.
- [ ] Run complete application suite/typecheck; commit.

### Task 3: Template approval and setter controls

**Files:** New `/settings/texting` page/actions/components/tests, settings navigation, setter approved-text component/actions/tests, conversation unknown label, operating runbook.

**Interfaces:** Strict server actions expose admin template/config/reconciliation operations and claim-scoped preview/send/pause operations. UI never supplies freeform body for approved sends or receives provider secrets. Delivery state distinguishes queued/accepted/unknown from recipient delivery.

- [ ] Write/observe failing action/UI tests for role/identity validation, approval preview, claim-only sends, pause/reconciliation and disabled readiness.
- [ ] Implement controls using existing UI patterns, preserve call-outcome workflow and expose actionable unknown states.
- [ ] Inspect synthetic desktop/mobile layouts, remove fixtures, update runbook; commit.

### Task 4: Verify and hand off

- [ ] Fresh complete unit/SQL/integration/type parity/lint/build checks; review the whole branch independently.
- [ ] Address concrete review findings with failing-first regressions, then open a PR targeting main and get CI/previews green.
- [ ] Record production #105 migration source/applied-version mapping and leave new automatic texting paused for client approval/provisioning.

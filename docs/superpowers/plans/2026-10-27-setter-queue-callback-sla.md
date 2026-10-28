# Setter Queue and Callback SLA Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. The user has authorized continued implementation in this session.

**Goal:** Give enrolled setters one ranked queue with exclusive claims, mandatory outcomes and durable callback escalation/recovery.

**Architecture:** Extend `tasks` with queue and claim metadata. Authenticated database RPCs enforce company membership, enrollment, shifts, claims and outcomes atomically; a separate setter page exposes only claimed lead context. A service-only Inngest sweep records callback SLA events, creates manager notifications and recovery tasks, and optionally delivers tenant-bound Slack alerts.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase/Postgres, Inngest, Vitest and pgTAP; Node 24.

**Spec:** ../specs/2026-10-27-2stack-booking-product-design.md

## Global Constraints

- PIW owns operational records. ActiveProspect and JobNimbus stay; LeadMaster cannot block launch.
- No live customer texts, external alert sends or production migrations during verification.
- Manual calling is acceptable; record attempts in PIW without implying vendor-verified calls.
- Reuse genuine virtual booking capacity; do not invent in-home appointment windows.
- Queue enrollment does not grant access to the full manager CRM.
- Deployment starts disabled per company. Managers enable the queue and enroll existing active company members.

## Review Focus

- Competing sessions, expired claims and repeated submissions cannot create simultaneous calls or duplicate follow-up tasks.
- A deactivated member or switched company cannot retain claimed lead access.
- A homeowner changing a callback invalidates the old claim and SLA clock.
- A no-answer attempt prevents missed-window escalation even when disposition is recorded later.
- A Slack timeout is ambiguous and must not cause blind duplicate notifications.

### Task 1: Atomic queue, claims and outcomes

**Files:** New generated migration, `supabase/tests/setter-queue.test.sql`, `supabase/tests/setter-queue-race.test.sql`; generated `src/lib/database.types.ts`.

**Interfaces:** `save_setter_queue_settings(enabled, timezone)`; `set_company_setter(user_id, enabled)`; `set_setter_shift(on_shift)`; `get_setter_queue()` returns authorized JSON snapshot; `claim_setter_task(task_id default null)` returns claimed task ID/token; `record_setter_attempt(task_id, token)`; `finish_setter_task(task_id, token, outcome, notes, callback_at, appointment_id)`.

- [x] Write pgTAP assertions for disabled/unrostered/off-shift access, tenant isolation, five priority buckets, assigned callback release after ten minutes, one lead per claim, one claim per setter, stale tokens and mandatory outcome.
- [x] Run against the isolated `piw-booking-build` database; observe missing queue behavior.
- [x] Add settings/roster, task queue metadata, immutable outcome history and stop-contact state. Adopt only known system task origins/titles when enabled. Exclude test, externally owned and closed leads. New leads older than fifteen minutes rank with follow-up.
- [x] Implement authenticated RPCs with live membership checks, company/user advisory locks, row locks and fifteen-minute claims. Unfinished claims resume before another lead; expiry permits another setter to recover them. Off-shift is refused with an unfinished claim.
- [x] Validate booked outcomes against a real future scheduled/confirmed appointment; virtual requires the existing reservation engine. Callback requires a future instant. No-answer/voicemail creates one two-hour follow-up, handoff creates one unassigned handoff, and stop outcomes cancel pending queue tasks for that lead. Replays return the original outcome without new tasks.
- [x] Guard direct authenticated task edits/deletes so generic completion cannot bypass disposition. Keep generic manual tasks unchanged. Callback due-time changes reset claim and SLA state.
- [x] Run queue pgTAP and real dblink contention tests, then regenerate types; commit.

### Task 2: Callback clock and manager alerts

**Files:** New generated migration if needed; `supabase/tests/setter-callback-sla.test.sql`; `src/modules/setter-queue/slack-alerts.ts` and tests; `src/inngest/functions/setter-callback-sla.ts`; register in `src/app/api/inngest/route.ts`.

**Interfaces:** service-only `sweep_setter_callback_sla()` records stages once per task, releases untouched callback claims at due +10 minutes, and closes an untouched callback at +30 minutes with one recovery handoff. `claim_setter_callback_alerts()` and `settle_setter_callback_alert(id, token, status)` protect Slack dispatch. Company webhook registry is server-only `SETTER_SLACK_CLIENTS_JSON`.

- [x] Write failing pgTAP tests at ten/thirty-minute boundaries, attempted callbacks, repeated sweeps, reschedules, company disable and original-setter attribution.
- [x] Implement atomic sweep and durable alert records, manager notifications and seven-day missed-window counts in the manager snapshot. No answer counts as an attempt; no automatic apology text in this slice.
- [x] Write failing transport tests for two-company routing, missing/duplicate/malformed configuration, bounded timeouts, non-success responses and ambiguous sends.
- [x] Implement one-minute cron, disabled unless `SETTER_CALLBACK_SLA_ENABLED=true`. Persist sending before network I/O; expired sends become uncertain for manual reconciliation. Never include homeowner PII in Slack.
- [x] Run targeted tests and pgTAP, regenerate types; commit.

### Task 3: Setter workflow and operational handoff

**Files:** `src/app/(setter)/setter-queue/{page.tsx,actions.ts,queue-workspace.tsx}`; `src/modules/setter-queue/{schema.ts,schema.test.ts}`; sidebar and generic task list; new runbook `docs/runbooks/setter-queue.md`; `.env.example`; root product plan.

**Interfaces:** authenticated RPCs from Tasks 1–2. Booking link action checks the live claimed task using the authenticated RPC before issuing a company-bound virtual booking link with the existing service.

- [x] Write failing tests for explicit tenant-timezone callback conversion, DST gaps/overlaps, required reason, safe action errors and the UI's claim/attempt/outcome flow.
- [x] Build a focused queue page: bucket counts, shift control, resume/claim, claimed homeowner details/source, estimate range/squares, text history, call history and real appointments. Manager-only configuration/enrollment and missed-callback report appear on the same page. Full JobNimbus/history/aerial remain linked through the existing manager workspace until scoped identity/media access is implemented.
- [x] Use existing virtual booking link and capacity engine. In-home bookings are not offered here until the capacity slice. Explicitly label manual call attempts and company timezone; reject ambiguous callback wall times instead of choosing silently.
- [x] Link the queue from CRM navigation and replace generic completion for queued tasks with a queue link.
- [x] Document enable/disable, shift expiry (eight hours), claim expiry, manual CallTools calling, recovery ownership, Slack setup/reconciliation, remaining messaging/capacity boundaries and production rollout.
- [x] Run complete unit suite, fresh isolated database reset and all pgTAP, exact generated type comparison, lint/typecheck/build; obtain independent review. Open a PR explicitly targeting `main` and attach it. Required CI must pass before merge.

## Initial scope decisions

The attachment is planning material, not an instruction to launch AI or send messages. This slice adopts its five-bucket discipline and ten/thirty-minute callback clock. Existing manager access remains unchanged; separate setter enrollment permits scoped employee access. Recovery creates a human task rather than sending unapproved texts or proposing unavailable times. Full identity-linked JobNimbus and aerial context, cadence automation, staffed schedules/languages and in-home capacity remain later product slices.

## Verification and review

- Branch based directly on main after #101 merged; main CI passed before implementation.
- Unit tests: 1,787 passed, 8 skipped (238 files passed, 7 skipped).
- Fresh isolated database reset: 1,742 pgTAP checks across 55 files passed; exact generated type comparison passed.
- Typecheck and production build passed with Node 24. Full lint: zero errors, 13 warnings in unchanged code.
- Local database security advisors: no issues found.
- Independent review identified callback identity/supersession, attempted callback recovery and per-claim attempt state gaps. All three have regressions that failed first and now pass. The supersession regression uses the actual homeowner callback RPC.
- Browser check: local synthetic fixture, desktop callback controls and mobile layout verified. The temporary preview route was removed; no live customer data or messages were used.
- The initial release landed in PR #102 at its earlier reviewed revision. The recovery corrections are a follow-up against main, packaged as a forward migration for existing databases; historical migrations remain unchanged. Required CI is the final merge gate. No production enablement, live Slack/SMS, or production database commands were run.

# Plan

Give every PIW-generated lead, regardless of which intake produced it, exactly one
outbound path into the ActiveProspect LeadConduit `Roofing` flow
(`6377949a81800d03d54119b5`) through the PIW-owned source
`6a999da372afc3570dc712a1`. Build the path disabled, prove it with test-mode
traffic, then enable it per environment.

This is the reverse direction of the existing access route. PIW is currently a
*receiver* only: `src/modules/access-route/leadconduit-shadow-receipt.ts` and
`/api/integrations/leadconduit/[flow]` accept a sanitized post-CoreLogic payload,
and both receiver flags are off. Nothing in the repository submits to LeadConduit.
Outbound submission and the shadow receipt are complements — the receipt is how
flow results come back — so they share the `access-route` module, the pinned-ID
convention, and the flag-off-by-default posture.

## Scope

- In: one canonical submission trigger shared by all lead sources, a durable
  per-lead submission ledger, a pure payload mapper, a pure outcome classifier,
  one Inngest dispatcher, environment binding pinned to the approved flow and
  source IDs, dashboard visibility, and a phased rollout runbook.
- Out: enabling a production submitter, editing the LeadConduit flow, adding
  LeadConduit sources beyond the one approved source, submitting into the
  `Roofing Virtual Quote` flow, TrustedForm certificate capture (a prerequisite,
  tracked below, not built here), and any change to how the shadow receipt works.

## Decisions taken

- **One shared source.** All PIW paths post to `6a999da372afc3570dc712a1`. PIW's
  own `source_system` and `campaign` ride along as fields rather than as separate
  LeadConduit sources. One URL, one credential, one mapper; adding a second source
  later is a binding-table row, not new code.
- **Submit at lead creation, uniformly.** Every `public.leads` row PIW creates is
  submitted, including assessment-path leads created before the roof result
  exists. This favors speed-to-lead and keeps one rule for all sources. The cost
  is that abandoned assessments still consume the flow's paid filter steps; the
  concurrency cap and kill switch below are what bound that, and the ledger makes
  the spend measurable before it is accepted permanently.
- **The field mapping is unresolved.** The Submission Docs page is behind
  authentication and could not be read while writing this plan. The mapping table
  below is deliberately unfilled and is a hard gate on implementation.

## The problem this has to solve first

Lead creation is fragmented. Three live RPCs create leads and they emit two
different domain events:

| Path | RPC | Event emitted |
|---|---|---|
| Manual dashboard intake (`/leads/new`) | `public.submit_lead_intake` | `crm/lead.submitted` |
| All Season website intake | `public.submit_all_season_lead` | `crm/lead.submitted` |
| All Season campaign / canonical assessment | `public.start_or_resume_roof_assessment` | `roof/assessment.started` |

Two further RPCs, `public.submit_lead_intake_from_source` and
`public.submit_roof_estimate_lead`, create leads but have no live application
call site; `submit_lead_intake_from_source` is reserved for vendor-payload
mapping. They must be wired identically so a future call site cannot silently
bypass submission.

Subscribing an exporter to `crm/lead.submitted` would therefore miss every
assessment and campaign lead — the highest-intent traffic. Fanning an exporter
across both event names would couple it to the current event vocabulary and break
the next time a path is added. Neither is clean.

The fix is to introduce one signal that means *a PIW lead exists and should be
offered to ActiveProspect*, emitted transactionally by each creating RPC, and to
make that the exporter's only trigger.

## Design

### 1. Submission ledger and canonical trigger (database)

New migration `leadconduit_outbound_submission.sql`:

- `public.leadconduit_submissions` — one row per lead, `unique (company_id, lead_id)`:
  `id`, `company_id`, `lead_id`, `flow_id`, `source_id`, `status`
  (`pending` | `in_flight` | `accepted` | `rejected` | `failed` | `skipped`),
  `attempt_count`, `available_at`, `claimed_at`, `claimed_by`,
  `request_fingerprint`, `leadconduit_lead_id`, `outcome`, `reason`,
  `last_error`, `submitted_at`, timestamps. RLS on, `revoke all` from `anon`
  and `authenticated`, `grant all` to `service_role`, company-scoped select
  policy for `authenticated` — matching `integration_events` and
  `suppression_list`.
- `public.request_leadconduit_submission(p_company_id, p_lead_id, p_pipeline_run_id, p_correlation_id, p_source_system)`
  — `security definer`, `set search_path = ''`. Inserts the ledger row
  `on conflict (company_id, lead_id) do nothing`, and **only when a row was
  actually inserted** appends one `public.domain_events` row plus one
  `public.event_outbox` row for `integration/leadconduit.submission_requested`.
  Copy the exact append pattern at
  `supabase/migrations/20260824172620_all_season_campaign_estimate_transaction.sql:279-335`,
  including `jsonb_strip_nulls`, the UTC `to_char` format, and an
  `idempotencyKey` of `integration/leadconduit.submission_requested:<lead_id>`.
  Returns early without inserting when `p_source_system = 'leadconduit'`.
- `public.claim_leadconduit_submission(p_id, p_worker)` and
  `public.record_leadconduit_submission_outcome(p_id, p_status, p_outcome, p_reason, p_leadconduit_lead_id, p_error, p_available_at)`
  — so the dispatcher never does read-modify-write against the ledger and two
  concurrent Inngest runs cannot both post the same lead.
- One added call to `request_leadconduit_submission` at the end of each of the
  five lead-creating RPCs, inside the existing transaction. Follow the repo's
  convention of redefining the whole function in a new migration rather than
  patching in place.
- pgTAP coverage in `supabase/tests/leadconduit-outbound-submission.test.sql`:
  ledger uniqueness, the `on conflict` no-op emitting no second event, the
  `source_system = 'leadconduit'` skip, claim exclusivity, and RLS isolation
  between companies.

Keying the ledger and the idempotency key on `lead_id` rather than
`pipeline_run_id` is deliberate: a lead can acquire a second pipeline run
(resume, re-estimate) and must still be submitted exactly once.

### 2. Binding and configuration

New `src/modules/access-route/leadconduit-submission-config.ts`, mirroring
`leadconduit-config.ts`:

```ts
export const LEADCONDUIT_SUBMISSION_FLOW_ID = "6377949a81800d03d54119b5";
export const LEADCONDUIT_SUBMISSION_SOURCE_ID = "6a999da372afc3570dc712a1";
```

`getLeadConduitSubmissionBinding(env, now)` returns `null` unless
`ACCESS_ROUTE_COMPANY_ID` is set and the configured IDs equal the pinned
constants — the same refusal-to-guess behavior that already protects the
receivers. Credentials follow the established active/next/expiry rotation shape.

New server env in `src/lib/env/server.ts` and `.env.example`, all defaulting off
or blank:

```
INTEGRATIONS_LEADCONDUIT_SUBMISSION_ENABLED=false
LEADCONDUIT_SUBMISSION_FLOW_ID=
LEADCONDUIT_SUBMISSION_SOURCE_ID=
LEADCONDUIT_SUBMISSION_BASE_URL=
LEADCONDUIT_SUBMISSION_API_KEY=
LEADCONDUIT_SUBMISSION_API_KEY_NEXT=
LEADCONDUIT_SUBMISSION_API_KEY_NEXT_EXPIRES_AT=
LEADCONDUIT_SUBMISSION_MAX_CONCURRENCY=2
```

Add a `serverEnvSchema` cross-field refinement: enabling the submitter requires
the company ID, both pinned IDs, a base URL, and an active key; a next key
requires an ISO 8601 UTC expiry. Extend `integrationFlagsSnapshot` and the
`/api/integrations/health` route so the submitter's state is observable without
reading environment variables off a running box.

### 3. Payload mapper (pure)

New `src/modules/access-route/leadconduit-submission-payload.ts`:
`buildLeadConduitSubmission(lead, binding) -> { fields, fingerprint }`. Reuses
`normalizePhone` / `normalizeEmail` from `src/modules/access-route/normalize.ts`
so outbound and inbound normalize identically. Validates the mapped object with
Zod before anything is sent; a mapping failure is a `skipped` ledger row with a
reason, never a malformed POST. `fingerprint` is a SHA-256 of the canonicalized
field set, stored on the ledger so a re-submission after a deliberate reset is
distinguishable from a duplicate.

**This table is the implementation gate. Fill it from the Submission Docs page
before writing the mapper.**

| PIW value | Column / source | LeadConduit field | Required? | Notes |
|---|---|---|---|---|
| Full name | `leads.name` | | | Flow may want first/last split |
| Phone | `leads.phone_e164`, falling back to `leads.phone` | | | |
| Email | `leads.email_normalized`, falling back to `leads.email` | | | |
| Address | `properties.canonical_address`, falling back to `leads.submitted_address` | | | Canonical preferred; CoreLogic steps key off it |
| State | `properties.state_code` (always `NJ`) | | | |
| Service | `leads.service_requested` | | | `roofing` \| `solar` \| `both` |
| PIW lead id | `leads.id` | | | Round-trip key for the shadow receipt |
| PIW source | `leads.source_system` | | | Replaces per-source LeadConduit sources |
| Campaign | `leads.campaign` | | | |
| Original source | `leads.original_lead_source` | | | |
| TrustedForm cert | `leads.trustedform_url` | | | **Not populated today — see prerequisites** |
| Consent reference | `leads.consent_reference` | | | |
| Submitted at | `leads.created_at` | | | |
| Test flag | `leads.is_test` or non-production `DEPLOYMENT_ENV` | | | Must be a real boolean, not `"true"` |

Also record from the docs page: the exact submit URL shape, the authentication
scheme, the request content type, and the response body shape. The plan below
assumes only that the response carries an outcome, a reason, and a LeadConduit
lead id; if it does not, the classifier changes.

### 4. Outcome classifier (pure)

New `src/modules/access-route/leadconduit-submission-outcome.ts`:
`classifyLeadConduitResponse(httpStatus, body) -> { disposition, leadConduitLeadId, reason }`
where `disposition` is `accepted` | `rejected` | `retry`.

The distinction that matters: LeadConduit answers a *rejected* lead with a
successful HTTP response carrying a failure outcome. Treating HTTP 200 as success
would mark filtered leads accepted and hide exactly the signal PIW wants.

- `accepted` — success outcome. Terminal. Store the returned lead id.
- `rejected` — failure outcome, i.e. a filter declined the lead. **Terminal, not
  retryable.** Store the reason verbatim; that reason is the product value of
  this integration.
- `retry` — error outcome, HTTP 429, 5xx, timeout, or transport failure. Bounded
  retries with backoff via `available_at`, then `failed`.

### 5. Dispatcher (Inngest)

New `src/inngest/functions/leadconduit-submitter.ts`, registered in
`src/app/api/inngest/route.ts`, triggered solely by
`integration/leadconduit.submission_requested`. Steps, each an Inngest step so
retries resume rather than restart:

1. Resolve the binding. Not configured or flag off → `skipped`, no HTTP call.
2. Load the lead with its property. Guard: `source_system = 'leadconduit'` →
   `skipped`. This loop guard is written now, before any inbound path creates
   leads, so it cannot be forgotten later.
3. `public.is_suppressed(company_id, 'call', phone_e164, email_normalized)` →
   `skipped`. PIW must not hand an opted-out contact to a distribution flow.
4. Build and validate the payload. Force the test flag when
   `DEPLOYMENT_ENV != 'production'` or `leads.is_test`.
5. `claim_leadconduit_submission`. A lost claim ends the run.
6. POST, with a request timeout.
7. Classify, then `record_leadconduit_submission_outcome`. `rejected` throws
   `NonRetriableError` after recording so Inngest stops immediately.

Set `concurrency` from `LEADCONDUIT_SUBMISSION_MAX_CONCURRENCY` and bounded
`retries`. Every submission may cost money and consume CoreLogic and TrustedForm
steps in the flow; an unbounded retry storm against a degraded endpoint is the
expensive failure mode here.

Log the LeadConduit lead id, outcome, and reason. Never log the API key, and
never log the full outbound payload — it is client PII.

### 6. Visibility

- `/leads/[leadId]` and the dialer view: submission status, LeadConduit lead id,
  and rejection reason, beside the existing TrustedForm row at
  `src/app/(app)/leads/[leadId]/dialer/page.tsx:285`.
- `/access-route`: counts by status and the ten most recent failures, so a broken
  credential is visible without a database session.

### 7. Prerequisite: TrustedForm

`leads.trustedform_url` exists and is displayed, but it is only ever populated
from inbound LeadConduit payloads (`src/modules/access-route/normalize.ts:259`).
**No PIW-owned form captures a TrustedForm certificate** — not the dashboard
intake, not the All Season website form, not the campaign assessment.

If the approved source's flow runs a TrustedForm claim or verify step, every PIW
submission will fail it. Confirm this against the Submission Docs page before
Phase C. If it is required, capturing the certificate on the All Season website
form and the assessment intake is a separate change that must land first; it is
not in this plan's scope.

## Action items

[ ] Read the Submission Docs page and fill the mapping table, the submit URL
    shape, the authentication scheme, the response body shape, and whether
    TrustedForm is required. Do not start implementation before this is done.
[ ] Write `leadconduit_outbound_submission.sql`: the ledger table, RLS and
    grants, `request_leadconduit_submission`, `claim_leadconduit_submission`,
    `record_leadconduit_submission_outcome`, and the five RPC redefinitions.
[ ] Write `supabase/tests/leadconduit-outbound-submission.test.sql` and run it
    with the existing access-route suites.
[ ] Regenerate `src/lib/database.types.ts` from the local database and diff it.
[ ] Add the submission env to `src/lib/env/server.ts` and `.env.example`, with
    the enabling refinement and its unit tests.
[ ] Add `leadconduit-submission-config.ts` with the pinned flow and source IDs
    and its refusal tests.
[ ] Add `leadconduit-submission-payload.ts` and
    `leadconduit-submission-outcome.ts` with unit tests, including a rejected
    lead returned on an HTTP 200.
[ ] Add `leadconduit-submitter.ts`, register it, and test each gate: flag off,
    suppressed, `source_system = 'leadconduit'`, claim lost, accepted, rejected,
    retryable error.
[ ] Extend `integrationFlagsSnapshot` and `/api/integrations/health`.
[ ] Add the lead-workspace and access-route submission panels.
[ ] Write `docs/runbooks/leadconduit-outbound-submission.md` in the phased,
    approval-gated form of `docs/runbooks/leadconduit-shadow-recipient.md`.
[ ] Run `npm run verify`.

## Rollout

- **Phase A** — everything above merged with `INTEGRATIONS_LEADCONDUIT_SUBMISSION_ENABLED=false`
  everywhere. Ledger rows accumulate as `skipped`, which by itself proves the
  canonical trigger fires for all four live intake paths.
- **Phase B** — deploy to the PIW staging stack, flag still false. Confirm every
  source produces exactly one ledger row per lead and no HTTP call is made.
- **Phase C** — with flow-owner approval, enable on staging with the test flag
  forced. Submit one synthetic lead per source. Confirm each appears in
  LeadConduit as a test lead, that the returned lead id is stored, and that a
  deliberately filtered lead lands as `rejected` with its reason.
- **Phase D** — enable in production for the manual dashboard intake only, by
  restricting the dispatcher to `source_system = 'piw_intake'`. Watch one
  business day: accepted/rejected split, cost per submission, and duplicates.
- **Phase E** — lift the restriction to all sources. Keep the flag as the kill
  switch.

Do not enable a production submitter from the implementation task. Phases C
through E are separate, explicitly approved operational actions.

## Open questions

- Does the approved source's flow require a TrustedForm certificate, and if so,
  who owns adding capture to the All Season website and assessment forms?
- What is the per-lead cost of a submission into this flow, and is there a daily
  ceiling PIW should enforce locally rather than discovering after the fact?
- Should `rejected` set a PIW lead stage — `nurture` or `lost` — or stay purely
  informational on the lead workspace? Nothing in `leadStageSchema` currently
  expresses "declined by a distribution filter".
- Assessment-path leads are submitted at creation, before the roof result exists.
  If Phase D shows a high filtered rate on abandoned assessments, is deferring
  that source to `roof/assessment.completed` acceptable?
- Does the flow owner want PIW leads distinguishable in LeadConduit reporting by
  field alone, or will separate sources per PIW path eventually be required?

# ActiveProspect LeadConduit Access Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tenant-bound, disabled-by-default ActiveProspect LeadConduit access route for the `Roofing` and `Roofing Virtual Quote` flows, beginning with read-only shadow ingestion and ending with optional real-time receipt plus a human-controlled rescue workflow inside PIW.

**Architecture:** Keep the existing LeadConduit flow authoritative. A GET-only reader inventories and reconciles exactly two configured flow IDs, while two flow-bound POST endpoints durably receipt accepted leads after all existing destinations. Webhook and polling observations merge into one tenant-scoped event identity. Accepted-lead processing and rescue actions run behind independent flags; rescue eligibility is an explicit allowlist, and every rescue-to-PIW decision is atomic, audited, and unable to write back to any vendor.

**Tech Stack:** Next.js 16 App Router and server actions, React 19, TypeScript, Zod 4, Vitest, Inngest 4, Supabase/Postgres with RLS and pgTAP, Vercel environment variables, ActiveProspect LeadConduit HTTP APIs.

## Global Constraints

- Before implementation, use `superpowers:using-git-worktrees` to create an isolated clean worktree. Fetch `origin`, and use refreshed `origin/main` only if it contains `src/modules/access-route/jobnimbus-canary.ts` and the JobNimbus normalization represented by commit `16509bf`. If it does not, base the implementation worktree on exact commit `16509bf`; do not build on the stale current `origin/main` and do not reapply the older Access Route merge commit `191e1d8`, whose tree is already represented by `8d425cd`.
- Keep the approved design at `docs/superpowers/specs/2026-08-11-activeprospect-access-route-design.md` beside this plan in the implementation branch.
- Use `superpowers:test-driven-development` for each task, the local `supabase` skill for every database action, `superpowers:verification-before-completion` before claiming success, and `superpowers:requesting-code-review` before the branch is handed off.
- Continue using `leadconduit` as the source-system key. Do not add a parallel `activeprospect` vendor.
- The only approved LeadConduit flows are the exact configured IDs for `Roofing` and `Roofing Virtual Quote`. Filter before persistence and again before presentation.
- Every LeadConduit capability defaults to false. Probe is account-scoped; shadow import, polling, receipt, accepted-lead processing, rescue recommendation generation, and rescue approval are independently controlled for each flow.
- All LeadConduit API client methods are HTTP `GET`; no code in the reader may expose flow mutation, deployment, or vendor writeback.
- The two real-time endpoints are optional final recipients, after existing destinations. They never proxy the source response or replace an existing recipient.
- A valid real-time delivery is acknowledged only after durable receipt and durable async work exist in one database transaction.
- Customer values may appear only in tenant-scoped operational records and the authenticated rescue detail. Status panels, action results, logs, error responses, audit metadata, and release evidence contain categories, counts, IDs, timestamps, and field names only.
- Rescue eligibility is deny-by-default. Unknown rules and systemic failures do not become rescue candidates.
- Consent, suppression/DNC, fraud, prohibited-source, client-blocklist, and confirmed-duplicate outcomes can never be recommended or approved for rescue.
- The first release places every LeadConduit-created PIW lead on `manual_hold`. Rescue approval creates one PIW lead and no consent, contact task, delivery row, LeadConduit write, LeadMaster write, or JobNimbus write. Releasing accepted leads into later outreach automation is a separate product decision.
- Preserve unrelated local changes. Stage and commit only the files named by each task.
- There is no existing Playwright/Cypress or `test:e2e` command. The local-Supabase integration tests and the deployed synthetic lead are the end-to-end gates.

## Clean-worktree preflight

- [ ] Fetch remote refs. If refreshed `origin/main` contains the `16509bf` JobNimbus canary tree, create `codex/activeprospect-access-route` from `origin/main`; otherwise create it from exact commit `16509bf`.
- [ ] Confirm `git status --short` is empty in that worktree.
- [ ] Record the selected base commit as `PIW_ACTIVEPROSPECT_BASE_SHA` in the release evidence before the first edit; all final diff checks use that exact SHA, not a possibly moving `origin/main`.
- [ ] Bring in approved design commit `42ce89b` if absent, then check out this plan path from `codex/access-route-integration` if absent. Confirm the spec, plan, JobNimbus canary files, and latest JobNimbus normalizers are present before editing.
- [ ] Run the existing baseline before editing:

```bash
npm ci
npm run db:start
npm run db:reset
npm run verify
```

Expected: the untouched baseline passes. Record any pre-existing failure before changing code.

---

### Task 1: Default-off capability flags and flow bindings

**Files:**
- Modify: `.env.example`
- Modify: `.github/workflows/ci.yml`
- Modify: `src/lib/env/server.ts`
- Modify: `src/lib/env/shared.test.ts`
- Modify: `src/lib/integrations/flags.ts`
- Create: `src/lib/integrations/flags.test.ts`
- Create: `src/modules/access-route/leadconduit-config.ts`
- Create: `src/modules/access-route/leadconduit-config.test.ts`
- Modify: `src/app/api/integrations/health/route.ts`
- Create: `src/app/api/integrations/health/route.test.ts`
- Modify: `src/app/api/integrations/[vendor]/route.ts`
- Modify: `src/app/api/integrations/[vendor]/route.test.ts`

**Interfaces:**

```ts
export type LeadConduitFlowSlug = "roofing" | "roofing-virtual-quote";

export type LeadConduitFlowBinding = {
  slug: LeadConduitFlowSlug;
  companyId: string;
  flowId: string;
  flowName: "Roofing" | "Roofing Virtual Quote";
  capabilities: {
    shadowImport: boolean;
    polling: boolean;
    receipt: boolean;
    processing: boolean;
    rescueRecommendations: boolean;
    rescueActions: boolean;
  };
  tokens: readonly Array<{ value: string; validUntil: string | null }>;
};

export function getLeadConduitFlowBinding(
  slug: string,
  environment: ServerEnv,
  now?: Date,
): LeadConduitFlowBinding | null;

export type LeadConduitReadEnvironment = Pick<ServerEnv,
  | "ACCESS_ROUTE_COMPANY_ID"
  | "LEADCONDUIT_API_KEY"
  | "LEADCONDUIT_BASE_URL"
  | "LEADCONDUIT_ROOFING_FLOW_ID"
  | "LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID"
  | "LEADCONDUIT_SHADOW_PAGE_LIMIT"
  | "LEADCONDUIT_SHADOW_MAX_PAGES"
  | "LEADCONDUIT_PAGE_LIMIT"
  | "LEADCONDUIT_MAX_PAGES"
  | "LEADCONDUIT_INITIAL_LOOKBACK_MINUTES"
>;
```

- [ ] **Step 1: Write failing environment, binding, and health tests**

Assert that these booleans all default to false:

```text
INTEGRATIONS_LEADCONDUIT_PROBE_ENABLED
INTEGRATIONS_LEADCONDUIT_ROOFING_SHADOW_IMPORT_ENABLED
INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_SHADOW_IMPORT_ENABLED
INTEGRATIONS_LEADCONDUIT_ROOFING_POLLING_ENABLED
INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_POLLING_ENABLED
INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED
INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RECEIVER_ENABLED
INTEGRATIONS_LEADCONDUIT_ROOFING_PROCESSING_ENABLED
INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_PROCESSING_ENABLED
INTEGRATIONS_LEADCONDUIT_ROOFING_RESCUE_ENABLED
INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RESCUE_ENABLED
INTEGRATIONS_LEADCONDUIT_ROOFING_RESCUE_ACTIONS_ENABLED
INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RESCUE_ACTIONS_ENABLED
```

Also test these server-only values and bounds:

```text
LEADCONDUIT_ROOFING_FLOW_ID
LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID
LEADCONDUIT_ROOFING_WEBHOOK_TOKEN
LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT
LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT_EXPIRES_AT
LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN
LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN_NEXT
LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN_NEXT_EXPIRES_AT
LEADCONDUIT_SHADOW_PAGE_LIMIT          default 50, maximum 50
LEADCONDUIT_SHADOW_MAX_PAGES           default 1, maximum 1
LEADCONDUIT_PAGE_LIMIT                 default 50, maximum 1000
LEADCONDUIT_MAX_PAGES                  default 1, maximum 25
LEADCONDUIT_INITIAL_LOOKBACK_MINUTES   default 1440, maximum 129600
LEADCONDUIT_WEBHOOK_ATTEMPT_RATE_LIMIT_PER_MINUTE default 600, maximum 10000
LEADCONDUIT_WEBHOOK_DELIVERY_RATE_LIMIT_PER_MINUTE default 300, maximum 5000
```

Required cases: every flow capability can be enabled while the same capability stays disabled for the other flow; a receiver requires its company ID, flow ID, and active token; probe/import/polling require the API key and relevant flow ID; each flow's rescue actions require that flow's rescue recommendation and processing flags; active and next tokens are deduplicated; a next token requires a future ISO expiry and is ignored after expiry; the health payload contains booleans only. Add a generic-route regression test proving `/api/integrations/leadconduit` is always rejected before tenant lookup or persistence, even when either polling flag is enabled.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm run test:run -- src/lib/env/shared.test.ts src/lib/integrations/flags.test.ts src/modules/access-route/leadconduit-config.test.ts src/app/api/integrations/health/route.test.ts 'src/app/api/integrations/[vendor]/route.test.ts'
```

Expected: FAIL because the capability schema, binding helper, and tests do not exist.

- [ ] **Step 3: Implement the exact capability contract**

Add the two per-flow polling flags without aliasing either to the legacy `INTEGRATIONS_LEADCONDUIT_ENABLED`. Keep the legacy schema field, fixed false in examples/CI, only until Task 5 removes the old scheduled reader so this intermediate commit still typechecks. Split generic-webhook eligibility from read vendors and explicitly reject `leadconduit` in `src/app/api/integrations/[vendor]/route.ts`; enabling polling must never activate the unsafe primary-company generic POST route. Use `superRefine` so only an enabled capability requires its own credentials. `getLeadConduitFlowBinding` must map the URL slug to a compile-time flow name, environment flow ID, and that flow's six capability booleans; it must never accept company or flow identity from request data.

Preserve the existing `vendors` booleans for LeadMaster, JobNimbus, and CallTools, and add this LeadConduit capability block; expose no secrets or identifiers:

```ts
{
  status: "ok",
  vendors: { leadconduit: false, leadmaster: false, jobnimbus: false, calltools: false },
  leadconduit: {
    probe: false,
    roofing: { shadowImport: false, polling: false, receipt: false, processing: false, rescueRecommendations: false, rescueActions: false },
    virtualQuote: { shadowImport: false, polling: false, receipt: false, processing: false, rescueRecommendations: false, rescueActions: false },
  },
}
```

Set every new value to `"false"` in the CI production-build environment. Add empty secret/config entries and explanatory comments to `.env.example`; never use a `NEXT_PUBLIC_` prefix.

- [ ] **Step 4: Run focused tests and static secret checks**

```bash
npm run test:run -- src/lib/env/shared.test.ts src/lib/integrations/flags.test.ts src/modules/access-route/leadconduit-config.test.ts src/app/api/integrations/health/route.test.ts 'src/app/api/integrations/[vendor]/route.test.ts'
! rg -n 'NEXT_PUBLIC_.*(LEADCONDUIT|ACTIVEPROSPECT)' src .env.example .github
npm run typecheck
```

Expected: PASS; health JSON contains no token, company ID, flow ID, or credential-presence field.

- [ ] **Step 5: Commit capability isolation**

```bash
git add .env.example .github/workflows/ci.yml src/lib/env/server.ts src/lib/env/shared.test.ts src/lib/integrations/flags.ts src/lib/integrations/flags.test.ts src/modules/access-route/leadconduit-config.ts src/modules/access-route/leadconduit-config.test.ts src/app/api/integrations/health/route.ts src/app/api/integrations/health/route.test.ts 'src/app/api/integrations/[vendor]/route.ts' 'src/app/api/integrations/[vendor]/route.test.ts'
git commit -m "feat: isolate LeadConduit capabilities by flow"
```

### Task 2: GET-only LeadConduit discovery client and sanitized probe

**Files:**
- Modify: `src/modules/access-route/http.ts`
- Modify: `src/modules/access-route/vendors.ts`
- Modify: `src/modules/access-route/vendors.test.ts`
- Modify: `src/modules/access-route/contracts.ts`

**Interfaces:**

```ts
export type LeadConduitProbeResult = {
  ok: boolean;
  status: number;
  visibleFlowCount: number;
  approvedFlows: Array<{
    flowId: string;
    flowName: string;
    sourceCount: number;
    fieldNames: string[];
  }>;
  missingFlowNames: string[];
  errorCategory?: "authentication" | "authorization" | "rate_limit" | "upstream" | "invalid_response";
};

export type LeadConduitOperationalErrorCategory =
  | "authentication"
  | "authorization"
  | "rate_limit"
  | "upstream"
  | "invalid_response"
  | "persistence"
  | "mapping"
  | "invalid_payload"
  | "flow_mismatch"
  | "unsupported_event"
  | "retry_exhausted";

LeadConduitReadClient.probe(input: {
  approvedFlows: ReadonlyMap<string, string>;
}): Promise<LeadConduitProbeResult>;

LeadConduitReadClient.eventsPage(input: {
  flowId: string;
  start?: string;
  afterId?: string | null;
  limit: number;
}): Promise<{ rows: JsonRecord[]; cursor: string | null; hasMore: boolean }>;

LeadConduitReadClient.sourceMeta(flowId: string, sourceId: string): Promise<JsonRecord>;
LeadConduitReadClient.eventDetail(eventId: string): Promise<JsonRecord>;
```

- [ ] **Step 1: Write failing client tests**

Cover Basic auth as `API:<key>`, `GET /flows`, and a single-page `GET /events`: bootstrap sends `start` plus `sort=asc` and no `after_id`; continuation sends `after_id` plus `sort=asc` and no `start`; both send the bounded `limit` and a stringified `rules` array equal to `[{"lhv":"flow.id","op":"is equal to","rhv":"<trusted flow ID>"}]`. Reject a call with both or neither cursor selector. Also cover `GET /flows/{flow_id}/sources/{source_id}/meta` and `GET /events/{event_id}`. Assert path components are encoded, page limits are respected, `401/403` are not retried, `429/5xx` use bounded retries, and invalid JSON becomes `invalid_response`.

For the probe, assert the serialized result includes only status, counts, approved flow names/IDs, and sorted field names. Fixture lead names, emails, phones, addresses, API keys, and upstream error bodies must not occur in the result.

- [ ] **Step 2: Run the reader tests and verify RED**

```bash
npm run test:run -- src/modules/access-route/vendors.test.ts
```

Expected: FAIL because the one-page events API, metadata/detail methods, and probe contract do not exist.

- [ ] **Step 3: Implement the minimal read surface**

Keep `LeadConduitReadClient` incapable of issuing any method other than `GET`. Remove multi-page accumulation from the client; orchestration owns page-by-page persistence. The official endpoint accepts a stringified `rules` query; every event page must apply the trusted `flow.id` equality rule server-side, then defensively verify every returned row's normalized flow ID and fail closed on a mismatch. Reuse the existing bounded retry/error categorization in `http.ts`. Filter the probe's flow array against the configured ID/name map before reading or returning metadata.

- [ ] **Step 4: Run focused tests and the no-write static gate**

```bash
npm run test:run -- src/modules/access-route/vendors.test.ts
! rg -n 'method:.*(POST|PUT|PATCH|DELETE)' src/modules/access-route/vendors.ts
```

Expected: PASS; every recorded request method is `GET`.

- [ ] **Step 5: Commit the read client**

```bash
git add src/modules/access-route/http.ts src/modules/access-route/vendors.ts src/modules/access-route/vendors.test.ts src/modules/access-route/contracts.ts
git commit -m "feat: add bounded LeadConduit discovery client"
```

### Task 3: Tenant-safe vendor identity and event provenance

**Files:**
- Create with CLI: one migration generated by `npx supabase migration new activeprospect_access_route`
- Create: `supabase/tests/activeprospect-access-route.test.sql`
- Create: `supabase/tests/lead-vendor-sourcing.test.sql`
- Create: `src/integration/leadconduit-foundation.integration.test.ts`
- Modify: `src/lib/database.types.ts`
- Modify: `src/modules/access-route/contracts.ts`
- Modify: `src/modules/access-route/normalize.ts`
- Modify: `src/modules/access-route/normalize.test.ts`
- Modify: `src/modules/access-route/repository.ts`
- Create: `src/modules/access-route/repository.test.ts`

- [ ] **Step 1: Generate the migration and write failing pgTAP/unit tests**

Run exactly:

```bash
npx supabase migration new activeprospect_access_route
```

Use the exact timestamped path printed by the CLI for every migration edit and commit in this task.

Tests must prove:

- `leads_source_external_id_idx` is unique on `(company_id, source_system, external_lead_id)` when the external ID is non-null.
- The same vendor external ID can create one lead in Tenant A and one in Tenant B.
- Same-tenant replay returns the original lead/property/pipeline IDs without orphan properties. A real two-client integration test, not sequential pgTAP calls, proves concurrent replay.
- Every duplicate lookup in `submit_lead_intake_from_source` includes `company_id`.
- `leadconduit_events` remains unique on `(company_id, event_id)` and has a composite `(company_id, id)` key for tenant-safe foreign keys.
- `leadconduit_source_metadata` is unique on `(company_id, flow_id, source_id)`, readable only by the matching tenant, and writable only by the service role.
- Normalized flow-step and rule snapshots preserve exact IDs/scopes so policy provisioning never parses `raw_payload`.
- Webhook then poll, and poll then webhook, preserve one logical event, the earliest first-observed time, both ingestion channels, and separate webhook/poll timestamps.
- Authenticated users have tenant-scoped read-only access; anonymous/authenticated callers cannot ingest.
- A real two-user integration test proves Tenant A cannot select Tenant B's flows, source metadata, events, existing `integration_events`, or lead identity. Explicit delivery-receipt isolation is added when that table is created in Task 9.

- [ ] **Step 2: Run database and normalizer tests and verify RED**

```bash
npm run db:reset
npx supabase test db supabase/tests/lead-vendor-sourcing.test.sql supabase/tests/activeprospect-access-route.test.sql
npm run test:run -- src/modules/access-route/normalize.test.ts src/modules/access-route/repository.test.ts
RUN_SUPABASE_INTEGRATION=1 npm run test:run -- src/integration/leadconduit-foundation.integration.test.ts
```

Expected: FAIL because company-scoped vendor identity, event provenance columns, and merge behavior do not exist.

- [ ] **Step 3: Implement the database hardening and immutable normalized event shape**

The generated migration must:

1. Replace the vendor-lead unique index with `(company_id, source_system, external_lead_id)`.
2. Replace `submit_lead_intake_from_source` without changing its public signature. For non-null external IDs only, acquire a transaction-scoped advisory lock from a deterministic hash of `(company_id, source_system, external_lead_id)`, then re-query the tenant-scoped lead and pipeline after the lock. Null external IDs remain distinct submissions.
3. Extend `leadconduit_events` with:

```text
step_id text
step_name text
rule_id text
rule_name text
rule_scope text
rule_scope_id text
reason_category text
lead_name text
submitted_phone text
submitted_email text
submitted_address text
campaign text
consent_reference text
trustedform_url text
attribution jsonb not null default '{}'
ingestion_channels text[] not null default '{}'
first_observed_at timestamptz
webhook_received_at timestamptz
poll_observed_at timestamptz
processing_status text not null default 'observed'
piw_lead_id uuid null references leads(id)
processing_error_category text
processing_attempts integer not null default 0
processing_claimed_at timestamptz
processing_claimed_by text
processing_next_attempt_at timestamptz
```

Backfill every pre-existing LeadConduit row as a known poll observation: `ingestion_channels={'poll'}`, `poll_observed_at=ingested_at`, and `first_observed_at=ingested_at`; then make `first_observed_at` non-null. Constrain ingestion channels to `webhook|poll`, prohibit duplicates in the array, and require each channel timestamp to agree with channel membership. Constrain processing status to `observed|pending|processed|failed|not_applicable`; `processed` requires `piw_lead_id`, `observed|pending` prohibit it, and failure details are limited to a sanitized category. Add nonnegative checks and indexes for pending/lease processing and flow/time queries. Add `UNIQUE (company_id, id)` to `leads` and make `leadconduit_events(company_id, piw_lead_id)` a composite foreign key to it.

4. Add `leadconduit_source_metadata` with `company_id`, `flow_id`, `source_id`, `source_name`, `field_names text[]`, `acceptance_metadata jsonb`, `raw_payload jsonb`, and `observed_at`; enforce the tenant-scoped unique key and recursively redact credential-like values.
5. Add `leadconduit_flow_steps` keyed by `(company_id, flow_id, step_id)` with step type/name/order/enabled/outcome and observed time. Add `leadconduit_flow_rules` keyed by `(company_id, flow_id, rule_scope, rule_scope_id, rule_id)`, where scope is `flow_acceptance|source_acceptance|filter_step` and scope ID is the exact flow/source/step ID. Store rule name/LHV/operator and observed time; policy code consumes these typed rows, never flow raw JSON.
6. Add a service-role-only `upsert_leadconduit_event_batch(p_company_id, p_events, p_channel, p_observed_at)` RPC. Ignore/reject tenant, processing-state, claim, and PIW-lead fields supplied inside `p_events`. On conflict it may fill previously-null normalized source fields and union observation metadata, but it must not replace identity, non-null vendor outcome/reason, evidence, or original raw payload. `first_observed_at` is the minimum, while channel timestamps are their earliest observations.
7. Preserve the existing explicit RLS/revoke/grant pattern and add no authenticated write policy.

Update `LeadConduitEventRow`; add `LeadConduitSourceMetadataRow`, `LeadConduitFlowStepRow`, and `LeadConduitFlowRuleRow`; and implement their normalizers/repository methods. Redact credential-like keys recursively, but do not make downstream code depend on ad hoc paths in `raw_payload`.

For every LeadConduit-created PIW lead, the canonical vendor dedupe key is `source_system='leadconduit'` plus the required LeadConduit `lead_id`. The optional payload `lead.external_id` is attribution evidence only and must never replace the canonical dedupe key; retain it in the event attribution snapshot.

- [ ] **Step 4: Regenerate types and verify GREEN**

```bash
npm run db:reset
npx supabase test db supabase/tests/lead-vendor-sourcing.test.sql supabase/tests/activeprospect-access-route.test.sql
npx supabase gen types typescript --local --schema public > src/lib/database.types.ts
npm run test:run -- src/modules/access-route/normalize.test.ts src/modules/access-route/repository.test.ts
RUN_SUPABASE_INTEGRATION=1 npm run test:run -- src/integration/leadconduit-foundation.integration.test.ts
npm run typecheck
```

Expected: PASS; same external ID across two companies never crosses tenant scope.

- [ ] **Step 5: Commit the foundation migration**

Stage the exact generated migration path, both pgTAP files, and the named TypeScript files, then commit:

```bash
git commit -m "fix: scope LeadConduit identity and event provenance"
```

### Task 4: Authenticated capped shadow import

**Files:**
- Create: `src/modules/access-route/leadconduit-shadow-import.ts`
- Create: `src/modules/access-route/leadconduit-shadow-import.test.ts`
- Modify: `src/app/(app)/access-route/[system]/action-handlers.ts`
- Modify: `src/app/(app)/access-route/[system]/actions.ts`
- Modify: `src/app/(app)/access-route/[system]/actions.test.ts`
- Create: `src/app/(app)/access-route/[system]/leadconduit-connection-panel.tsx`
- Create: `src/app/(app)/access-route/[system]/leadconduit-connection-panel.test.tsx`
- Modify: `src/app/(app)/access-route/[system]/page.tsx`
- Modify after discovery: `src/modules/access-route/normalize.test.ts`
- Create after discovery: `src/modules/access-route/fixtures/leadconduit-roofing.sanitized.json`
- Create after discovery: `src/modules/access-route/fixtures/leadconduit-roofing-virtual-quote.sanitized.json`

**Interfaces:**

```ts
export type LeadConduitShadowResult = {
  outcome: "succeeded" | "failed";
  flowSlug: LeadConduitFlowSlug;
  flowSeen: boolean;
  sourceMetadataSeen: number;
  eventsSeen: number;
  eventsWritten: number;
  nextCursor: string | null;
  errorCategory?: string;
};

export async function importLeadConduitShadow(input: {
  companyId: string;
  flowSlug: LeadConduitFlowSlug;
  environment: LeadConduitReadEnvironment;
  repository: AccessRouteRepository;
  fetcher?: typeof fetch;
  now?: Date;
}): Promise<LeadConduitShadowResult>;
```

- [ ] **Step 1: Write failing service, action, and component tests**

Cover unauthenticated rejection, server-derived `admin_profiles.company_id`, probe-flag denial, per-flow import-flag denial, both expected flows present, only the selected approved flow's rows/events persisted, source metadata GETs, normalized flow-step/rule upserts with exact IDs and scopes, failed probe preventing import writes, schedule remaining disabled, and sync metadata `{ mode: "shadow", read_only: true, flow_slug }`. The standalone probe itself must persist a sanitized `leadconduit:probe:<ISO timestamp>` sync run containing only status, counts, approved flow names, and field-name lists so it survives page reload. Prove the `flow.id` server-side rule is present and the service rejects an unexpected-flow row before persistence. Prove shadow limits default to and can never exceed 50 events/one page, even when polling is configured for 1000 events/25 pages. Run the action once per flow; each result must contain that flow's event count, or a documented zero-event window for that flow.

The component must reveal the import button only after a successful probe and render only status, counts, approved flow names, and field-name lists. Assert fixture homeowner values do not appear in rendered HTML or action state.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm run test:run -- src/modules/access-route/leadconduit-shadow-import.test.ts 'src/app/(app)/access-route/[system]/actions.test.ts' 'src/app/(app)/access-route/[system]/leadconduit-connection-panel.test.tsx'
```

Expected: FAIL because the shadow service and LeadConduit controls do not exist.

- [ ] **Step 3: Implement the shadow path**

Mirror the JobNimbus canary's authenticated action/service pattern, but expose two server-defined buttons keyed only by `LeadConduitFlowSlug`. The action must ignore any submitted company or flow ID and resolve the binding server-side. Persist standalone probe status in its sanitized sync run. Each import begins `leadconduit:shadow:<flow_slug>:<ISO timestamp>`, probes, stores that filtered flow snapshot and source metadata, normalizes/upserts the flow's exact step and rule rows into `leadconduit_flow_steps` and `leadconduit_flow_rules`, reads at most the shadow cap, and persists its filtered page with channel `poll` before returning its cursor. It must not create a PIW lead, rescue case, or scheduled job.

After the first successful sample from each flow, stop before Task 5. Create one credential-redacted, customer-synthetic fixture per flow that preserves the observed key/type/status/step/rule shape, add the fixtures to `normalize.test.ts`, and have the flow owner confirm the exact source/event/outcome/field mapping. Polling, rescue, and processing flags remain false until both fixtures pass and the mapping checkpoint is recorded in the rollout evidence.

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
npm run test:run -- src/modules/access-route/leadconduit-shadow-import.test.ts 'src/app/(app)/access-route/[system]/actions.test.ts' 'src/app/(app)/access-route/[system]/leadconduit-connection-panel.test.tsx'
npm run test:run -- src/modules/access-route/normalize.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit shadow discovery**

```bash
git add src/modules/access-route/leadconduit-shadow-import.ts src/modules/access-route/leadconduit-shadow-import.test.ts src/modules/access-route/normalize.test.ts src/modules/access-route/fixtures/leadconduit-roofing.sanitized.json src/modules/access-route/fixtures/leadconduit-roofing-virtual-quote.sanitized.json 'src/app/(app)/access-route/[system]/action-handlers.ts' 'src/app/(app)/access-route/[system]/actions.ts' 'src/app/(app)/access-route/[system]/actions.test.ts' 'src/app/(app)/access-route/[system]/leadconduit-connection-panel.tsx' 'src/app/(app)/access-route/[system]/leadconduit-connection-panel.test.tsx' 'src/app/(app)/access-route/[system]/page.tsx'
git commit -m "feat: add LeadConduit shadow import"
```

### Task 5: Five-minute page-checkpointed reconciliation

**Files:**
- Create with CLI: one migration generated by `npx supabase migration new leadconduit_poll_checkpoints`
- Modify: `supabase/tests/activeprospect-access-route.test.sql`
- Modify: `.env.example`
- Modify: `.github/workflows/ci.yml`
- Modify: `src/lib/database.types.ts`
- Modify: `src/lib/env/server.ts`
- Modify: `src/lib/env/shared.test.ts`
- Modify: `src/lib/integrations/flags.ts`
- Modify: `src/lib/integrations/flags.test.ts`
- Modify: `src/modules/access-route/contracts.ts`
- Modify: `src/modules/access-route/repository.ts`
- Modify: `src/modules/access-route/run.ts`
- Create: `src/modules/access-route/run.test.ts`
- Create: `src/modules/access-route/leadconduit-poll.ts`
- Create: `src/modules/access-route/leadconduit-poll.test.ts`
- Create: `src/inngest/functions/leadconduit-reconciliation-sync.ts`
- Create: `src/inngest/functions/leadconduit-reconciliation-sync.test.ts`
- Modify: `src/inngest/functions/access-route-read-sync.ts`
- Modify: `src/app/api/inngest/route.ts`

**Interfaces:**

```ts
export async function runLeadConduitPoll(input: {
  flowSlug: LeadConduitFlowSlug;
  binding: LeadConduitFlowBinding;
  environment: LeadConduitReadEnvironment;
  repository: AccessRouteRepository;
  fetcher?: typeof fetch;
  now?: Date;
}): Promise<{
  outcome: "succeeded" | "partial" | "failed" | "skipped";
  pagesPersisted: number;
  recordsSeen: number;
  recordsWritten: number;
  nextCursor: string | null;
  errorCategory?: string;
}>;
```

- [ ] **Step 1: Generate the checkpoint migration and write failing poll/schedule tests**

Run:

```bash
npx supabase migration new leadconduit_poll_checkpoints
```

Use the exact printed migration path. The pgTAP contract covers tenant/flow lease uniqueness, acquire/renew/release privileges, ten-minute expiry, persisted bootstrap start/cursor, monotonic checkpoint generation, and rejection of an older worker's out-of-order checkpoint.

Prove a five-minute slot key rounds to `00,05,10,...,55`; each flow has its own `leadconduit:poll:<flow_slug>:` run/cursor; the old 30-minute function no longer includes LeadConduit; the new Inngest function ID is `leadconduit-reconciliation-sync`, uses `TZ=America/New_York */5 * * * *`, and has two Inngest retries. A database-backed per-flow lease prevents overlap across slots: any active run younger than ten minutes causes the next slot to skip; an expired lease, failed run, or partial run resumes from the last durable checkpoint. Prove this with an active prior-slot run and an out-of-order completion attempt. Persist the exact bootstrap `start` in the run before page one; a delayed retry after first-page failure must reuse that original timestamp rather than recompute a later lookback. Prove unapproved/other-flow rows are rejected before repository calls; each page is persisted before the next request; cursor advances only after persistence; a second-page failure returns `partial` with the first page's cursor; a first-page failure returns `failed`; and auth/rate-limit/upstream errors create one failed sync run, not per-lead records. A shadow cursor never seeds polling, and enabling one flow's poll flag never stores or advances the other flow.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm run db:reset
npx supabase test db supabase/tests/activeprospect-access-route.test.sql
npm run test:run -- src/lib/env/shared.test.ts src/lib/integrations/flags.test.ts src/modules/access-route/run.test.ts src/modules/access-route/leadconduit-poll.test.ts src/inngest/functions/leadconduit-reconciliation-sync.test.ts
```

Expected: FAIL because the dedicated poller, five-minute key, and cron do not exist.

- [ ] **Step 3: Implement the dedicated poller**

Do not merely edit the cron. Remove LeadConduit from `runAccessRouteSync` so LeadMaster and JobNimbus remain on their existing 30-minute cadence, then remove the legacy `INTEGRATIONS_LEADCONDUIT_ENABLED` environment field and all runtime use from `.env.example`, CI, server schema, and integration flag helpers/tests. Add repository/RPC methods to acquire/renew/release one per-company/per-flow poll lease, begin-or-resume a flow run, reject stale/out-of-order checkpoints, and load only that flow's latest `leadconduit:poll:<flow_slug>:` cursor/bootstrap start; shadow runs remain `leadconduit:shadow:<flow_slug>:` and are never eligible. The Inngest function resolves a trusted `LeadConduitFlowBinding` from server environment and launches one isolated poll per enabled flow. Each poll verifies that the binding matches `flowSlug`, company, and expected flow ID; it never derives identity from an event or request. Each poll computes and persists `LEADCONDUIT_INITIAL_LOOKBACK_MINUTES` once when its own cursor/bootstrap does not exist, reuses that start until the first durable cursor, reads at most the configured pages with the server-side flow rule, normalizes and verifies one page for that single flow, persists it, checkpoints counts/cursor, then requests the next page. Register the new Inngest function in `src/app/api/inngest/route.ts`.

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
npm run db:reset
npx supabase test db supabase/tests/activeprospect-access-route.test.sql
npx supabase gen types typescript --local --schema public > src/lib/database.types.ts
npm run test:run -- src/lib/env/shared.test.ts src/lib/integrations/flags.test.ts src/modules/access-route/run.test.ts src/modules/access-route/leadconduit-poll.test.ts src/inngest/functions/leadconduit-reconciliation-sync.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit five-minute reconciliation**

Stage the exact generated migration and named files, then commit:

```bash
git commit -m "feat: reconcile LeadConduit every five minutes"
```

### Task 6: Deny-by-default rescue policies, cases, and classifier

**Files:**
- Create with CLI: one migration generated by `npx supabase migration new leadconduit_rescue_workflow`
- Create: `supabase/tests/leadconduit-rescue-workflow.test.sql`
- Modify: `src/lib/database.types.ts`
- Create: `src/modules/access-route/rescue/contracts.ts`
- Create: `src/modules/access-route/rescue/classify-rejection.ts`
- Create: `src/modules/access-route/rescue/classify-rejection.test.ts`
- Create: `src/modules/access-route/rescue/repository.ts`
- Create: `src/modules/access-route/rescue/repository.test.ts`
- Create: `src/modules/access-route/rescue/backfill-cases.ts`
- Create: `src/modules/access-route/rescue/backfill-cases.test.ts`
- Create: `src/modules/access-route/rescue/policy-manifest.ts`
- Create: `src/modules/access-route/rescue/policy-manifest.test.ts`
- Create: `scripts/provision-leadconduit-rescue-policies.ts`
- Create: `src/inngest/functions/leadconduit-rescue-backfill.ts`
- Create: `src/inngest/functions/leadconduit-rescue-backfill.test.ts`
- Modify: `src/app/api/inngest/route.ts`
- Modify: `src/modules/access-route/leadconduit-poll.ts`
- Modify: `src/modules/access-route/leadconduit-poll.test.ts`

**Classifier contract:**

```ts
export type RescueClassification =
  | {
      kind: "candidate";
      category: "address_normalization" | "service_boundary" | "correctable_data" | "delivery_error" | "property_conflict";
      rationale: string;
      evidence: Record<string, unknown>;
      confidence: number;
      recommendedAction: "verify_address" | "confirm_serviceability" | "correct_data" | "verify_delivery" | "review_property_evidence";
      recommendedDecision: "rescue_to_piw" | "needs_information";
    }
  | { kind: "excluded"; reason: "consent" | "suppression_dnc" | "fraud" | "prohibited_source" | "client_blocklist" | "confirmed_duplicate" | "client_exclusion" | "unknown_rule" }
  | { kind: "incident"; category: "authentication" | "authorization" | "rate_limit" | "upstream" };
```

- [ ] **Step 1: Generate the migration and write failing schema/classifier tests**

Run:

```bash
npx supabase migration new leadconduit_rescue_workflow
```

Use the exact printed migration path. Define tests for these records:

- `leadconduit_rescue_policy_sets`: one current integer revision per company/flow, advanced explicitly whenever the flow owner changes approved rules.
- `leadconduit_rescue_policies`: company, flow ID, policy-set revision, `match_kind rule|step_outcome`, exact rule scope/scope ID/rule ID for rule matches, or exact step ID/event type/outcome for step-outcome matches, display names, disposition `candidate|excluded`, category, recommendation/decision, active flag, audit timestamps. Rule matches require all typed rule identity fields and prohibit step-outcome fields; step-outcome matches require step/event/outcome and prohibit rule identity. Use separate partial unique indexes for the two key shapes.
- `leadconduit_rescue_assessments`: immutable event/revision result `candidate|excluded|incident`, sanitized reason/category, and assessed time; unique `(company_id, stopping_event_id, policy_revision)`.
- `leadconduit_rescue_cases`: tenant-safe source/stopping event and exact assessment references, immutable policy revision, state `observed|candidate|under_review|rescued_to_piw|not_rescuable|needs_information`, category, stopping rule, original reason, rationale, evidence, confidence `0..100`, recommendation/decision, timestamps; unique `(company_id, stopping_event_id)`.
- `leadconduit_rescue_decisions`: company/case/reviewer, decision, required reason code, optional note, allowlisted corrected-fields object, immutable decision time, and one decision per case.
- `leadconduit_rescue_lead_links`: unique case, unique PIW lead, pipeline run, and tenant-safe lineage.

Classifier tests must establish precedence: hard exclusions beat a misconfigured candidate policy; systemic failures are incidents; an exact active rule policy can classify a filter/acceptance rejection; an exact step-outcome policy can classify a lead-specific delivery/retry error with no rule ID; an inactive, missing, or unknown policy is excluded as `unknown_rule`; an account-wide failure creates no case. Backfill tests must prove a rejection imported during shadow becomes a candidate after its flow's rescue flag and exact policy are enabled, without refetching the vendor page or rewinding the poll cursor; repeated backfills do not replace evidence or duplicate cases. More than 100 excluded events followed by a candidate must make progress over successive batches, and incrementing the policy-set revision must intentionally reassess history under the new policy without changing prior assessments/cases.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm run db:reset
npx supabase test db supabase/tests/leadconduit-rescue-workflow.test.sql
npm run test:run -- src/modules/access-route/rescue/classify-rejection.test.ts src/modules/access-route/rescue/repository.test.ts src/modules/access-route/rescue/backfill-cases.test.ts src/modules/access-route/rescue/policy-manifest.test.ts src/modules/access-route/leadconduit-poll.test.ts src/inngest/functions/leadconduit-rescue-backfill.test.ts
```

Expected: FAIL because the rescue schema and classifier do not exist.

- [ ] **Step 3: Implement schema, RLS, and classification**

Use explicit RLS: service role writes; authenticated users read only their `current_company_id()`; anonymous users receive nothing. Add leading indexes for every foreign key and queue predicate. Do not widen `review_tasks`, which requires a lead/property/pipeline before a rescue decision exists.

The classifier must require either an exact active `(flow, rule_scope, rule_scope_id, rule_id)` policy key or an exact active `(flow, step_id, event_type, outcome)` policy key and then apply the hard exclusions again in code. When the matching flow's rescue-recommendation flag is true, an idempotent service-only database operation inserts the immutable assessment/event as `observed`, then promotes it to `candidate` with classifier evidence and recommended decision; a crash between those steps leaves an `observed` row for the independent backfill to resume. The case links tenant-safely to that exact immutable assessment and policy revision. Conflict handling may never replace original event identity or evidence. Excluded/incident outcomes create no case and remain in assessments/events/sync diagnostics. Use a focused `LeadConduitRescueRepository`, not additional methods on the broad `AccessRouteRepository`.

Add a five-minute, per-flow, bounded backfill function that scans persisted failed/filter events lacking an assessment for the flow's current policy-set revision, plus resumable `observed` cases, independently of API cursors. It runs only for a flow whose rescue-recommendation flag is enabled, processes at most 100 rows per invocation, persists an assessment for every candidate/excluded/incident result so old exclusions cannot starve later rows, and uses the same idempotent case operation as new poll pages. Advancing the explicit policy-set revision is the only way to rescan previously assessed history. This is how historical shadow samples become reviewable after policy approval.

Use composite tenant-safe foreign keys for source event, stopping event, case, reviewer, lead, and pipeline run. Require `jsonb_typeof(corrected_fields) = 'object'`. Treat `needs_information` as terminal in this release; reopening is a later product change, not a second decision row. Explicitly revoke writes from `PUBLIC`, `anon`, and `authenticated` on every rescue table and function.

Add a service-only, audited `replace_leadconduit_rescue_policy_set(p_company_id, p_flow_id, p_expected_revision, p_manifest, p_admin_id)` RPC. It validates every exact step/rule against `leadconduit_flow_steps`/`leadconduit_flow_rules`, requires hard-exclusion rows to remain excluded, inserts a complete new revision atomically, and writes only IDs/counts/revision to `audit_log`. The operator script accepts `--flow roofing|roofing-virtual-quote`, `--manifest`, and `--dry-run`; it derives company/flow from server environment, validates the manifest with `policy-manifest.ts`, and prints IDs/counts only. A dry run performs no writes. Applying or deactivating policies always creates a new revision, so rollback is an audited revision change rather than destructive deletion.

The manifest is exactly `{ schemaVersion: 1, expectedRevision: number, policies: [...] }`; every policy includes match kind and its required exact key, disposition, category, recommendation, recommended decision, and active boolean. The runbook sets the task-specific absolute path in `PIW_LEADCONDUIT_POLICY_MANIFEST` and uses:

```bash
node --experimental-strip-types scripts/provision-leadconduit-rescue-policies.ts --flow roofing --manifest "$PIW_LEADCONDUIT_POLICY_MANIFEST" --dry-run
node --experimental-strip-types scripts/provision-leadconduit-rescue-policies.ts --flow roofing --manifest "$PIW_LEADCONDUIT_POLICY_MANIFEST"
```

- [ ] **Step 4: Regenerate types and verify GREEN**

```bash
npm run db:reset
npx supabase test db supabase/tests/leadconduit-rescue-workflow.test.sql
npx supabase gen types typescript --local --schema public > src/lib/database.types.ts
npm run test:run -- src/modules/access-route/rescue/classify-rejection.test.ts src/modules/access-route/rescue/repository.test.ts src/modules/access-route/rescue/backfill-cases.test.ts src/modules/access-route/rescue/policy-manifest.test.ts src/modules/access-route/leadconduit-poll.test.ts src/inngest/functions/leadconduit-rescue-backfill.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit rescue classification**

Stage the exact generated migration and named files, then commit:

```bash
git commit -m "feat: classify LeadConduit rescue candidates"
```

### Task 7: Atomic human rescue decision and PIW lead creation

**Files:**
- Create with CLI: one migration generated by `npx supabase migration new leadconduit_rescue_decision`
- Modify: `supabase/tests/leadconduit-rescue-workflow.test.sql`
- Modify: `src/lib/database.types.ts`
- Modify: `src/domain/events.ts`
- Modify: `src/domain/events.test.ts`
- Create: `src/integration/leadconduit-rescue-approval.integration.test.ts`

**RPC:**

```sql
resolve_leadconduit_rescue_case(
  p_company_id uuid,
  p_rescue_case_id uuid,
  p_admin_id uuid,
  p_decision text,
  p_reason_code text,
  p_note text,
  p_corrected_fields jsonb
)
```

Return `new_status, decision_id, lead_id, property_id, pipeline_run_id, correlation_id`.

- [ ] **Step 1: Generate the migration and write failing atomicity tests**

Run:

```bash
npx supabase migration new leadconduit_rescue_decision
```

Use the exact printed migration path. Test wrong-company case/admin rejection; blank reason rejection; decision/reason compatibility; excluded/non-candidate denial; same-action replay returning identical IDs; conflicting terminal action failure; forced downstream failure rolling back case, decision, lead, link, audit, domain event, and outbox; and no lead for `do_not_rescue` or `needs_information`.

Exact decisions are `rescue_to_piw|do_not_rescue|needs_information`. Exact structured reasons are:

```text
verified_address
confirmed_serviceability
corrected_data
resolved_delivery_error
property_evidence
confirmed_non_rescuable
insufficient_evidence
more_information_required
```

Corrected keys are limited to `name`, `phone`, `email`, `submitted_address`, and `campaign`.

Decision/reason compatibility is exact: `rescue_to_piw` accepts `verified_address|confirmed_serviceability|corrected_data|resolved_delivery_error|property_evidence`; `do_not_rescue` accepts `confirmed_non_rescuable|insufficient_evidence`; `needs_information` accepts only `more_information_required`.

- [ ] **Step 2: Run atomic tests and verify RED**

```bash
npm run db:reset
npx supabase test db supabase/tests/leadconduit-rescue-workflow.test.sql
RUN_SUPABASE_INTEGRATION=1 npm run test:run -- src/integration/leadconduit-rescue-approval.integration.test.ts src/domain/events.test.ts
```

Expected: FAIL because the resolver, manual-hold state, and rescue event provenance do not exist.

- [ ] **Step 3: Implement the transactional resolver**

Define the RPC as `SECURITY INVOKER`, revoke execute from `PUBLIC`, `anon`, and `authenticated`, and grant it only to `service_role`. It must lock the case, validate company/admin scope, accept only `under_review`, reapply the hard-exclusion rules from immutable event/case/policy data inside SQL, validate the decision/reason matrix before side effects, and make terminal replay idempotent. A same-decision replay returns the original IDs without changing reason, corrections, note, or evidence; a different terminal action fails.

For `rescue_to_piw`, merge only allowlisted corrected fields over immutable typed event fields and validate the merged record in SQL: JSON object type, maximum lengths, valid email, normalized phone/email recomputed from corrected values, and nonblank name/phone/email/address. Call the tenant-hardened vendor intake logic; create the decision, rescue link, audit row, and existing `crm/lead.submitted` domain event/outbox row in the same transaction; then set the case terminal. If vendor intake reports a pre-existing lead but this case has no rescue link, abort with a sanitized `confirmed_duplicate` conflict and create nothing; do not mutate or silently attach an unrelated existing lead.

Extend `leads_speed_to_lead_status_check` with `manual_hold` and set rescued leads to it before enqueueing. Enqueue `crm/lead.submitted` only when this transaction created the lead. Do not create `lead_consents`, tasks, speed-to-lead events, or vendor delivery records. Extend `leadSubmittedDataSchema` with optional `rescueCaseId` and `leadconduitEventRowId` UUIDs so the SQL-built event uses the internal event row identity and parses through `eventEnvelopeSchema`; the vendor event ID remains bounded text in its own database field. Audit only action, status, and structured reason; never copy notes or corrected/customer values into `audit_log.metadata`.

- [ ] **Step 4: Regenerate types and verify GREEN**

```bash
npm run db:reset
npx supabase test db supabase/tests/leadconduit-rescue-workflow.test.sql
npx supabase gen types typescript --local --schema public > src/lib/database.types.ts
RUN_SUPABASE_INTEGRATION=1 npm run test:run -- src/integration/leadconduit-rescue-approval.integration.test.ts src/domain/events.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit atomic rescue decisions**

Stage the exact generated migration and named files, then commit:

```bash
git commit -m "feat: add atomic LeadConduit rescue decisions"
```

### Task 8: Human review UI and reporting-only learning loop

**Files:**
- Modify: `src/app/(app)/review/page.tsx`
- Modify: `src/app/(app)/review/page.test.tsx`
- Move: `src/app/(app)/review/[reviewTaskId]/review-submit-button.tsx` to `src/app/(app)/review/review-submit-button.tsx`
- Modify: `src/app/(app)/review/[reviewTaskId]/page.tsx`
- Create: `src/app/(app)/review/rescues/[rescueCaseId]/page.tsx`
- Create: `src/app/(app)/review/rescues/[rescueCaseId]/page.test.tsx`
- Create: `src/app/(app)/review/rescues/[rescueCaseId]/rescue-actions.ts`
- Create: `src/app/(app)/review/rescues/[rescueCaseId]/rescue-action-service.ts`
- Create: `src/app/(app)/review/rescues/[rescueCaseId]/rescue-action-service.test.ts`
- Create: `src/app/(app)/review/rescues/[rescueCaseId]/rescue-form-data.ts`
- Create: `src/app/(app)/review/rescues/[rescueCaseId]/rescue-form-data.test.ts`
- Create: `src/integration/leadconduit-rescue-rls.integration.test.ts`
- Create with CLI: one migration generated by `npx supabase migration new leadconduit_rescue_learning_view`
- Modify: `supabase/tests/leadconduit-rescue-workflow.test.sql`
- Modify: `src/lib/database.types.ts`

- [ ] **Step 1: Write failing queue, detail, action, and learning-view tests**

The `/review` page keeps property reviews and adds a distinct `Lead rescue candidates` section. The rescue detail renders exactly `Why it stopped`, `Why it may be rescuable`, and `Recommended next step`, plus the three decisions. Structured reason is mandatory; note is optional; corrections use strict allowlisted fields.

Action tests must authenticate, derive company/admin from `admin_profiles`, deny server-side unless that case's flow-specific rescue-action flag is enabled, ignore submitted tenant/flow IDs, call the RPC once, and map database failures to safe codes without raw SQL text. Add an explicit `Start review` action backed by an atomic service-only operation that changes `candidate` to `under_review`; resolution is unavailable until that succeeds. A real authenticated integration test—not only mocked page data—must prove Tenant A cannot query, begin, or resolve Tenant B's case.

Generate the learning-view migration with:

```bash
npx supabase migration new leadconduit_rescue_learning_view
```

Use the exact printed path. The security-invoker detail view exposes exactly one row per rescue case. Use lateral/latest-row subqueries or `exists` aggregates so appointment and stage history cannot multiply rows. Define current stage as the latest `lead_stage_history.to_stage`; contacted as `leads.contacted_at is not null`; appointment as the latest tenant-scoped appointment status; won/lost from the latest canonical stage; duplicate from the linked property's resolution state; and downstream value only from matched `jobnimbus_jobs.sold_value` (null when no confirmed JobNimbus value exists). Expose flow/category/rule, recommendation, recommended decision, reviewer decision, corrected field keys only, and aggregate dates—but no names, phones, emails, addresses, notes, corrected values, or raw payloads.

Name the one-row detail view `leadconduit_rescue_learning` and the aggregate view `leadconduit_rescue_learning_metrics`. The metrics view provides review volume, decided volume, rescue rate, recommendation-agreement rate (`decision = recommended_decision`), corrected-field-key counts, appointment rate, and downstream value by flow/filter category. Both views use `security_invoker=true`, revoke all from anonymous/public roles, grant tenant-scoped authenticated select only, and have cross-tenant integration tests. Tests must use one-to-many stage/appointment fixtures and prove counts remain correct.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm run db:reset
npx supabase test db supabase/tests/leadconduit-rescue-workflow.test.sql
npm run test:run -- 'src/app/(app)/review/page.test.tsx' 'src/app/(app)/review/rescues/[rescueCaseId]/page.test.tsx' 'src/app/(app)/review/rescues/[rescueCaseId]/rescue-action-service.test.ts' 'src/app/(app)/review/rescues/[rescueCaseId]/rescue-form-data.test.ts'
RUN_SUPABASE_INTEGRATION=1 npm run test:run -- src/integration/leadconduit-rescue-rls.integration.test.ts
```

- [ ] **Step 3: Implement the review experience and projection**

Follow the existing property-review authentication and redirect patterns. Only the detail page may render relevant customer values, and only through authenticated tenant-scoped queries. Redirect a successful rescue to the created PIW lead; return other decisions to `/review`.

Create `leadconduit_rescue_learning` and `leadconduit_rescue_learning_metrics` with the exact security/grant contract above. Verify both views and every underlying table enforce RLS. They are read/reporting only: no trigger, retraining, threshold update, automatic policy change, auto-approval, or vendor write.

- [ ] **Step 4: Regenerate types and verify GREEN**

```bash
npm run db:reset
npx supabase test db supabase/tests/leadconduit-rescue-workflow.test.sql
npx supabase gen types typescript --local --schema public > src/lib/database.types.ts
npm run test:run -- 'src/app/(app)/review/page.test.tsx' 'src/app/(app)/review/rescues/[rescueCaseId]/page.test.tsx' 'src/app/(app)/review/rescues/[rescueCaseId]/rescue-action-service.test.ts' 'src/app/(app)/review/rescues/[rescueCaseId]/rescue-form-data.test.ts'
RUN_SUPABASE_INTEGRATION=1 npm run test:run -- src/integration/leadconduit-rescue-rls.integration.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit review and learning UI**

Stage the exact generated migration and named files, then commit:

```bash
git commit -m "feat: add human LeadConduit rescue review"
```

### Task 9: Flow-bound real-time receipt endpoints

**Files:**
- Create with CLI: one migration generated by `npx supabase migration new leadconduit_delivery_receipts`
- Modify: `supabase/tests/activeprospect-access-route.test.sql`
- Modify: `src/lib/database.types.ts`
- Create: `src/modules/access-route/leadconduit-webhook.ts`
- Create: `src/modules/access-route/leadconduit-webhook.test.ts`
- Create: `src/modules/integrations/record-leadconduit-delivery.ts`
- Create: `src/modules/integrations/record-leadconduit-delivery.test.ts`
- Create: `src/app/api/integrations/leadconduit/[flow]/route.ts`
- Create: `src/app/api/integrations/leadconduit/[flow]/route.test.ts`
- Create: `src/integration/leadconduit-receipt-rls.integration.test.ts`
- Modify: `src/domain/events.ts`
- Modify: `src/domain/events.test.ts`
- Modify: `src/inngest/client.ts`

**Payload contract:**

```ts
const leadConduitDeliverySchema = z.object({
  schema_version: z.literal(1),
  event_id: z.string().min(1).max(200),
  lead_id: z.string().min(1).max(200),
  flow_id: z.string().min(1).max(200),
  flow_name: z.string().min(1).max(200),
  source_id: z.string().min(1).max(200).optional(),
  source_name: z.string().min(1).max(200).optional(),
  submitted_at: z.iso.datetime(),
  is_test: z.boolean().default(false),
  lead: z.object({
    external_id: z.string().min(1).max(200).optional(),
    name: z.string().min(1).max(200),
    phone: z.string().min(1).max(50),
    email: z.email(),
    submitted_address: z.string().min(1).max(500),
    campaign: z.string().max(200).optional(),
    consent_reference: z.string().max(500).optional(),
    trustedform_url: z.url().optional(),
    attribution: z.record(z.string(), z.string().max(500)).default({}),
  }),
});
```

- [ ] **Step 1: Generate the receipt migration and write failing endpoint tests**

Run:

```bash
npx supabase migration new leadconduit_delivery_receipts
```

Use the exact printed migration path. Test:

- Correct flow token and exact configured flow ID returns `200 { outcome: "success", receipt_id }`.
- Duplicate returns `200` with the same receipt ID and no second outbox row.
- A Roofing token cannot authenticate Virtual Quote, and a flow-ID mismatch returns `401` without saying what mismatched.
- Missing/invalid fields return `400` with field/category pairs only.
- An authenticated malformed delivery also creates one sanitized diagnostic containing only request ID, flow binding, timestamp, category, and invalid field names; it stores no submitted values or raw body.
- Non-JSON content type returns `400`; more than 262144 bytes returns `413` before JSON parsing.
- Per-flow quota exhaustion returns `429` with `Retry-After` and no payload echo.
- After successful token authentication but before body streaming, every attempt consumes an atomic per-flow attempt bucket; repeated authenticated malformed/content-type/oversized requests are rate-limited and cannot flood parsing or diagnostics.
- Persistence failure returns `503 { outcome: "retry", category: "persistence" }`.
- Receiver disabled returns sanitized `503`; processing disabled still returns `200` after receipt.
- The exact public paths are `/api/integrations/leadconduit/roofing` and `/api/integrations/leadconduit/roofing-virtual-quote`.
- The receipt enqueues `integration/leadconduit.received`, not the generic `integration/event.received`; the existing generic stub must never mark a LeadConduit receipt processed.
- A two-user integration test proves Tenant A cannot select Tenant B's explicit receipt rows and neither authenticated user can insert/update/delete them.
- A duplicate is resolved before unique-delivery quota consumption, so vendor retries do not exhaust the lower delivery bucket. Every authenticated attempt still counts toward the separate higher abuse cap; duplicates below that cap return `200`, while any request beyond the abuse cap returns `429`.
- Two concurrent first deliveries of the same vendor event consume one quota unit and return the same receipt; prove this with two database clients, not sequential mocks.
- Submitted `flow_name` must exactly match the trusted binding, but authorization still comes only from path/token/configured flow ID; persistence uses the configured name.

- [ ] **Step 2: Run route/receipt tests and verify RED**

```bash
npm run db:reset
npx supabase test db supabase/tests/activeprospect-access-route.test.sql
npm run test:run -- 'src/app/api/integrations/leadconduit/[flow]/route.test.ts' src/modules/access-route/leadconduit-webhook.test.ts src/modules/integrations/record-leadconduit-delivery.test.ts src/domain/events.test.ts
RUN_SUPABASE_INTEGRATION=1 npm run test:run -- src/integration/leadconduit-receipt-rls.integration.test.ts
```

- [ ] **Step 3: Implement atomic receipt and authentication**

Do not attach the generic `src/app/api/integrations/[vendor]/route.ts`. Read the bearer header, hash candidate and expected tokens to equal-length SHA-256 buffers, and compare with `timingSafeEqual`; accept either active or next token. Check the receiver flag and binding before reading the body. Read the request stream in bounded chunks and stop as soon as 262144 bytes are exceeded; do not rely only on the untrusted `Content-Length` header or buffer an unbounded body first.

Add a typed `integration/leadconduit.received` domain event whose data is `{ integrationEventId, flowSlug }`, with idempotency key `integration/leadconduit.received:<integrationEventId>`, and register it in `src/inngest/client.ts`.

The migration must create `leadconduit_delivery_receipts` with internal receipt UUID, tenant, flow slug/ID, vendor event ID, unique integration-event link, unique domain-event link, state `received|processing|processed|retryable_error|terminal_error`, attempt count, `claimed_at`, `claimed_by`, `next_attempt_at`, vendor `submitted_at`, PIW `received_at`, `processed_at`, and sanitized error category. Enforce unique `(company_id, flow_id, vendor_event_id)`, composite tenant-safe foreign keys, RLS, service writes, and tenant-scoped authenticated reads. Create separate atomic attempt and unique-delivery minute buckets keyed by `(company_id, flow_id, bucket_start)`.

Create `leadconduit_delivery_failures` for authenticated schema/content-type/size failures with `request_id`, company, trusted flow slug/ID, HTTP status, category, `invalid_fields text[]`, and `occurred_at`. It stores no payload, submitted values, upstream body, or authorization data. Invalid authentication is not persisted. Apply the same RLS/grant model as receipts.

Add a service-only `consume_leadconduit_attempt_quota` RPC and call it immediately after valid flow-token authentication, before reading content type/body; this charges every authenticated attempt at the attempt-limit setting. The service-role-only `record_leadconduit_delivery` RPC then acquires a transaction-scoped advisory lock from a deterministic hash of `(company_id, flow_id, vendor_event_id)`, resolves/rechecks an existing receipt and repairs/ensures its domain-event/outbox association without charging the separate unique-delivery quota. For a genuinely new receipt, that same transaction atomically increments the unique-delivery bucket, inserts the tenant-scoped `integration_events` record with idempotency key `leadconduit:<flow_id>:<event_id>`, inserts the explicit receipt, and calls `enqueue_domain_event` for one `integration/leadconduit.received` event. It stores a credential-redacted payload—customer PII intentionally remains tenant-scoped for processing—and never stores authorization headers.

Route responses and logs may include request/receipt IDs and categories only.

- [ ] **Step 4: Regenerate types and verify GREEN**

```bash
npm run db:reset
npx supabase test db supabase/tests/activeprospect-access-route.test.sql
npx supabase gen types typescript --local --schema public > src/lib/database.types.ts
npm run test:run -- 'src/app/api/integrations/leadconduit/[flow]/route.test.ts' src/modules/access-route/leadconduit-webhook.test.ts src/modules/integrations/record-leadconduit-delivery.test.ts src/domain/events.test.ts
RUN_SUPABASE_INTEGRATION=1 npm run test:run -- src/integration/leadconduit-receipt-rls.integration.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit real-time receipt**

Stage the exact generated migration and named files, including `src/inngest/client.ts`, then commit:

```bash
git commit -m "feat: receipt LeadConduit deliveries by flow"
```

### Task 10: Idempotent accepted-lead processing and backlog recovery

**Files:**
- Create with CLI: one migration generated by `npx supabase migration new leadconduit_accepted_lead_processing`
- Modify: `supabase/tests/activeprospect-access-route.test.sql`
- Modify: `src/lib/database.types.ts`
- Create: `src/modules/leads/process-leadconduit-accepted-event.ts`
- Create: `src/modules/leads/process-leadconduit-accepted-event.test.ts`
- Create: `src/inngest/functions/process-leadconduit-delivery.ts`
- Create: `src/inngest/functions/process-leadconduit-delivery.test.ts`
- Create: `src/inngest/functions/process-pending-leadconduit-deliveries.ts`
- Create: `src/inngest/functions/process-pending-leadconduit-deliveries.test.ts`
- Modify: `src/inngest/functions/leadconduit-reconciliation-sync.ts`
- Modify: `src/app/api/inngest/route.ts`
- Create: `src/integration/leadconduit-ingestion.integration.test.ts`

- [ ] **Step 1: Generate the processing migration and write failing processor/integration tests**

Run:

```bash
npx supabase migration new leadconduit_accepted_lead_processing
```

Use the exact printed migration path. Required tests:

- Processing disabled leaves a durable receipt in `received`, creates no lead, and returns without losing later work.
- Only the new `integration/leadconduit.received` handler consumes a LeadConduit receipt; the generic integration processor leaves it untouched.
- Enabling processing drains pending receipts and accepted poll events.
- Enabling Roofing processing drains only Roofing work; Virtual Quote remains observation-only until its own processing flag is enabled, even if its polling flag is already on.
- Flags enabled after cursors have advanced still drain all eligible persisted `observed|failed` accepted events without refetch or duplicate leads.
- Webhook normalization creates/merges one `leadconduit_events` row with channel `webhook`.
- Webhook retry plus poll overlap yields one logical event, one PIW lead, one pipeline, and one `crm/lead.submitted` outbox event.
- Poll-only accepted event recovers a missed webhook within the next five-minute run.
- Processing failure records a sanitized category and remains retryable.
- Overlapping workers claim different rows with `FOR UPDATE SKIP LOCKED`; an expired lease is recoverable, while an active lease is not double-processed.
- Retryable categories (`rate_limit`, `upstream`, `persistence`) back off for `min(2^attempt * 60 seconds, 3600 seconds)` and stop after eight attempts; terminal categories (`invalid_payload`, `flow_mismatch`, `unsupported_event`) are never retried automatically.
- Tenant A and B can use the same vendor lead ID without collision; a control user cannot read or process the other tenant.
- Accepted-lead creation adds no vendor write and no automatic contact/consent record.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm run db:reset
npx supabase test db supabase/tests/activeprospect-access-route.test.sql
npm run test:run -- src/modules/leads/process-leadconduit-accepted-event.test.ts src/inngest/functions/process-leadconduit-delivery.test.ts src/inngest/functions/process-pending-leadconduit-deliveries.test.ts
RUN_SUPABASE_INTEGRATION=1 npm run test:run -- src/integration/leadconduit-ingestion.integration.test.ts
```

- [ ] **Step 3: Implement unified atomic lead processing**

Add a service-role-only `process_leadconduit_accepted_event(p_company_id, p_leadconduit_event_row_id, p_expected_flow_id)` RPC. It locks the internal UUID row, returns the existing PIW IDs on replay, requires the row's flow ID to equal `p_expected_flow_id`, and requires a webhook observation or canonical poll predicate `event_type="source" AND outcome="success"`. It calls tenant-safe vendor intake with `p_source_system='leadconduit'` and `p_external_lead_id` equal to the required LeadConduit `lead_id`; optional upstream `lead.external_id` remains attribution only. It sets a newly created LeadConduit lead to `manual_hold` before enqueueing, enqueues `crm/lead.submitted` in the same transaction only when the lead is new, and marks the event processed with its PIW lead ID. If the tenant-scoped vendor lead already exists, link/finish idempotently using its existing pipeline without changing contact data, creating another pipeline, or enqueueing another event. It must never create consent or outreach records.

`processLeadConduitDelivery` is triggered by `integration/leadconduit.received`. It loads the tenant-scoped integration receipt, validates the stored flow binding again, normalizes/upserts the webhook event, invokes the atomic RPC only when that receipt's flow-specific processing flag is enabled, and marks the receipt processed only after success. Add service-only lease RPCs for receipts and poll events using `FOR UPDATE SKIP LOCKED`, `claimed_at`, `claimed_by`, and `next_attempt_at`; claims are bounded, flow-filtered, and expire after five minutes. The pending-delivery function runs every five minutes and reuses the same processor. Independently scan all persisted accepted `observed|failed` poll events for each processing-enabled flow rather than only the current API page. Receipt completion is independently idempotent: if lead creation commits but receipt completion fails, retry resolves the existing event/lead/outbox and only finishes the receipt.

The reconciliation function submits newly observed accepted poll source events with canonical `event_type="source"` and `outcome="success"` to the same atomic RPC; rescue generation remains separate. If discovery fixtures demonstrate a different raw success spelling, normalize it to canonical `success` and add the fixture before processing can be enabled—never broaden the predicate with fuzzy text matching.

- [ ] **Step 4: Regenerate types and verify GREEN**

```bash
npm run db:reset
npx supabase test db supabase/tests/activeprospect-access-route.test.sql
npx supabase gen types typescript --local --schema public > src/lib/database.types.ts
npm run test:run -- src/modules/leads/process-leadconduit-accepted-event.test.ts src/inngest/functions/process-leadconduit-delivery.test.ts src/inngest/functions/process-pending-leadconduit-deliveries.test.ts
RUN_SUPABASE_INTEGRATION=1 npm run test:run -- src/integration/leadconduit-ingestion.integration.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit processing and recovery**

Stage the exact generated migration and named files, then commit:

```bash
git commit -m "feat: process LeadConduit leads idempotently"
```

### Task 11: Sanitized operations and failure display

**Files:**
- Modify: `src/app/(app)/access-route/page.tsx`
- Create: `src/app/(app)/access-route/page.test.tsx`
- Modify: `src/app/(app)/access-route/[system]/page.tsx`
- Create: `src/app/(app)/access-route/[system]/page.test.tsx`
- Create: `src/app/(app)/access-route/[system]/leadconduit-operations-panel.tsx`
- Create: `src/app/(app)/access-route/[system]/leadconduit-operations-panel.test.tsx`
- Create: `src/modules/access-route/leadconduit-observability.ts`
- Create: `src/modules/access-route/leadconduit-observability.test.ts`
- Modify: `src/modules/access-route/leadconduit-webhook.ts`
- Modify: `src/modules/access-route/leadconduit-poll.ts`
- Modify: `src/inngest/functions/process-leadconduit-delivery.ts`
- Modify: `src/inngest/functions/process-pending-leadconduit-deliveries.ts`

- [ ] **Step 1: Write failing operations UI tests**

Render latest probe/import/poll/receipt/processing outcomes with flow name, run/receipt ID, start/finish time, counts, cursor age, latency, and sanitized category. Use the shared `LeadConduitOperationalErrorCategory`; do not invent combined spellings such as `persistence_or_mapping` for new LeadConduit work.

Assert these strings never occur in operational HTML: fixture homeowner name, email, phone, address, bearer token, API key, webhook body, upstream error body, corrected-field value, or rescue note. Capture serialized structured-log context from webhook, poll, processing, retry, and failure paths and assert the same sentinels never occur there. The overview currently selects `error_category` but does not render it; add a regression assertion that it is visible.

- [ ] **Step 2: Run UI tests and verify RED**

```bash
npm run test:run -- 'src/app/(app)/access-route/page.test.tsx' 'src/app/(app)/access-route/[system]/page.test.tsx' 'src/app/(app)/access-route/[system]/leadconduit-operations-panel.test.tsx' src/modules/access-route/leadconduit-observability.test.ts
```

- [ ] **Step 3: Implement the sanitized status projection**

Select only the columns the panels render. Do not select `raw_payload`, typed customer fields, decision notes, or corrected fields. Show persisted account probe runs, per-flow shadow/poll runs, receipt/processing status, and rescue metrics so one flow's failure cannot imply the other is down. Add a single structured-log helper that accepts an allowlisted context type—request/run/receipt IDs, flow slug, counts, timestamps, HTTP status, cursor, latency, and `LeadConduitOperationalErrorCategory` only—and route every LeadConduit log call through it.

- [ ] **Step 4: Run UI tests and verify GREEN**

```bash
npm run test:run -- 'src/app/(app)/access-route/page.test.tsx' 'src/app/(app)/access-route/[system]/page.test.tsx' 'src/app/(app)/access-route/[system]/leadconduit-operations-panel.test.tsx' src/modules/access-route/leadconduit-observability.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit operations visibility**

```bash
git add 'src/app/(app)/access-route/page.tsx' 'src/app/(app)/access-route/page.test.tsx' 'src/app/(app)/access-route/[system]/page.tsx' 'src/app/(app)/access-route/[system]/page.test.tsx' 'src/app/(app)/access-route/[system]/leadconduit-operations-panel.tsx' 'src/app/(app)/access-route/[system]/leadconduit-operations-panel.test.tsx' src/modules/access-route/leadconduit-observability.ts src/modules/access-route/leadconduit-observability.test.ts src/modules/access-route/leadconduit-webhook.ts src/modules/access-route/leadconduit-poll.ts src/inngest/functions/process-leadconduit-delivery.ts src/inngest/functions/process-pending-leadconduit-deliveries.ts
git commit -m "feat: display sanitized LeadConduit operations"
```

### Task 12: Full verification, deployment runbook, and canary evidence

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/access-route-read-integration.md`
- Modify: `docs/runbooks/deployment.md`
- Create: `docs/runbooks/activeprospect-leadconduit-rollout.md`
- Create: `docs/runbooks/templates/activeprospect-canary-evidence.md`
- Create: `docs/runbooks/queries/activeprospect-release-evidence.sql`

- [ ] **Step 1: Write the rollout and rollback checklist**

The runbook must require this sequence:

1. Confirm exact flow/source IDs with the client flow owner and save a secure pre-change flow snapshot.
2. Enable probe only; run GET-only discovery.
3. Enable shadow import only; import at most 50 events and one page per action.
4. Verify allowlist, tenant isolation, idempotency, normalization, rescue exclusions, and sanitized failures.
5. With the flow owner, insert exact step/rule-ID rescue policies from discovery: hard exclusions first, then explicitly approved candidate rules. Leave unknown rules unconfigured and therefore excluded.
6. Enable rescue recommendations for one flow while rescue actions remain false; run the bounded backlog classifier over its shadow sample and review explanations/exclusions. Repeat for the other flow only after its policies are confirmed.
7. Enable per-flow five-minute polling and prove reconciliation under five minutes without cross-flow cursor or processing effects.
8. Deploy both POST routes while both receiver flags remain false and verify only the disabled `503` smoke response. Keep persistence-failure injection in automated/local tests; do not break staging storage to manufacture it.
9. Select the lower-volume flow. Temporarily enable only its staging receiver with processing paused, then directly test valid, duplicate, cross-token, malformed, oversized, attempt-quota, unique-delivery-quota, and processing-paused cases. Return the limits to deployment values after the controlled quota test.
10. In the saved ActiveProspect flow draft, add PIW as the final optional Custom JSON recipient after all existing destinations. Configure POST, `Content-Type: application/json`, the flow-specific `Authorization: Bearer ...` header, response Outcome Search Path `outcome`, success search term `success`, continue-on-failure/error, and automated retry for `429`/`5xx`. Assert a draft test records the PIW step as success when PIW returns `{ outcome: "success", receipt_id }`.
11. Turn that receiver off, then run one draft test that receives `503` and prove source response/existing destinations are unchanged. If the account cannot test a saved draft, deploy with the saved snapshot ready and use one immediate synthetic lead as this controlled fallback. Turn the receiver on and prove automated retry or one new synthetic lead creates exactly one durable receipt.
12. Enable processing for only that flow and confirm exactly one PIW lead while the second flow remains observation-only. Observe at least 24 hours and 25 leads; only then repeat receiver, processing, and rescue-action enablement for the second flow.

Rollback order is: pause processing, preserve receipt/polling visibility, disable/remove the optional PIW recipient, deploy the saved flow snapshot, verify destination totals, diagnose, then recanary.

- [ ] **Step 2: Create a no-PII evidence template**

Capture only base/commit/deployment ID and Vercel `READY` state; confirmed flow/source IDs; secure snapshot location/time; Inngest function IDs; probe status/counts/flow names/field-name lists; run/receipt IDs, timestamps, cursors, categories, P95 receipt latency and poll lag; existing-destination comparison totals; duplicate/tenant/pause/no-write results; observation start/end and 24-hour/25-lead gate. Explicitly prohibit tokens, payloads, and homeowner values.

The SQL evidence file must contain parameterized, aggregate-only queries for: unapproved-flow row count; duplicate `(company,event_id)` count; duplicate `(company,source_system,external_lead_id)` PIW lead count; P95 receipt latency from `received_at - submitted_at`; P95/max poll lag from `poll_observed_at - occurred_at`; webhook/poll merge count; receipt/processing/rescue backlog by flow/state; per-flow sync runs/checkpoints; and the control tenant's visible row counts. Every result is a count, timestamp, ID, category, or percentile—never a customer field.

- [ ] **Step 3: Run all local gates**

```bash
npm ci
npm run db:start
npm run db:reset
npm run verify
npx supabase db lint --local --schema public --level warning --fail-on warning
npx supabase db advisors --local --type all --level warn --fail-on warn
npx supabase gen types typescript --local --schema public > /tmp/piw-activeprospect-database.types.ts
diff -u src/lib/database.types.ts /tmp/piw-activeprospect-database.types.ts
git diff --check
```

Expected: lint, typecheck, unit/component tests, pgTAP, local-Supabase integration tests, and production build all pass; generated database types have no diff; database lint/advisors produce no warnings.

- [ ] **Step 4: Run explicit safety and scope checks**

```bash
! rg -n 'NEXT_PUBLIC_.*(LEADCONDUIT|ACTIVEPROSPECT)' src .env.example .github
! rg -n 'method:.*(POST|PUT|PATCH|DELETE)' src/modules/access-route/vendors.ts src/modules/access-route/leadconduit-poll.ts src/modules/access-route/leadconduit-shadow-import.ts
! rg -n --glob '!**/*.md' "[\"']activeprospect[\"']" src supabase
git diff --check
git diff --check "$PIW_ACTIVEPROSPECT_BASE_SHA"...HEAD
git diff --stat "$PIW_ACTIVEPROSPECT_BASE_SHA"...HEAD
git status --short
```

Review the diff for exactly two flow bindings, every default-false flag, no generic webhook attachment, no unapproved flow persistence, no vendor-write client, and no unrelated user files.

- [ ] **Step 5: Request review, document evidence, and commit the runbooks**

Use `superpowers:requesting-code-review`, address every actionable finding, rerun `npm run verify`, then:

```bash
git add README.md docs/runbooks/access-route-read-integration.md docs/runbooks/deployment.md docs/runbooks/activeprospect-leadconduit-rollout.md docs/runbooks/templates/activeprospect-canary-evidence.md docs/runbooks/queries/activeprospect-release-evidence.sql
git commit -m "docs: add LeadConduit rollout evidence gates"
```

After the final commit, rerun `git diff --check "$PIW_ACTIVEPROSPECT_BASE_SHA"...HEAD`, `git diff --stat "$PIW_ACTIVEPROSPECT_BASE_SHA"...HEAD`, and require `git status --short` to be empty. Do not move a pull request out of draft until the full local suite and CI pass. Do not enable a production flow from the implementation task; the flow-owner canary is a separate, explicitly approved operational action.

## Final acceptance matrix

| Requirement | Automated evidence | Operational evidence |
|---|---|---|
| Only two approved flows | allowlist unit/integration tests | confirmed flow/source IDs |
| Tenant isolation | pgTAP plus two-user integration tests | control-tenant check |
| Default-off controls | env/flag/health tests and CI env | deployment configuration snapshot |
| Accepted receipt under 5 seconds P95 | receipt timestamps and latency query test | canary evidence percentile |
| Poll recovery under 5 minutes | five-minute schedule/cursor tests | missed-delivery reconciliation timing |
| No duplicate event or lead | webhook/poll overlap integration test | synthetic/retry comparison |
| No existing-flow regression | architecture and endpoint isolation tests | destination baseline versus canary totals |
| Safe rescue exclusions | classifier and RPC denial tests | reviewed historical sample |
| Human-only rescue | authenticated action/RPC tests | reviewer audit entry |
| No vendor write or auto-contact | GET-only static tests and database assertions | vendor audit plus PIW lead inspection |
| Sanitized failures | response/render/log fixture tests | screenshot/evidence review |
| Full release quality | `npm run verify`, DB lint/advisors, CI | 24-hour and 25-lead gate |

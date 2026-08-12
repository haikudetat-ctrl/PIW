# LeadConduit Direct Shadow Receipt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two disabled-by-default, flow-bound PIW JSON receipt endpoints that identify three allowlisted post-CoreLogic filter matches without using ActiveProspect account API access or changing LeadConduit.

**Architecture:** Reuse the branch's tenant-safe `leadconduit_events` table, service-only merge RPC, exact flow bindings, token rotation, and RLS. A shared pure classifier converts a strict, bounded recipient payload into a privacy-minimized event row; a thin Next.js route authenticates before reading the body, persists idempotently, and returns only sanitized outcomes. Superseded API probe/shadow-import UI is removed from the release surface, while the pre-existing dormant reader remains unscheduled and disabled.

**Tech Stack:** Next.js 16 App Router, TypeScript 5, Zod 4, Vitest 4, Supabase/Postgres with RLS, Node 24 crypto, Vercel server environment variables.

## Global Constraints

- Work only in the existing isolated worktree on `codex/activeprospect-access-route`; preserve unrelated workspace changes.
- Do not open, edit, save, test, or otherwise mutate either LeadConduit flow during implementation.
- Do not deploy, push schema to a remote database, call ActiveProspect APIs, or ingest client records. Tests use synthetic values and local Supabase only.
- Continue using `leadconduit` as the source-system key. Do not add an `activeprospect` vendor.
- The only trusted flow bindings are Roofing `6377949a81800d03d54119b5` and Roofing Virtual Quote `68d597a7e5a45ce2a9c822fe`, supplied through server environment configuration and verified against the request payload.
- The public paths are exactly `/api/integrations/leadconduit/roofing` and `/api/integrations/leadconduit/roofing-virtual-quote`.
- Each receiver defaults to false and has a distinct active/next bearer-token set. A token for one flow must not authenticate the other.
- The request checkpoint is exactly `after_corelogic`; company identity is never accepted from request data.
- Classification is deny-by-default. Roofing may produce `apartment_classification`, `multiple_property_match`, or `vacant_property_classification`; Roofing Virtual Quote may produce only `apartment_classification`.
- Exact, case-sensitive source exemptions after whitespace trimming are the six UI names `RoofingCalculator`, `Webrunner Media Group`, `Angies Leads`, `Angi`, `Facebook Lead Ads`, and `1MDE`, plus LeadConduit's exported internal IDs `66294ffc805cf61e9575ee40` (Webrunner Media Group) and `65a84540388af4b003c1b8de` (Angi). A match on source ID or name is sufficient.
- A missing CoreLogic outcome, an outcome other than case-insensitive `Success`, an unknown rule/value, or any compliance/suppression/TCPA/fraud/system category creates no candidate.
- The endpoint labels candidates as `likely filter match`; it never claims LeadConduit rejected a lead.
- The endpoint creates no PIW lead, property, pipeline, consent, task, delivery, rescue decision, domain event, outbox event, LeadMaster record, or JobNimbus record.
- Customer values may exist only in tenant-scoped candidate event rows and authenticated detail views. Logs, HTTP responses, errors, audit/status metadata, non-candidate rows, tests, and documentation contain no client values.
- Every new or changed behavior follows strict RED → GREEN TDD. Run the exact failing command before implementation and record the expected failure.
- One narrow database migration is expected because the existing service-only event upsert drops `processing_status`. The migration may only forward and merge `observed`/`not_applicable` through the existing RPC; it adds no table/column, rewrites no existing row, and grants no new role. Any other schema mismatch is a stop condition.

---

### Task 1: Remove the superseded API shadow surface and narrow configuration to receipt

**Files:**
- Delete: `src/modules/access-route/leadconduit-shadow-import.ts`
- Delete: `src/modules/access-route/leadconduit-shadow-import.test.ts`
- Delete: `src/app/(app)/access-route/[system]/leadconduit-connection-panel.tsx`
- Delete: `src/app/(app)/access-route/[system]/leadconduit-connection-panel.test.tsx`
- Modify: `src/app/(app)/access-route/[system]/action-handlers.ts`
- Modify: `src/app/(app)/access-route/[system]/actions.ts`
- Modify: `src/app/(app)/access-route/[system]/actions.test.ts`
- Modify: `src/app/(app)/access-route/[system]/page.tsx`
- Modify: `src/lib/env/server.ts`
- Modify: `src/lib/env/shared.test.ts`
- Modify: `src/lib/integrations/flags.ts`
- Modify: `src/lib/integrations/flags.test.ts`
- Modify: `src/modules/access-route/leadconduit-config.ts`
- Modify: `src/modules/access-route/leadconduit-config.test.ts`
- Modify: `src/modules/access-route/run.test.ts`
- Modify: `src/app/api/integrations/health/route.ts`
- Modify: `src/app/api/integrations/health/route.test.ts`
- Modify: `.env.example`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces `LeadConduitFlowBinding` with `slug`, `companyId`, `flowId`, `flowName`, `receiptEnabled`, and `tokens` only.
- Produces `leadConduitReceiptFlagsSnapshot()` with two booleans and no API/probe/polling identifiers.
- Preserves `INTEGRATION_VENDORS` and makes `isIntegrationEnabled("leadconduit")` equal the OR of the two receiver flags; it no longer reads a legacy global switch.
- Preserves the generic-route rejection of `leadconduit` and the existing LeadMaster/JobNimbus behavior.

- [ ] **Step 1: Rewrite configuration tests first**

In `leadconduit-config.test.ts`, replace API/probe/polling/rescue cases with literal receipt cases:

```ts
test("binds Roofing receipt to its server company, flow, and active token", () => {
  const env = parseServerEnv({
    ...validServerEnvironment,
    ACCESS_ROUTE_COMPANY_ID: COMPANY_ID,
    LEADCONDUIT_ROOFING_FLOW_ID: "6377949a81800d03d54119b5",
    INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED: "true",
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN: "roofing-token",
  });

  expect(getLeadConduitFlowBinding("roofing", env)).toEqual({
    slug: "roofing",
    companyId: COMPANY_ID,
    flowId: "6377949a81800d03d54119b5",
    flowName: "Roofing",
    receiptEnabled: true,
    tokens: [{ value: "roofing-token", validUntil: null }],
  });
});

test("keeps Virtual Quote disabled independently", () => {
  const env = parseServerEnv({ ...validServerEnvironment });
  expect(getLeadConduitFlowBinding("roofing-virtual-quote", env)).toBeNull();
});
```

Retain active/next token deduplication and future-expiry cases. Add `shared.test.ts` cases proving an enabled receiver requires company ID, its exact flow ID variable, and its own active token, while both disabled receivers require none of them.

- [ ] **Step 2: Rewrite flag and health tests first**

Require this exact public shape:

```ts
expect(leadConduitReceiptFlagsSnapshot(environment)).toEqual({
  roofing: false,
  virtualQuote: false,
});

expect(await response.json()).toMatchObject({
  leadconduit: { roofing: false, virtualQuote: false },
});
```

Assert `isIntegrationEnabled("leadconduit")` and `integrationFlagsSnapshot().leadconduit` are false when both receivers are false and true when either receiver alone is true. Assert the health JSON contains no keys matching `/probe|shadow|poll|process|rescue|token|flowId|api/i`.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm run test:run -- src/lib/env/shared.test.ts src/lib/integrations/flags.test.ts src/modules/access-route/leadconduit-config.test.ts src/app/api/integrations/health/route.test.ts 'src/app/(app)/access-route/[system]/actions.test.ts'
```

Expected: FAIL because the binding and health snapshot still expose superseded capability fields and the authenticated Access Route page still wires the API probe/import panel.

- [ ] **Step 4: Implement the narrow receipt configuration**

Replace the binding shape with:

```ts
export type LeadConduitFlowBinding = {
  slug: "roofing" | "roofing-virtual-quote";
  companyId: string;
  flowId: string;
  flowName: "Roofing" | "Roofing Virtual Quote";
  receiptEnabled: boolean;
  tokens: ReadonlyArray<{ value: string; validUntil: string | null }>;
};
```

Remove API-only probe/shadow/polling/processing/rescue fields, unused webhook attempt/delivery rate-limit fields, and the legacy scheduler-only `INTEGRATIONS_LEADCONDUIT_ENABLED` switch from `serverEnvSchema`, `.env.example`, CI, flags, health output, and their tests. Keep only the two receiver flags, two flow IDs, two active/next/expiry token sets, and `ACCESS_ROUTE_COMPANY_ID`; the 65,536-byte route limit is a code constant. Make the generic LeadConduit enabled snapshot equal `roofingReceiver || virtualQuoteReceiver`, while the detailed snapshot exposes each receiver independently. Remove the LeadConduit probe/import actions and UI without changing JobNimbus actions or rendering. Update `run.test.ts` to retain the no-LeadConduit-scheduling assertion without passing deleted legacy environment keys.

Delete the four superseded probe/import files. Do not restore the legacy scheduled LeadConduit branch in `run.ts`; its existing regression test must remain green.

- [ ] **Step 5: Verify GREEN and regression boundaries**

```bash
npm run test:run -- src/lib/env/shared.test.ts src/lib/integrations/flags.test.ts src/modules/access-route/leadconduit-config.test.ts src/app/api/integrations/health/route.test.ts 'src/app/(app)/access-route/[system]/actions.test.ts' src/modules/access-route/run.test.ts 'src/app/api/integrations/[vendor]/route.test.ts'
npm run typecheck
```

Expected: PASS; health contains receipt booleans only, the generic route still rejects LeadConduit before tenant lookup, and no UI offers API discovery/import.

- [ ] **Step 6: Commit**

```bash
git add .env.example .github/workflows/ci.yml src/lib/env/server.ts src/lib/env/shared.test.ts src/lib/integrations/flags.ts src/lib/integrations/flags.test.ts src/modules/access-route/leadconduit-config.ts src/modules/access-route/leadconduit-config.test.ts src/modules/access-route/run.test.ts src/app/api/integrations/health/route.ts src/app/api/integrations/health/route.test.ts 'src/app/(app)/access-route/[system]/action-handlers.ts' 'src/app/(app)/access-route/[system]/actions.ts' 'src/app/(app)/access-route/[system]/actions.test.ts' 'src/app/(app)/access-route/[system]/page.tsx' src/modules/access-route/leadconduit-shadow-import.ts src/modules/access-route/leadconduit-shadow-import.test.ts 'src/app/(app)/access-route/[system]/leadconduit-connection-panel.tsx' 'src/app/(app)/access-route/[system]/leadconduit-connection-panel.test.tsx'
git commit -m "refactor: narrow LeadConduit to direct receipt"
```

---

### Task 2: Strict shadow payload, classifier, and privacy-minimized event mapping

**Files:**
- Create: `src/modules/access-route/leadconduit-shadow-receipt.ts`
- Create: `src/modules/access-route/leadconduit-shadow-receipt.test.ts`

**Interfaces:**

```ts
export const LEADCONDUIT_SHADOW_CHECKPOINT = "after_corelogic" as const;
export type LeadConduitShadowCategory =
  | "apartment_classification"
  | "multiple_property_match"
  | "vacant_property_classification";

export type LeadConduitShadowPayload = z.infer<typeof leadConduitShadowPayloadSchema>;

export function parseLeadConduitShadowPayload(value: unknown):
  | { ok: true; value: LeadConduitShadowPayload }
  | { ok: false; invalidFields: string[] };

export function classifyLeadConduitShadow(input: {
  flowSlug: LeadConduitFlowSlug;
  payload: LeadConduitShadowPayload;
}): LeadConduitShadowCategory[];

export function toLeadConduitShadowEvent(input: {
  binding: LeadConduitFlowBinding;
  payload: LeadConduitShadowPayload;
  categories: LeadConduitShadowCategory[];
  observedAt: string;
}): LeadConduitEventRow;
```

The strict schema is the logical PIW contract below. It is intentionally decoupled from LeadConduit field IDs; the future recipient performs that mapping:

```ts
const optionalLeaf = z.string().trim().nullable().optional();

const leadConduitShadowPayloadSchema = z.object({
  schema_version: z.literal(1),
  lead_id: z.string().trim().min(1),
  flow_id: z.string().trim().min(1),
  checkpoint: z.literal("after_corelogic"),
  source: z.object({
    id: optionalLeaf,
    name: optionalLeaf,
  }).strict().refine(
    (source) => Boolean(source.id || source.name),
    { message: "source identity is required" },
  ),
  submitted_at: z.string().datetime({ offset: true }),
  is_test: z.boolean(),
  lead: z.object({
    name: optionalLeaf,
    phone: optionalLeaf,
    email: optionalLeaf,
    submitted_address: optionalLeaf,
    trustedform_url: optionalLeaf,
  }).strict(),
  corelogic: z.object({
    outcome: optionalLeaf,
    reason: optionalLeaf,
    building_comments: optionalLeaf,
    site_land_use: optionalLeaf,
  }).strict(),
}).strict();
```

- [ ] **Step 1: Write strict schema tests**

Use a complete synthetic literal with `.invalid` contact values. Tests must prove:

- schema version is exactly `1`;
- checkpoint is exactly `after_corelogic`;
- `lead_id`, `flow_id`, `submitted_at`, and `is_test` are required, and `source` must contain at least one non-empty ID or name;
- missing/null `corelogic.outcome` is accepted because the existing flow conditionally skips CoreLogic for exempt sources;
- optional leaf strings accept string, null, or omission;
- unknown top-level and nested keys are rejected;
- invalid output contains sorted dot-path field names only and never submitted values.

Example assertion:

```ts
expect(parseLeadConduitShadowPayload({
  ...syntheticPayload,
  lead: { ...syntheticPayload.lead, secret_note: "must-not-survive" },
})).toEqual({ ok: false, invalidFields: ["lead.secret_note"] });
```

- [ ] **Step 2: Write classifier tests**

Add literal cases for:

```ts
[
  ["Building Comments: APARTMENT HOUSE", "Single Family", ["apartment_classification"]],
  [null, "Garden Apartment", ["apartment_classification"]],
  [null, "Vacant Residential", ["vacant_property_classification"]],
]
```

Also prove:

- both apartment fields yield one deduplicated category;
- exact multiple-property reason yields `multiple_property_match` for Roofing only;
- category order is apartment, multiple-property, vacant;
- the six exact trimmed source-name exemptions and the two exported internal source-ID equivalents yield `[]` when matched through either `source.id` or `source.name`;
- a case-changed exemption such as `angi` does not silently become exempt;
- missing, null, and non-success CoreLogic outcomes yield `[]` without making the payload invalid;
- Virtual Quote never produces `multiple_property_match` or `vacant_property_classification`;
- unknown property text yields `[]`.

- [ ] **Step 3: Write event-mapping privacy tests**

For a candidate, assert exact trusted company/flow identity, SHA-256 event ID format `/^shadow:[a-f0-9]{64}$/`, `event_type="shadow_checkpoint"`, `raw_status="likely_filter_match"`, primary `reason_category`, full ordered `attribution.shadow_categories`, normalized review fields, webhook provenance, and no arbitrary input key.

For a non-candidate, assert `lead_name`, submitted contact/address, TrustedForm, CoreLogic values, and customer raw payload are absent/null; `raw_status="observed"`, `processing_status="not_applicable"`, `reason_category=null`, and the snapshot is exactly:

```ts
{
  schema_version: 1,
  checkpoint: "after_corelogic",
  candidate_categories: [],
}
```

- [ ] **Step 4: Run focused tests and verify RED**

```bash
npm run test:run -- src/modules/access-route/leadconduit-shadow-receipt.test.ts
```

Expected: FAIL because the strict schema, classifier, and mapping module do not exist.

- [ ] **Step 5: Implement the minimal pure module**

Use recursive `.strict()` Zod objects and convert issues to sorted unique dot paths. Use `node:crypto` SHA-256 over:

```ts
[binding.flowId, payload.lead_id, payload.checkpoint].join("\0")
```

Build every `LeadConduitEventRow` field explicitly; never spread request objects. Candidate `raw_payload` is exactly the allowlisted normalized snapshot. Non-candidate customer and CoreLogic values are null/empty. Use `processing_status="observed"` for candidates and `"not_applicable"` for non-candidates; never assign a PIW lead ID.

- [ ] **Step 6: Verify GREEN**

```bash
npm run test:run -- src/modules/access-route/leadconduit-shadow-receipt.test.ts src/modules/access-route/repository.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/access-route/leadconduit-shadow-receipt.ts src/modules/access-route/leadconduit-shadow-receipt.test.ts
git commit -m "feat: classify LeadConduit shadow receipts"
```

---

### Task 3: Authenticated, bounded, idempotent flow routes

**Files:**
- Create: `src/app/api/integrations/leadconduit/[flow]/route.ts`
- Create: `src/app/api/integrations/leadconduit/[flow]/route.test.ts`

**Interfaces:**

```ts
export type LeadConduitShadowRouteDependencies = {
  getBinding(flow: string): LeadConduitFlowBinding | null;
  persist(input: LeadConduitEventBatch): Promise<number>;
  now(): Date;
};

export async function handleLeadConduitShadowRequest(
  request: Request,
  flow: string,
  dependencies: LeadConduitShadowRouteDependencies,
): Promise<{ status: 200 | 400 | 401 | 413 | 503; body: Record<string, unknown> }>;
```

- [ ] **Step 1: Write pre-body authentication and binding tests**

Use a `Request` whose body stream throws if read. Prove unknown flow, unavailable binding, and disabled receiver return sanitized `503` before reading. Prove missing/malformed/wrong/cross-flow bearer tokens return generic `401` and never call persistence. Prove active and unexpired next tokens succeed, while an expired token is excluded by the binding.

The only failure bodies are:

```ts
{ outcome: "retry", category: "disabled" }
{ outcome: "unauthorized" }
```

- [ ] **Step 2: Write bounded-body and schema tests**

Prove:

- non-JSON content type returns sanitized `400`;
- malformed JSON returns `400` with `category="invalid_payload"` and no submitted content;
- invalid schema returns sorted invalid field names only;
- a streaming body exceeding `65_536` bytes returns `413` before JSON parsing;
- an untrusted `Content-Length` smaller than the streamed body cannot bypass the limit;
- exact flow ID/checkpoint mismatch returns generic `401` and no persistence.

- [ ] **Step 3: Write persistence and idempotency tests**

With an in-memory fake keyed by event ID, prove apartment, Roofing multiple-property, Roofing-vacant, and non-candidate requests call persistence once per request with trusted company/flow/channel data; replays keep one logical row and return the same `200 { outcome: "success" }`. Prove Virtual Quote multiple-property and vacant inputs remain non-candidates. Make persistence throw and assert `503 { outcome: "retry", category: "persistence" }` without an error message or payload echo.

Assert no dependency exists for lead creation, Inngest, outbox, LeadMaster, JobNimbus, or ActiveProspect fetch.

- [ ] **Step 4: Run focused route tests and verify RED**

```bash
npm run test:run -- 'src/app/api/integrations/leadconduit/[flow]/route.test.ts'
```

Expected: FAIL because the flow-bound route does not exist.

- [ ] **Step 5: Implement authentication and bounded parsing**

Extract `Bearer <token>` without logging it. For each configured token, compare `sha256(candidate)` and `sha256(expected)` with `crypto.timingSafeEqual`; do not short-circuit on string equality. Authenticate after binding/flag checks and before content type/body reads.

Read `request.body` with a reader, add chunk sizes before concatenation, cancel and return 413 immediately above 65,536 bytes, then decode and parse JSON. Map Zod failures to field names only.

- [ ] **Step 6: Implement trusted persistence and the Next.js adapter**

Reject flow ID/checkpoint mismatch with generic 401. Classify and map using Task 2, then call:

```ts
await dependencies.persist({
  companyId: binding.companyId,
  flowId: binding.flowId,
  channel: "webhook",
  observedAt: now.toISOString(),
  rows: [event],
});
```

The exported `POST` resolves `params.flow`, parses server env, gets the binding, creates `SupabaseAccessRouteRepository(createServiceClient())`, and delegates to the pure handler. It returns only the handler body/status and performs no logging of request data.

- [ ] **Step 7: Verify GREEN and generic-route isolation**

```bash
npm run test:run -- 'src/app/api/integrations/leadconduit/[flow]/route.test.ts' src/modules/access-route/leadconduit-shadow-receipt.test.ts 'src/app/api/integrations/[vendor]/route.test.ts'
npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add 'src/app/api/integrations/leadconduit/[flow]/route.ts' 'src/app/api/integrations/leadconduit/[flow]/route.test.ts'
git commit -m "feat: receipt LeadConduit shadow candidates"
```

---

### Task 4: Local Supabase proof, posting runbook, and release-boundary verification

**Files:**
- Create: `supabase/migrations/20260812141000_leadconduit_shadow_receipt_status.sql`
- Modify: `supabase/tests/activeprospect-access-route.test.sql`
- Modify: `src/modules/access-route/repository.ts`
- Modify: `src/modules/access-route/repository.test.ts`
- Create: `src/integration/leadconduit-shadow-receipt.integration.test.ts`
- Create: `docs/runbooks/leadconduit-shadow-recipient.md`
- Modify: `docs/runbooks/access-route-read-integration.md`

**Interfaces:**
- Consumes the Task 2 classifier/event mapper and Task 3 pure route handler.
- Produces synthetic local evidence and exact future LeadConduit mapping instructions; it performs no deployment or flow edit.

- [ ] **Step 1: Write failing repository and pgTAP status-forwarding tests**

In `repository.test.ts`, require `eventPayload` to pass `processing_status` from each trusted `LeadConduitEventRow` into `p_events`. In `activeprospect-access-route.test.sql`, invoke `upsert_leadconduit_event_batch` with a synthetic shadow event carrying `processing_status="not_applicable"`, assert that exact stored status, replay the same `(company_id,event_id)` with `processing_status="observed"`, and assert `observed` wins. Also assert the RPC remains inaccessible to `anon`/`authenticated` and accepts only statuses already allowed by the table constraint.

Run:

```bash
npm run test:run -- src/modules/access-route/repository.test.ts
npm run db:reset
npx supabase test db supabase/tests/activeprospect-access-route.test.sql
```

Expected: FAIL because the repository omits the property and the existing RPC insert/update ignores it.

- [ ] **Step 2: Add the function-only migration and repository forwarding**

Create `20260812141000_leadconduit_shadow_receipt_status.sql` with `create or replace function public.upsert_leadconduit_event_batch(...)` preserving the existing signature, `security definer`, `set search_path = ''`, validation, field mapping, grants, and merge behavior. Change only these semantics:

- insert `processing_status` as `coalesce(nullif(trim(v_event->>'processing_status'), ''), 'observed')`;
- on conflict, preserve terminal/in-flight `processed`, `pending`, or `failed`; otherwise let `observed` outrank `not_applicable` so a candidate observation can never be downgraded by a later non-candidate replay;
- rely on the existing table check constraint to reject any unsupported status;
- do not update `piw_lead_id`, processing errors, claim fields, attempts, or retry time;
- repeat the existing revoke/grant statements so only `service_role` can execute it.

Add `processing_status: row.processing_status` to the repository RPC payload. Run the two RED commands again and require GREEN, then run `npx supabase db diff --local` and require no uncommitted schema drift beyond the migration.

- [ ] **Step 3: Write a failing real-persistence integration test**

Behind `RUN_SUPABASE_INTEGRATION=1`, create two synthetic companies, matching `leadconduit_flows` rows, two service repositories, and two authenticated local users. Call `handleLeadConduitShadowRequest` with real repository persistence for:

- Tenant A Roofing apartment candidate twice concurrently;
- Tenant A Roofing non-candidate containing synthetic customer values;
- Tenant B Virtual Quote apartment candidate using the same LeadConduit lead ID.

Assert one Tenant A candidate row after replay, a distinct Tenant B row, tenant-scoped authenticated reads, authenticated write rejection, and no rows in `leads`, `properties`, `pipeline_runs`, `integration_events`, or `event_outbox` for either synthetic company.

Assert the non-candidate database row has null name/phone/email/address/TrustedForm and no CoreLogic values in attribution/raw payload. Cleanup every synthetic row and auth user in `finally`.

- [ ] **Step 4: Run the integration test and verify RED**

```bash
npm run db:reset
RUN_SUPABASE_INTEGRATION=1 npm run test:run -- src/integration/leadconduit-shadow-receipt.integration.test.ts
```

Expected: FAIL until the real handler/repository composition satisfies idempotency, privacy minimization, RLS, and zero-side-effect assertions.

- [ ] **Step 5: Make only composition fixes required for GREEN**

Fix Task 2/3/repository composition rather than weakening assertions. Do not add schema objects beyond the approved function replacement. If concurrent upsert or existing RLS cannot meet the spec, stop and report the exact failing database contract.

- [ ] **Step 6: Write the exact posting runbook**

`docs/runbooks/leadconduit-shadow-recipient.md` must include:

- a banner: `PREPARATION ONLY — DO NOT APPLY WITHOUT PHASE C APPROVAL`;
- the two exact endpoint paths and intended step positions;
- Custom JSON recipient, bearer authorization, and `application/json` requirements;
- the exact schema-version-1 JSON keys from the design;
- the logical-to-LeadConduit mapping table below, using only field IDs actually observed during planning and marking metadata/step-output selections for Phase C verification:

| PIW JSON key | Future LeadConduit selection | Verification rule |
|---|---|---|
| `lead_id` | LeadConduit system lead ID | Do **not** assume client field `lead_id_allss`; prove stable replay identity with a synthetic Test Flow |
| `flow_id` | hardcoded expected flow ID | Must equal the path binding |
| `checkpoint` | hardcoded `after_corelogic` | Literal only |
| `source.id` | built-in Source ID | Prefer the stable internal ID; verify `66294ffc805cf61e9575ee40` and `65a84540388af4b003c1b8de` resolve to the two UI labels seen in the existing rules |
| `source.name` | built-in Source name | Map alongside the ID when exposed; do **not** substitute `lead_source_allss` or `campaign_source` |
| `submitted_at` | LeadConduit submission timestamp metadata | Verify ISO-8601 output with offset |
| `is_test` | LeadConduit test marker metadata | Verify JSON boolean, not a quoted string |
| `lead.name` | `first_name` plus `last_name` | Verify the recipient template joins safely when either is absent |
| `lead.phone` | submitted phone field | Select by semantic field in Phase C; do not guess an unseen ID |
| `lead.email` | `email` | Confirmed client field ID |
| `lead.submitted_address` | `address_1`, optional `address_2`, `city`, plus state/postal fields selected semantically in Phase C | Join only present components; do not guess unseen IDs |
| `lead.trustedform_url` | existing TrustedForm certificate URL | Select the existing flow/step value; optional |
| `corelogic.outcome` | CoreLogic Property Details Outcome | Optional step output; omit/null when the conditional CoreLogic step did not run |
| `corelogic.reason` | CoreLogic Property Details Reason | Step output after CoreLogic |
| `corelogic.building_comments` | CoreLogic Property Details Building Building Comments | Step output after CoreLogic |
| `corelogic.site_land_use` | CoreLogic Property Details Site Land Use | Step output after CoreLogic |

- an observed-field appendix listing `address_1`, `address_2`, `city`, `email`, `first_name`, `last_name`, `guid_allss`, `lead_id_allss`, `lead_source_allss`, `campaign_source`, `comments`, and `original_source`, with an explicit warning that observed availability is not proof of semantic equivalence;
- an explicit catalog warning: a listed field with Status off or zero Flow usage is not proven available, and Roofing mappings must never be copied to Virtual Quote without an independent synthetic preview;
- token instructions that reference the server-managed token and never include a token value in the document or URL;
- success response `{ "outcome": "success" }`;
- explicit instructions not to add a filter based on PIW outcome and not to reorder/change any existing step;
- a Phase C pre-enable mapping gate run independently for both flows: use only LeadConduit Test Flow synthetic data, verify Status/Flow usage plus the recipient preview, inspect PIW's sanitized receipt result and tenant-scoped stored row, and stop if system lead ID, built-in Source ID/name, metadata types, or CoreLogic step outputs cannot be selected exactly; include one exempt-source synthetic case where CoreLogic output is absent and PIW still returns success with a non-candidate row;
- synthetic-only test criteria and rollback: disable/remove only the new PIW recipient, leaving every existing step untouched;
- a checklist requiring separate Phase B deployment approval and Phase C LeadConduit-edit approval.

Update `access-route-read-integration.md` to state that LeadConduit API reading is paused, unscheduled, not required by the direct receipt baseline, and must remain disabled.

- [ ] **Step 7: Run final local verification**

```bash
npm run db:reset
npx supabase test db supabase/tests/lead-vendor-sourcing.test.sql supabase/tests/activeprospect-access-route.test.sql
npm run test:run -- src/modules/access-route/leadconduit-shadow-receipt.test.ts 'src/app/api/integrations/leadconduit/[flow]/route.test.ts' src/modules/access-route/run.test.ts 'src/app/api/integrations/[vendor]/route.test.ts'
RUN_SUPABASE_INTEGRATION=1 npm run test:run -- src/integration/leadconduit-shadow-receipt.integration.test.ts src/integration/leadconduit-foundation.integration.test.ts
npm run typecheck
npm run lint
npm run build
```

Expected: all commands pass. Only previously recorded baseline warnings may remain; no new warning is accepted.

- [ ] **Step 8: Prove the external safety boundary**

Run source/diff checks:

```bash
git diff --check
git diff --name-only dc4241a..HEAD
rg -n "fetch\(|LeadConduitReadClient|app\.leadconduit\.com|api\.activeprospect" 'src/app/api/integrations/leadconduit/[flow]' src/modules/access-route/leadconduit-shadow-receipt.ts
```

Expected: the direct receipt files contain no outbound fetch or ActiveProspect reader reference. Confirm no command in the task used Vercel deployment, remote Supabase, or browser mutation.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260812141000_leadconduit_shadow_receipt_status.sql supabase/tests/activeprospect-access-route.test.sql src/modules/access-route/repository.ts src/modules/access-route/repository.test.ts src/integration/leadconduit-shadow-receipt.integration.test.ts docs/runbooks/leadconduit-shadow-recipient.md docs/runbooks/access-route-read-integration.md
git commit -m "test: verify LeadConduit shadow receipt boundary"
```

## Completion boundary

Completion of this plan means Phase A is locally implemented, independently reviewed, and verified. It does **not** authorize pushing the branch, opening or moving a PR, deploying PIW, setting Vercel secrets, enabling either receiver, sending a request containing client data, or editing LeadConduit. Those actions require the separate approvals defined in the design.

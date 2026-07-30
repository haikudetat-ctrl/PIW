# PIW Property Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 3 Property Identity vertical slice on top of the PIW foundation and CRM: real address validation against the US Census Geocoder, NJ parcel discovery against the NJGIN statewide composite parcels FeatureServer, duplicate-property detection and merge, a minimal review queue for human escalation, and a Leaflet-based Property Profile extension to the lead workspace.

**Architecture:** Extends the existing Next.js App Router application, Supabase/PostGIS schema, typed domain event contracts, transactional outbox, Inngest integration, and provider framework established in Phases 1–2. The existing CRM Writer (Phase 2's only worker) now additionally publishes `property/address.validation_requested` after its existing projection work. Two new Inngest workers — `addressValidationWorker` and `propertyDiscoveryWorker` — consume this event chain (`property/address.validation_requested` → `property/discovery_requested`), calling two new live, free, unauthenticated provider adapters (US Census Geocoder for `address.validate`, NJGIN for `parcel.lookup`). Both workers follow the exact idempotency pattern established by `crm-writer.ts`: an idempotency-keyed `worker_runs` upsert, unique-constraint-backed dedup on every side-effect table, and the audit-write/completion-mark step guarded by `workerRun.status !== "completed"` from the start (no interim bug to fix, unlike Phase 2's Task 4). Ambiguous or low-confidence outcomes create a `review_tasks` row and set the pipeline run to `review_required` instead of advancing the chain; a new minimal Review Queue lets an admin `resolve`, `reject`, `retry`, or `mark unsupported`.

**Tech Stack:** Node.js 24.x, npm 11.x, Next.js 16.2.x, React 19.2.x, TypeScript 7.0.x, Supabase CLI 2.110.x, `@supabase/supabase-js` 2.111.0, Inngest 4.13.0, Zod 4.4.3, Vitest 4.1.x, PostgreSQL with PostGIS, GitHub Actions, Vercel — all pinned versions inherited unchanged from Phases 1–2. This phase adds `leaflet@1.9.4` and `react-leaflet@5.0.0` (pinned exact) for the parcel/candidate map.

## Global Constraints

All Phase 1 and Phase 2 global constraints still apply:

- Initial market is New Jersey; initial service is residential roofing only.
- The system serves one roofing company and invitation-only administrators.
- Weather, hail, wind, hurricane, storm-probability, insurance-event, and insurance-claims intelligence are excluded.
- A property is the durable entity; leads reference properties and retain independent histories.
- Every material derived value must trace to source evidence, a versioned calculation, or a labeled assumption.
- Every worker is event-driven and idempotent; workers never call downstream workers directly.
- Every application table has row-level security, and anonymous operational-data access is denied.
- Every new table requires **explicit `grant ... to service_role`** statements — this local Postgres image grants `service_role` no implicit privileges beyond RLS bypass.
- Node.js is pinned to `24.x`; production dependencies use exact versions.

Phase 3 adds these property-identity-specific constraints and decisions (fixed, not to be relitigated — several are labeled interpretations where the spec is silent):

1. **Fully asynchronous.** No synchronous provider call is added to the lead-intake request path. `submit_lead_intake` and the intake server action are unmodified. Spec §10.2's "immediate address and duplicate feedback" is satisfied by the existing ~1-minute outbox cron cadence plus UI polling/refresh on the lead workspace and dashboard — **not** a new synchronous call. *(Labeled interpretation.)*
2. **Net-new entities:** `property_addresses`, `parcels`, `structures`, `review_tasks` — all four are Phase 3's per spec §6.1 and §16 ("property resolution" and Property Discovery Worker's "Identify relevant building footprints" in §5.2).
3. **Pipeline flow:** `received` (lead intake) → `validating` (Address Validation Worker starts) → `enriching` (Property Discovery Worker starts) → `complete` (both succeed) or `review_required` (either worker escalates). These are all existing `pipeline_status` enum values from Phase 1 — no enum change needed.
4. **`properties.resolution_status` is implemented as `text` + a `check` constraint, not a native Postgres enum** (verified in `supabase/migrations/20260729161911_foundation.sql`). Extending it to include `'duplicate'` is therefore a plain `drop constraint` / `add constraint` pair inside one migration transaction — **not** the transaction-unsafe `alter type ... add value` case that applies to native enums. This corrects an assumption in the original ask; no special multi-transaction handling is required.
5. **Duplicate/merge design.** `submit_lead_intake` (Phase 2) always creates a fresh placeholder `properties` row per lead. The Address Validation Worker is where duplicate detection happens (spec §5.1, §6.4). When it finds exactly one existing non-placeholder property whose `property_addresses.canonical_address` (normalized) matches the newly validated address, created within the last **180 days** *(labeled default, not spec-mandated)*: it sets the placeholder's `resolution_status = 'duplicate'` and `merged_into_property_id` to the canonical property's id, repoints `leads.property_id` at the canonical property, and still writes a `property_addresses` row (against the canonical property) recording the new observation. Zero candidates proceeds normally; more than one candidate is ambiguous and creates a `review_tasks` row (`reason = 'duplicate_candidates'`) instead of auto-merging.
6. **Review task actions and reasons.** `review_tasks.status`: `open | resolved | rejected | retried | unsupported`. `review_tasks.reason`: `low_address_confidence | duplicate_candidates | multiple_parcels | condo_ambiguity | commercial_property | unsupported_property_type` — the subset of spec §5.10's ten triggers that Phase 3's two workers can actually detect (GIS/measurement-conflict triggers are Phase 4's). Resolving/rejecting/retrying/marking-unsupported all go through one `security definer` SQL function, `resolve_review_task`, mirroring the `change_lead_stage` pattern from Phase 2, because the action always spans `review_tasks` plus at least one of `properties`, `leads`, or `pipeline_runs`.
7. **Retry mechanics.** A domain event's idempotency key (`${name}:${pipelineRunId}`) intentionally allows an event name to be enqueued only once per pipeline run — correct for duplicate-delivery protection, but it would also block a legitimate reviewer-triggered retry of the same logical step. Phase 3 adds an `attempt` field (default `1`) to the `data` payload of both new event types; `createEventEnvelope` derives the idempotency key as `${name}:${pipelineRunId}:${attempt}` for these two event types only (existing event types are unchanged). `resolve_review_task`'s `retry` action returns the next attempt number; the calling server action re-publishes the original triggering event with that attempt number, producing a fresh, non-duplicate `worker_runs` row. *(Labeled default — full selective re-enrichment tooling is Phase 6's scope; this is the minimum needed for a working "Retry" button.)*
8. **Provider adapters are real, live HTTP integrations**, not stubs, wrapped through the existing `ProviderAdapter<I, O>` interface and registered in a `ProviderRegistry`. Both are free (`paid: false`). Because the existing `evaluateProviderRequest` in `src/modules/providers/cost-policy.ts` unconditionally returns `{ allowed: false, reason: "paid_providers_disabled" }` whenever `paidProvidersEnabled` is false — it has no branch for free adapters — **Phase 3 workers skip `evaluateProviderRequest` entirely for `paid: false` adapters** and call `registry.resolve(capability).execute(...)` directly. This is a labeled interpretation of design decision #8: the cost-policy contract itself is untouched (not relitigated), but callers only invoke it for adapters where `adapter.paid === true`. Every call still writes one `provider_requests` row (`estimated_cost_micros = 0`) and, on the first successful attempt, one `source_records` row, preserving the evidence trail even for free providers.
9. **Unit tests mock `fetch`.** Automated tests never call the real network. Each provider task's manual verification step hits the real Census/NJGIN endpoints exactly once, by hand, respecting rate limits.
10. **Map library:** Leaflet + OpenStreetMap tiles via `react-leaflet`, rendering GeoJSON parcel polygons and candidate markers. Not spec-mandated by name; the only mapping requirement is spec §5.10/§10.8's "shows candidates... including maps."
11. **`OWNER_NAME` is never stored or displayed anywhere** (Daniel's Law, spec §9.2/§12) — the `parcels` table has no such column, the pure NJGIN-response parser never copies it, and a unit test asserts this explicitly.
12. **Parcel-geometry disclaimer.** Every UI surface that renders parcel geometry or the map shows: "Parcel geometry is analytical and is not a legal survey." (spec line 165/584).
13. **Cross-table admin-invoked writes use `security definer` SQL functions restricted to `service_role`** (mirroring `submit_lead_intake`/`change_lead_stage`); single-table worker writes use direct service-role table operations gated by unique constraints (mirroring `crm-writer.ts`) — no new SQL functions for worker internals.

## Scope and Plan Sequence

1. Foundation — complete (Phase 1 plan)
2. CRM — complete (Phase 2 plan)
3. **Property identity — this plan** — address validation, duplicate matching, NJ parcel discovery, maps, property resolution, and human review
4. Property intelligence — public records, GIS, roof analysis, confidence, and evidence display
5. Commercial intelligence — scoring, price books, estimates, reports, and PDF export
6. Operations — re-enrichment, budgets, observability, replay, recovery, and production hardening

Phase 3 is complete when a submitted lead is automatically address-validated against the real Census Geocoder, resolved against a real NJ parcel via NJGIN, and its Property Profile shows canonical address, block/lot/qualifier, PAMS PIN, acreage, year built, and values on a Leaflet parcel map — or, when identity is ambiguous, a review task appears in a working Review Queue that an admin can resolve, reject, retry, or mark unsupported — all durably processed through the existing outbox/Inngest pattern and idempotent under duplicate delivery.

## File Map

### Domain Contracts

- `src/domain/property-identity.ts` — `addressMatchMethodSchema`, `addressValidationResultSchema`, `parcelDataSchema`, `reviewTaskReasonSchema`, `reviewTaskStatusSchema`, `duplicateMatchDecisionSchema`
- `src/domain/events.ts` — extended with `property/address.validation_requested`, `property/discovery_requested`

### Database

- `supabase/migrations/<timestamp>_property_identity.sql` — new tables, `resolution_status` extension, RLS, `resolve_review_task`
- `supabase/tests/property-identity.test.sql` — pgTAP schema, RLS, and function assertions (new file, one-per-phase, matching the `foundation.test.sql`/`crm.test.sql` precedent)
- `src/lib/database.types.ts` — regenerated after each migration change

### Providers

- `src/modules/providers/adapters/census-geocode.ts`
- `src/modules/providers/adapters/njgin-parcel-lookup.ts`
- `src/modules/providers/property-identity-registry.ts`

### CRM Writer Trigger

- `src/inngest/client.ts` — modified to register the two new event types
- `src/inngest/functions/crm-writer.ts` — modified to publish `property/address.validation_requested`

### Address Validation Worker

- `src/modules/property-identity/normalize-address.ts`
- `src/modules/property-identity/decide-duplicate-match.ts`
- `src/inngest/functions/address-validation-worker.ts`

### Property Discovery Worker

- `src/modules/property-identity/decide-parcel-resolution.ts`
- `src/inngest/functions/property-discovery-worker.ts`

### Review Queue

- `src/app/(app)/review/page.tsx`
- `src/app/(app)/review/[reviewTaskId]/page.tsx`
- `src/app/(app)/review/[reviewTaskId]/review-actions.ts`
- `src/app/(app)/review/[reviewTaskId]/parcel-map.tsx`
- `src/app/(app)/page.tsx` — modified: real review-queue count

### Property Profile

- `src/app/(app)/leads/[leadId]/page.tsx` — modified: parcel/structure fields, map, disclaimer

---

### Task 1: Extend Domain Contracts for Property Identity

**Files:**
- Create: `src/domain/property-identity.ts`
- Create: `src/domain/property-identity.test.ts`
- Modify: `src/domain/events.ts`
- Modify: `src/domain/events.test.ts`

**Interfaces:**
- Consumes: `uuidSchema` from `src/domain/ids.ts`, `confidenceSchema` from `src/domain/evidence.ts`
- Produces: `addressMatchMethodSchema`, `addressValidationResultSchema`, `AddressValidationResult`, `parcelDataSchema`, `ParcelData`, `reviewTaskReasonSchema`, `reviewTaskStatusSchema`, `duplicateMatchDecisionSchema`, `DuplicateMatchDecision`, extended `eventEnvelopeSchema` and `createEventEnvelope(input)` accepting `property/address.validation_requested` and `property/discovery_requested`

- [ ] **Step 1: Write failing tests for the property-identity schemas**

Create `src/domain/property-identity.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  addressMatchMethodSchema,
  addressValidationResultSchema,
  duplicateMatchDecisionSchema,
  parcelDataSchema,
  reviewTaskReasonSchema,
  reviewTaskStatusSchema,
} from "./property-identity";

test("address match method is explicit", () => {
  expect(addressMatchMethodSchema.options).toEqual([
    "exact_single_match",
    "no_match",
    "multiple_matches",
  ]);
});

test("address validation result requires a confidence and match method", () => {
  const result = addressValidationResultSchema.parse({
    submittedAddress: "1600 Pennsylvania Ave, Washington DC",
    canonicalAddress: "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500",
    latitude: 38.89869893252,
    longitude: -77.03518753691,
    municipality: "WASHINGTON",
    county: null,
    stateCode: null,
    zip: "20500",
    matchMethod: "exact_single_match",
    confidence: 97,
  });
  expect(result.confidence).toBe(97);
});

test("parcel data never accepts an owner name field", () => {
  const parcel = parcelDataSchema.parse({
    block: "101",
    lot: "5",
    qualifier: null,
    pamsPin: "0101_5_",
    gisPin: null,
    municipalityCode: "0101",
    municipalityName: "TRENTON CITY",
    county: "MERCER",
    propertyClass: "2",
    acreage: 0.25,
    yearBuilt: 1975,
    landValue: 50000,
    improvementValue: 150000,
    netValue: 200000,
    propertyLocation: "12 BIRCH ST",
    streetAddress: "12 BIRCH ST",
    buildingDescription: null,
    landDescription: null,
    dwellingUnits: 1,
    geometry: { type: "Polygon", coordinates: [] },
  });
  expect(parcel).not.toHaveProperty("ownerName");
});

test("review task reason and status are explicit", () => {
  expect(reviewTaskReasonSchema.options).toEqual([
    "low_address_confidence",
    "duplicate_candidates",
    "multiple_parcels",
    "condo_ambiguity",
    "commercial_property",
    "unsupported_property_type",
  ]);
  expect(reviewTaskStatusSchema.options).toEqual([
    "open",
    "resolved",
    "rejected",
    "retried",
    "unsupported",
  ]);
});

test("duplicate match decision is a discriminated union", () => {
  expect(duplicateMatchDecisionSchema.parse({ outcome: "no_match" })).toEqual({
    outcome: "no_match",
  });
  expect(() => duplicateMatchDecisionSchema.parse({ outcome: "merge" })).toThrow();
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm run test:run -- src/domain/property-identity.test.ts
```

Expected: FAIL because `./property-identity` does not exist.

- [ ] **Step 3: Implement the property-identity schemas**

Create `src/domain/property-identity.ts`:

```ts
import { z } from "zod";
import { uuidSchema } from "./ids";
import { confidenceSchema } from "./evidence";

export const addressMatchMethodSchema = z.enum([
  "exact_single_match",
  "no_match",
  "multiple_matches",
]);

export const addressValidationResultSchema = z.object({
  submittedAddress: z.string().min(1),
  canonicalAddress: z.string().min(1).nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  municipality: z.string().nullable(),
  county: z.string().nullable(),
  stateCode: z.literal("NJ").nullable(),
  zip: z.string().nullable(),
  matchMethod: addressMatchMethodSchema,
  confidence: confidenceSchema,
});
export type AddressValidationResult = z.infer<typeof addressValidationResultSchema>;

export const parcelDataSchema = z.object({
  block: z.string().min(1),
  lot: z.string().min(1),
  qualifier: z.string().nullable(),
  pamsPin: z.string().nullable(),
  gisPin: z.string().nullable(),
  municipalityCode: z.string().nullable(),
  municipalityName: z.string().nullable(),
  county: z.string().nullable(),
  propertyClass: z.string().nullable(),
  acreage: z.number().nonnegative().nullable(),
  yearBuilt: z.number().int().positive().nullable(),
  landValue: z.number().nonnegative().nullable(),
  improvementValue: z.number().nonnegative().nullable(),
  netValue: z.number().nonnegative().nullable(),
  propertyLocation: z.string().nullable(),
  streetAddress: z.string().nullable(),
  buildingDescription: z.string().nullable(),
  landDescription: z.string().nullable(),
  dwellingUnits: z.number().int().nonnegative().nullable(),
  // Opaque GeoJSON polygon geometry; domain layer does not interpret it.
  geometry: z.record(z.string(), z.unknown()).nullable(),
});
export type ParcelData = z.infer<typeof parcelDataSchema>;

export const reviewTaskReasonSchema = z.enum([
  "low_address_confidence",
  "duplicate_candidates",
  "multiple_parcels",
  "condo_ambiguity",
  "commercial_property",
  "unsupported_property_type",
]);

export const reviewTaskStatusSchema = z.enum([
  "open",
  "resolved",
  "rejected",
  "retried",
  "unsupported",
]);

export const duplicateMatchDecisionSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("no_match") }),
  z.object({ outcome: z.literal("merge"), canonicalPropertyId: uuidSchema }),
  z.object({
    outcome: z.literal("ambiguous"),
    candidatePropertyIds: z.array(uuidSchema).min(2),
  }),
]);
export type DuplicateMatchDecision = z.infer<typeof duplicateMatchDecisionSchema>;
```

- [ ] **Step 4: Write failing tests for the two new domain events, including attempt-aware idempotency keys**

Append to `src/domain/events.test.ts`:

```ts
describe("property/address.validation_requested event", () => {
  test("defaults attempt to 1 with an unsuffixed idempotency key", () => {
    const event = createEventEnvelope({
      name: "property/address.validation_requested",
      correlationId: "11111111-1111-4111-8111-111111111111",
      pipelineRunId: "22222222-2222-4222-8222-222222222222",
      leadId: "55555555-5555-4555-8555-555555555555",
      propertyId: "66666666-6666-4666-8666-666666666666",
      data: {
        leadId: "55555555-5555-4555-8555-555555555555",
        propertyId: "66666666-6666-4666-8666-666666666666",
        submittedAddress: "12 Birch St, Trenton, NJ",
        attempt: 1,
      },
    });

    expect(eventEnvelopeSchema.parse(event)).toMatchObject({
      name: "property/address.validation_requested",
      idempotencyKey: "property/address.validation_requested:22222222-2222-4222-8222-222222222222:1",
    });
  });

  test("a retried attempt produces a distinct idempotency key", () => {
    const event = createEventEnvelope({
      name: "property/address.validation_requested",
      correlationId: "11111111-1111-4111-8111-111111111111",
      pipelineRunId: "22222222-2222-4222-8222-222222222222",
      leadId: "55555555-5555-4555-8555-555555555555",
      propertyId: "66666666-6666-4666-8666-666666666666",
      data: {
        leadId: "55555555-5555-4555-8555-555555555555",
        propertyId: "66666666-6666-4666-8666-666666666666",
        submittedAddress: "12 Birch St, Trenton, NJ",
        attempt: 2,
      },
    });

    expect(event.idempotencyKey).toBe(
      "property/address.validation_requested:22222222-2222-4222-8222-222222222222:2",
    );
  });
});

describe("property/discovery_requested event", () => {
  test("creates a versioned discovery-requested event", () => {
    const event = createEventEnvelope({
      name: "property/discovery_requested",
      correlationId: "11111111-1111-4111-8111-111111111111",
      pipelineRunId: "22222222-2222-4222-8222-222222222222",
      leadId: "55555555-5555-4555-8555-555555555555",
      propertyId: "66666666-6666-4666-8666-666666666666",
      data: {
        leadId: "55555555-5555-4555-8555-555555555555",
        propertyId: "66666666-6666-4666-8666-666666666666",
        canonicalAddress: "12 BIRCH ST, TRENTON, NJ, 08611",
        latitude: 40.22,
        longitude: -74.76,
        attempt: 1,
      },
    });

    expect(eventEnvelopeSchema.parse(event)).toMatchObject({
      name: "property/discovery_requested",
      idempotencyKey: "property/discovery_requested:22222222-2222-4222-8222-222222222222:1",
    });
  });
});
```

- [ ] **Step 5: Run and confirm failure**

```bash
npm run test:run -- src/domain/events.test.ts
```

Expected: FAIL because the two event names are not members of `eventEnvelopeSchema` and `createEventEnvelope` does not compute attempt-suffixed idempotency keys.

- [ ] **Step 6: Extend the discriminated event union with attempt-aware idempotency keys**

Modify `src/domain/events.ts`, adding alongside the existing schemas:

```ts
export const addressValidationRequestedDataSchema = z.object({
  leadId: uuidSchema,
  propertyId: uuidSchema,
  submittedAddress: z.string().min(1),
  attempt: z.number().int().positive().default(1),
});

const addressValidationRequestedSchema = z.object({
  id: uuidSchema,
  name: z.literal("property/address.validation_requested"),
  schemaVersion: z.literal(1),
  correlationId: uuidSchema,
  causationEventId: uuidSchema.optional(),
  leadId: uuidSchema,
  propertyId: uuidSchema,
  pipelineRunId: uuidSchema,
  occurredAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1),
  data: addressValidationRequestedDataSchema,
});

export const propertyDiscoveryRequestedDataSchema = z.object({
  leadId: uuidSchema,
  propertyId: uuidSchema,
  canonicalAddress: z.string().min(1),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  attempt: z.number().int().positive().default(1),
});

const propertyDiscoveryRequestedSchema = z.object({
  id: uuidSchema,
  name: z.literal("property/discovery_requested"),
  schemaVersion: z.literal(1),
  correlationId: uuidSchema,
  causationEventId: uuidSchema.optional(),
  leadId: uuidSchema,
  propertyId: uuidSchema,
  pipelineRunId: uuidSchema,
  occurredAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1),
  data: propertyDiscoveryRequestedDataSchema,
});

export const eventEnvelopeSchema = z.discriminatedUnion("name", [
  diagnosticRequestedSchema,
  leadSubmittedSchema,
  addressValidationRequestedSchema,
  propertyDiscoveryRequestedSchema,
]);

export type DomainEvent = z.infer<typeof eventEnvelopeSchema>;

// Event names whose idempotency key incorporates a retry `attempt` number
// (Phase 3's review-task "retry" action). Existing event types are
// unaffected — the omitted `else` branch below preserves their key format.
const ATTEMPT_AWARE_EVENT_NAMES = new Set([
  "property/address.validation_requested",
  "property/discovery_requested",
]);

type EventInput =
  | { name: "system/diagnostic.requested"; correlationId: string; pipelineRunId: string; causationEventId?: string; data: z.infer<typeof diagnosticRequestedDataSchema>; now?: Date; id?: string }
  | { name: "crm/lead.submitted"; correlationId: string; pipelineRunId: string; leadId: string; propertyId: string; causationEventId?: string; data: z.infer<typeof leadSubmittedDataSchema>; now?: Date; id?: string }
  | { name: "property/address.validation_requested"; correlationId: string; pipelineRunId: string; leadId: string; propertyId: string; causationEventId?: string; data: z.infer<typeof addressValidationRequestedDataSchema>; now?: Date; id?: string }
  | { name: "property/discovery_requested"; correlationId: string; pipelineRunId: string; leadId: string; propertyId: string; causationEventId?: string; data: z.infer<typeof propertyDiscoveryRequestedDataSchema>; now?: Date; id?: string };

export function createEventEnvelope(input: EventInput): DomainEvent {
  const id = input.id ?? crypto.randomUUID();
  const attempt = ATTEMPT_AWARE_EVENT_NAMES.has(input.name)
    ? ((input.data as { attempt?: number }).attempt ?? 1)
    : undefined;
  const idempotencyKey = attempt
    ? `${input.name}:${input.pipelineRunId}:${attempt}`
    : `${input.name}:${input.pipelineRunId}`;

  return eventEnvelopeSchema.parse({
    ...input,
    id,
    schemaVersion: 1,
    occurredAt: (input.now ?? new Date()).toISOString(),
    idempotencyKey,
  });
}
```

- [ ] **Step 7: Run focused and full gates**

```bash
npm run test:run -- src/domain
npm run test:run
npm run lint
npm run typecheck
```

Expected: all commands exit 0; the existing `system/diagnostic.requested` and `crm/lead.submitted` tests still pass unmodified.

- [ ] **Step 8: Commit the property-identity domain contracts**

```bash
git add src/domain/property-identity.ts src/domain/property-identity.test.ts src/domain/events.ts src/domain/events.test.ts
git commit -m "feat: extend domain contracts for property identity"
```

---

### Task 2: Create the Property Identity Database Schema and RLS Policies

**Files:**
- Create: `supabase/migrations/<timestamp>_property_identity.sql` (run `npx supabase migration new property_identity`)
- Create: `supabase/tests/property-identity.test.sql`
- Modify: `src/lib/database.types.ts`

**Interfaces:**
- Consumes: `addressMatchMethodSchema`, `reviewTaskReasonSchema`, `reviewTaskStatusSchema` from Task 1 (source of truth for enum value lists); `current_company_id()` from the foundation migration
- Produces: enums `address_match_method`, `review_task_reason`, `review_task_status`; tables `property_addresses`, `parcels`, `structures`, `review_tasks`; `properties.resolution_status` extended with `'duplicate'`; `properties.merged_into_property_id`

- [ ] **Step 1: Generate the migration file**

```bash
npx supabase migration new property_identity
```

Use the generated timestamped filename for the remainder of this plan wherever `<timestamp>_property_identity.sql` appears.

- [ ] **Step 2: Write failing pgTAP schema and RLS assertions**

Create `supabase/tests/property-identity.test.sql`:

```sql
begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

select has_table('public', 'property_addresses', 'property_addresses exists');
select has_table('public', 'parcels', 'parcels exists');
select has_table('public', 'structures', 'structures exists');
select has_table('public', 'review_tasks', 'review_tasks exists');
select hasnt_column('public', 'parcels', 'owner_name', 'parcels never stores owner_name (Daniel''s Law)');
select has_column('public', 'properties', 'merged_into_property_id', 'properties gains a merge pointer');

select policies_are(
  'public', 'property_addresses',
  array['company admins read property addresses'],
  'property_addresses has a single read policy'
);
select policies_are(
  'public', 'parcels',
  array['company admins read parcels'],
  'parcels has a single read policy'
);
select policies_are(
  'public', 'structures',
  array['company admins read structures'],
  'structures has a single read policy'
);
select policies_are(
  'public', 'review_tasks',
  array['company admins read review tasks'],
  'review_tasks has a single read policy'
);

select is(
  has_table_privilege('anon', 'public.review_tasks', 'select'),
  false,
  'anonymous users cannot select review tasks'
);
select is(
  has_table_privilege('authenticated', 'public.review_tasks', 'insert'),
  false,
  'authenticated admins cannot directly insert review tasks'
);
select is(
  has_table_privilege('authenticated', 'public.parcels', 'insert'),
  false,
  'authenticated admins cannot directly insert parcels'
);
select is(
  has_table_privilege('service_role', 'public.property_addresses', 'insert'),
  true,
  'service role can insert property addresses'
);

insert into public.companies (id, name)
values ('00000000-0000-4000-8000-000000000001', 'PIW Local Roofing')
on conflict (id) do nothing;

select lives_ok(
  $$ insert into public.properties (id, company_id, resolution_status)
     values ('77777777-7777-4777-8777-777777777777', '00000000-0000-4000-8000-000000000001', 'duplicate') $$,
  'resolution_status accepts the new duplicate value'
);
select throws_ok(
  $$ insert into public.properties (id, company_id, resolution_status)
     values ('88888888-8888-4888-8888-888888888888', '00000000-0000-4000-8000-000000000001', 'bogus') $$,
  '23514',
  null,
  'resolution_status still rejects unknown values'
);

select is(
  (select count(*) from public.review_tasks where reason = 'low_address_confidence'),
  0::bigint,
  'review_task_reason accepts low_address_confidence as a valid enum member'
);
select function_privs_are(
  'public', 'resolve_review_task', array['uuid','uuid','text','uuid','integer','text'],
  'authenticated', array[]::text[],
  'authenticated role cannot call resolve_review_task directly'
);

select * from finish();

rollback;
```

- [ ] **Step 3: Run and confirm failure**

```bash
npm run db:reset
npm run db:test
```

Expected: FAIL because none of the new tables, columns, or the `resolve_review_task` function exist yet.

- [ ] **Step 4: Implement the schema migration**

Write `supabase/migrations/<timestamp>_property_identity.sql`:

```sql
-- Extend property resolution lifecycle with a duplicate outcome and a merge
-- pointer. `resolution_status` is a text column with an inline check
-- constraint (not a native enum), so this is a plain constraint swap inside
-- one transaction — not the transaction-unsafe `alter type ... add value`
-- case that would apply to a real Postgres enum.
alter table public.properties
  drop constraint properties_resolution_status_check;
alter table public.properties
  add constraint properties_resolution_status_check
  check (resolution_status in ('unresolved', 'resolved', 'review_required', 'unsupported', 'duplicate'));

alter table public.properties
  add column merged_into_property_id uuid references public.properties(id);

create index properties_merged_into_property_id_idx
  on public.properties(merged_into_property_id)
  where merged_into_property_id is not null;

create type public.address_match_method as enum (
  'exact_single_match', 'no_match', 'multiple_matches'
);

create table public.property_addresses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  property_id uuid not null references public.properties(id),
  submitted_address text not null check (length(trim(submitted_address)) > 0),
  canonical_address text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  location extensions.geography(point, 4326),
  municipality text,
  county text,
  state_code text check (state_code = 'NJ'),
  zip text,
  match_method public.address_match_method not null,
  confidence smallint not null check (confidence between 0 and 100),
  provider_request_id uuid references public.provider_requests(id),
  created_at timestamptz not null default now()
);

create table public.parcels (
  -- Deliberately no owner_name column: NJGIN ownership is redacted under
  -- Daniel's Law and must never be stored (architecture spec §9.2, §12).
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  property_id uuid not null references public.properties(id),
  is_primary boolean not null default true,
  block text not null check (length(trim(block)) > 0),
  lot text not null check (length(trim(lot)) > 0),
  qualifier text,
  pams_pin text,
  gis_pin text,
  municipality_code text,
  municipality_name text,
  county text,
  property_class text,
  acreage numeric(10, 4) check (acreage >= 0),
  year_built integer check (year_built > 1600),
  land_value_cents bigint check (land_value_cents >= 0),
  improvement_value_cents bigint check (improvement_value_cents >= 0),
  net_value_cents bigint check (net_value_cents >= 0),
  property_location text,
  street_address text,
  building_description text,
  land_description text,
  dwelling_units integer check (dwelling_units >= 0),
  geometry extensions.geography(polygon, 4326),
  provider_request_id uuid references public.provider_requests(id),
  created_at timestamptz not null default now()
);

create table public.structures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  property_id uuid not null references public.properties(id),
  parcel_id uuid references public.parcels(id),
  is_primary boolean not null default true,
  -- Building-footprint geometry is a placeholder until Phase 4's GIS Worker
  -- refines it; Phase 3 derives it from the parcel record only.
  footprint_geometry extensions.geography(polygon, 4326),
  source text not null check (length(trim(source)) > 0),
  created_at timestamptz not null default now()
);

create type public.review_task_reason as enum (
  'low_address_confidence',
  'duplicate_candidates',
  'multiple_parcels',
  'condo_ambiguity',
  'commercial_property',
  'unsupported_property_type'
);

create type public.review_task_status as enum (
  'open', 'resolved', 'rejected', 'retried', 'unsupported'
);

create table public.review_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  pipeline_run_id uuid not null references public.pipeline_runs(id),
  lead_id uuid not null references public.leads(id),
  property_id uuid not null references public.properties(id),
  reason public.review_task_reason not null,
  status public.review_task_status not null default 'open',
  -- Which triggering event to re-publish on "retry"; reconstructed by the
  -- calling server action rather than fully replayed from storage.
  triggering_event_name text not null
    check (triggering_event_name in (
      'property/address.validation_requested', 'property/discovery_requested'
    )),
  candidate_data jsonb not null default '[]'::jsonb,
  retry_count integer not null default 0 check (retry_count >= 0),
  resolution_notes text,
  resolved_by uuid references public.admin_profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- At most one open review task per pipeline run keeps the review queue and
-- worker idempotency aligned under duplicate event delivery.
create unique index review_tasks_open_pipeline_run_idx
  on public.review_tasks(pipeline_run_id)
  where status = 'open';

create index property_addresses_company_id_idx on public.property_addresses(company_id);
create index property_addresses_property_id_idx on public.property_addresses(property_id, created_at desc);
create index parcels_company_id_idx on public.parcels(company_id);
-- Unique (not just indexed): guards against a duplicate-delivered
-- Property Discovery Worker run inserting a second primary parcel for the
-- same property (see Task 7's recordParcel, which catches 23505 on this).
create unique index parcels_property_id_primary_idx on public.parcels(property_id) where is_primary;
create index structures_company_id_idx on public.structures(company_id);
create index structures_property_id_idx on public.structures(property_id);
-- Unique (not just indexed): same duplicate-delivery guard as parcels above,
-- for Task 7's recordStructure.
create unique index structures_property_id_primary_idx on public.structures(property_id) where is_primary;
create index structures_parcel_id_idx on public.structures(parcel_id);
create index review_tasks_company_id_idx on public.review_tasks(company_id);
create index review_tasks_open_idx on public.review_tasks(company_id, created_at desc) where status = 'open';
create index review_tasks_property_id_idx on public.review_tasks(property_id);

alter table public.property_addresses enable row level security;
alter table public.parcels enable row level security;
alter table public.structures enable row level security;
alter table public.review_tasks enable row level security;

revoke all on public.property_addresses from anon, authenticated;
revoke all on public.parcels from anon, authenticated;
revoke all on public.structures from anon, authenticated;
revoke all on public.review_tasks from anon, authenticated;

-- service_role bypasses RLS but, as in prior migrations, this local Postgres
-- image grants it no implicit table privileges.
grant all on public.property_addresses to service_role;
grant all on public.parcels to service_role;
grant all on public.structures to service_role;
grant all on public.review_tasks to service_role;

grant select on public.property_addresses to authenticated;
grant select on public.parcels to authenticated;
grant select on public.structures to authenticated;
grant select on public.review_tasks to authenticated;

create policy "company admins read property addresses" on public.property_addresses
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read parcels" on public.parcels
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read structures" on public.structures
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read review tasks" on public.review_tasks
  for select to authenticated
  using (company_id = (select public.current_company_id()));
```

This migration intentionally does not yet include `resolve_review_task` (Task 8 appends it once the Review Queue needs it — following the Phase 2 precedent of `submit_lead_intake` landing in the same migration file but a later task).

Append a placeholder `resolve_review_task` stub so the pgTAP assertion in Step 2 can pass at this stage without waiting for Task 8's full behavior:

```sql
create or replace function public.resolve_review_task(
  p_company_id uuid,
  p_review_task_id uuid,
  p_action text,
  p_admin_id uuid,
  p_selected_candidate_index integer,
  p_notes text
) returns table (
  new_status public.review_task_status,
  pipeline_run_id uuid,
  property_id uuid,
  next_attempt integer
)
language plpgsql security definer
set search_path = ''
as $$
begin
  raise exception 'resolve_review_task is not yet implemented (Task 8)';
end;
$$;

revoke all on function public.resolve_review_task(uuid, uuid, text, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.resolve_review_task(uuid, uuid, text, uuid, integer, text)
  to service_role;
```

- [ ] **Step 5: Reset and run pgTAP**

```bash
npm run db:reset
npm run db:test
```

Expected: all 19 assertions pass.

- [ ] **Step 6: Regenerate database types**

```bash
npm run db:types -- --schema public > src/lib/database.types.ts
```

Expected: `Database["public"]["Tables"]` now includes `property_addresses`, `parcels`, `structures`, `review_tasks`, and `properties.Row.merged_into_property_id`.

- [ ] **Step 7: Run full gates**

```bash
npm run test:run
npm run db:test
npm run lint
npm run typecheck
```

- [ ] **Step 8: Commit the property-identity schema**

```bash
git add supabase/migrations supabase/tests/property-identity.test.sql src/lib/database.types.ts
git commit -m "feat: add property identity schema, RLS policies, and duplicate resolution status"
```

---

### Task 3: Implement the Census Geocode Address-Validation Provider

**Files:**
- Create: `src/modules/providers/adapters/census-geocode.ts`
- Create: `src/modules/providers/adapters/census-geocode.test.ts`

**Interfaces:**
- Consumes: `ProviderAdapter<I, O>`, `ProviderRequestContext`, `ProviderResult<T>` from `src/modules/providers/contracts.ts`; `AddressValidationResult`, `addressValidationResultSchema` from Task 1
- Produces: `parseCensusGeocodeResponse(raw, submittedAddress)`, `censusGeocodeAddressValidationProvider: ProviderAdapter<{ submittedAddress: string }, AddressValidationResult>`

- [ ] **Step 1: Write failing tests for the pure response parser using literal fixtures**

Create `src/modules/providers/adapters/census-geocode.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { parseCensusGeocodeResponse, censusGeocodeAddressValidationProvider } from "./census-geocode";

const SINGLE_MATCH_FIXTURE = {
  result: {
    addressMatches: [
      {
        coordinates: { x: -77.03518753691, y: 38.89869893252 },
        matchedAddress: "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500",
        addressComponents: {
          fromAddress: "1600",
          streetName: "PENNSYLVANIA",
          suffixType: "AVE",
          suffixDirection: "NW",
          city: "WASHINGTON",
          state: "DC",
          zip: "20500",
        },
        tigerLine: { tigerLineId: "76225813", side: "L" },
      },
    ],
  },
};

const NO_MATCH_FIXTURE = { result: { addressMatches: [] } };

const MULTIPLE_MATCH_FIXTURE = {
  result: {
    addressMatches: [
      { ...SINGLE_MATCH_FIXTURE.result.addressMatches[0] },
      {
        ...SINGLE_MATCH_FIXTURE.result.addressMatches[0],
        matchedAddress: "1600 PENNSYLVANIA AVE SE, WASHINGTON, DC, 20003",
      },
    ],
  },
};

describe("parseCensusGeocodeResponse", () => {
  test("a single match is high confidence", () => {
    const result = parseCensusGeocodeResponse(SINGLE_MATCH_FIXTURE, "1600 Pennsylvania Ave");
    expect(result).toMatchObject({
      canonicalAddress: "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500",
      latitude: 38.89869893252,
      longitude: -77.03518753691,
      municipality: "WASHINGTON",
      zip: "20500",
      matchMethod: "exact_single_match",
      confidence: 97,
    });
  });

  test("zero matches is zero confidence", () => {
    const result = parseCensusGeocodeResponse(NO_MATCH_FIXTURE, "12 Nowhere Ave");
    expect(result).toMatchObject({
      canonicalAddress: null,
      matchMethod: "no_match",
      confidence: 0,
    });
  });

  test("multiple matches is ambiguous, below the review threshold", () => {
    const result = parseCensusGeocodeResponse(MULTIPLE_MATCH_FIXTURE, "1600 Pennsylvania Ave");
    expect(result).toMatchObject({ matchMethod: "multiple_matches", confidence: 40 });
    expect(result.confidence).toBeLessThan(95);
  });

  test("a non-NJ match still parses but is flagged with a null NJ state code", () => {
    const result = parseCensusGeocodeResponse(SINGLE_MATCH_FIXTURE, "1600 Pennsylvania Ave");
    expect(result.stateCode).toBeNull();
  });
});

describe("censusGeocodeAddressValidationProvider", () => {
  test("calls the Census one-line-address endpoint and returns a provider result", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SINGLE_MATCH_FIXTURE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await censusGeocodeAddressValidationProvider.execute(
      { submittedAddress: "1600 Pennsylvania Ave, Washington DC" },
      {
        companyId: "company-1",
        pipelineRunId: "run-1",
        correlationId: "corr-1",
        requestKey: "address.validate:run-1",
        deploymentEnvironment: "test",
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"),
    );
    expect(result.value.matchMethod).toBe("exact_single_match");
    expect(result.provider).toBe("census_geocoder");
    expect(result.estimatedCostMicros).toBe(0);

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm run test:run -- src/modules/providers/adapters/census-geocode.test.ts
```

Expected: FAIL because `./census-geocode` does not exist.

- [ ] **Step 3: Implement the pure parser and the HTTP-calling adapter**

Create `src/modules/providers/adapters/census-geocode.ts`:

```ts
import "server-only";
import type { ProviderAdapter, ProviderRequestContext, ProviderResult } from "../contracts";
import type { AddressValidationResult } from "@/domain/property-identity";

type CensusAddressMatch = {
  coordinates: { x: number; y: number };
  matchedAddress: string;
  addressComponents: {
    city?: string;
    state?: string;
    zip?: string;
  };
};

type CensusGeocodeResponse = {
  result: { addressMatches: CensusAddressMatch[] };
};

export function parseCensusGeocodeResponse(
  raw: CensusGeocodeResponse,
  submittedAddress: string,
): AddressValidationResult {
  const matches = raw.result.addressMatches;

  if (matches.length === 0) {
    return {
      submittedAddress,
      canonicalAddress: null,
      latitude: null,
      longitude: null,
      municipality: null,
      county: null,
      stateCode: null,
      zip: null,
      matchMethod: "no_match",
      confidence: 0,
    };
  }

  if (matches.length > 1) {
    return {
      submittedAddress,
      canonicalAddress: null,
      latitude: null,
      longitude: null,
      municipality: null,
      county: null,
      stateCode: null,
      zip: null,
      matchMethod: "multiple_matches",
      confidence: 40,
    };
  }

  const [match] = matches;
  return {
    submittedAddress,
    canonicalAddress: match.matchedAddress,
    latitude: match.coordinates.y,
    longitude: match.coordinates.x,
    municipality: match.addressComponents.city ?? null,
    // The Census one-line-address geocoder does not return county; the
    // Property Discovery Worker's NJGIN lookup fills it in from COUNTY.
    county: null,
    // Census returns whatever state the address matched to, which may not
    // be NJ; PIW is NJ-only, so a non-NJ match is never labeled "NJ" here.
    stateCode: match.addressComponents.state === "NJ" ? "NJ" : null,
    zip: match.addressComponents.zip ?? null,
    matchMethod: "exact_single_match",
    confidence: 97,
  };
}

async function fetchCensusGeocode(submittedAddress: string): Promise<CensusGeocodeResponse> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", submittedAddress);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Census geocoder responded with ${response.status}`);
  return response.json() as Promise<CensusGeocodeResponse>;
}

export const censusGeocodeAddressValidationProvider: ProviderAdapter<
  { submittedAddress: string },
  AddressValidationResult
> = {
  id: "census-geocoder",
  capability: "address.validate",
  priority: 10,
  paid: false,
  enabled: true,
  async execute(
    input: { submittedAddress: string },
    _context: ProviderRequestContext,
  ): Promise<ProviderResult<AddressValidationResult>> {
    const raw = await fetchCensusGeocode(input.submittedAddress);
    const value = parseCensusGeocodeResponse(raw, input.submittedAddress);
    return {
      value,
      provider: "census_geocoder",
      sourceIdentifier: value.canonicalAddress ?? input.submittedAddress,
      retrievedAt: new Date().toISOString(),
      estimatedCostMicros: 0,
    };
  },
};
```

- [ ] **Step 4: Run gates**

```bash
npm run test:run -- src/modules/providers
npm run lint
npm run typecheck
```

- [ ] **Step 5: Manually verify against the real Census endpoint once**

```bash
curl -s "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=1600%20Pennsylvania%20Ave%20NW%2C%20Washington%2C%20DC&benchmark=Public_AR_Current&format=json" | head -c 800
```

Expected: a live JSON response with one `addressMatches` entry for the White House address, confirming the endpoint shape matches the fixture used in Step 1. Do not loop this call; run it once.

- [ ] **Step 6: Commit the Census provider**

```bash
git add src/modules/providers/adapters/census-geocode.ts src/modules/providers/adapters/census-geocode.test.ts
git commit -m "feat: add live Census Geocoder address-validation provider"
```

---

### Task 4: Implement the NJGIN Parcel-Lookup Provider and Registry

**Files:**
- Create: `src/modules/providers/adapters/njgin-parcel-lookup.ts`
- Create: `src/modules/providers/adapters/njgin-parcel-lookup.test.ts`
- Create: `src/modules/providers/property-identity-registry.ts`
- Create: `src/modules/providers/property-identity-registry.test.ts`

**Interfaces:**
- Consumes: `ProviderAdapter<I, O>` from `src/modules/providers/contracts.ts`, `ProviderRegistry` from `src/modules/providers/registry.ts`, `ParcelData` from Task 1, `censusGeocodeAddressValidationProvider` from Task 3
- Produces: `parseNjginParcelResponse(raw)`, `njginParcelLookupProvider: ProviderAdapter<{ lat: number; lng: number } | { address: string }, ParcelData[]>`, `createPropertyIdentityProviderRegistry()`

- [ ] **Step 1: Write failing tests for the pure GeoJSON parser, including a Daniel's Law guard**

Create `src/modules/providers/adapters/njgin-parcel-lookup.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { parseNjginParcelResponse, njginParcelLookupProvider } from "./njgin-parcel-lookup";

function feature(overrides: Record<string, unknown> = {}) {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
    properties: {
      PCLBLOCK: "101",
      PCLLOT: "5",
      PCLQCODE: null,
      PAMS_PIN: "0101_5_",
      GIS_PIN: "0101-5-",
      PCL_MUN: "0101",
      MUN_NAME: "TRENTON CITY",
      COUNTY: "MERCER",
      PROP_CLASS: "2",
      OWNER_NAME: "JANE DOE", // must never survive parsing (Daniel's Law)
      CALC_ACRE: 0.25,
      YR_CONSTR: 1975,
      LAND_VAL: 50000,
      IMPRVT_VAL: 150000,
      NET_VALUE: 200000,
      PROP_LOC: "12 BIRCH ST",
      ST_ADDRESS: "12 BIRCH ST",
      BLDG_DESC: null,
      LAND_DESC: null,
      DWELL: 1,
      ...overrides,
    },
  };
}

describe("parseNjginParcelResponse", () => {
  test("maps a single feature to ParcelData and drops OWNER_NAME entirely", () => {
    const candidates = parseNjginParcelResponse({ type: "FeatureCollection", features: [feature()] });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ block: "101", lot: "5", municipalityName: "TRENTON CITY" });
    expect(JSON.stringify(candidates)).not.toContain("JANE DOE");
    expect(JSON.stringify(candidates)).not.toMatch(/owner/i);
  });

  test("an empty feature collection returns no candidates", () => {
    expect(parseNjginParcelResponse({ type: "FeatureCollection", features: [] })).toEqual([]);
  });

  test("multiple features (e.g. condo units) return multiple candidates", () => {
    const candidates = parseNjginParcelResponse({
      type: "FeatureCollection",
      features: [feature(), feature({ PCLQCODE: "C0002" })],
    });
    expect(candidates).toHaveLength(2);
  });
});

describe("njginParcelLookupProvider", () => {
  test("queries the FeatureServer by point and returns parsed candidates", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ type: "FeatureCollection", features: [feature()] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await njginParcelLookupProvider.execute(
      { lat: 40.22, lng: -74.76 },
      {
        companyId: "company-1",
        pipelineRunId: "run-1",
        correlationId: "corr-1",
        requestKey: "parcel.lookup:run-1",
        deploymentEnvironment: "test",
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query",
      ),
    );
    expect(result.value).toHaveLength(1);
    expect(result.estimatedCostMicros).toBe(0);

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm run test:run -- src/modules/providers/adapters/njgin-parcel-lookup.test.ts
```

Expected: FAIL because `./njgin-parcel-lookup` does not exist.

- [ ] **Step 3: Implement the pure parser and the HTTP-calling adapter**

Create `src/modules/providers/adapters/njgin-parcel-lookup.ts`:

```ts
import "server-only";
import type { ProviderAdapter, ProviderRequestContext, ProviderResult } from "../contracts";
import type { ParcelData } from "@/domain/property-identity";

const NJGIN_QUERY_URL =
  "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query";

type NjginFeature = {
  geometry: Record<string, unknown> | null;
  properties: Record<string, unknown>;
};

type NjginFeatureCollection = { type: "FeatureCollection"; features: NjginFeature[] };

function toNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function parseNjginParcelResponse(raw: NjginFeatureCollection): ParcelData[] {
  // OWNER_NAME may be present on the raw feature (NJGIN's composite layer
  // includes it); it is read from nowhere below and therefore never enters
  // ParcelData. See Daniel's Law constraint in architecture spec §9.2/§12.
  return raw.features.map((feature) => {
    const p = feature.properties;
    return {
      block: String(p.PCLBLOCK),
      lot: String(p.PCLLOT),
      qualifier: toNullableString(p.PCLQCODE),
      pamsPin: toNullableString(p.PAMS_PIN),
      gisPin: toNullableString(p.GIS_PIN),
      municipalityCode: toNullableString(p.PCL_MUN),
      municipalityName: toNullableString(p.MUN_NAME),
      county: toNullableString(p.COUNTY),
      propertyClass: toNullableString(p.PROP_CLASS),
      acreage: toNullableNumber(p.CALC_ACRE),
      yearBuilt: toNullableNumber(p.YR_CONSTR),
      landValue: toNullableNumber(p.LAND_VAL),
      improvementValue: toNullableNumber(p.IMPRVT_VAL),
      netValue: toNullableNumber(p.NET_VALUE),
      propertyLocation: toNullableString(p.PROP_LOC),
      streetAddress: toNullableString(p.ST_ADDRESS),
      buildingDescription: toNullableString(p.BLDG_DESC),
      landDescription: toNullableString(p.LAND_DESC),
      dwellingUnits: toNullableNumber(p.DWELL),
      geometry: feature.geometry,
    };
  });
}

type NjginLookupInput = { lat: number; lng: number } | { address: string };

function buildWhereClause(input: NjginLookupInput): string {
  if ("address" in input) {
    const escaped = input.address.replace(/'/g, "''").toUpperCase();
    return `PROP_LOC LIKE '%${escaped}%' OR ST_ADDRESS LIKE '%${escaped}%'`;
  }
  // Point-in-polygon spatial filter is expressed via the `geometry`/`geometryType`
  // query params below, not the `where` clause, when lat/lng is supplied.
  return "1=1";
}

async function fetchNjginParcels(input: NjginLookupInput): Promise<NjginFeatureCollection> {
  const url = new URL(NJGIN_QUERY_URL);
  url.searchParams.set("outFields", "*");
  url.searchParams.set("f", "geojson");
  url.searchParams.set("where", buildWhereClause(input));

  if ("lat" in input) {
    url.searchParams.set("geometry", `${input.lng},${input.lat}`);
    url.searchParams.set("geometryType", "esriGeometryPoint");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  }

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`NJGIN parcel query responded with ${response.status}`);
  return response.json() as Promise<NjginFeatureCollection>;
}

export const njginParcelLookupProvider: ProviderAdapter<NjginLookupInput, ParcelData[]> = {
  id: "njgin-parcel-lookup",
  capability: "parcel.lookup",
  priority: 10,
  paid: false,
  enabled: true,
  async execute(
    input: NjginLookupInput,
    _context: ProviderRequestContext,
  ): Promise<ProviderResult<ParcelData[]>> {
    const raw = await fetchNjginParcels(input);
    const value = parseNjginParcelResponse(raw);
    const first = value[0];
    return {
      value,
      provider: "njgin_parcels_composite",
      sourceIdentifier: first ? `${first.municipalityCode}-${first.block}-${first.lot}` : "no-match",
      retrievedAt: new Date().toISOString(),
      estimatedCostMicros: 0,
    };
  },
};
```

- [ ] **Step 4: Write a failing test for the property-identity provider registry**

Create `src/modules/providers/property-identity-registry.test.ts`:

```ts
import { expect, test } from "vitest";
import { createPropertyIdentityProviderRegistry } from "./property-identity-registry";

test("resolves the free Census adapter for address.validate and NJGIN for parcel.lookup", () => {
  const registry = createPropertyIdentityProviderRegistry();
  expect(registry.resolve("address.validate").id).toBe("census-geocoder");
  expect(registry.resolve("parcel.lookup").id).toBe("njgin-parcel-lookup");
});
```

- [ ] **Step 5: Run and confirm failure**

```bash
npm run test:run -- src/modules/providers/property-identity-registry.test.ts
```

Expected: FAIL because `./property-identity-registry` does not exist.

- [ ] **Step 6: Implement the registry factory**

Create `src/modules/providers/property-identity-registry.ts`:

```ts
import { ProviderRegistry } from "./registry";
import { censusGeocodeAddressValidationProvider } from "./adapters/census-geocode";
import { njginParcelLookupProvider } from "./adapters/njgin-parcel-lookup";

export function createPropertyIdentityProviderRegistry() {
  return new ProviderRegistry([
    censusGeocodeAddressValidationProvider,
    njginParcelLookupProvider,
  ]);
}
```

- [ ] **Step 7: Run gates**

```bash
npm run test:run -- src/modules/providers
npm run lint
npm run typecheck
```

- [ ] **Step 8: Manually verify against the real NJGIN endpoint once**

```bash
curl -s "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query?where=MUN_NAME%3D%27TRENTON+CITY%27&outFields=PCLBLOCK,PCLLOT,MUN_NAME,COUNTY,PROP_CLASS&resultRecordCount=1&f=geojson" | head -c 800
```

Expected: a live GeoJSON `FeatureCollection` with at least one Trenton parcel, confirming field names match the parser. Run once, not in a loop.

- [ ] **Step 9: Commit the NJGIN provider and registry**

```bash
git add src/modules/providers/adapters/njgin-parcel-lookup.ts src/modules/providers/adapters/njgin-parcel-lookup.test.ts src/modules/providers/property-identity-registry.ts src/modules/providers/property-identity-registry.test.ts
git commit -m "feat: add live NJGIN parcel-lookup provider and property identity registry"
```

---

### Task 5: Trigger Address Validation from the CRM Writer

**Files:**
- Modify: `src/inngest/client.ts`
- Modify: `src/inngest/functions/crm-writer.ts`
- Modify: `src/inngest/functions/crm-writer.test.ts`

**Interfaces:**
- Consumes: `property/address.validation_requested` from Task 1, `SupabaseOutboxRepository` from Phase 1
- Produces: `addressValidationRequested`, `propertyDiscoveryRequested` typed Inngest events; `CrmWriterRepository.publishAddressValidationRequested(...)`

- [ ] **Step 1: Write a failing test asserting the CRM Writer publishes exactly once under duplicate delivery and no longer completes the pipeline itself**

Modify `src/inngest/functions/crm-writer.test.ts`: extend `FakeCrmWriterRepository` with a `publishAddressValidationRequested` method tracked by a `Set` keyed on `correlationId` (mirroring the existing notification-dedup fields), remove the `completePipelineRun`/`pipelineRunCompletions` tracking (Phase 3 supersedes it — see Step 3), and update the assertion:

```ts
test("duplicate delivery publishes address validation exactly once and never completes the pipeline itself", async () => {
  const repository = new FakeCrmWriterRepository();
  const event = {
    id: "44444444-4444-4444-8444-444444444444",
    pipelineRunId: "22222222-2222-4222-8222-222222222222",
    correlationId: "11111111-1111-4111-8111-111111111111",
    leadId: "66666666-6666-4666-8666-666666666666",
    propertyId: "77777777-7777-4777-8777-777777777777",
    submittedAddress: "12 Birch St, Trenton, NJ",
  };

  await writeCrmProjection(event, repository);
  await writeCrmProjection(event, repository);

  expect(repository.stageHistoryCount).toBe(1);
  expect(repository.notificationCount).toBe(1);
  expect(repository.addressValidationPublishCount).toBe(1);
  expect(repository.completions).toBe(1);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm run test:run -- src/inngest/functions/crm-writer.test.ts
```

Expected: FAIL because `publishAddressValidationRequested` and `addressValidationPublishCount` do not exist on the fake, and `writeCrmProjection` never calls the new method.

- [ ] **Step 3: Register the two new typed events on the Inngest client**

Modify `src/inngest/client.ts`, adding alongside the existing `eventType` exports:

```ts
type AddressValidationRequestedData = Extract<
  DomainEvent,
  { name: "property/address.validation_requested" }
>;
type PropertyDiscoveryRequestedData = Extract<
  DomainEvent,
  { name: "property/discovery_requested" }
>;

export const addressValidationRequested = eventType(
  "property/address.validation_requested",
  { schema: staticSchema<AddressValidationRequestedData>() },
);

export const propertyDiscoveryRequested = eventType(
  "property/discovery_requested",
  { schema: staticSchema<PropertyDiscoveryRequestedData>() },
);
```

- [ ] **Step 4: Modify the CRM Writer to publish the trigger event and stop completing the pipeline**

Modify `src/inngest/functions/crm-writer.ts`. This is a deliberate behavioral change from Phase 2: the CRM Writer's `completePipelineRun` step is removed — the pipeline is no longer "done" after CRM projection; it is now `received` until the Address Validation Worker advances it to `validating`. Replace the `CrmWriterRepository` interface's `completePipelineRun` method with:

```ts
export interface CrmWriterRepository {
  upsertWorkerRunQueued(input: { pipelineRunId: string; idempotencyKey: string }): Promise<WorkerRunRecord>;
  markWorkerRunCompleted(workerRunId: string): Promise<void>;
  recordInitialStageHistory(leadId: string): Promise<void>;
  createLeadSubmittedNotification(input: { leadId: string; correlationId: string }): Promise<void>;
  publishAddressValidationRequested(input: {
    leadId: string;
    propertyId: string;
    pipelineRunId: string;
    correlationId: string;
    submittedAddress: string;
  }): Promise<void>;
}
```

Update `writeCrmProjection` to call `publishAddressValidationRequested` unconditionally (idempotency is enforced downstream by the outbox's `idempotency_key` uniqueness) in place of `completePipelineRun`, and implement `SupabaseCrmWriterRepository.publishAddressValidationRequested` using the existing `SupabaseOutboxRepository` and `createEventEnvelope`:

```ts
async publishAddressValidationRequested(input: {
  leadId: string;
  propertyId: string;
  pipelineRunId: string;
  correlationId: string;
  submittedAddress: string;
}) {
  const { data: lead, error } = await this.client
    .from("leads")
    .select("company_id")
    .eq("id", input.leadId)
    .single();
  if (error || !lead) throw new Error("Failed to load lead for address validation trigger");

  const event = createEventEnvelope({
    name: "property/address.validation_requested",
    correlationId: input.correlationId,
    pipelineRunId: input.pipelineRunId,
    leadId: input.leadId,
    propertyId: input.propertyId,
    data: {
      leadId: input.leadId,
      propertyId: input.propertyId,
      submittedAddress: input.submittedAddress,
      attempt: 1,
    },
  });

  const outbox = new SupabaseOutboxRepository(this.client);
  await outbox.enqueue(event, lead.company_id);
}
```

Update the exported `crmWriter` Inngest function: replace the `"complete-pipeline-run"` step with `step.run("publish-address-validation-requested", () => repository.publishAddressValidationRequested({ leadId: event.data.leadId, propertyId: event.data.propertyId, pipelineRunId: event.data.pipelineRunId, correlationId: event.data.correlationId, submittedAddress: event.data.submittedAddress }))`, and add the necessary imports (`createEventEnvelope`, `SupabaseOutboxRepository`).

- [ ] **Step 5: Run gates**

```bash
npm run test:run -- src/inngest
npm run lint
npm run typecheck
npm run build
```

- [ ] **Step 6: Manually verify the new trigger locally**

With `npm run dev`, `npm run db:start`, and `npx inngest-cli@latest dev` running, submit a lead and confirm in Supabase Studio: `pipeline_runs.status` remains `received` (not `complete`) after the CRM Writer finishes; one `domain_events` row and one `event_outbox` row exist for `property/address.validation_requested`, sharing the pipeline's `correlation_id`.

- [ ] **Step 7: Commit the CRM Writer trigger change**

```bash
git add src/inngest/client.ts src/inngest/functions/crm-writer.ts src/inngest/functions/crm-writer.test.ts
git commit -m "feat: trigger address validation from the CRM Writer"
```

---

### Task 6: Implement the Address Validation Worker

**Files:**
- Create: `src/modules/property-identity/normalize-address.ts`
- Create: `src/modules/property-identity/normalize-address.test.ts`
- Create: `src/modules/property-identity/decide-duplicate-match.ts`
- Create: `src/modules/property-identity/decide-duplicate-match.test.ts`
- Create: `src/inngest/functions/address-validation-worker.ts`
- Create: `src/inngest/functions/address-validation-worker.test.ts`
- Modify: `src/app/api/inngest/route.ts`

**Interfaces:**
- Consumes: `property/address.validation_requested` from Task 1, `censusGeocodeAddressValidationProvider`/`createPropertyIdentityProviderRegistry` from Tasks 3–4, `writeAuditEntry` from Phase 1
- Produces: `normalizeAddressForMatching(address)`, `decideDuplicateMatch(candidates)`, `runAddressValidation(event, repository)`, `addressValidationWorker` durable function

- [ ] **Step 1: Write failing tests for the two pure decision functions**

Create `src/modules/property-identity/normalize-address.test.ts`:

```ts
import { expect, test } from "vitest";
import { normalizeAddressForMatching } from "./normalize-address";

test("collapses whitespace, case, and punctuation for stable matching", () => {
  expect(normalizeAddressForMatching("  12 Birch St., Trenton, NJ  ")).toBe(
    normalizeAddressForMatching("12 BIRCH ST TRENTON NJ"),
  );
});
```

Create `src/modules/property-identity/decide-duplicate-match.test.ts`:

```ts
import { expect, test } from "vitest";
import { decideDuplicateMatch } from "./decide-duplicate-match";

test("no candidates is no_match", () => {
  expect(decideDuplicateMatch([])).toEqual({ outcome: "no_match" });
});

test("exactly one candidate merges into it", () => {
  expect(decideDuplicateMatch([{ propertyId: "property-1" }])).toEqual({
    outcome: "merge",
    canonicalPropertyId: "property-1",
  });
});

test("more than one candidate is ambiguous", () => {
  expect(
    decideDuplicateMatch([{ propertyId: "property-1" }, { propertyId: "property-2" }]),
  ).toEqual({ outcome: "ambiguous", candidatePropertyIds: ["property-1", "property-2"] });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm run test:run -- src/modules/property-identity
```

Expected: FAIL because neither module exists.

- [ ] **Step 3: Implement the two pure functions**

Create `src/modules/property-identity/normalize-address.ts`:

```ts
export function normalizeAddressForMatching(address: string): string {
  return address
    .trim()
    .toUpperCase()
    .replace(/[.,#]/g, "")
    .replace(/\s+/g, " ");
}
```

Create `src/modules/property-identity/decide-duplicate-match.ts`:

```ts
import type { DuplicateMatchDecision } from "@/domain/property-identity";

export function decideDuplicateMatch(
  candidates: { propertyId: string }[],
): DuplicateMatchDecision {
  if (candidates.length === 0) return { outcome: "no_match" };
  if (candidates.length === 1) {
    return { outcome: "merge", canonicalPropertyId: candidates[0].propertyId };
  }
  return {
    outcome: "ambiguous",
    candidatePropertyIds: candidates.map((candidate) => candidate.propertyId),
  };
}
```

- [ ] **Step 4: Run and confirm the pure functions pass**

```bash
npm run test:run -- src/modules/property-identity
```

- [ ] **Step 5: Write a failing idempotency test for the worker core, covering the review path and the merge path**

Create `src/inngest/functions/address-validation-worker.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import {
  runAddressValidation,
  type AddressValidationWorkerRepository,
} from "./address-validation-worker";

function makeRepository(overrides: Partial<AddressValidationWorkerRepository> = {}) {
  const workerRuns = new Map<string, { id: string; status: string }>();
  const propertyAddressKeys = new Set<string>();
  let completions = 0;
  let auditWrites = 0;

  const base: AddressValidationWorkerRepository = {
    async upsertWorkerRunQueued({ idempotencyKey }) {
      const existing = workerRuns.get(idempotencyKey);
      if (existing) return existing;
      const record = { id: idempotencyKey, status: "queued" };
      workerRuns.set(idempotencyKey, record);
      return record;
    },
    async markWorkerRunCompleted(workerRunId) {
      completions += 1;
      for (const record of workerRuns.values()) {
        if (record.id === workerRunId) record.status = "completed";
      }
    },
    async startValidating() {},
    async validateAddress() {
      return {
        submittedAddress: "12 Birch St, Trenton, NJ",
        canonicalAddress: "12 BIRCH ST, TRENTON, NJ, 08611",
        latitude: 40.22,
        longitude: -74.76,
        municipality: "TRENTON",
        county: null,
        stateCode: "NJ",
        zip: "08611",
        matchMethod: "exact_single_match",
        confidence: 97,
      };
    },
    async recordProviderEvidence() {
      return { isFirstAttempt: true };
    },
    async recordPropertyAddress(input) {
      propertyAddressKeys.add(input.propertyId);
    },
    async updateCanonicalPropertyFields() {},
    async findDuplicateCandidates() {
      return [];
    },
    async mergeIntoCanonicalProperty() {},
    async createReviewTask() {},
    async publishDiscoveryRequested() {},
    async writeAudit() {
      auditWrites += 1;
    },
    ...overrides,
  };
  return { repository: base, get completions() { return completions; }, get auditWrites() { return auditWrites; }, propertyAddressKeys };
}

const event = {
  id: "event-1",
  pipelineRunId: "run-1",
  correlationId: "corr-1",
  leadId: "lead-1",
  propertyId: "property-1",
  submittedAddress: "12 Birch St, Trenton, NJ",
  attempt: 1,
};

test("duplicate delivery records the address exactly once and completes once", async () => {
  const { repository, completions: getCompletions, auditWrites: getAuditWrites } = makeRepository();

  await runAddressValidation(event, repository);
  await runAddressValidation(event, repository);

  expect(getCompletions).toBe(1);
  expect(getAuditWrites).toBe(1);
});

test("low confidence creates a review task instead of publishing discovery", async () => {
  const publishDiscoveryRequested = vi.fn();
  const createReviewTask = vi.fn();
  const { repository } = makeRepository({
    validateAddress: async () => ({
      submittedAddress: "1 Ambiguous Way",
      canonicalAddress: null,
      latitude: null,
      longitude: null,
      municipality: null,
      county: null,
      stateCode: null,
      zip: null,
      matchMethod: "no_match",
      confidence: 0,
    }),
    publishDiscoveryRequested,
    createReviewTask,
  });

  const result = await runAddressValidation(event, repository);

  expect(createReviewTask).toHaveBeenCalledWith(
    expect.objectContaining({ reason: "low_address_confidence" }),
  );
  expect(publishDiscoveryRequested).not.toHaveBeenCalled();
  expect(result.outcome).toBe("review_required");
});
```

- [ ] **Step 6: Run and confirm failure**

```bash
npm run test:run -- src/inngest/functions/address-validation-worker.test.ts
```

Expected: FAIL because `address-validation-worker.ts` does not exist.

- [ ] **Step 7: Implement the DI-testable core**

Create `src/inngest/functions/address-validation-worker.ts` (core + repository interface; the Supabase implementation and Inngest wiring follow in Step 8):

```ts
import "server-only";
import type { AddressValidationResult } from "@/domain/property-identity";
import { normalizeAddressForMatching } from "@/modules/property-identity/normalize-address";
import { decideDuplicateMatch } from "@/modules/property-identity/decide-duplicate-match";

const CONFIDENCE_REVIEW_THRESHOLD = 95;
const DUPLICATE_WINDOW_DAYS = 180;

export type WorkerRunRecord = { id: string; status: string };

export interface AddressValidationWorkerRepository {
  upsertWorkerRunQueued(input: { pipelineRunId: string; idempotencyKey: string }): Promise<WorkerRunRecord>;
  markWorkerRunCompleted(workerRunId: string): Promise<void>;
  startValidating(pipelineRunId: string): Promise<void>;
  validateAddress(submittedAddress: string): Promise<AddressValidationResult>;
  recordProviderEvidence(input: {
    pipelineRunId: string;
    submittedAddress: string;
    result: AddressValidationResult;
  }): Promise<{ isFirstAttempt: boolean; providerRequestId?: string }>;
  recordPropertyAddress(input: {
    propertyId: string;
    submittedAddress: string;
    result: AddressValidationResult;
    providerRequestId?: string;
  }): Promise<void>;
  updateCanonicalPropertyFields(input: { propertyId: string; result: AddressValidationResult }): Promise<void>;
  findDuplicateCandidates(input: {
    excludePropertyId: string;
    normalizedAddress: string;
    windowStartIso: string;
  }): Promise<{ propertyId: string }[]>;
  mergeIntoCanonicalProperty(input: {
    placeholderPropertyId: string;
    canonicalPropertyId: string;
    leadId: string;
  }): Promise<void>;
  createReviewTask(input: {
    pipelineRunId: string;
    leadId: string;
    propertyId: string;
    reason: "low_address_confidence" | "duplicate_candidates";
    candidateData: unknown;
  }): Promise<void>;
  publishDiscoveryRequested(input: {
    leadId: string;
    propertyId: string;
    pipelineRunId: string;
    correlationId: string;
    canonicalAddress: string;
    latitude: number | null;
    longitude: number | null;
    attempt: number;
  }): Promise<void>;
  writeAudit(input: { action: string; propertyId: string; correlationId: string }): Promise<void>;
}

type AddressValidationEventData = {
  id: string;
  pipelineRunId: string;
  correlationId: string;
  leadId: string;
  propertyId: string;
  submittedAddress: string;
  attempt: number;
};

export async function runAddressValidation(
  event: AddressValidationEventData,
  repository: AddressValidationWorkerRepository,
) {
  const idempotencyKey = `address-validation-worker:${event.pipelineRunId}:${event.attempt}`;
  const workerRun = await repository.upsertWorkerRunQueued({
    pipelineRunId: event.pipelineRunId,
    idempotencyKey,
  });

  await repository.startValidating(event.pipelineRunId);

  const result = await repository.validateAddress(event.submittedAddress);
  const { isFirstAttempt, providerRequestId } = await repository.recordProviderEvidence({
    pipelineRunId: event.pipelineRunId,
    submittedAddress: event.submittedAddress,
    result,
  });
  void isFirstAttempt; // guards source_records dedup inside the repository implementation

  await repository.recordPropertyAddress({
    propertyId: event.propertyId,
    submittedAddress: event.submittedAddress,
    result,
    providerRequestId,
  });

  let outcome: "review_required" | "merged" | "discovery_requested";

  if (result.confidence < CONFIDENCE_REVIEW_THRESHOLD) {
    await repository.createReviewTask({
      pipelineRunId: event.pipelineRunId,
      leadId: event.leadId,
      propertyId: event.propertyId,
      reason: "low_address_confidence",
      candidateData: { result },
    });
    outcome = "review_required";
  } else {
    await repository.updateCanonicalPropertyFields({ propertyId: event.propertyId, result });

    const windowStartIso = new Date(
      Date.now() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const candidates = await repository.findDuplicateCandidates({
      excludePropertyId: event.propertyId,
      normalizedAddress: normalizeAddressForMatching(result.canonicalAddress ?? event.submittedAddress),
      windowStartIso,
    });
    const decision = decideDuplicateMatch(candidates);

    if (decision.outcome === "ambiguous") {
      await repository.createReviewTask({
        pipelineRunId: event.pipelineRunId,
        leadId: event.leadId,
        propertyId: event.propertyId,
        reason: "duplicate_candidates",
        candidateData: { candidatePropertyIds: decision.candidatePropertyIds },
      });
      outcome = "review_required";
    } else if (decision.outcome === "merge") {
      await repository.mergeIntoCanonicalProperty({
        placeholderPropertyId: event.propertyId,
        canonicalPropertyId: decision.canonicalPropertyId,
        leadId: event.leadId,
      });
      // The canonical property has presumably already completed discovery;
      // Phase 3 does not re-trigger it to avoid duplicate parcel rows.
      outcome = "merged";
    } else {
      await repository.publishDiscoveryRequested({
        leadId: event.leadId,
        propertyId: event.propertyId,
        pipelineRunId: event.pipelineRunId,
        correlationId: event.correlationId,
        canonicalAddress: result.canonicalAddress ?? event.submittedAddress,
        latitude: result.latitude,
        longitude: result.longitude,
        attempt: 1,
      });
      outcome = "discovery_requested";
    }
  }

  if (workerRun.status !== "completed") {
    await repository.markWorkerRunCompleted(workerRun.id);
    await repository.writeAudit({
      action:
        outcome === "review_required"
          ? "property.address_validation_review_required"
          : "property.address_validated",
      propertyId: event.propertyId,
      correlationId: event.correlationId,
    });
  }

  return { workerRunId: workerRun.id, outcome };
}
```

- [ ] **Step 8: Implement the Supabase repository and register the Inngest function**

Append to `src/inngest/functions/address-validation-worker.ts` a `SupabaseAddressValidationWorkerRepository implements AddressValidationWorkerRepository` using `createServiceClient()`, mirroring `SupabaseCrmWriterRepository`'s style:

- `upsertWorkerRunQueued` / `markWorkerRunCompleted`: identical pattern to `crm-writer.ts`, with `worker_type: "address_validation"`.
- `startValidating`: `update pipeline_runs set status = 'validating' where id = ... and status = 'received'`.
- `validateAddress`: `createPropertyIdentityProviderRegistry().resolve("address.validate").execute({ submittedAddress }, context)` and returns `.value` (per the Global Constraints §8 bypass of `evaluateProviderRequest` for `paid: false` adapters).
- `recordProviderEvidence`: `insert into provider_requests (..., request_key: \`address.validate:${pipelineRunId}\`, status: 'succeeded') on conflict (request_key) do nothing returning id`; if a row was returned, also insert one `source_records` row and return `{ isFirstAttempt: true, providerRequestId }}`; otherwise select the existing `provider_requests.id` and return `{ isFirstAttempt: false, providerRequestId }`.
- `recordPropertyAddress`: plain insert into `property_addresses` (no uniqueness needed beyond `(property_id, created_at)` — duplicate delivery within the same attempt produces at most one row because the whole function only runs once per attempt, guarded by the Inngest step memoization plus the `workerRun.status !== "completed"` gate on completion; a genuine second physical delivery of the same attempt is accepted as a second observation row, consistent with the observation model's append-only design in spec §6.3).
- `updateCanonicalPropertyFields`: `update properties set canonical_address = ..., municipality = ..., county = ..., location = st_setsrid(st_point(lng, lat), 4326)::geography where id = propertyId`.
- `findDuplicateCandidates`: `select property_id from property_addresses join properties on properties.id = property_addresses.property_id where property_addresses.company_id = ... and properties.resolution_status != 'duplicate' and property_addresses.property_id != excludePropertyId and upper(regexp_replace(property_addresses.canonical_address, '[.,#]', '', 'g')) = normalizedAddress and property_addresses.created_at >= windowStartIso`, deduplicated to distinct `property_id`.
- `mergeIntoCanonicalProperty`: two sequential updates — `properties` (`resolution_status = 'duplicate', merged_into_property_id = canonicalPropertyId`) and `leads` (`property_id = canonicalPropertyId`) — both idempotent no-ops on retry since they set the same absolute values.
- `createReviewTask`: `insert into review_tasks (..., triggering_event_name: 'property/address.validation_requested') on conflict (pipeline_run_id) where status = 'open' do nothing`, then set `properties.resolution_status = 'review_required'` and `pipeline_runs.status = 'review_required'`.
- `publishDiscoveryRequested`: build the event with `createEventEnvelope({ name: "property/discovery_requested", ... })` and enqueue via `SupabaseOutboxRepository`.
- `writeAudit`: delegate to `writeAuditEntry` from Phase 1.

Export `addressValidationWorker`:

```ts
export const addressValidationWorker = inngest.createFunction(
  { id: "address-validation-worker", triggers: { event: addressValidationRequested } },
  async ({ event }) => {
    const repository = new SupabaseAddressValidationWorkerRepository();
    return runAddressValidation(
      { ...event.data, id: event.data.id },
      repository,
    );
  },
);
```

Modify `src/app/api/inngest/route.ts`, adding `addressValidationWorker` to the `functions` array.

- [ ] **Step 9: Run gates**

```bash
npm run test:run -- src/modules/property-identity src/inngest
npm run lint
npm run typecheck
npm run build
```

- [ ] **Step 10: Manually verify with a real NJ address, and separately with a deliberately unresolvable one**

With `npm run dev`, `npm run db:start`, and `npx inngest-cli@latest dev` running, submit two leads:

1. `12 Birch St, Trenton, NJ` (or any real, geocodable NJ address) — confirm `pipeline_runs.status = 'validating'`, one `property_addresses` row with `confidence >= 95`, and one `event_outbox` row for `property/discovery_requested`.
2. `asdfghjkl not a real place` — confirm `confidence = 0`, one `review_tasks` row with `reason = 'low_address_confidence'`, `properties.resolution_status = 'review_required'`, `pipeline_runs.status = 'review_required'`, and no `property/discovery_requested` event.

Replay the `property/address.validation_requested` event from the Inngest dashboard for lead 1 and confirm no duplicate `property_addresses`, `provider_requests`, or `audit_log` rows.

- [ ] **Step 11: Commit the Address Validation Worker**

```bash
git add src/modules/property-identity src/inngest/functions/address-validation-worker.ts src/inngest/functions/address-validation-worker.test.ts src/modules/property-identity/normalize-address.ts src/modules/property-identity/normalize-address.test.ts src/modules/property-identity/decide-duplicate-match.ts src/modules/property-identity/decide-duplicate-match.test.ts src/app/api/inngest/route.ts
git commit -m "feat: add Address Validation Worker with duplicate-merge and review-task logic"
```

---

### Task 7: Implement the Property Discovery Worker

**Files:**
- Create: `src/modules/property-identity/decide-parcel-resolution.ts`
- Create: `src/modules/property-identity/decide-parcel-resolution.test.ts`
- Create: `src/inngest/functions/property-discovery-worker.ts`
- Create: `src/inngest/functions/property-discovery-worker.test.ts`
- Modify: `src/app/api/inngest/route.ts`

**Interfaces:**
- Consumes: `property/discovery_requested` from Task 1, `njginParcelLookupProvider`/`createPropertyIdentityProviderRegistry` from Task 4, `writeAuditEntry` from Phase 1
- Produces: `decideParcelResolution(candidates)`, `runPropertyDiscovery(event, repository)`, `propertyDiscoveryWorker` durable function

- [ ] **Step 1: Write failing tests for the parcel-resolution decision function**

Create `src/modules/property-identity/decide-parcel-resolution.test.ts`:

```ts
import { expect, test } from "vitest";
import { decideParcelResolution } from "./decide-parcel-resolution";
import type { ParcelData } from "@/domain/property-identity";

function parcel(overrides: Partial<ParcelData> = {}): ParcelData {
  return {
    block: "101",
    lot: "5",
    qualifier: null,
    pamsPin: "0101_5_",
    gisPin: null,
    municipalityCode: "0101",
    municipalityName: "TRENTON CITY",
    county: "MERCER",
    propertyClass: "2",
    acreage: 0.25,
    yearBuilt: 1975,
    landValue: 50000,
    improvementValue: 150000,
    netValue: 200000,
    propertyLocation: "12 BIRCH ST",
    streetAddress: "12 BIRCH ST",
    buildingDescription: null,
    landDescription: null,
    dwellingUnits: 1,
    geometry: null,
    ...overrides,
  };
}

test("zero candidates is unsupported_property_type", () => {
  expect(decideParcelResolution([])).toEqual({
    outcome: "review",
    reason: "unsupported_property_type",
  });
});

test("a single class-2 residential parcel resolves", () => {
  expect(decideParcelResolution([parcel()])).toEqual({
    outcome: "resolved",
    parcel: parcel(),
  });
});

test("a single parcel with multiple dwelling units is a condo ambiguity", () => {
  expect(decideParcelResolution([parcel({ dwellingUnits: 4, qualifier: "C0001" })])).toEqual({
    outcome: "review",
    reason: "condo_ambiguity",
  });
});

test("a commercial property class defers to human review", () => {
  expect(decideParcelResolution([parcel({ propertyClass: "4A" })])).toEqual({
    outcome: "review",
    reason: "commercial_property",
  });
});

test("an unrecognized property class is unsupported", () => {
  expect(decideParcelResolution([parcel({ propertyClass: "15F" })])).toEqual({
    outcome: "review",
    reason: "unsupported_property_type",
  });
});

test("multiple distinct-parcel candidates is multiple_parcels", () => {
  expect(decideParcelResolution([parcel(), parcel({ lot: "6" })])).toEqual({
    outcome: "review",
    reason: "multiple_parcels",
  });
});

test("multiple candidates sharing block/lot but differing qualifier is condo_ambiguity", () => {
  expect(
    decideParcelResolution([parcel({ qualifier: "C0001" }), parcel({ qualifier: "C0002" })]),
  ).toEqual({ outcome: "review", reason: "condo_ambiguity" });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm run test:run -- src/modules/property-identity/decide-parcel-resolution.test.ts
```

Expected: FAIL because `./decide-parcel-resolution` does not exist.

- [ ] **Step 3: Implement the pure decision function**

Create `src/modules/property-identity/decide-parcel-resolution.ts`:

```ts
import type { ParcelData } from "@/domain/property-identity";

export type ParcelResolutionDecision =
  | { outcome: "resolved"; parcel: ParcelData }
  | {
      outcome: "review";
      reason:
        | "multiple_parcels"
        | "condo_ambiguity"
        | "commercial_property"
        | "unsupported_property_type";
    };

// NJ MOD-IV property class codes: "2" is standard owner-occupied residential.
// Labeled defaults, not spec-mandated — Phase 4 may refine this table.
const RESIDENTIAL_CLASSES = new Set(["2"]);
const COMMERCIAL_CLASS_PREFIXES = ["4A", "4B", "4C"];

function isCondoLike(parcel: ParcelData): boolean {
  return Boolean(parcel.qualifier) || (parcel.dwellingUnits ?? 1) > 1;
}

export function decideParcelResolution(candidates: ParcelData[]): ParcelResolutionDecision {
  if (candidates.length === 0) {
    return { outcome: "review", reason: "unsupported_property_type" };
  }

  if (candidates.length > 1) {
    const sameParcel = candidates.every(
      (candidate) => candidate.block === candidates[0].block && candidate.lot === candidates[0].lot,
    );
    return {
      outcome: "review",
      reason: sameParcel ? "condo_ambiguity" : "multiple_parcels",
    };
  }

  const [parcel] = candidates;
  const propertyClass = parcel.propertyClass ?? "";

  if (COMMERCIAL_CLASS_PREFIXES.some((prefix) => propertyClass.startsWith(prefix))) {
    return { outcome: "review", reason: "commercial_property" };
  }
  if (!RESIDENTIAL_CLASSES.has(propertyClass)) {
    return { outcome: "review", reason: "unsupported_property_type" };
  }
  if (isCondoLike(parcel)) {
    return { outcome: "review", reason: "condo_ambiguity" };
  }

  return { outcome: "resolved", parcel };
}
```

- [ ] **Step 4: Run and confirm the pure function passes**

```bash
npm run test:run -- src/modules/property-identity/decide-parcel-resolution.test.ts
```

- [ ] **Step 5: Write a failing idempotency test for the worker core**

Create `src/inngest/functions/property-discovery-worker.test.ts` mirroring the shape of Task 6 Step 5's test — a `makeRepository()` helper implementing `PropertyDiscoveryWorkerRepository`, one test asserting duplicate delivery inserts exactly one `parcels` row and completes once, and one test asserting a zero-candidate lookup creates a review task instead of resolving the property:

```ts
import { expect, test, vi } from "vitest";
import {
  runPropertyDiscovery,
  type PropertyDiscoveryWorkerRepository,
} from "./property-discovery-worker";

function makeRepository(overrides: Partial<PropertyDiscoveryWorkerRepository> = {}) {
  const workerRuns = new Map<string, { id: string; status: string }>();
  let completions = 0;

  const base: PropertyDiscoveryWorkerRepository = {
    async upsertWorkerRunQueued({ idempotencyKey }) {
      const existing = workerRuns.get(idempotencyKey);
      if (existing) return existing;
      const record = { id: idempotencyKey, status: "queued" };
      workerRuns.set(idempotencyKey, record);
      return record;
    },
    async markWorkerRunCompleted(workerRunId) {
      completions += 1;
      for (const record of workerRuns.values()) {
        if (record.id === workerRunId) record.status = "completed";
      }
    },
    async startEnriching() {},
    async lookupParcels() {
      return [
        {
          block: "101", lot: "5", qualifier: null, pamsPin: null, gisPin: null,
          municipalityCode: "0101", municipalityName: "TRENTON CITY", county: "MERCER",
          propertyClass: "2", acreage: 0.25, yearBuilt: 1975, landValue: 50000,
          improvementValue: 150000, netValue: 200000, propertyLocation: "12 BIRCH ST",
          streetAddress: "12 BIRCH ST", buildingDescription: null, landDescription: null,
          dwellingUnits: 1, geometry: null,
        },
      ];
    },
    async recordProviderEvidence() {
      return { isFirstAttempt: true };
    },
    async recordParcel() {},
    async recordStructure() {},
    async resolveProperty() {},
    async createReviewTask() {},
    async completePipelineRun() {},
    async writeAudit() {},
    ...overrides,
  };
  return { repository: base, get completions() { return completions; } };
}

const event = {
  id: "event-1",
  pipelineRunId: "run-1",
  correlationId: "corr-1",
  leadId: "lead-1",
  propertyId: "property-1",
  canonicalAddress: "12 BIRCH ST, TRENTON, NJ",
  latitude: 40.22,
  longitude: -74.76,
  attempt: 1,
};

test("duplicate delivery resolves once and completes once", async () => {
  const { repository, completions: getCompletions } = makeRepository();
  await runPropertyDiscovery(event, repository);
  await runPropertyDiscovery(event, repository);
  expect(getCompletions).toBe(1);
});

test("no parcel candidates creates an unsupported_property_type review task", async () => {
  const createReviewTask = vi.fn();
  const { repository } = makeRepository({ lookupParcels: async () => [], createReviewTask });
  const result = await runPropertyDiscovery(event, repository);
  expect(createReviewTask).toHaveBeenCalledWith(
    expect.objectContaining({ reason: "unsupported_property_type" }),
  );
  expect(result.outcome).toBe("review_required");
});
```

- [ ] **Step 6: Run and confirm failure**

```bash
npm run test:run -- src/inngest/functions/property-discovery-worker.test.ts
```

Expected: FAIL because `property-discovery-worker.ts` does not exist.

- [ ] **Step 7: Implement the DI-testable core**

Create `src/inngest/functions/property-discovery-worker.ts` following the exact shape of Task 6 Step 7 (`AddressValidationWorkerRepository` → `PropertyDiscoveryWorkerRepository`, `runAddressValidation` → `runPropertyDiscovery`):

```ts
import "server-only";
import type { ParcelData } from "@/domain/property-identity";
import { decideParcelResolution } from "@/modules/property-identity/decide-parcel-resolution";

export type WorkerRunRecord = { id: string; status: string };

export interface PropertyDiscoveryWorkerRepository {
  upsertWorkerRunQueued(input: { pipelineRunId: string; idempotencyKey: string }): Promise<WorkerRunRecord>;
  markWorkerRunCompleted(workerRunId: string): Promise<void>;
  startEnriching(pipelineRunId: string): Promise<void>;
  lookupParcels(input: { latitude: number | null; longitude: number | null; canonicalAddress: string }): Promise<ParcelData[]>;
  recordProviderEvidence(input: { pipelineRunId: string; candidates: ParcelData[] }): Promise<{ isFirstAttempt: boolean; providerRequestId?: string }>;
  recordParcel(input: { propertyId: string; parcel: ParcelData; providerRequestId?: string }): Promise<{ parcelId: string }>;
  recordStructure(input: { propertyId: string; parcelId: string }): Promise<void>;
  resolveProperty(propertyId: string): Promise<void>;
  createReviewTask(input: {
    pipelineRunId: string;
    leadId: string;
    propertyId: string;
    reason: "multiple_parcels" | "condo_ambiguity" | "commercial_property" | "unsupported_property_type";
    candidateData: unknown;
  }): Promise<void>;
  completePipelineRun(pipelineRunId: string): Promise<void>;
  writeAudit(input: { action: string; propertyId: string; correlationId: string }): Promise<void>;
}

type PropertyDiscoveryEventData = {
  id: string;
  pipelineRunId: string;
  correlationId: string;
  leadId: string;
  propertyId: string;
  canonicalAddress: string;
  latitude: number | null;
  longitude: number | null;
  attempt: number;
};

export async function runPropertyDiscovery(
  event: PropertyDiscoveryEventData,
  repository: PropertyDiscoveryWorkerRepository,
) {
  const idempotencyKey = `property-discovery-worker:${event.pipelineRunId}:${event.attempt}`;
  const workerRun = await repository.upsertWorkerRunQueued({
    pipelineRunId: event.pipelineRunId,
    idempotencyKey,
  });

  await repository.startEnriching(event.pipelineRunId);

  const candidates = await repository.lookupParcels({
    latitude: event.latitude,
    longitude: event.longitude,
    canonicalAddress: event.canonicalAddress,
  });
  const { providerRequestId } = await repository.recordProviderEvidence({
    pipelineRunId: event.pipelineRunId,
    candidates,
  });

  const decision = decideParcelResolution(candidates);
  let outcome: "resolved" | "review_required";

  if (decision.outcome === "review") {
    await repository.createReviewTask({
      pipelineRunId: event.pipelineRunId,
      leadId: event.leadId,
      propertyId: event.propertyId,
      reason: decision.reason,
      candidateData: { candidates },
    });
    outcome = "review_required";
  } else {
    const { parcelId } = await repository.recordParcel({
      propertyId: event.propertyId,
      parcel: decision.parcel,
      providerRequestId,
    });
    await repository.recordStructure({ propertyId: event.propertyId, parcelId });
    await repository.resolveProperty(event.propertyId);
    await repository.completePipelineRun(event.pipelineRunId);
    outcome = "resolved";
  }

  if (workerRun.status !== "completed") {
    await repository.markWorkerRunCompleted(workerRun.id);
    await repository.writeAudit({
      action: outcome === "resolved" ? "property.discovery_resolved" : "property.discovery_review_required",
      propertyId: event.propertyId,
      correlationId: event.correlationId,
    });
  }

  return { workerRunId: workerRun.id, outcome };
}
```

- [ ] **Step 8: Implement the Supabase repository and register the Inngest function**

Append `SupabasePropertyDiscoveryWorkerRepository` following the same conventions as Task 6 Step 8:

- `lookupParcels`: prefer `{ lat, lng }` when both are non-null (spatial query), else fall back to `{ address: canonicalAddress }` (attribute query), calling `njginParcelLookupProvider` via `createPropertyIdentityProviderRegistry().resolve("parcel.lookup")`.
- `recordProviderEvidence`: same `on conflict (request_key) do nothing` pattern as Task 6, with `request_key: \`parcel.lookup:${pipelineRunId}\``.
- `recordParcel`: insert into `parcels` with `is_primary: true`, storing `land_value_cents`/`improvement_value_cents`/`net_value_cents` as `Math.round(value * 100)` from the dollar-denominated NJGIN values and `geometry` via `st_geomfromgeojson(...)::geography`. This is a duplicate-delivery-sensitive write (unlike `property_addresses`, an append-only observation log, `parcels` represents current state via `is_primary`) — catch the unique-violation from `parcels_property_id_primary_idx` (Task 2's fix) exactly like `crm-writer.ts`'s `recordInitialStageHistory`: attempt the insert; on `error.code === '23505'`, select the existing primary parcel's `id` instead of throwing, so `recordStructure` below always gets a valid `parcelId` regardless of which delivery actually created the row.
- `recordStructure`: insert into `structures` (`property_id`, `parcel_id`, `is_primary: true`, `source: 'njgin_parcels_composite'`). Same treatment: catch `23505` from `structures_property_id_primary_idx` (Task 2's fix) and no-op — nothing downstream needs the structure's own `id`, so unlike `recordParcel` there is no need to select the existing row back.
- `resolveProperty`: `update properties set resolution_status = 'resolved' where id = ...`.
- `createReviewTask`: same pattern as Task 6, `triggering_event_name: 'property/discovery_requested'`, and additionally sets `pipeline_runs.status = 'review_required'` and `properties.resolution_status = 'review_required'`.
- `completePipelineRun`: `update pipeline_runs set status = 'complete', finished_at = now() where id = ... and status != 'complete'`.

Export `propertyDiscoveryWorker` mirroring `addressValidationWorker`'s shape, and add it to `src/app/api/inngest/route.ts`'s `functions` array.

- [ ] **Step 9: Run gates**

```bash
npm run test:run -- src/modules/property-identity src/inngest
npm run lint
npm run typecheck
npm run build
```

- [ ] **Step 10: Manually verify end-to-end with a real NJ address**

Reuse lead 1 from Task 6 Step 10. Confirm: `pipeline_runs.status = 'enriching'` then `'complete'`; one `parcels` row with real `block`/`lot`/`municipality_name`/`county` values from NJGIN; one `structures` row referencing it; `properties.resolution_status = 'resolved'`. Replay `property/discovery_requested` and confirm no duplicate `parcels`/`structures` rows.

- [ ] **Step 11: Commit the Property Discovery Worker**

```bash
git add src/modules/property-identity/decide-parcel-resolution.ts src/modules/property-identity/decide-parcel-resolution.test.ts src/inngest/functions/property-discovery-worker.ts src/inngest/functions/property-discovery-worker.test.ts src/app/api/inngest/route.ts
git commit -m "feat: add Property Discovery Worker with NJ parcel resolution"
```

---

### Task 8: Build the Review Queue

**Files:**
- Modify: `supabase/migrations/<timestamp>_property_identity.sql` (replace the Task 2 stub `resolve_review_task` with the real implementation)
- Modify: `supabase/tests/property-identity.test.sql`
- Modify: `src/lib/database.types.ts`
- Create: `src/app/(app)/review/page.tsx`
- Create: `src/app/(app)/review/[reviewTaskId]/page.tsx`
- Create: `src/app/(app)/review/[reviewTaskId]/review-actions.ts`
- Create: `src/app/(app)/review/[reviewTaskId]/parcel-map.tsx`
- Modify: `src/app/(app)/page.tsx`
- Modify: `package.json`

**Interfaces:**
- Consumes: `review_tasks`, `reviewTaskReasonSchema`/`reviewTaskStatusSchema` from Task 1
- Produces: SQL function `resolve_review_task` (real behavior); routes `/review` and `/review/[reviewTaskId]`; server actions `resolveReviewTask`, `rejectReviewTask`, `retryReviewTask`, `markReviewTaskUnsupported`

- [ ] **Step 1: Write failing pgTAP tests for each of the four `resolve_review_task` actions**

Append to `supabase/tests/property-identity.test.sql` (before `select * from finish();`), updating `select plan(19);` to `select plan(24);`:

```sql
insert into public.properties (id, company_id, resolution_status)
values ('99999999-9999-4999-8999-999999999999', '00000000-0000-4000-8000-000000000001', 'review_required')
on conflict (id) do nothing;
insert into public.leads (id, company_id, property_id, name, phone, email, submitted_address)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '00000000-0000-4000-8000-000000000001',
        '99999999-9999-4999-8999-999999999999', 'Test Lead', '555-0100', 't@example.com', '1 Test Way')
on conflict (id) do nothing;
insert into public.pipeline_runs (id, company_id, lead_id, property_id, correlation_id, pipeline_version, status)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '00000000-0000-4000-8000-000000000001',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '99999999-9999-4999-8999-999999999999',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 1, 'review_required')
on conflict (id) do nothing;
insert into public.review_tasks (id, company_id, pipeline_run_id, lead_id, property_id, reason, triggering_event_name)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '00000000-0000-4000-8000-000000000001',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '99999999-9999-4999-8999-999999999999', 'low_address_confidence',
        'property/address.validation_requested')
on conflict (id) do nothing;

select is(
  (select new_status from public.resolve_review_task(
    '00000000-0000-4000-8000-000000000001', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'resolve', null, null, 'accepted as-is'
  )),
  'resolved'::public.review_task_status,
  'resolve without a candidate accepts the placeholder property'
);
select is(
  (select resolution_status from public.properties where id = '99999999-9999-4999-8999-999999999999'),
  'resolved',
  'resolve without a candidate marks the property resolved'
);
select is(
  (select status from public.pipeline_runs where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'complete'::public.pipeline_status,
  'resolve without a candidate completes the pipeline run'
);
select throws_ok(
  $$ select public.resolve_review_task(
       '00000000-0000-4000-8000-000000000001', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
       'reject', null, null, 'already resolved') $$,
  null, 'Review task % is not open',
  'a second action on an already-resolved task is rejected'
);
```

Add a second fixture review task in state `open` and assert `reject`, `retry` (checking `next_attempt = 2`), and `unsupported` each transition `review_tasks.status` correctly and update `pipeline_runs.status`/`properties.resolution_status` as designed. Add one more assertion re-running the `function_privs_are` check from Task 2 (unchanged signature, now against real behavior).

- [ ] **Step 2: Run and confirm failure**

```bash
npm run db:reset
npm run db:test
```

Expected: FAIL — the Task 2 stub raises "not yet implemented."

- [ ] **Step 3: Implement `resolve_review_task`**

Replace the stub in `supabase/migrations/<timestamp>_property_identity.sql` with the full implementation (four-branch `if`/`elsif` on `p_action`, `for update` row lock, candidate-index lookup from `candidate_data`, and per-action side effects on `properties`/`leads`/`pipeline_runs`) as designed in the Global Constraints §6–§7 above. Structure it exactly as follows:

```sql
create or replace function public.resolve_review_task(
  p_company_id uuid,
  p_review_task_id uuid,
  p_action text,
  p_admin_id uuid,
  p_selected_candidate_index integer,
  p_notes text
) returns table (
  new_status public.review_task_status,
  pipeline_run_id uuid,
  property_id uuid,
  next_attempt integer
)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_task public.review_tasks%rowtype;
  v_candidate jsonb;
  v_new_status public.review_task_status;
  v_next_attempt integer;
begin
  if p_action not in ('resolve', 'reject', 'retry', 'unsupported') then
    raise exception 'Invalid review task action %', p_action;
  end if;

  select * into v_task
  from public.review_tasks
  where id = p_review_task_id and company_id = p_company_id
  for update;

  if not found then
    raise exception 'Review task % not found for company %', p_review_task_id, p_company_id;
  end if;

  if v_task.status != 'open' then
    raise exception 'Review task % is not open', p_review_task_id;
  end if;

  if p_action = 'resolve' then
    v_new_status := 'resolved';

    if p_selected_candidate_index is not null then
      v_candidate := v_task.candidate_data -> p_selected_candidate_index;
      if v_candidate is null then
        raise exception 'Candidate index % not found on review task %', p_selected_candidate_index, p_review_task_id;
      end if;

      if v_task.reason = 'duplicate_candidates' then
        update public.properties
        set resolution_status = 'duplicate',
            merged_into_property_id = (v_candidate->>'propertyId')::uuid,
            updated_at = now()
        where id = v_task.property_id;

        update public.leads
        set property_id = (v_candidate->>'propertyId')::uuid, updated_at = now()
        where id = v_task.lead_id;
      else
        insert into public.parcels (
          company_id, property_id, block, lot, qualifier, pams_pin, gis_pin,
          municipality_code, municipality_name, county, property_class,
          acreage, year_built, land_value_cents, improvement_value_cents,
          net_value_cents, property_location, street_address,
          building_description, land_description, dwelling_units
        ) values (
          p_company_id, v_task.property_id,
          v_candidate->>'block', v_candidate->>'lot', v_candidate->>'qualifier',
          v_candidate->>'pamsPin', v_candidate->>'gisPin',
          v_candidate->>'municipalityCode', v_candidate->>'municipalityName',
          v_candidate->>'county', v_candidate->>'propertyClass',
          nullif(v_candidate->>'acreage', '')::numeric, nullif(v_candidate->>'yearBuilt', '')::integer,
          nullif(v_candidate->>'landValue', '')::bigint, nullif(v_candidate->>'improvementValue', '')::bigint,
          nullif(v_candidate->>'netValue', '')::bigint, v_candidate->>'propertyLocation',
          v_candidate->>'streetAddress', v_candidate->>'buildingDescription',
          v_candidate->>'landDescription', nullif(v_candidate->>'dwellingUnits', '')::integer
        );

        update public.properties
        set resolution_status = 'resolved', updated_at = now()
        where id = v_task.property_id;
      end if;
    else
      update public.properties
      set resolution_status = 'resolved', updated_at = now()
      where id = v_task.property_id;
    end if;

    update public.pipeline_runs set status = 'complete', finished_at = now() where id = v_task.pipeline_run_id;

  elsif p_action = 'reject' then
    v_new_status := 'rejected';
    update public.pipeline_runs set status = 'failed', finished_at = now() where id = v_task.pipeline_run_id;

  elsif p_action = 'unsupported' then
    v_new_status := 'unsupported';
    update public.properties set resolution_status = 'unsupported', updated_at = now() where id = v_task.property_id;
    update public.pipeline_runs set status = 'partial', finished_at = now() where id = v_task.pipeline_run_id;

  elsif p_action = 'retry' then
    v_new_status := 'retried';
    v_next_attempt := v_task.retry_count + 2;
  end if;

  update public.review_tasks
  set status = v_new_status,
      resolution_notes = p_notes,
      resolved_by = p_admin_id,
      resolved_at = now(),
      retry_count = case when p_action = 'retry' then retry_count + 1 else retry_count end
  where id = p_review_task_id;

  return query select v_new_status, v_task.pipeline_run_id, v_task.property_id, v_next_attempt;
end;
$$;

revoke all on function public.resolve_review_task(uuid, uuid, text, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.resolve_review_task(uuid, uuid, text, uuid, integer, text)
  to service_role;
```

- [ ] **Step 4: Reset, run pgTAP, regenerate types**

```bash
npm run db:reset
npm run db:test
npm run db:types -- --schema public > src/lib/database.types.ts
```

Expected: all 24 assertions pass.

- [ ] **Step 5: Install Leaflet and build the queue list page**

```bash
npm install leaflet@1.9.4 react-leaflet@5.0.0
npm install --save-dev @types/leaflet@1.9.14
```

Create `src/app/(app)/review/page.tsx`: server component querying `select id, reason, status, created_at, property_id, leads(name, submitted_address) from review_tasks where status = 'open' order by created_at` scoped by RLS, rendering a `<ul>` of `<Link href={\`/review/${task.id}\`}>` entries showing `reason`, the lead's name, and submitted address (an `aria-label="Open review tasks"` section, matching the CRM plan's `aria-label` convention).

- [ ] **Step 6: Build the review-task detail page and Leaflet map**

Create `src/app/(app)/review/[reviewTaskId]/parcel-map.tsx` as a `"use client"` component wrapping `react-leaflet`'s `MapContainer`/`TileLayer` (OpenStreetMap tiles) plus a `GeoJSON` layer per candidate parcel polygon and a `Marker` per candidate address point, accepting `candidates: { geometry: unknown; label: string }[]` as props.

Create `src/app/(app)/review/[reviewTaskId]/page.tsx`: loads the `review_tasks` row (with `candidate_data`), renders the reason, the raw candidate list (address/parcel fields, never `ownerName` since it was never stored), the `<ParcelMap>`, the disclaimer text "Parcel geometry is analytical and is not a legal survey," and four forms — one per action — each posting to a dedicated server action with an optional `selectedCandidateIndex` radio-button selection and a `notes` textarea.

- [ ] **Step 7: Implement the four server actions**

Create `src/app/(app)/review/[reviewTaskId]/review-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAuditEntry } from "@/modules/audit/write-audit-entry";
import { createEventEnvelope } from "@/domain/events";
import { SupabaseOutboxRepository } from "@/modules/events/supabase-outbox-repository";

type Action = "resolve" | "reject" | "retry" | "unsupported";

async function applyReviewAction(
  reviewTaskId: string,
  action: Action,
  selectedCandidateIndex: number | null,
  notes: string | null,
) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: adminProfile } = await supabase
    .from("admin_profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!adminProfile) redirect("/login");

  const service = createServiceClient();
  const { data, error } = await service.rpc("resolve_review_task", {
    p_company_id: adminProfile.company_id,
    p_review_task_id: reviewTaskId,
    p_action: action,
    p_admin_id: user.id,
    p_selected_candidate_index: selectedCandidateIndex,
    p_notes: notes,
  });
  if (error || !data?.[0]) throw new Error(`Failed to ${action} review task`);

  await writeAuditEntry(
    {
      companyId: adminProfile.company_id,
      actorId: user.id,
      action: `review.task_${action === "resolve" ? "resolved" : action + "ed"}`,
      entityType: "review_task",
      entityId: reviewTaskId,
      metadata: { action },
    },
    service,
  );

  if (action === "retry" && data[0].next_attempt) {
    const { data: task } = await service
      .from("review_tasks")
      .select("triggering_event_name, lead_id, property_id, pipeline_run_id")
      .eq("id", reviewTaskId)
      .single();
    if (task) {
      const event =
        task.triggering_event_name === "property/address.validation_requested"
          ? await buildAddressValidationRetryEvent(service, task, data[0].next_attempt)
          : await buildDiscoveryRetryEvent(service, task, data[0].next_attempt);
      const outbox = new SupabaseOutboxRepository(service);
      await outbox.enqueue(event, adminProfile.company_id);
    }
  }

  revalidatePath("/review");
  revalidatePath(`/review/${reviewTaskId}`);
  revalidatePath("/");
}

export async function resolveReviewTask(reviewTaskId: string, formData: FormData) {
  const index = formData.get("selectedCandidateIndex");
  await applyReviewAction(
    reviewTaskId,
    "resolve",
    index ? Number(index) : null,
    (formData.get("notes") as string) || null,
  );
}
export async function rejectReviewTask(reviewTaskId: string, formData: FormData) {
  await applyReviewAction(reviewTaskId, "reject", null, (formData.get("notes") as string) || null);
}
export async function retryReviewTask(reviewTaskId: string, formData: FormData) {
  await applyReviewAction(reviewTaskId, "retry", null, (formData.get("notes") as string) || null);
}
export async function markReviewTaskUnsupported(reviewTaskId: string, formData: FormData) {
  await applyReviewAction(reviewTaskId, "unsupported", null, (formData.get("notes") as string) || null);
}
```

Implement `buildAddressValidationRetryEvent`/`buildDiscoveryRetryEvent` as small private helpers in the same file: the address-validation variant reloads `leads.submitted_address`; the discovery variant reloads the most recent `property_addresses` row for `task.property_id` to recover `canonicalAddress`/`latitude`/`longitude`. Both call `createEventEnvelope` with `data.attempt = nextAttempt`.

- [ ] **Step 8: Wire the real dashboard review-queue count**

Modify `src/app/(app)/page.tsx`: add `supabase.from("review_tasks").select("id", { count: "exact", head: true }).eq("status", "open")` to the existing `Promise.all`, and replace the static `<p>0 items awaiting review</p>` with the real count, linking to `/review`.

- [ ] **Step 9: Run gates**

```bash
npm run test:run
npm run db:test
npm run lint
npm run typecheck
npm run build
```

- [ ] **Step 10: Manually verify all four actions**

Using the two review tasks created in Task 6 Step 10 and Task 7 Step 10 (or freshly created ones), exercise: `resolve` with a selected duplicate candidate (confirm merge), `resolve` with no candidate (confirm the placeholder becomes canonical), `reject` (confirm `pipeline_runs.status = 'failed'`), `retry` (confirm a new `worker_runs` row appears with a `:2` idempotency-key suffix and the pipeline resumes), and `unsupported` (confirm `properties.resolution_status = 'unsupported'` and `pipeline_runs.status = 'partial'`). Confirm the dashboard's review-queue count decreases after each resolution.

- [ ] **Step 11: Commit the Review Queue**

```bash
git add supabase/migrations supabase/tests/property-identity.test.sql src/lib/database.types.ts "src/app/(app)/review" "src/app/(app)/page.tsx" package.json package-lock.json
git commit -m "feat: add the Review Queue with resolve/reject/retry/unsupported actions"
```

---

### Task 9: Extend the Property Profile in the Lead Workspace

**Files:**
- Modify: `src/app/(app)/leads/[leadId]/page.tsx`
- Create: `src/app/(app)/leads/[leadId]/parcel-map.tsx` (reuse pattern from Task 8's `parcel-map.tsx`; consider extracting a shared component)

**Interfaces:**
- Consumes: `parcels`, `structures`, `property_addresses` rows
- Produces: an extended "Property" section on the lead workspace

- [ ] **Step 1: Manually capture the current Property section rendering as a baseline**

Run `npm run test:run -- "src/app/(app)/leads"` to confirm the existing lead-workspace tests (if any exist by this point) still pass before modification. If none exist yet, skip to Step 2 — the CRM plan did not add a page-level test for this route, consistent with Phase 2's style of testing pure logic (`buildActivityTimeline`) rather than the page component itself.

- [ ] **Step 2: Extend the lead workspace query**

Modify `src/app/(app)/leads/[leadId]/page.tsx`: add `parcels` and `structures` queries to the existing `Promise.all`:

```ts
supabase
  .from("parcels")
  .select("block, lot, qualifier, pams_pin, municipality_name, county, acreage, year_built, land_value_cents, improvement_value_cents, net_value_cents, geometry")
  .eq("property_id", lead.property_id)
  .eq("is_primary", true)
  .maybeSingle(),
```

- [ ] **Step 3: Extend the Property section**

Replace the existing `<section aria-label="Property">` block:

```tsx
<section aria-label="Property">
  <h2>Property</h2>
  <p>{lead.properties?.canonical_address ?? lead.submitted_address}</p>
  <p>Resolution: {lead.properties?.resolution_status}</p>

  {parcel ? (
    <>
      <dl>
        <div><dt>Block / Lot / Qualifier</dt><dd>{parcel.block} / {parcel.lot} / {parcel.qualifier ?? "—"}</dd></div>
        <div><dt>PAMS PIN</dt><dd>{parcel.pams_pin ?? "—"}</dd></div>
        <div><dt>Municipality / County</dt><dd>{parcel.municipality_name} / {parcel.county}</dd></div>
        <div><dt>Acreage</dt><dd>{parcel.acreage ?? "—"}</dd></div>
        <div><dt>Year built</dt><dd>{parcel.year_built ?? "—"}</dd></div>
        <div><dt>Land / Improvement / Net value</dt>
          <dd>
            {(parcel.land_value_cents ?? 0) / 100} / {(parcel.improvement_value_cents ?? 0) / 100} / {(parcel.net_value_cents ?? 0) / 100}
          </dd>
        </div>
      </dl>
      <ParcelMap candidates={[{ geometry: parcel.geometry, label: "Parcel" }]} />
      <p role="note">
        Parcel geometry is analytical and is not a legal survey.
      </p>
    </>
  ) : (
    <p>Parcel details are not yet available.</p>
  )}
</section>
```

Confirm no field named `owner`, `ownerName`, or similar appears anywhere in this component — it must not exist in the query's `select(...)` list either, since the underlying `parcels` table has no such column (enforced by Task 2's pgTAP `hasnt_column` assertion).

- [ ] **Step 4: Run gates**

```bash
npm run test:run
npm run lint
npm run typecheck
npm run build
```

- [ ] **Step 5: Manually verify the Property Profile**

Open the lead workspace for the resolved lead from Task 7 Step 10. Confirm the parcel fields render with real NJGIN values, the map shows the parcel polygon, the disclaimer is visible, and no owner name appears anywhere in the rendered HTML (view source / inspect and search for the fixture owner name used in Task 4's tests, confirming it is structurally impossible, not just absent in this instance).

- [ ] **Step 6: Commit the Property Profile extension**

```bash
git add "src/app/(app)/leads/[leadId]"
git commit -m "feat: extend the Property Profile with parcel, structure, and map details"
```

---

### Task 10: Phase 3 Vertical-Slice Verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: every module built in Tasks 1–9
- Produces: a verified, deployable Property Identity vertical slice

- [ ] **Step 1: Run every automated gate from a clean state**

```bash
npm ci
npm run db:start
npm run db:reset
npm run verify
git diff --check
git status --short
```

Expected: dependency installation is reproducible; migrations (foundation + CRM + property identity) replay from zero; all pgTAP assertions pass (foundation + CRM + property identity); lint, types, unit tests, and the production build pass; no stray whitespace or unintended files.

- [ ] **Step 2: Walk the full vertical slice manually, once, against the real Census and NJGIN endpoints**

With `npm run dev`, `npm run db:start`, and `npx inngest-cli@latest dev` running:

1. Submit a lead with a real, geocodable NJ residential address. Confirm the pipeline progresses `received → validating → enriching → complete` without manual intervention, and the lead workspace's Property section shows the real canonical address, block/lot, municipality/county, acreage, year built, values, and parcel map.
2. Submit a second lead with the **same** address (or a trivially re-formatted version of it) within the 180-day window. Confirm the second lead's `properties` row ends as `resolution_status = 'duplicate'` pointing at the first lead's property, the second lead's `leads.property_id` now points at the first lead's canonical property, and both leads retain independent `lead_stage_history`/`interactions`/`tasks` — i.e., neither lead's own history is lost.
3. Submit a lead with a deliberately unresolvable or nonsensical address. Confirm a `review_tasks` row appears in `/review` with `reason = 'low_address_confidence'` and the dashboard's review-queue count increments.
4. From `/review`, resolve that task via each of the applicable four actions across repeated test submissions (one lead per action): `resolve` (with and without a selected candidate), `reject`, `retry`, `unsupported`. Confirm each produces the expected `properties.resolution_status`/`pipeline_runs.status` and one `review.task_*` audit entry.
5. Sign out and confirm `/review` and `/review/[reviewTaskId]` redirect to `/login`; confirm anonymous Supabase REST calls against `property_addresses`, `parcels`, `structures`, and `review_tasks` are rejected (matching the pgTAP assertions from Task 2).
6. In the Inngest dev dashboard, replay `property/address.validation_requested` and `property/discovery_requested` for the same completed pipeline run and confirm no duplicate `property_addresses`, `parcels`, `structures`, `provider_requests`, `source_records`, `review_tasks`, `worker_runs`, or `audit_log` rows are created.

- [ ] **Step 3: Update the README**

Add a short "Phase 3: Property Identity" note to `README.md` alongside the existing Phase 1/2 links, stating: "Phase 3 adds live address validation (US Census Geocoder), NJ parcel discovery (NJGIN), duplicate property merging, and a minimal Review Queue for human escalation. Both provider integrations are free and require no API keys."

- [ ] **Step 4: Commit the verification**

```bash
git add README.md
git commit -m "docs: verify PIW Property Identity vertical slice"
```

## Phase 3 Completion Gate

Do not begin the Property Intelligence plan until all of the following are true:

- [ ] A clean checkout reaches a working local environment using the existing runbook, now including the property-identity migration.
- [ ] The CRM Writer publishes `property/address.validation_requested` after its existing projection work, and no longer marks the pipeline run `complete` itself.
- [ ] The Address Validation Worker calls the real Census Geocoder, derives a confidence score, and either publishes `property/discovery_requested`, merges into an existing canonical property within the 180-day window, or creates a `low_address_confidence`/`duplicate_candidates` review task — exactly once under duplicate delivery.
- [ ] The Property Discovery Worker calls the real NJGIN FeatureServer, resolves a single unambiguous residential parcel to `parcels`/`structures` and `properties.resolution_status = 'resolved'`, or creates a `multiple_parcels`/`condo_ambiguity`/`commercial_property`/`unsupported_property_type` review task — exactly once under duplicate delivery.
- [ ] `OWNER_NAME` is never stored (no such column exists on `parcels`) or rendered anywhere in the UI.
- [ ] Duplicate lead submissions for the same address merge into one property without losing either lead's own stage-history/task/interaction records.
- [ ] The Review Queue lists open tasks, shows candidates and a Leaflet map, and all four actions (`resolve`, `reject`, `retry`, `unsupported`) work end-to-end, each writing one audit entry and updating the linked property/pipeline run.
- [ ] The Property Profile on the lead workspace shows canonical address, block/lot/qualifier, PAMS PIN, municipality/county, acreage, year built, values, and a parcel map with the "not a legal survey" disclaimer once resolved.
- [ ] The dashboard's review-queue widget shows a real count.
- [ ] Anonymous REST access is rejected on `property_addresses`, `parcels`, `structures`, and `review_tasks`.
- [ ] Unit, pgTAP, lint, type, and production-build gates pass locally and in GitHub Actions without modification to `.github/workflows/ci.yml`.
- [ ] The implementation is reviewed against architecture spec §5.1, §5.2, §5.10, §6.1, §6.4, §9.4, §10.8, §11, and §12.

---

### Critical Files for Implementation

- `supabase/migrations/<timestamp>_property_identity.sql` — the new tables, the `resolution_status` extension, RLS policies, and `resolve_review_task`; everything else depends on this landing correctly.
- `src/domain/events.ts` — extending the discriminated event union (with the new attempt-aware idempotency-key derivation) is the contract every downstream module is built against.
- `src/inngest/functions/crm-writer.ts` — the modification that turns Phase 2's terminal worker into the trigger for Phase 3's chain; getting its behavioral change right (stop completing the pipeline, start publishing) is the hinge the whole phase swings on.
- `src/inngest/functions/address-validation-worker.ts` and `src/inngest/functions/property-discovery-worker.ts` — the two new workers, whose idempotency pattern (worker-run upsert, unique-constraint dedup, `workerRun.status !== "completed"`-gated completion/audit) is the template Phases 4–5 will reuse.
- `src/modules/providers/adapters/census-geocode.ts` and `src/modules/providers/adapters/njgin-parcel-lookup.ts` — the first two real, live provider integrations; their pure parse functions are what keep the whole pipeline's evidence trail honest and Daniel's-Law-compliant.
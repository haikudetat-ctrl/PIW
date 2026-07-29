# PIW Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deployable PIW foundation: a secured Next.js application, version-controlled Supabase/PostGIS schema, typed event contracts, transactional outbox, provider framework, Inngest integration, audit logging, and CI gates.

**Architecture:** A single Next.js App Router application runs on Vercel and exposes server-only domain services plus an Inngest handler. Supabase PostgreSQL is the system of record; immutable observations, pipeline runs, worker runs, domain events, and an outbox establish the contracts used by every later vertical slice. Domain modules depend on ports, while Supabase, Inngest, and provider implementations remain adapters.

**Tech Stack:** Node.js 24.x, npm 11.x, Next.js 16.2.x, React 19.2.x, TypeScript 7.0.x, Supabase CLI 2.110.x, `@supabase/supabase-js` 2.111.x, Inngest 4.13.x, Zod 4.4.x, Vitest 4.1.x, PostgreSQL with PostGIS, GitHub Actions, Vercel

## Global Constraints

- Initial market is New Jersey.
- Initial service is residential roofing only.
- The system serves one roofing company and invitation-only administrators.
- Weather, hail, wind, hurricane, storm-probability, insurance-event, and insurance-claims intelligence are excluded.
- A property is the durable entity; leads reference properties and retain independent histories.
- Every material derived value must trace to source evidence, a versioned calculation, or a labeled assumption.
- Every worker is event-driven and idempotent; workers never call downstream workers directly.
- Every application table has row-level security, and anonymous operational-data access is denied.
- Paid provider calls are disabled in preview and test environments.
- Vercel request handlers enqueue durable work and do not synchronously coordinate enrichment pipelines.
- Node.js is pinned to `24.x` in `package.json`.
- Production dependencies use exact versions recorded by the lockfile; automated dependency updates run as reviewable pull requests.

## Scope and Plan Sequence

The approved architecture contains six independently deployable subprojects. This plan implements Phase 1 only and establishes the interfaces consumed by the remaining plans:

1. **Foundation** — this plan
2. CRM — lead intake, dashboard, pipeline, tasks, interactions, and notifications
3. Property identity — address validation, duplicate matching, parcel discovery, maps, and review
4. Property intelligence — public records, GIS, roof analysis, confidence, and evidence display
5. Commercial intelligence — scoring, price books, estimates, reports, and PDF export
6. Operations — re-enrichment, budgets, observability, replay, recovery, and production hardening

Phase 1 is complete when an invited admin can sign in, view a protected application shell, submit a typed diagnostic event, observe its durable Inngest run and persisted audit trail, and pass all local and CI quality gates from a clean checkout.

## File Map

### Application and Tooling

- `package.json` — pinned runtime, scripts, and dependencies
- `package-lock.json` — reproducible dependency graph
- `tsconfig.json` — strict TypeScript configuration
- `eslint.config.mjs` — lint rules
- `next.config.ts` — Next.js configuration
- `vitest.config.ts` — unit-test aliases and environment
- `.env.example` — documented nonsecret environment contract
- `.gitignore` — generated and secret files

### Web and Authentication

- `src/app/layout.tsx` — root document and metadata
- `src/app/page.tsx` — authenticated foundation dashboard
- `src/app/login/page.tsx` — invitation-only admin sign-in
- `src/app/login/actions.ts` — server-side sign-in action
- `src/app/auth/callback/route.ts` — Supabase auth-code exchange
- `src/middleware.ts` — session refresh and protected-route redirect
- `src/lib/supabase/browser.ts` — browser Supabase client
- `src/lib/supabase/server.ts` — request-scoped server client
- `src/lib/supabase/service.ts` — server-only service-role client

### Domain Contracts

- `src/domain/events.ts` — event envelope and event-name schemas
- `src/domain/evidence.ts` — confidence, method, and observation schemas
- `src/domain/runs.ts` — pipeline and worker status schemas
- `src/domain/ids.ts` — branded UUID types and validation

### Persistence and Orchestration

- `src/lib/database.types.ts` — generated Supabase types
- `src/modules/events/outbox-repository.ts` — transactional event persistence port
- `src/modules/events/supabase-outbox-repository.ts` — Supabase implementation
- `src/modules/events/publish-pending-events.ts` — outbox-to-Inngest relay
- `src/inngest/client.ts` — typed Inngest client
- `src/inngest/functions/process-diagnostic-event.ts` — first durable function
- `src/app/api/inngest/route.ts` — Inngest serve handler

### Providers, Audit, and Diagnostics

- `src/modules/providers/contracts.ts` — capability and cost contracts
- `src/modules/providers/registry.ts` — ordered provider resolution
- `src/modules/audit/write-audit-entry.ts` — append-only audit service
- `src/app/api/diagnostics/events/route.ts` — admin-only diagnostic event endpoint

### Database and Delivery

- `supabase/config.toml` — local Supabase configuration
- `supabase/migrations/20260729000100_foundation.sql` — extensions, enums, core tables, RLS, and outbox functions
- `supabase/seed.sql` — deterministic local company and admin-profile fixture
- `supabase/tests/foundation.test.sql` — pgTAP schema and RLS assertions
- `.github/workflows/ci.yml` — lint, type, unit, database, and build gates
- `vercel.json` — deployment runtime and function settings
- `docs/runbooks/local-development.md` — reproducible local workflow
- `docs/runbooks/deployment.md` — GitHub, Supabase, Inngest, and Vercel setup

---

### Task 1: Scaffold the Deployable Next.js Application

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `next.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/app/globals.css`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/test/setup.ts`
- Test: `src/app/page.test.tsx`

**Interfaces:**
- Consumes: none
- Produces: npm scripts `dev`, `build`, `lint`, `typecheck`, `test`, and `test:run`; import alias `@/*`; `HomePage(): JSX.Element`

- [ ] **Step 1: Scaffold the application and install exact major-version dependencies**

Run:

```bash
npx create-next-app@16.2.12 . --ts --eslint --tailwind --src-dir --app --import-alias='@/*' --use-npm
npm install zod@4.4.3 inngest@4.13.0 @supabase/supabase-js@2.111.0 @supabase/ssr
npm install --save-dev vitest@4.1.10 jsdom @testing-library/react @testing-library/jest-dom supabase@2.110.0
npm pkg set engines.node='24.x'
npm pkg set scripts.typecheck='tsc --noEmit'
npm pkg set scripts.test='vitest'
npm pkg set scripts.test:run='vitest run'
```

Expected: `package-lock.json` is created, `package.json` declares Node `24.x`, and no install command reports an unresolved peer dependency.

- [ ] **Step 2: Configure Vitest before writing the application smoke test**

Create `vitest.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

Create `src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: Write the failing foundation-page test**

Replace the generated page test target with `src/app/page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import HomePage from "./page";

test("identifies the application and foundation status", () => {
  render(<HomePage />);
  expect(
    screen.getByRole("heading", { name: "Property Intelligence Worker" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Foundation online")).toBeInTheDocument();
});
```

- [ ] **Step 4: Run the test and verify the generated page fails the contract**

Run:

```bash
npm run test:run -- src/app/page.test.tsx
```

Expected: FAIL because the generated page does not contain the required heading or status.

- [ ] **Step 5: Implement the minimal foundation page**

Replace `src/app/page.tsx`:

```tsx
export default function HomePage() {
  return (
    <main>
      <p>PIW · New Jersey residential roofing</p>
      <h1>Property Intelligence Worker</h1>
      <p>Foundation online</p>
    </main>
  );
}
```

Set `src/app/layout.tsx` metadata title to `Property Intelligence Worker` and description to `New Jersey residential roofing intelligence`.

- [ ] **Step 6: Verify all scaffold gates**

Run:

```bash
npm run test:run
npm run lint
npm run typecheck
npm run build
```

Expected: all four commands exit 0.

- [ ] **Step 7: Commit the deployable scaffold**

```bash
git add package.json package-lock.json tsconfig.json eslint.config.mjs next.config.ts vitest.config.ts .gitignore .env.example src
git commit -m "chore: scaffold PIW application"
```

---

### Task 2: Define and Validate the Environment Contract

**Files:**
- Modify: `.env.example`
- Create: `src/lib/env/shared.ts`
- Create: `src/lib/env/server.ts`
- Create: `src/lib/env/client.ts`
- Test: `src/lib/env/shared.test.ts`

**Interfaces:**
- Consumes: `zod`
- Produces: `deploymentEnvironmentSchema`, `parseServerEnv(values)`, `parseClientEnv(values)`, `ServerEnv`, and `ClientEnv`

- [ ] **Step 1: Write failing tests for safe defaults and forbidden paid-provider access**

Create `src/lib/env/shared.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parseServerEnv } from "./server";

const base = {
  NODE_ENV: "test",
  DEPLOYMENT_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
  INNGEST_EVENT_KEY: "local-event-key",
  INNGEST_SIGNING_KEY: "local-signing-key",
};

describe("parseServerEnv", () => {
  test("disables paid providers by default", () => {
    expect(parseServerEnv(base).PAID_PROVIDERS_ENABLED).toBe(false);
  });

  test("rejects paid providers in preview", () => {
    expect(() =>
      parseServerEnv({
        ...base,
        DEPLOYMENT_ENV: "preview",
        PAID_PROVIDERS_ENABLED: "true",
      }),
    ).toThrow("Paid providers cannot be enabled in preview or test");
  });
});
```

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run:

```bash
npm run test:run -- src/lib/env/shared.test.ts
```

Expected: FAIL because `./server` does not exist.

- [ ] **Step 3: Implement schemas and the explicit safety refinement**

Create `src/lib/env/shared.ts`:

```ts
import { z } from "zod";

export const deploymentEnvironmentSchema = z.enum([
  "development",
  "test",
  "preview",
  "production",
]);

export const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");
```

Create `src/lib/env/server.ts`:

```ts
import "server-only";
import { z } from "zod";
import { booleanString, deploymentEnvironmentSchema } from "./shared";

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    DEPLOYMENT_ENV: deploymentEnvironmentSchema,
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    INNGEST_EVENT_KEY: z.string().min(1),
    INNGEST_SIGNING_KEY: z.string().min(1),
    PAID_PROVIDERS_ENABLED: booleanString,
  })
  .superRefine((value, context) => {
    if (
      value.PAID_PROVIDERS_ENABLED &&
      ["preview", "test"].includes(value.DEPLOYMENT_ENV)
    ) {
      context.addIssue({
        code: "custom",
        path: ["PAID_PROVIDERS_ENABLED"],
        message: "Paid providers cannot be enabled in preview or test",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export function parseServerEnv(values: Record<string, string | undefined>) {
  return serverEnvSchema.parse(values);
}
```

Create `src/lib/env/client.ts` with a schema limited to `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `DEPLOYMENT_ENV`. Do not import `server.ts` into client code.

- [ ] **Step 4: Document every variable**

Set `.env.example` to:

```dotenv
NODE_ENV=development
DEPLOYMENT_ENV=development
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
PAID_PROVIDERS_ENABLED=false
```

- [ ] **Step 5: Run focused and full quality gates**

Run:

```bash
npm run test:run -- src/lib/env/shared.test.ts
npm run test:run
npm run lint
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the environment contract**

```bash
git add .env.example src/lib/env
git commit -m "feat: validate deployment environment"
```

---

### Task 3: Define Versioned Domain Contracts

**Files:**
- Create: `src/domain/ids.ts`
- Create: `src/domain/evidence.ts`
- Create: `src/domain/runs.ts`
- Create: `src/domain/events.ts`
- Test: `src/domain/events.test.ts`
- Test: `src/domain/evidence.test.ts`

**Interfaces:**
- Consumes: Zod schemas
- Produces: `uuidSchema`, `confidenceSchema`, `observationMethodSchema`, `pipelineStatusSchema`, `workerStatusSchema`, `eventEnvelopeSchema`, `diagnosticRequestedDataSchema`, `DomainEvent`, and `createEventEnvelope(input)`

- [ ] **Step 1: Write failing event-envelope tests**

Create `src/domain/events.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { createEventEnvelope, eventEnvelopeSchema } from "./events";

describe("domain event envelope", () => {
  test("creates a versioned event with causal metadata", () => {
    const event = createEventEnvelope({
      name: "system/diagnostic.requested",
      correlationId: "11111111-1111-4111-8111-111111111111",
      pipelineRunId: "22222222-2222-4222-8222-222222222222",
      data: { requestedBy: "33333333-3333-4333-8333-333333333333" },
      now: new Date("2026-07-29T12:00:00.000Z"),
      id: "44444444-4444-4444-8444-444444444444",
    });

    expect(eventEnvelopeSchema.parse(event)).toMatchObject({
      id: "44444444-4444-4444-8444-444444444444",
      name: "system/diagnostic.requested",
      schemaVersion: 1,
      correlationId: "11111111-1111-4111-8111-111111111111",
    });
  });

  test("rejects unknown events", () => {
    expect(() =>
      eventEnvelopeSchema.parse({
        id: crypto.randomUUID(),
        name: "weather/completed",
        schemaVersion: 1,
        correlationId: crypto.randomUUID(),
        pipelineRunId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        data: {},
      }),
    ).toThrow();
  });
});
```

Create `src/domain/evidence.test.ts`:

```ts
import { expect, test } from "vitest";
import { confidenceSchema, observationMethodSchema } from "./evidence";

test("confidence is an integer from zero through one hundred", () => {
  expect(confidenceSchema.parse(95)).toBe(95);
  expect(() => confidenceSchema.parse(100.1)).toThrow();
  expect(() => confidenceSchema.parse(-1)).toThrow();
});

test("observation method is explicit", () => {
  expect(observationMethodSchema.options).toEqual([
    "measured",
    "calculated",
    "assumed",
    "reported",
  ]);
});
```

- [ ] **Step 2: Run the tests and verify missing-contract failures**

Run:

```bash
npm run test:run -- src/domain
```

Expected: FAIL because the domain modules do not exist.

- [ ] **Step 3: Implement IDs, evidence, and run-status schemas**

Create `src/domain/ids.ts`:

```ts
import { z } from "zod";

export const uuidSchema = z.uuid();
export type UUID = z.infer<typeof uuidSchema>;
```

Create `src/domain/evidence.ts`:

```ts
import { z } from "zod";

export const confidenceSchema = z.number().int().min(0).max(100);
export const observationMethodSchema = z.enum([
  "measured",
  "calculated",
  "assumed",
  "reported",
]);
export const observationStatusSchema = z.enum([
  "current",
  "superseded",
  "disputed",
  "rejected",
]);
```

Create `src/domain/runs.ts`:

```ts
import { z } from "zod";

export const pipelineStatusSchema = z.enum([
  "received",
  "validating",
  "enriching",
  "analyzing",
  "scoring",
  "estimating",
  "complete",
  "partial",
  "review_required",
  "failed",
]);

export const workerStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "partial",
  "review_required",
  "failed",
]);
```

- [ ] **Step 4: Implement the discriminated event contract**

Create `src/domain/events.ts`:

```ts
import { z } from "zod";
import { uuidSchema } from "./ids";

export const diagnosticRequestedDataSchema = z.object({
  requestedBy: uuidSchema,
});

const diagnosticRequestedSchema = z.object({
  id: uuidSchema,
  name: z.literal("system/diagnostic.requested"),
  schemaVersion: z.literal(1),
  correlationId: uuidSchema,
  causationEventId: uuidSchema.optional(),
  leadId: uuidSchema.optional(),
  propertyId: uuidSchema.optional(),
  pipelineRunId: uuidSchema,
  occurredAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1),
  data: diagnosticRequestedDataSchema,
});

export const eventEnvelopeSchema = z.discriminatedUnion("name", [
  diagnosticRequestedSchema,
]);

export type DomainEvent = z.infer<typeof eventEnvelopeSchema>;

type DiagnosticEventInput = {
  name: "system/diagnostic.requested";
  correlationId: string;
  pipelineRunId: string;
  data: z.infer<typeof diagnosticRequestedDataSchema>;
  now?: Date;
  id?: string;
};

export function createEventEnvelope(input: DiagnosticEventInput): DomainEvent {
  const id = input.id ?? crypto.randomUUID();
  return eventEnvelopeSchema.parse({
    ...input,
    id,
    schemaVersion: 1,
    occurredAt: (input.now ?? new Date()).toISOString(),
    idempotencyKey: `${input.name}:${input.pipelineRunId}`,
  });
}
```

- [ ] **Step 5: Verify contracts and forbidden weather-event rejection**

Run:

```bash
npm run test:run -- src/domain
npm run typecheck
```

Expected: all tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit the domain contracts**

```bash
git add src/domain
git commit -m "feat: define PIW domain contracts"
```

---

### Task 4: Create the Foundation Database and RLS Policies

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/20260729000100_foundation.sql`
- Create: `supabase/seed.sql`
- Create: `supabase/tests/foundation.test.sql`
- Modify: `package.json`

**Interfaces:**
- Consumes: UUID identifiers and statuses defined in Task 3
- Produces: PostgreSQL enums; tables `companies`, `admin_profiles`, `properties`, `leads`, `pipeline_runs`, `worker_runs`, `source_records`, `evidence_artifacts`, `observations`, `provider_requests`, `provider_cost_entries`, `domain_events`, `event_outbox`, `audit_log`; SQL function `current_company_id()`

- [ ] **Step 1: Initialize local Supabase and add database scripts**

Run:

```bash
npx supabase init
npm pkg set scripts.db:start='supabase start'
npm pkg set scripts.db:stop='supabase stop'
npm pkg set scripts.db:reset='supabase db reset'
npm pkg set scripts.db:test='supabase test db'
npm pkg set scripts.db:types='supabase gen types typescript --local'
```

Expected: `supabase/config.toml` exists and no remote project is linked.

- [ ] **Step 2: Write failing pgTAP schema and anonymous-access assertions**

Create `supabase/tests/foundation.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select has_extension('postgis', 'PostGIS is enabled');
select has_table('public', 'properties', 'properties exists');
select has_table('public', 'observations', 'observations exists');
select has_table('public', 'event_outbox', 'event_outbox exists');
select has_table('public', 'audit_log', 'audit_log exists');
select policies_are('public', 'properties', array['company admins read properties'], 'properties has explicit read policy');
select policies_are('public', 'leads', array['company admins read leads', 'company admins write leads'], 'leads has explicit admin policies');
select is(
  has_table_privilege('anon', 'public.leads', 'select'),
  false,
  'anonymous users cannot select leads'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Start Supabase and verify the tests fail before the migration**

Run:

```bash
npm run db:start
npm run db:test
```

Expected: FAIL because the foundation tables and PostGIS migration do not exist.

- [ ] **Step 4: Implement the migration in dependency order**

Create `supabase/migrations/20260729000100_foundation.sql` with:

```sql
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.pipeline_status as enum (
  'received', 'validating', 'enriching', 'analyzing', 'scoring',
  'estimating', 'complete', 'partial', 'review_required', 'failed'
);
create type public.worker_status as enum (
  'queued', 'running', 'completed', 'partial', 'review_required', 'failed'
);
create type public.observation_method as enum (
  'measured', 'calculated', 'assumed', 'reported'
);
create type public.observation_status as enum (
  'current', 'superseded', 'disputed', 'rejected'
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  display_name text not null,
  created_at timestamptz not null default now()
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  canonical_address text,
  municipality text,
  county text,
  state_code text not null default 'NJ' check (state_code = 'NJ'),
  location extensions.geography(point, 4326),
  resolution_status text not null default 'unresolved'
    check (resolution_status in ('unresolved', 'resolved', 'review_required', 'unsupported')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  property_id uuid references public.properties(id),
  name text not null,
  phone text not null,
  email text not null,
  submitted_address text not null,
  service_requested text not null default 'roofing' check (service_requested = 'roofing'),
  notes text,
  stage text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid references public.leads(id),
  property_id uuid references public.properties(id),
  correlation_id uuid not null unique,
  pipeline_version integer not null check (pipeline_version > 0),
  status public.pipeline_status not null default 'received',
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.worker_runs (
  id uuid primary key default gen_random_uuid(),
  pipeline_run_id uuid not null references public.pipeline_runs(id),
  worker_type text not null,
  worker_version integer not null check (worker_version > 0),
  idempotency_key text not null unique,
  status public.worker_status not null default 'queued',
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  started_at timestamptz,
  finished_at timestamptz
);

create table public.source_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  provider text not null,
  source_identifier text not null,
  source_url text,
  retrieved_at timestamptz not null,
  effective_at timestamptz,
  raw_payload jsonb,
  unique (provider, source_identifier, retrieved_at)
);

create table public.evidence_artifacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  storage_path text not null unique,
  media_type text not null,
  sha256 text not null,
  created_at timestamptz not null default now()
);

create table public.observations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  entity_type text not null,
  entity_id uuid not null,
  fact_type text not null,
  normalized_value jsonb not null,
  raw_value jsonb,
  units text,
  source_record_id uuid references public.source_records(id),
  method public.observation_method not null,
  confidence smallint not null check (confidence between 0 and 100),
  transformation_version text,
  status public.observation_status not null default 'current',
  created_at timestamptz not null default now()
);

create table public.provider_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  pipeline_run_id uuid references public.pipeline_runs(id),
  capability text not null,
  provider text not null,
  request_key text not null unique,
  status text not null check (status in ('requested', 'succeeded', 'failed', 'blocked_budget', 'cache_hit')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.provider_cost_entries (
  id uuid primary key default gen_random_uuid(),
  provider_request_id uuid not null references public.provider_requests(id),
  currency text not null default 'USD' check (currency = 'USD'),
  estimated_cost_micros bigint not null default 0 check (estimated_cost_micros >= 0),
  actual_cost_micros bigint check (actual_cost_micros >= 0),
  created_at timestamptz not null default now()
);

create table public.domain_events (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  pipeline_run_id uuid references public.pipeline_runs(id),
  event_name text not null,
  schema_version integer not null check (schema_version > 0),
  correlation_id uuid not null,
  causation_event_id uuid references public.domain_events(id),
  idempotency_key text not null unique,
  payload jsonb not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.event_outbox (
  event_id uuid primary key references public.domain_events(id) on delete cascade,
  available_at timestamptz not null default now(),
  published_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id),
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  correlation_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index observations_entity_fact_idx
  on public.observations(entity_type, entity_id, fact_type, created_at desc);
create index outbox_pending_idx
  on public.event_outbox(available_at) where published_at is null;
create index audit_company_created_idx
  on public.audit_log(company_id, created_at desc);

create or replace function public.current_company_id()
returns uuid language sql stable security invoker
set search_path = ''
as $$
  select company_id from public.admin_profiles where id = auth.uid()
$$;

alter table public.companies enable row level security;
alter table public.admin_profiles enable row level security;
alter table public.properties enable row level security;
alter table public.leads enable row level security;
alter table public.pipeline_runs enable row level security;
alter table public.worker_runs enable row level security;
alter table public.source_records enable row level security;
alter table public.evidence_artifacts enable row level security;
alter table public.observations enable row level security;
alter table public.provider_requests enable row level security;
alter table public.provider_cost_entries enable row level security;
alter table public.domain_events enable row level security;
alter table public.event_outbox enable row level security;
alter table public.audit_log enable row level security;

revoke all on all tables in schema public from anon;

create policy "company admins read properties" on public.properties
  for select to authenticated
  using (company_id = (select public.current_company_id()));
create policy "company admins read leads" on public.leads
  for select to authenticated
  using (company_id = (select public.current_company_id()));
create policy "company admins write leads" on public.leads
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));
```

Append the remaining explicit policies:

```sql
create policy "company admins read company" on public.companies
  for select to authenticated
  using (id = (select public.current_company_id()));

create policy "admins read own profile" on public.admin_profiles
  for select to authenticated
  using (id = auth.uid());

create policy "company admins read pipeline runs" on public.pipeline_runs
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read worker runs" on public.worker_runs
  for select to authenticated
  using (
    exists (
      select 1
      from public.pipeline_runs
      where pipeline_runs.id = worker_runs.pipeline_run_id
        and pipeline_runs.company_id = (select public.current_company_id())
    )
  );

create policy "company admins read source records" on public.source_records
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read evidence artifacts" on public.evidence_artifacts
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read observations" on public.observations
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read provider requests" on public.provider_requests
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read provider costs" on public.provider_cost_entries
  for select to authenticated
  using (
    exists (
      select 1
      from public.provider_requests
      where provider_requests.id = provider_cost_entries.provider_request_id
        and provider_requests.company_id = (select public.current_company_id())
    )
  );

create policy "company admins read domain events" on public.domain_events
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read audit log" on public.audit_log
  for select to authenticated
  using (company_id = (select public.current_company_id()));
```

Do not add authenticated write policies to evidence, events, outbox, provider-cost, worker-run, or audit tables; trusted server code writes them with the service role.

- [ ] **Step 5: Add deterministic local seed data**

Create `supabase/seed.sql`:

```sql
insert into public.companies (id, name)
values ('00000000-0000-4000-8000-000000000001', 'PIW Local Roofing')
on conflict (id) do nothing;
```

Admin identities are created through Supabase Auth, not by inserting directly into `auth.users` in the seed.

- [ ] **Step 6: Reset the local database and run pgTAP**

Run:

```bash
npm run db:reset
npm run db:test
```

Expected: all eight pgTAP assertions pass.

- [ ] **Step 7: Verify migration replay from a clean local database**

Run:

```bash
npm run db:stop -- --no-backup
npm run db:start
npm run db:reset
npm run db:test
```

Expected: migration replay and all database tests pass.

- [ ] **Step 8: Commit the database foundation**

```bash
git add package.json package-lock.json supabase
git commit -m "feat: add property-first database foundation"
```

---

### Task 5: Add Typed Supabase Clients and Invitation-Only Admin Authentication

**Files:**
- Create: `src/lib/database.types.ts`
- Create: `src/lib/supabase/browser.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/service.ts`
- Create: `src/middleware.ts`
- Create: `src/app/login/page.tsx`
- Create: `src/app/login/actions.ts`
- Create: `src/app/auth/callback/route.ts`
- Modify: `src/app/page.tsx`
- Test: `src/lib/supabase/service.test.ts`
- Test: `src/app/login/actions.test.ts`

**Interfaces:**
- Consumes: generated `Database`, parsed environment, Supabase Auth
- Produces: `createBrowserClient()`, `createServerClient()`, `createServiceClient()`, `signIn(formData)`, protected `/`, public `/login`, and `/auth/callback`

- [ ] **Step 1: Generate and capture database types**

Run:

```bash
npm run db:types -- --schema public > src/lib/database.types.ts
```

Expected: the file contains typed rows for `properties`, `leads`, `observations`, `domain_events`, and `audit_log`.

- [ ] **Step 2: Write failing tests for server-only service access and sign-in validation**

Create `src/app/login/actions.test.ts`:

```ts
import { expect, test } from "vitest";
import { loginInputSchema } from "./actions";

test("requires a valid email and nonempty password", () => {
  expect(() =>
    loginInputSchema.parse({ email: "invalid", password: "" }),
  ).toThrow();
  expect(
    loginInputSchema.parse({
      email: "admin@example.com",
      password: "correct horse battery staple",
    }),
  ).toEqual({
    email: "admin@example.com",
    password: "correct horse battery staple",
  });
});
```

Create `src/lib/supabase/service.test.ts`:

```ts
import { expect, test, vi } from "vitest";

test("service client module declares a server-only boundary", async () => {
  vi.mock("server-only", () => ({}));
  const module = await import("./service");
  expect(module.createServiceClient).toBeTypeOf("function");
});
```

- [ ] **Step 3: Run the tests and verify the modules are missing**

Run:

```bash
npm run test:run -- src/app/login/actions.test.ts src/lib/supabase/service.test.ts
```

Expected: FAIL because the auth action and clients do not exist.

- [ ] **Step 4: Implement typed clients**

Use `@supabase/ssr` for request-scoped browser/server clients and `@supabase/supabase-js` for the service client. `src/lib/supabase/service.ts` must begin with:

```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { parseServerEnv } from "@/lib/env/server";

export function createServiceClient() {
  const env = parseServerEnv(process.env);
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
```

The browser client receives only public values. The server client adapts Next.js cookies exactly as documented by `@supabase/ssr`.

- [ ] **Step 5: Implement invitation-only sign-in and route protection**

Export the validation schema from `src/app/login/actions.ts`:

```ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";

export const loginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export async function signIn(formData: FormData) {
  const input = loginInputSchema.parse(Object.fromEntries(formData));
  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword(input);
  if (error) return { error: "Invalid email or password" };
  redirect("/");
}
```

`src/middleware.ts` refreshes the Supabase session, allows `/login` and `/auth/callback`, and redirects unauthenticated requests to `/login`. Do not implement self-service sign-up.

`src/app/page.tsx` calls `supabase.auth.getUser()`, redirects missing users to `/login`, and verifies a matching `admin_profiles` row before rendering.

- [ ] **Step 6: Verify auth tests, types, and build**

Run:

```bash
npm run test:run -- src/app/login/actions.test.ts src/lib/supabase/service.test.ts
npm run lint
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 7: Manually verify invitation-only behavior locally**

Run:

```bash
npm run dev
```

Expected:

- Visiting `/` without a session redirects to `/login`.
- Invalid credentials show `Invalid email or password`.
- No sign-up control or public admin invitation endpoint exists.
- An Auth user with an `admin_profiles` row can view the foundation page.

- [ ] **Step 8: Commit authentication**

```bash
git add src/lib/database.types.ts src/lib/supabase src/middleware.ts src/app/login src/app/auth src/app/page.tsx
git commit -m "feat: secure PIW with admin authentication"
```

---

### Task 6: Implement the Transactional Event Outbox

**Files:**
- Modify: `supabase/migrations/20260729000100_foundation.sql`
- Modify: `supabase/tests/foundation.test.sql`
- Create: `src/modules/events/outbox-repository.ts`
- Create: `src/modules/events/supabase-outbox-repository.ts`
- Test: `src/modules/events/outbox-repository.test.ts`

**Interfaces:**
- Consumes: `DomainEvent`, `Database`, service-role Supabase client
- Produces: `OutboxRepository.enqueue(event, companyId)`, `claimBatch(limit, claimedBy)`, `markPublished(eventId)`, `markFailed(eventId, message)`, SQL functions `enqueue_domain_event`, `claim_outbox_events`, `complete_outbox_event`, and `fail_outbox_event`

- [ ] **Step 1: Write failing repository contract tests with an in-memory fake**

Create `src/modules/events/outbox-repository.test.ts`:

```ts
import { expect, test } from "vitest";
import { createEventEnvelope } from "@/domain/events";
import { InMemoryOutboxRepository } from "./outbox-repository";

test("enqueue is idempotent by event id and idempotency key", async () => {
  const repository = new InMemoryOutboxRepository();
  const event = createEventEnvelope({
    name: "system/diagnostic.requested",
    correlationId: "11111111-1111-4111-8111-111111111111",
    pipelineRunId: "22222222-2222-4222-8222-222222222222",
    data: { requestedBy: "33333333-3333-4333-8333-333333333333" },
    id: "44444444-4444-4444-8444-444444444444",
  });

  await repository.enqueue(event, "00000000-0000-4000-8000-000000000001");
  await repository.enqueue(event, "00000000-0000-4000-8000-000000000001");

  expect(repository.events).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test and verify the missing repository failure**

Run:

```bash
npm run test:run -- src/modules/events/outbox-repository.test.ts
```

Expected: FAIL because `outbox-repository.ts` does not exist.

- [ ] **Step 3: Define the port and deterministic in-memory implementation**

Create `src/modules/events/outbox-repository.ts`:

```ts
import type { DomainEvent } from "@/domain/events";

export type PendingOutboxEvent = {
  event: DomainEvent;
  attemptCount: number;
};

export interface OutboxRepository {
  enqueue(event: DomainEvent, companyId: string): Promise<void>;
  claimBatch(limit: number, claimedBy: string): Promise<PendingOutboxEvent[]>;
  markPublished(eventId: string): Promise<void>;
  markFailed(eventId: string, message: string): Promise<void>;
}

export class InMemoryOutboxRepository implements OutboxRepository {
  readonly events: DomainEvent[] = [];

  async enqueue(event: DomainEvent) {
    if (!this.events.some((item) => item.id === event.id)) this.events.push(event);
  }
  async claimBatch(limit: number) {
    return this.events.slice(0, limit).map((event) => ({ event, attemptCount: 0 }));
  }
  async markPublished() {}
  async markFailed() {}
}
```

- [ ] **Step 4: Add atomic SQL functions and lease columns**

Add `claimed_at timestamptz` and `claimed_by text` to `event_outbox`. Add:

```sql
create or replace function public.enqueue_domain_event(
  p_company_id uuid,
  p_event jsonb
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_event_id uuid := (p_event->>'id')::uuid;
begin
  insert into public.domain_events (
    id, company_id, pipeline_run_id, event_name, schema_version,
    correlation_id, causation_event_id, idempotency_key, payload, occurred_at
  ) values (
    v_event_id,
    p_company_id,
    (p_event->>'pipelineRunId')::uuid,
    p_event->>'name',
    (p_event->>'schemaVersion')::integer,
    (p_event->>'correlationId')::uuid,
    nullif(p_event->>'causationEventId', '')::uuid,
    p_event->>'idempotencyKey',
    p_event,
    (p_event->>'occurredAt')::timestamptz
  )
  on conflict (idempotency_key) do nothing;

  insert into public.event_outbox (event_id)
  select id from public.domain_events
  where idempotency_key = p_event->>'idempotencyKey'
  on conflict (event_id) do nothing;

  return v_event_id;
end;
$$;
```

Add atomic lease, completion, and failure functions:

```sql
create or replace function public.claim_outbox_events(
  p_limit integer,
  p_claimed_by text
) returns table (
  event_id uuid,
  payload jsonb,
  attempt_count integer
)
language plpgsql security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select outbox.event_id
    from public.event_outbox as outbox
    where outbox.published_at is null
      and outbox.available_at <= now()
      and (
        outbox.claimed_at is null
        or outbox.claimed_at < now() - interval '5 minutes'
      )
    order by outbox.available_at, outbox.event_id
    for update skip locked
    limit greatest(0, least(p_limit, 100))
  ),
  claimed as (
    update public.event_outbox as outbox
    set claimed_at = now(),
        claimed_by = p_claimed_by,
        attempt_count = outbox.attempt_count + 1
    from candidates
    where outbox.event_id = candidates.event_id
    returning outbox.event_id, outbox.attempt_count
  )
  select claimed.event_id, events.payload, claimed.attempt_count
  from claimed
  join public.domain_events as events on events.id = claimed.event_id;
end;
$$;

create or replace function public.complete_outbox_event(p_event_id uuid)
returns void
language sql security definer
set search_path = ''
as $$
  update public.event_outbox
  set published_at = now(), claimed_at = null, claimed_by = null, last_error = null
  where event_id = p_event_id and published_at is null
$$;

create or replace function public.fail_outbox_event(
  p_event_id uuid,
  p_error text
) returns void
language sql security definer
set search_path = ''
as $$
  update public.event_outbox
  set claimed_at = null,
      claimed_by = null,
      last_error = left(p_error, 500),
      available_at = now() + least(
        interval '15 minutes',
        interval '5 seconds' * power(2, least(attempt_count, 8))
      )
  where event_id = p_event_id and published_at is null
$$;

revoke all on function public.enqueue_domain_event(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.claim_outbox_events(integer, text) from public, anon, authenticated;
revoke all on function public.complete_outbox_event(uuid) from public, anon, authenticated;
revoke all on function public.fail_outbox_event(uuid, text) from public, anon, authenticated;

grant execute on function public.enqueue_domain_event(uuid, jsonb) to service_role;
grant execute on function public.claim_outbox_events(integer, text) to service_role;
grant execute on function public.complete_outbox_event(uuid) to service_role;
grant execute on function public.fail_outbox_event(uuid, text) to service_role;
```

- [ ] **Step 5: Add pgTAP assertions for idempotency and permissions**

Append this event fixture and assertions, replacing the pgTAP plan count with the final assertion count:

```sql
insert into public.pipeline_runs (
  id, company_id, correlation_id, pipeline_version, status
) values (
  '22222222-2222-4222-8222-222222222222',
  '00000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  1,
  'received'
);

select public.enqueue_domain_event(
  '00000000-0000-4000-8000-000000000001',
  '{
    "id":"44444444-4444-4444-8444-444444444444",
    "name":"system/diagnostic.requested",
    "schemaVersion":1,
    "correlationId":"11111111-1111-4111-8111-111111111111",
    "pipelineRunId":"22222222-2222-4222-8222-222222222222",
    "occurredAt":"2026-07-29T12:00:00.000Z",
    "idempotencyKey":"system/diagnostic.requested:22222222-2222-4222-8222-222222222222",
    "data":{"requestedBy":"33333333-3333-4333-8333-333333333333"}
  }'::jsonb
);
select public.enqueue_domain_event(
  '00000000-0000-4000-8000-000000000001',
  '{
    "id":"44444444-4444-4444-8444-444444444444",
    "name":"system/diagnostic.requested",
    "schemaVersion":1,
    "correlationId":"11111111-1111-4111-8111-111111111111",
    "pipelineRunId":"22222222-2222-4222-8222-222222222222",
    "occurredAt":"2026-07-29T12:00:00.000Z",
    "idempotencyKey":"system/diagnostic.requested:22222222-2222-4222-8222-222222222222",
    "data":{"requestedBy":"33333333-3333-4333-8333-333333333333"}
  }'::jsonb
);

select is(
  (select count(*) from public.domain_events where id = '44444444-4444-4444-8444-444444444444'),
  1::bigint,
  'duplicate enqueue creates one domain event'
);
select is(
  (select count(*) from public.event_outbox where event_id = '44444444-4444-4444-8444-444444444444'),
  1::bigint,
  'duplicate enqueue creates one outbox row'
);
select function_privs_are(
  'public', 'enqueue_domain_event', array['uuid', 'jsonb'], 'anon', array[]::text[],
  'anonymous role cannot enqueue events'
);
select function_privs_are(
  'public', 'enqueue_domain_event', array['uuid', 'jsonb'], 'authenticated', array[]::text[],
  'authenticated role cannot enqueue events'
);
select is(
  (select count(*) from public.claim_outbox_events(1, 'first-claimer')),
  1::bigint,
  'first claimant leases the pending event'
);
select is(
  (select count(*) from public.claim_outbox_events(1, 'second-claimer')),
  0::bigint,
  'second claimant cannot lease an active claim'
);
```

Update the test plan count to match the exact number of assertions.

- [ ] **Step 6: Implement the Supabase adapter**

Create `src/modules/events/supabase-outbox-repository.ts` implementing `OutboxRepository` with typed `rpc()` calls. Parse every claimed payload using `eventEnvelopeSchema` before returning it to application code. Convert database errors to `OutboxPersistenceError` without including raw payloads.

- [ ] **Step 7: Run unit and database tests**

Run:

```bash
npm run test:run -- src/modules/events
npm run db:reset
npm run db:test
npm run typecheck
```

Expected: all commands exit 0 and duplicate enqueue produces one durable event.

- [ ] **Step 8: Regenerate database types and commit**

Run:

```bash
npm run db:types -- --schema public > src/lib/database.types.ts
git add supabase src/lib/database.types.ts src/modules/events
git commit -m "feat: add transactional event outbox"
```

---

### Task 7: Add Inngest Relay and Durable Diagnostic Processing

**Files:**
- Create: `src/inngest/client.ts`
- Create: `src/inngest/functions/process-diagnostic-event.ts`
- Create: `src/inngest/functions/publish-outbox.ts`
- Create: `src/app/api/inngest/route.ts`
- Create: `src/modules/events/publish-pending-events.ts`
- Test: `src/modules/events/publish-pending-events.test.ts`
- Test: `src/inngest/functions/process-diagnostic-event.test.ts`

**Interfaces:**
- Consumes: `OutboxRepository`, `DomainEvent`, typed Inngest event map
- Produces: `inngest`, `publishPendingEvents(dependencies)`, `publishOutbox`, `processDiagnosticEvent`, and `/api/inngest`

- [ ] **Step 1: Write the failing relay behavior test**

Create `src/modules/events/publish-pending-events.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import { publishPendingEvents } from "./publish-pending-events";

test("publishes claimed events and acknowledges only successes", async () => {
  const event = {
    id: "44444444-4444-4444-8444-444444444444",
    name: "system/diagnostic.requested" as const,
    schemaVersion: 1 as const,
    correlationId: "11111111-1111-4111-8111-111111111111",
    pipelineRunId: "22222222-2222-4222-8222-222222222222",
    occurredAt: "2026-07-29T12:00:00.000Z",
    idempotencyKey: "system/diagnostic.requested:22222222-2222-4222-8222-222222222222",
    data: { requestedBy: "33333333-3333-4333-8333-333333333333" },
  };
  const repository = {
    claimBatch: vi.fn().mockResolvedValue([{ event, attemptCount: 0 }]),
    markPublished: vi.fn(),
    markFailed: vi.fn(),
    enqueue: vi.fn(),
  };
  const send = vi.fn().mockResolvedValue(undefined);

  await publishPendingEvents({ repository, send, claimedBy: "test-worker" });

  expect(send).toHaveBeenCalledWith({ name: event.name, data: event });
  expect(repository.markPublished).toHaveBeenCalledWith(event.id);
  expect(repository.markFailed).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the relay test and verify failure**

Run:

```bash
npm run test:run -- src/modules/events/publish-pending-events.test.ts
```

Expected: FAIL because `publish-pending-events.ts` does not exist.

- [ ] **Step 3: Implement the relay with per-event acknowledgement**

Create `src/modules/events/publish-pending-events.ts`:

```ts
import type { DomainEvent } from "@/domain/events";
import type { OutboxRepository } from "./outbox-repository";

type Dependencies = {
  repository: OutboxRepository;
  send: (event: { name: DomainEvent["name"]; data: DomainEvent }) => Promise<void>;
  claimedBy: string;
};

export async function publishPendingEvents({
  repository,
  send,
  claimedBy,
}: Dependencies) {
  const pending = await repository.claimBatch(50, claimedBy);
  for (const { event } of pending) {
    try {
      await send({ name: event.name, data: event });
      await repository.markPublished(event.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown publish error";
      await repository.markFailed(event.id, message.slice(0, 500));
    }
  }
  return { claimed: pending.length };
}
```

- [ ] **Step 4: Create the typed Inngest client and route**

Create `src/inngest/client.ts`:

```ts
import { EventSchemas, Inngest } from "inngest";
import type { DomainEvent } from "@/domain/events";

type Events = {
  "system/diagnostic.requested": { data: Extract<DomainEvent, { name: "system/diagnostic.requested" }> };
};

export const inngest = new Inngest({
  id: "property-intelligence-worker",
  schemas: new EventSchemas().fromRecord<Events>(),
});
```

Create `src/app/api/inngest/route.ts` using `serve` from `inngest/next`, the typed client, `publishOutbox`, and `processDiagnosticEvent`. Export `GET`, `POST`, and `PUT`; set `maxDuration = 300`.

- [ ] **Step 5: Implement durable functions with idempotent steps**

`publishOutbox` runs every minute and calls `publishPendingEvents` inside `step.run("claim-and-publish", ...)`.

`processDiagnosticEvent` listens to `system/diagnostic.requested` and:

1. uses `step.run("record-worker-start", ...)` to upsert a `worker_runs` row with idempotency key `diagnostic:<pipelineRunId>`;
2. uses `step.run("record-worker-completion", ...)` to set the run to `completed`;
3. writes an audit entry with the same correlation ID.

Return `{ ok: true, eventId: event.data.id }`.

- [ ] **Step 6: Test success and duplicate delivery**

Create `src/inngest/functions/process-diagnostic-event.test.ts` around an extracted `processDiagnosticEventData(event, repository)` service. Invoke it twice with the same event and assert the repository contains one worker run and one logical completion.

Run:

```bash
npm run test:run -- src/modules/events src/inngest
npm run lint
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 7: Verify locally with Inngest Dev Server**

Run in separate terminals:

```bash
npm run dev
npx inngest-cli@latest dev
```

Expected: the Inngest dashboard at `http://localhost:8288` discovers both functions and a diagnostic event completes without duplicate worker rows.

- [ ] **Step 8: Commit orchestration**

```bash
git add src/inngest src/app/api/inngest src/modules/events
git commit -m "feat: connect durable event processing"
```

---

### Task 8: Define the Provider and Cost-Control Framework

**Files:**
- Create: `src/modules/providers/contracts.ts`
- Create: `src/modules/providers/registry.ts`
- Create: `src/modules/providers/cost-policy.ts`
- Test: `src/modules/providers/registry.test.ts`
- Test: `src/modules/providers/cost-policy.test.ts`

**Interfaces:**
- Consumes: deployment environment and provider capability names
- Produces: `ProviderCapability`, `ProviderAdapter`, `ProviderRequestContext`, `ProviderResult<T>`, `ProviderRegistry.resolve(capability)`, and `evaluateProviderRequest(input)`

- [ ] **Step 1: Write failing resolution and budget tests**

Create `src/modules/providers/registry.test.ts`:

```ts
import { expect, test } from "vitest";
import { ProviderRegistry } from "./registry";

test("resolves the lowest-cost enabled provider for a capability", () => {
  const registry = new ProviderRegistry([
    { id: "premium", capability: "address.validate", priority: 20, enabled: true },
    { id: "public", capability: "address.validate", priority: 10, enabled: true },
  ]);
  expect(registry.resolve("address.validate").id).toBe("public");
});
```

Create `src/modules/providers/cost-policy.test.ts`:

```ts
import { expect, test } from "vitest";
import { evaluateProviderRequest } from "./cost-policy";

test("blocks paid requests in preview regardless of available budget", () => {
  expect(
    evaluateProviderRequest({
      deploymentEnvironment: "preview",
      paidProvidersEnabled: false,
      estimatedCostMicros: 250_000,
      leadSpentMicros: 0,
      leadCapMicros: 5_000_000,
      providerMonthSpentMicros: 0,
      providerMonthCapMicros: 50_000_000,
    }),
  ).toEqual({ allowed: false, reason: "paid_providers_disabled" });
});
```

- [ ] **Step 2: Run tests and verify missing modules**

Run:

```bash
npm run test:run -- src/modules/providers
```

Expected: FAIL because the provider modules do not exist.

- [ ] **Step 3: Define explicit capability and result contracts**

In `contracts.ts`, define:

```ts
export type ProviderCapability =
  | "address.validate"
  | "parcel.lookup"
  | "permits.search"
  | "imagery.retrieve"
  | "elevation.retrieve"
  | "roof.measurement";

export type ProviderRequestContext = {
  companyId: string;
  pipelineRunId: string;
  correlationId: string;
  requestKey: string;
  deploymentEnvironment: "development" | "test" | "preview" | "production";
};

export type ProviderResult<T> = {
  value: T;
  provider: string;
  sourceIdentifier: string;
  retrievedAt: string;
  estimatedCostMicros: number;
  actualCostMicros?: number;
  rawArtifactId?: string;
};

export interface ProviderAdapter<I, O> {
  id: string;
  capability: ProviderCapability;
  priority: number;
  paid: boolean;
  enabled: boolean;
  execute(input: I, context: ProviderRequestContext): Promise<ProviderResult<O>>;
}
```

- [ ] **Step 4: Implement deterministic registry and cost decisions**

`ProviderRegistry.resolve(capability)` filters enabled providers by exact capability, sorts ascending by priority, and throws `ProviderUnavailableError(capability)` when empty.

`evaluateProviderRequest` returns one of:

- `{ allowed: true }`
- `{ allowed: false, reason: "paid_providers_disabled" }`
- `{ allowed: false, reason: "lead_budget_exceeded" }`
- `{ allowed: false, reason: "provider_month_budget_exceeded" }`

All money values are integer USD micros; floating-point currency is forbidden.

- [ ] **Step 5: Add edge-case tests**

Add tests for:

- no adapter supporting the capability;
- disabled public adapter falling through to an enabled premium adapter;
- exact lead-cap boundary allowed;
- request exceeding lead cap blocked;
- request exceeding monthly provider cap blocked;
- production paid call allowed only when `paidProvidersEnabled` is true.

- [ ] **Step 6: Run provider and global tests**

Run:

```bash
npm run test:run -- src/modules/providers
npm run test:run
npm run lint
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit provider contracts**

```bash
git add src/modules/providers
git commit -m "feat: add cost-aware provider framework"
```

---

### Task 9: Add Append-Only Audit Logging and Admin Diagnostics

**Files:**
- Create: `src/modules/audit/write-audit-entry.ts`
- Create: `src/app/api/diagnostics/events/route.ts`
- Modify: `src/app/page.tsx`
- Test: `src/modules/audit/write-audit-entry.test.ts`
- Test: `src/app/api/diagnostics/events/route.test.ts`

**Interfaces:**
- Consumes: service Supabase client, outbox repository, authenticated admin
- Produces: `writeAuditEntry(input, client)`, `POST /api/diagnostics/events`, and a protected dashboard diagnostic control

- [ ] **Step 1: Write failing audit-redaction test**

Create `src/modules/audit/write-audit-entry.test.ts`:

```ts
import { expect, test } from "vitest";
import { sanitizeAuditMetadata } from "./write-audit-entry";

test("redacts lead contact fields recursively", () => {
  expect(
    sanitizeAuditMetadata({
      email: "person@example.com",
      nested: { phone: "555-555-5555", status: "received" },
    }),
  ).toEqual({
    email: "[REDACTED]",
    nested: { phone: "[REDACTED]", status: "received" },
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
npm run test:run -- src/modules/audit/write-audit-entry.test.ts
```

Expected: FAIL because the audit module does not exist.

- [ ] **Step 3: Implement append-only audit writes and recursive redaction**

`sanitizeAuditMetadata` redacts keys matching `email`, `phone`, `name`, `password`, `token`, `authorization`, `secret`, and `raw_payload`, case-insensitively, at every nesting level.

`writeAuditEntry` accepts:

```ts
type AuditEntryInput = {
  companyId: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
};
```

It inserts sanitized metadata and never updates or deletes audit rows.

- [ ] **Step 4: Write the failing diagnostic-route authorization test**

Create a route test with injected `getCurrentAdmin` and `enqueue` dependencies. Assert an unauthenticated request returns 401 and does not enqueue. Assert an authenticated request returns 202 with event and pipeline IDs.

- [ ] **Step 5: Implement the diagnostic endpoint**

`POST /api/diagnostics/events`:

1. gets the authenticated Supabase user;
2. loads the matching admin profile and company;
3. inserts a `pipeline_runs` record with version 1 and a new correlation ID;
4. creates `system/diagnostic.requested`;
5. enqueues it through `OutboxRepository`;
6. writes `diagnostic.event_requested` to the audit log;
7. returns status 202 with `{ eventId, pipelineRunId, correlationId }`.

The response contains no service credentials or raw provider payloads.

- [ ] **Step 6: Add a protected dashboard control**

Add a small server-rendered “Foundation diagnostics” panel showing authentication, database, event relay, and last diagnostic status. Its button posts to the diagnostic endpoint and displays the returned correlation ID.

- [ ] **Step 7: Verify the complete vertical slice**

Run:

```bash
npm run test:run
npm run db:test
npm run lint
npm run typecheck
npm run build
```

Expected: all commands exit 0.

With the local web app, Supabase, and Inngest dev server running, submit a diagnostic event and verify:

- one pipeline run exists;
- one domain event and one outbox row exist;
- the outbox row is marked published;
- one worker run completes;
- audit entries use the same correlation ID;
- replay does not duplicate the worker run.

- [ ] **Step 8: Commit audit and diagnostics**

```bash
git add src/modules/audit src/app/api/diagnostics src/app/page.tsx
git commit -m "feat: add auditable foundation diagnostics"
```

---

### Task 10: Add CI, Vercel Configuration, and Reproducible Runbooks

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `vercel.json`
- Create: `docs/runbooks/local-development.md`
- Create: `docs/runbooks/deployment.md`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: all Phase 1 scripts and environment variables
- Produces: required CI checks, documented local bootstrap, and production deployment procedure

- [ ] **Step 1: Add a single local verification command**

Add:

```bash
npm pkg set scripts.verify='npm run lint && npm run typecheck && npm run test:run && npm run db:test && npm run build'
```

Run:

```bash
npm run verify
```

Expected: the command exits 0 against the completed foundation.

- [ ] **Step 2: Create the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  application:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test:run
      - run: npm run build
        env:
          NODE_ENV: production
          DEPLOYMENT_ENV: test
          NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ci-publishable
          SUPABASE_SERVICE_ROLE_KEY: ci-service
          INNGEST_EVENT_KEY: ci-event
          INNGEST_SIGNING_KEY: ci-signing
          PAID_PROVIDERS_ENABLED: "false"

  database:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx supabase start
      - run: npm run db:reset
      - run: npm run db:test
      - run: |
          npm run db:types -- --schema public > /tmp/database.types.ts
          diff -u src/lib/database.types.ts /tmp/database.types.ts
```

Pin GitHub Action commit SHAs in the implementation commit after Dependabot is configured; retain version comments for readability.

- [ ] **Step 3: Configure Vercel**

Create `vercel.json`:

```json
{
  "framework": "nextjs",
  "functions": {
    "src/app/api/inngest/route.ts": {
      "maxDuration": 300
    }
  }
}
```

Confirm the Vercel project uses Node.js 24.x and that preview has `DEPLOYMENT_ENV=preview` and `PAID_PROVIDERS_ENABLED=false`.

- [ ] **Step 4: Write the local-development runbook**

Document exact prerequisites and commands:

```bash
npm ci
npm run db:start
npm run db:reset
cp .env.example .env.local
npx inngest-cli@latest dev
npm run dev
npm run verify
```

Document how to create a local Auth user through Supabase Studio and insert its `admin_profiles` row for company `00000000-0000-4000-8000-000000000001`. Warn that `supabase db reset --linked` is destructive and is never used against production.

- [ ] **Step 5: Write the deployment runbook**

Document:

1. create production and preview Supabase projects;
2. run `supabase db push --dry-run` before `supabase db push`;
3. create the first admin through Supabase Auth and insert the profile;
4. configure Inngest event and signing keys;
5. configure Vercel environment variables by environment;
6. connect the GitHub repository to Vercel;
7. require both CI jobs before merging;
8. deploy and verify `/api/inngest` sync;
9. run the diagnostic event and retain its correlation ID;
10. verify backups and record the recovery owner.

Explicitly state that service-role and Inngest signing keys must never use the `NEXT_PUBLIC_` prefix.

- [ ] **Step 6: Update the README**

The README links the approved architecture spec, this plan, both runbooks, the local commands, and the statement: “PIW v1 supports New Jersey residential roofing and does not include weather or storm intelligence.”

- [ ] **Step 7: Run the final Phase 1 verification**

Run:

```bash
npm ci
npm run db:start
npm run db:reset
npm run verify
git diff --check
git status --short
```

Expected:

- dependency installation is reproducible;
- migrations replay from zero;
- database tests pass;
- lint, types, unit tests, and production build pass;
- `git diff --check` emits no output;
- only intended Phase 1 files are modified.

- [ ] **Step 8: Commit delivery automation and documentation**

```bash
git add .github vercel.json docs/runbooks README.md package.json package-lock.json
git commit -m "ci: verify and document PIW foundation"
```

## Phase 1 Completion Gate

Do not begin the CRM plan until all of the following are true:

- [ ] A clean checkout reaches a working local environment using the runbook.
- [ ] Invitation-only admin sign-in works; anonymous operational-data access fails.
- [ ] Database migrations and generated TypeScript types agree.
- [ ] A diagnostic event persists transactionally, publishes through Inngest, and completes once under duplicate delivery.
- [ ] Audit entries share the pipeline correlation ID and redact contact fields.
- [ ] Provider policies block paid calls in test and preview.
- [ ] Unit, database, lint, type, and production-build gates pass locally and in GitHub Actions.
- [ ] The Vercel production deployment discovers Inngest functions and completes a diagnostic run.
- [ ] The implementation is reviewed against the approved architecture specification.

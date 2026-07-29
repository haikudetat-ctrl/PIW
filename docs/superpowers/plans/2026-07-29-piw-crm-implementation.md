# PIW CRM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 2 CRM vertical slice on top of the PIW foundation: property-first lead intake, a CRM Writer worker, a dashboard, an eight-stage pipeline board, a lead workspace, tasks, interactions, and in-app notifications.

**Architecture:** Extends the existing Next.js App Router application, Supabase/PostGIS schema, typed domain event contracts, transactional outbox, and Inngest integration established in Phase 1. Lead intake creates a `properties` row immediately (`resolution_status = 'unresolved'`) so property intelligence has somewhere to live before Phase 3's address validation exists. No real enrichment pipeline runs yet: a single "CRM Writer" Inngest function consumes `crm/lead.submitted`, records the initial pipeline stage, creates an in-app notification, and marks the pipeline run `complete`.

**Tech Stack:** Node.js 24.x, npm 11.x, Next.js 16.2.x, React 19.2.x, TypeScript 7.0.x, Supabase CLI 2.110.x, `@supabase/supabase-js` 2.111.x, Inngest 4.13.x, Zod 4.4.x, Vitest 4.1.x, PostgreSQL with PostGIS, GitHub Actions, Vercel — all pinned versions inherited unchanged from Phase 1.

## Global Constraints

All Phase 1 global constraints still apply:

- Initial market is New Jersey; initial service is residential roofing only.
- The system serves one roofing company and invitation-only administrators.
- Weather, hail, wind, hurricane, storm-probability, insurance-event, and insurance-claims intelligence are excluded.
- A property is the durable entity; leads reference properties and retain independent histories.
- Every worker is event-driven and idempotent; workers never call downstream workers directly.
- Every application table has row-level security, and anonymous operational-data access is denied.
- Every new table requires **explicit `grant ... to service_role`** statements — this local Postgres image grants `service_role` no implicit privileges beyond RLS bypass, and a blanket grant executed in an earlier migration does not retroactively cover tables created by a later migration.
- Node.js is pinned to `24.x`; production dependencies use exact versions.

Phase 2 adds these CRM-specific constraints and decisions (fixed, not to be relitigated):

- **Property-first lead intake.** Submitting a lead creates a `leads` row and a `properties` row in the same atomic operation. `properties.resolution_status = 'unresolved'`, `properties.canonical_address = null`, `leads.property_id` points at the new property, `leads.submitted_address` holds the raw typed text.
- **No real enrichment in Phase 2.** Lead submission creates a `pipeline_runs` row and publishes `crm/lead.submitted`. The CRM Writer Inngest function is the only consumer; it immediately marks the pipeline run `complete` — there is nothing else to enrich yet.
- **`review_tasks` is out of scope.** It is explicitly a Phase 3 entity per the architecture spec's phase assignment. The dashboard's review-queue widget shows a static `0` count.
- **Interaction types** (`interactions.type`): `call`, `email`, `text`, `site_visit`, `note`. This is a product default, not spec-mandated.
- **Task status** (`tasks.status`): `open`, `complete`, `cancelled`. A product default, chosen for consistency with the nullable-timestamp-as-state pattern already used elsewhere (`completed_at`).
- **Notification type** (`notifications.type`): `lead_submitted`, `review_task_created`, `pipeline_stuck`, `pipeline_failed`. Phase 2 only ever emits `lead_submitted`; the other three values are reserved so Phase 3–6 workers described in spec §5.9 don't require another enum migration.
- **`leads.stage` becomes a proper Postgres enum** (`public.lead_stage`), converted from the existing free-text column via `alter table ... using stage::public.lead_stage`, matching how `pipeline_status`/`worker_status`/`observation_method` are already modeled.
- **Notifications are in-app only.** No email/SMS integration (explicit in spec §5.9).
- **No provider-spend dashboard widget.** Spec §10.1 mentions "provider spend," but no provider calls exist until Phase 3+; that widget is deferred with `provider_cost_entries`.
- **Pipeline stage changes use an explicit per-lead stage selector, not drag-and-drop**, to avoid adding a client-side DnD dependency in Phase 2.
- **A shared authenticated app-shell route group `src/app/(app)/`** is introduced to host navigation (Dashboard / Pipeline / New lead / Notifications) and the existing auth guard. URL paths are unchanged; this is a route-group refactor, not a URL change. The existing Phase 1 dashboard (`src/app/page.tsx`, `src/app/page.test.tsx`, `src/app/foundation-diagnostics.tsx`) moves under this group.
- Cross-table writes that must be atomic (lead+property+pipeline_run creation; stage change + history append) are implemented as `security definer` SQL functions restricted to `service_role`, mirroring `enqueue_domain_event`. Single-table writes an authenticated admin performs directly (creating a task, logging an interaction, marking a notification read) use ordinary RLS-scoped grants, mirroring the existing `leads` "for all" policy — no service role needed for those.

## Scope and Plan Sequence

1. Foundation — complete (previous plan)
2. **CRM — this plan** — lead intake, dashboard, pipeline, lead workspace, property profile shell, tasks, interactions, and in-app notifications
3. Property identity — address validation, duplicate matching, parcel discovery, maps, and review
4. Property intelligence — public records, GIS, roof analysis, confidence, and evidence display
5. Commercial intelligence — scoring, price books, estimates, reports, and PDF export
6. Operations — re-enrichment, budgets, observability, replay, recovery, and production hardening

Phase 2 is complete when an invited admin can submit a lead, see it appear on the dashboard and pipeline board, move it through the eight commercial stages, open its workspace to see contact details, a property shell, tasks, interactions, and merged activity history, and receive an in-app notification for the submission — all durably processed through the existing outbox/Inngest pattern and covered by unit, pgTAP, lint, type, and build gates.

## File Map

### Domain Contracts

- `src/domain/crm.ts` — `leadStageSchema`, `interactionTypeSchema`, `taskStatusSchema`, `notificationTypeSchema`
- `src/domain/events.ts` — extended with `crm/lead.submitted`

### Database

- `supabase/migrations/<timestamp>_crm.sql` — CRM tables, `lead_stage` enum conversion, RLS, `submit_lead_intake`, `change_lead_stage`
- `supabase/tests/crm.test.sql` — pgTAP schema, RLS, and function assertions
- `src/lib/database.types.ts` — regenerated after each migration change

### Lead Intake

- `src/modules/leads/submit-lead-intake.ts` — DI-testable orchestration core
- `src/app/(app)/leads/new/page.tsx`, `lead-intake-form.tsx`, `actions.ts`

### CRM Writer

- `src/inngest/client.ts` — modified to register `crm/lead.submitted`
- `src/inngest/functions/crm-writer.ts`
- `src/app/api/inngest/route.ts` — modified to register `crmWriter`

### App Shell and Dashboard

- `src/app/(app)/layout.tsx` — nav + auth guard (moved from `src/app/page.tsx`'s inline guard)
- `src/app/(app)/page.tsx`, `page.test.tsx`, `foundation-diagnostics.tsx` — moved from `src/app/`
- `src/modules/dashboard/pipeline-totals.ts`

### Pipeline Board

- `src/modules/leads/change-lead-stage.ts`
- `src/app/(app)/pipeline/page.tsx`, `pipeline-board.tsx`, `actions.ts`

### Lead Workspace

- `src/modules/leads/activity-timeline.ts`
- `src/app/(app)/leads/[leadId]/page.tsx`

### Tasks

- `src/modules/tasks/schema.ts`, `due-status.ts`
- `src/app/(app)/leads/[leadId]/task-list.tsx`, `task-actions.ts`

### Interactions

- `src/modules/interactions/schema.ts`
- `src/app/(app)/leads/[leadId]/interaction-list.tsx`, `interaction-actions.ts`

### Notifications

- `src/modules/notifications/badge.ts`
- `src/app/(app)/notifications/page.tsx`, `actions.ts`
- `src/app/(app)/notifications-bell.tsx`

---

### Task 1: Extend Domain Contracts for CRM

**Files:**
- Create: `src/domain/crm.ts`
- Create: `src/domain/crm.test.ts`
- Modify: `src/domain/events.ts`
- Modify: `src/domain/events.test.ts`

**Interfaces:**
- Consumes: `uuidSchema` from `src/domain/ids.ts`
- Produces: `leadStageSchema`, `interactionTypeSchema`, `taskStatusSchema`, `notificationTypeSchema`, `leadSubmittedDataSchema`, extended `eventEnvelopeSchema` and `createEventEnvelope(input)` accepting `crm/lead.submitted`

- [ ] **Step 1: Write failing tests for the new CRM enums**

Create `src/domain/crm.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  interactionTypeSchema,
  leadStageSchema,
  notificationTypeSchema,
  taskStatusSchema,
} from "./crm";

test("lead stage is the eight-stage commercial pipeline", () => {
  expect(leadStageSchema.options).toEqual([
    "new",
    "contacting",
    "appointment_set",
    "estimating",
    "proposal_sent",
    "won",
    "lost",
    "nurture",
  ]);
});

test("interaction type is explicit", () => {
  expect(interactionTypeSchema.options).toEqual([
    "call",
    "email",
    "text",
    "site_visit",
    "note",
  ]);
});

test("task status is explicit", () => {
  expect(taskStatusSchema.options).toEqual(["open", "complete", "cancelled"]);
});

test("notification type is explicit", () => {
  expect(notificationTypeSchema.options).toEqual([
    "lead_submitted",
    "review_task_created",
    "pipeline_stuck",
    "pipeline_failed",
  ]);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm run test:run -- src/domain/crm.test.ts
```

Expected: FAIL because `./crm` does not exist.

- [ ] **Step 3: Implement the CRM enum schemas**

Create `src/domain/crm.ts`:

```ts
import { z } from "zod";

export const leadStageSchema = z.enum([
  "new",
  "contacting",
  "appointment_set",
  "estimating",
  "proposal_sent",
  "won",
  "lost",
  "nurture",
]);

export const interactionTypeSchema = z.enum([
  "call",
  "email",
  "text",
  "site_visit",
  "note",
]);

export const taskStatusSchema = z.enum(["open", "complete", "cancelled"]);

export const notificationTypeSchema = z.enum([
  "lead_submitted",
  "review_task_created",
  "pipeline_stuck",
  "pipeline_failed",
]);
```

- [ ] **Step 4: Write a failing test for the `crm/lead.submitted` event**

Append to `src/domain/events.test.ts`:

```ts
describe("crm/lead.submitted event", () => {
  test("creates a versioned lead-submitted event", () => {
    const event = createEventEnvelope({
      name: "crm/lead.submitted",
      correlationId: "11111111-1111-4111-8111-111111111111",
      pipelineRunId: "22222222-2222-4222-8222-222222222222",
      leadId: "55555555-5555-4555-8555-555555555555",
      propertyId: "66666666-6666-4666-8666-666666666666",
      data: {
        leadId: "55555555-5555-4555-8555-555555555555",
        propertyId: "66666666-6666-4666-8666-666666666666",
        name: "Jordan Rivera",
        phone: "555-010-1000",
        email: "jordan@example.com",
        submittedAddress: "12 Birch St, Trenton, NJ",
        serviceRequested: "roofing",
      },
    });

    expect(eventEnvelopeSchema.parse(event)).toMatchObject({
      name: "crm/lead.submitted",
      schemaVersion: 1,
      leadId: "55555555-5555-4555-8555-555555555555",
      propertyId: "66666666-6666-4666-8666-666666666666",
    });
  });
});
```

(This requires `describe` to already be imported; it is, from Task 3 of the foundation plan.)

- [ ] **Step 5: Run and confirm failure**

```bash
npm run test:run -- src/domain/events.test.ts
```

Expected: FAIL because `crm/lead.submitted` is not a member of `eventEnvelopeSchema`.

- [ ] **Step 6: Extend the discriminated event union**

Replace `src/domain/events.ts`:

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

export const leadSubmittedDataSchema = z.object({
  leadId: uuidSchema,
  propertyId: uuidSchema,
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.email(),
  submittedAddress: z.string().min(1),
  serviceRequested: z.literal("roofing"),
  notes: z.string().optional(),
});

const leadSubmittedSchema = z.object({
  id: uuidSchema,
  name: z.literal("crm/lead.submitted"),
  schemaVersion: z.literal(1),
  correlationId: uuidSchema,
  causationEventId: uuidSchema.optional(),
  leadId: uuidSchema,
  propertyId: uuidSchema,
  pipelineRunId: uuidSchema,
  occurredAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1),
  data: leadSubmittedDataSchema,
});

export const eventEnvelopeSchema = z.discriminatedUnion("name", [
  diagnosticRequestedSchema,
  leadSubmittedSchema,
]);

export type DomainEvent = z.infer<typeof eventEnvelopeSchema>;

type EventInput =
  | {
      name: "system/diagnostic.requested";
      correlationId: string;
      pipelineRunId: string;
      causationEventId?: string;
      data: z.infer<typeof diagnosticRequestedDataSchema>;
      now?: Date;
      id?: string;
    }
  | {
      name: "crm/lead.submitted";
      correlationId: string;
      pipelineRunId: string;
      leadId: string;
      propertyId: string;
      causationEventId?: string;
      data: z.infer<typeof leadSubmittedDataSchema>;
      now?: Date;
      id?: string;
    };

export function createEventEnvelope(input: EventInput): DomainEvent {
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

- [ ] **Step 7: Run focused and full gates**

```bash
npm run test:run -- src/domain
npm run test:run
npm run lint
npm run typecheck
```

Expected: all commands exit 0, and the existing `system/diagnostic.requested` tests still pass unmodified.

- [ ] **Step 8: Commit the CRM domain contracts**

```bash
git add src/domain/crm.ts src/domain/crm.test.ts src/domain/events.ts src/domain/events.test.ts
git commit -m "feat: extend domain contracts for CRM lead submission"
```

---

### Task 2: Create the CRM Database Schema and RLS Policies

**Files:**
- Create: `supabase/migrations/<timestamp>_crm.sql` (run `npx supabase migration new crm` to generate the timestamped filename)
- Create: `supabase/tests/crm.test.sql`
- Modify: `src/lib/database.types.ts`

**Interfaces:**
- Consumes: `leadStageSchema`, `interactionTypeSchema`, `taskStatusSchema`, `notificationTypeSchema` from Task 1 (as the source of truth for the enum value lists below); `current_company_id()` from the foundation migration
- Produces: enums `lead_stage`, `interaction_type`, `task_status`, `notification_type`; tables `lead_stage_history`, `tasks`, `interactions`, `notifications`; `leads.stage` converted to `public.lead_stage`

- [ ] **Step 1: Generate the migration file**

```bash
npx supabase migration new crm
```

Expected: an empty `supabase/migrations/<timestamp>_crm.sql` is created. Use that exact filename for the remainder of this plan wherever `<timestamp>_crm.sql` appears.

- [ ] **Step 2: Write failing pgTAP schema and RLS assertions**

Create `supabase/tests/crm.test.sql`:

```sql
begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

select has_table('public', 'lead_stage_history', 'lead_stage_history exists');
select has_table('public', 'tasks', 'tasks exists');
select has_table('public', 'interactions', 'interactions exists');
select has_table('public', 'notifications', 'notifications exists');

select col_type_is('public', 'leads', 'stage', 'public.lead_stage', 'leads.stage is a governed enum');

select policies_are(
  'public', 'lead_stage_history',
  array['company admins read lead stage history'],
  'lead_stage_history has a single read policy'
);
select policies_are(
  'public', 'tasks',
  array['company admins read tasks', 'company admins create tasks', 'company admins update tasks'],
  'tasks has explicit read/create/update policies'
);
select policies_are(
  'public', 'interactions',
  array['company admins read interactions', 'company admins create interactions'],
  'interactions has explicit read/create policies'
);
select policies_are(
  'public', 'notifications',
  array['company admins read notifications', 'company admins mark notifications read'],
  'notifications has explicit read/update policies'
);

select is(
  has_table_privilege('anon', 'public.tasks', 'select'),
  false,
  'anonymous users cannot select tasks'
);
select is(
  has_table_privilege('authenticated', 'public.lead_stage_history', 'insert'),
  false,
  'authenticated admins cannot directly insert lead stage history'
);
select is(
  has_table_privilege('authenticated', 'public.notifications', 'insert'),
  false,
  'authenticated admins cannot directly insert notifications'
);
select is(
  has_table_privilege('service_role', 'public.notifications', 'insert'),
  true,
  'service role can insert notifications'
);

select * from finish();

rollback;
```

- [ ] **Step 3: Run and confirm failure**

```bash
npm run db:reset
npm run db:test
```

Expected: FAIL because the CRM tables and the `lead_stage` enum do not exist yet.

- [ ] **Step 4: Implement the CRM migration**

Write `supabase/migrations/<timestamp>_crm.sql`:

```sql
-- Convert leads.stage from free text to a governed pipeline-stage enum.
create type public.lead_stage as enum (
  'new',
  'contacting',
  'appointment_set',
  'estimating',
  'proposal_sent',
  'won',
  'lost',
  'nurture'
);

alter table public.leads alter column stage drop default;
alter table public.leads
  alter column stage type public.lead_stage
  using stage::public.lead_stage;
alter table public.leads alter column stage set default 'new'::public.lead_stage;

create type public.interaction_type as enum (
  'call', 'email', 'text', 'site_visit', 'note'
);

create type public.task_status as enum (
  'open', 'complete', 'cancelled'
);

create type public.notification_type as enum (
  'lead_submitted', 'review_task_created', 'pipeline_stuck', 'pipeline_failed'
);

create table public.lead_stage_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id) on delete cascade,
  from_stage public.lead_stage,
  to_stage public.lead_stage not null,
  changed_by uuid references public.admin_profiles(id),
  note text,
  changed_at timestamptz not null default now()
);

-- Exactly one system-authored "initial stage" row per lead. The CRM Writer
-- (Task 4) relies on this constraint to stay idempotent under duplicate
-- event delivery.
create unique index lead_stage_history_initial_idx
  on public.lead_stage_history(lead_id)
  where from_stage is null;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text,
  due_at timestamptz,
  assigned_to uuid references public.admin_profiles(id),
  status public.task_status not null default 'open',
  completed_at timestamptz,
  created_by uuid references public.admin_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id) on delete cascade,
  type public.interaction_type not null,
  summary text not null check (length(trim(summary)) > 0),
  occurred_at timestamptz not null default now(),
  created_by uuid references public.admin_profiles(id),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid references public.leads(id) on delete cascade,
  type public.notification_type not null,
  title text not null check (length(trim(title)) > 0),
  body text,
  correlation_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- One notification per (correlation, type). The CRM Writer (Task 4) relies
-- on this constraint to stay idempotent under duplicate event delivery.
create unique index notifications_correlation_type_idx
  on public.notifications(correlation_id, type)
  where correlation_id is not null;

create index lead_stage_history_company_id_idx on public.lead_stage_history(company_id);
create index lead_stage_history_lead_id_idx on public.lead_stage_history(lead_id, changed_at desc);
create index tasks_company_id_idx on public.tasks(company_id);
create index tasks_lead_id_idx on public.tasks(lead_id);
create index tasks_status_due_at_idx on public.tasks(status, due_at);
create index interactions_company_id_idx on public.interactions(company_id);
create index interactions_lead_id_idx on public.interactions(lead_id, occurred_at desc);
create index notifications_company_id_created_idx on public.notifications(company_id, created_at desc);
create index notifications_lead_id_idx on public.notifications(lead_id);
create index notifications_unread_idx on public.notifications(company_id) where read_at is null;

alter table public.lead_stage_history enable row level security;
alter table public.tasks enable row level security;
alter table public.interactions enable row level security;
alter table public.notifications enable row level security;

revoke all on public.lead_stage_history from anon, authenticated;
revoke all on public.tasks from anon, authenticated;
revoke all on public.interactions from anon, authenticated;
revoke all on public.notifications from anon, authenticated;

-- service_role bypasses RLS but, as in the foundation migration, this local
-- Postgres image grants it no implicit table privileges.
grant all on public.lead_stage_history to service_role;
grant all on public.tasks to service_role;
grant all on public.interactions to service_role;
grant all on public.notifications to service_role;

grant select on public.lead_stage_history to authenticated;
grant select, insert, update on public.tasks to authenticated;
grant select, insert on public.interactions to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy "company admins read lead stage history" on public.lead_stage_history
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins read tasks" on public.tasks
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins create tasks" on public.tasks
  for insert to authenticated
  with check (company_id = (select public.current_company_id()));

create policy "company admins update tasks" on public.tasks
  for update to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

create policy "company admins read interactions" on public.interactions
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins create interactions" on public.interactions
  for insert to authenticated
  with check (company_id = (select public.current_company_id()));

create policy "company admins read notifications" on public.notifications
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "company admins mark notifications read" on public.notifications
  for update to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));
```

- [ ] **Step 5: Reset and run pgTAP**

```bash
npm run db:reset
npm run db:test
```

Expected: all 13 assertions pass.

- [ ] **Step 6: Regenerate database types**

```bash
npm run db:types -- --schema public > src/lib/database.types.ts
```

Expected: `Database["public"]["Tables"]` now includes `lead_stage_history`, `tasks`, `interactions`, `notifications`, and `leads.Row.stage` is typed as the `lead_stage` union.

- [ ] **Step 7: Run full gates**

```bash
npm run test:run
npm run db:test
npm run lint
npm run typecheck
```

- [ ] **Step 8: Commit the CRM schema**

```bash
git add supabase/migrations supabase/tests/crm.test.sql src/lib/database.types.ts
git commit -m "feat: add CRM schema, RLS policies, and lead-stage enum"
```

---

### Task 3: Implement Property-First Lead Intake

**Files:**
- Modify: `supabase/migrations/<timestamp>_crm.sql`
- Modify: `supabase/tests/crm.test.sql`
- Modify: `src/lib/database.types.ts`
- Create: `src/modules/leads/submit-lead-intake.ts`
- Create: `src/modules/leads/submit-lead-intake.test.ts`
- Create: `src/app/(app)/leads/new/page.tsx`
- Create: `src/app/(app)/leads/new/lead-intake-form.tsx`
- Create: `src/app/(app)/leads/new/actions.ts`

**Interfaces:**
- Consumes: `leadIntakeInputSchema`, `createEventEnvelope`, `SupabaseOutboxRepository`
- Produces: SQL function `submit_lead_intake`; `submitLeadIntake(input, deps)`; server action `createLead(formData)`; route `/leads/new`

- [ ] **Step 1: Write a failing pgTAP test for atomic lead intake**

Append to `supabase/tests/crm.test.sql` (before `select * from finish();`), and update `select plan(13);` to `select plan(17);`:

```sql
insert into public.companies (id, name)
values ('00000000-0000-4000-8000-000000000001', 'PIW Local Roofing')
on conflict (id) do nothing;

select is(
  (select count(*) from public.submit_lead_intake(
    '00000000-0000-4000-8000-000000000001',
    'Jordan Rivera', '555-010-1000', 'jordan@example.com',
    '12 Birch St, Trenton, NJ', null,
    '55555555-5555-4555-8555-555555555555', 1
  )),
  1::bigint,
  'submit_lead_intake returns one row'
);
select is(
  (select resolution_status from public.properties
   where id = (select property_id from public.leads
               where submitted_address = '12 Birch St, Trenton, NJ')),
  'unresolved',
  'lead intake creates an unresolved property'
);
select is(
  (select count(*) from public.pipeline_runs
   where correlation_id = '55555555-5555-4555-8555-555555555555'),
  1::bigint,
  'lead intake creates one pipeline run'
);
select function_privs_are(
  'public', 'submit_lead_intake',
  array['uuid','text','text','text','text','text','uuid','integer'],
  'authenticated', array[]::text[],
  'authenticated role cannot call submit_lead_intake directly'
);
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm run db:reset
npm run db:test
```

Expected: FAIL because `public.submit_lead_intake` does not exist.

- [ ] **Step 3: Implement `submit_lead_intake`**

Append to `supabase/migrations/<timestamp>_crm.sql`:

```sql
create or replace function public.submit_lead_intake(
  p_company_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_submitted_address text,
  p_notes text,
  p_correlation_id uuid,
  p_pipeline_version integer
) returns table (
  lead_id uuid,
  property_id uuid,
  pipeline_run_id uuid
)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_property_id uuid;
  v_lead_id uuid;
  v_pipeline_run_id uuid;
begin
  insert into public.properties (company_id, resolution_status)
  values (p_company_id, 'unresolved')
  returning id into v_property_id;

  insert into public.leads (
    company_id, property_id, name, phone, email, submitted_address, notes
  ) values (
    p_company_id, v_property_id, p_name, p_phone, p_email, p_submitted_address, p_notes
  )
  returning id into v_lead_id;

  insert into public.pipeline_runs (
    company_id, lead_id, property_id, correlation_id, pipeline_version, status
  ) values (
    p_company_id, v_lead_id, v_property_id, p_correlation_id, p_pipeline_version, 'received'
  )
  returning id into v_pipeline_run_id;

  return query select v_lead_id, v_property_id, v_pipeline_run_id;
end;
$$;

revoke all on function public.submit_lead_intake(uuid, text, text, text, text, text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.submit_lead_intake(uuid, text, text, text, text, text, uuid, integer)
  to service_role;
```

`plpgsql` function bodies execute as a single statement from the caller's perspective, so all three inserts commit or roll back together — a raised exception anywhere (e.g. a future `not null` violation) undoes the whole call.

- [ ] **Step 4: Reset and run pgTAP**

```bash
npm run db:reset
npm run db:test
npm run db:types -- --schema public > src/lib/database.types.ts
```

Expected: all 17 assertions pass; `src/lib/database.types.ts` gains the `submit_lead_intake` RPC signature.

- [ ] **Step 5: Write a failing unit test for the intake orchestration core**

Create `src/modules/leads/submit-lead-intake.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import { submitLeadIntake } from "./submit-lead-intake";

test("creates lead records before enqueueing the submitted event", async () => {
  const createLeadRecords = vi.fn().mockResolvedValue({
    leadId: "lead-1",
    propertyId: "property-1",
    pipelineRunId: "run-1",
  });
  const enqueueLeadSubmitted = vi.fn().mockResolvedValue(undefined);

  const input = {
    name: "Jordan Rivera",
    phone: "555-010-1000",
    email: "jordan@example.com",
    submittedAddress: "12 Birch St, Trenton, NJ",
  };

  const result = await submitLeadIntake(input, { createLeadRecords, enqueueLeadSubmitted });

  expect(result).toEqual({
    leadId: "lead-1",
    propertyId: "property-1",
    pipelineRunId: "run-1",
    correlationId: expect.any(String),
  });
  expect(createLeadRecords).toHaveBeenCalledWith({ ...input, correlationId: result.correlationId });
  expect(enqueueLeadSubmitted).toHaveBeenCalledWith({
    leadId: "lead-1",
    propertyId: "property-1",
    pipelineRunId: "run-1",
    correlationId: result.correlationId,
    lead: input,
  });
});
```

- [ ] **Step 6: Run and confirm failure**

```bash
npm run test:run -- src/modules/leads/submit-lead-intake.test.ts
```

Expected: FAIL because `submit-lead-intake.ts` does not exist.

- [ ] **Step 7: Implement the intake orchestration core**

Create `src/modules/leads/submit-lead-intake.ts`:

```ts
import { z } from "zod";

export const leadIntakeInputSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.email(),
  submittedAddress: z.string().min(1),
  notes: z.string().optional(),
});

export type LeadIntakeInput = z.infer<typeof leadIntakeInputSchema>;

export type LeadIntakeResult = {
  leadId: string;
  propertyId: string;
  pipelineRunId: string;
  correlationId: string;
};

export type SubmitLeadIntakeDependencies = {
  createLeadRecords: (
    input: LeadIntakeInput & { correlationId: string },
  ) => Promise<{ leadId: string; propertyId: string; pipelineRunId: string }>;
  enqueueLeadSubmitted: (input: {
    leadId: string;
    propertyId: string;
    pipelineRunId: string;
    correlationId: string;
    lead: LeadIntakeInput;
  }) => Promise<void>;
};

export async function submitLeadIntake(
  input: LeadIntakeInput,
  deps: SubmitLeadIntakeDependencies,
): Promise<LeadIntakeResult> {
  const correlationId = crypto.randomUUID();
  const { leadId, propertyId, pipelineRunId } = await deps.createLeadRecords({
    ...input,
    correlationId,
  });

  await deps.enqueueLeadSubmitted({ leadId, propertyId, pipelineRunId, correlationId, lead: input });

  return { leadId, propertyId, pipelineRunId, correlationId };
}
```

- [ ] **Step 8: Wire the real server action**

Create `src/app/(app)/leads/new/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createEventEnvelope } from "@/domain/events";
import { SupabaseOutboxRepository } from "@/modules/events/supabase-outbox-repository";
import { leadIntakeInputSchema, submitLeadIntake } from "@/modules/leads/submit-lead-intake";

export async function createLead(formData: FormData) {
  const input = leadIntakeInputSchema.parse(Object.fromEntries(formData));

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: adminProfile } = await supabase
    .from("admin_profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!adminProfile) redirect("/login");

  const service = createServiceClient();

  const result = await submitLeadIntake(input, {
    createLeadRecords: async (lead) => {
      const { data, error } = await service.rpc("submit_lead_intake", {
        p_company_id: adminProfile.company_id,
        p_name: lead.name,
        p_phone: lead.phone,
        p_email: lead.email,
        p_submitted_address: lead.submittedAddress,
        p_notes: lead.notes ?? null,
        p_correlation_id: lead.correlationId,
        p_pipeline_version: 1,
      });
      if (error || !data?.[0]) throw new Error("Failed to create lead intake");
      return {
        leadId: data[0].lead_id,
        propertyId: data[0].property_id,
        pipelineRunId: data[0].pipeline_run_id,
      };
    },
    enqueueLeadSubmitted: async ({ leadId, propertyId, pipelineRunId, correlationId, lead }) => {
      const event = createEventEnvelope({
        name: "crm/lead.submitted",
        correlationId,
        pipelineRunId,
        leadId,
        propertyId,
        data: {
          leadId,
          propertyId,
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          submittedAddress: lead.submittedAddress,
          serviceRequested: "roofing",
          notes: lead.notes,
        },
      });
      const outbox = new SupabaseOutboxRepository(service);
      await outbox.enqueue(event, adminProfile.company_id);
    },
  });

  // Task 7 (Lead Workspace) redirects here to /leads/${result.leadId} once
  // that route exists. Until then, land back on the dashboard.
  redirect(`/?submitted=${result.leadId}`);
}
```

Create `src/app/(app)/leads/new/lead-intake-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { createLead } from "./actions";

type LeadIntakeState = { error?: string };
const initialState: LeadIntakeState = {};

export function LeadIntakeForm() {
  const [state, formAction, pending] = useActionState<LeadIntakeState, FormData>(
    async (_previousState, formData) => {
      await createLead(formData);
      return initialState;
    },
    initialState,
  );

  return (
    <form action={formAction}>
      <label>
        Name
        <input name="name" required />
      </label>
      <label>
        Phone
        <input name="phone" type="tel" required />
      </label>
      <label>
        Email
        <input name="email" type="email" required />
      </label>
      <label>
        Property address
        <input name="submittedAddress" required />
      </label>
      <label>
        Notes
        <textarea name="notes" />
      </label>
      <button type="submit" disabled={pending}>
        Submit lead
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
```

Create `src/app/(app)/leads/new/page.tsx`:

```tsx
import { LeadIntakeForm } from "./lead-intake-form";

export default function NewLeadPage() {
  return (
    <main>
      <h1>New lead</h1>
      <LeadIntakeForm />
    </main>
  );
}
```

- [ ] **Step 9: Run gates**

```bash
npm run test:run
npm run lint
npm run typecheck
npm run build
```

- [ ] **Step 10: Manually verify property-first intake**

With `npm run dev` and `npm run db:start` running, sign in and submit a lead at `/leads/new`. In Supabase Studio, confirm:

- one `properties` row with `resolution_status = 'unresolved'` and `canonical_address is null`;
- one `leads` row whose `property_id` matches it and `submitted_address` holds the typed text;
- one `pipeline_runs` row with `status = 'received'` (the CRM Writer in Task 4 will advance it);
- one `domain_events` row and one `event_outbox` row for `crm/lead.submitted`.

- [ ] **Step 11: Commit lead intake**

```bash
git add supabase/migrations supabase/tests/crm.test.sql src/lib/database.types.ts src/modules/leads src/app/\(app\)/leads/new
git commit -m "feat: add property-first lead intake"
```

---

### Task 4: Implement the CRM Writer Inngest Function

**Files:**
- Modify: `src/inngest/client.ts`
- Create: `src/inngest/functions/crm-writer.ts`
- Create: `src/inngest/functions/crm-writer.test.ts`
- Modify: `src/app/api/inngest/route.ts`

**Interfaces:**
- Consumes: `crm/lead.submitted` from Task 1, `writeAuditEntry` from Phase 1
- Produces: `leadSubmitted` typed Inngest event, `crmWriter` durable function, `writeCrmProjection(event, repository)`

- [ ] **Step 1: Write a failing idempotency test for the projection core**

Create `src/inngest/functions/crm-writer.test.ts`:

```ts
import { expect, test } from "vitest";
import { writeCrmProjection, type CrmWriterRepository, type WorkerRunRecord } from "./crm-writer";

class FakeCrmWriterRepository implements CrmWriterRepository {
  private readonly runsByIdempotencyKey = new Map<string, WorkerRunRecord>();
  private readonly initialStageLeadIds = new Set<string>();
  private readonly notificationCorrelationIds = new Set<string>();
  private nextId = 1;
  completions = 0;
  pipelineRunCompletions = 0;

  async upsertWorkerRunQueued(input: { idempotencyKey: string }): Promise<WorkerRunRecord> {
    const existing = this.runsByIdempotencyKey.get(input.idempotencyKey);
    if (existing) return existing;
    const record: WorkerRunRecord = { id: String(this.nextId++), status: "queued" };
    this.runsByIdempotencyKey.set(input.idempotencyKey, record);
    return record;
  }

  async markWorkerRunCompleted(workerRunId: string): Promise<void> {
    this.completions += 1;
    for (const record of this.runsByIdempotencyKey.values()) {
      if (record.id === workerRunId) record.status = "completed";
    }
  }

  async recordInitialStageHistory(leadId: string): Promise<void> {
    this.initialStageLeadIds.add(leadId);
  }

  async createLeadSubmittedNotification(input: { correlationId: string }): Promise<void> {
    this.notificationCorrelationIds.add(input.correlationId);
  }

  async completePipelineRun(): Promise<void> {
    this.pipelineRunCompletions += 1;
  }

  get stageHistoryCount() {
    return this.initialStageLeadIds.size;
  }
  get notificationCount() {
    return this.notificationCorrelationIds.size;
  }
}

test("duplicate delivery projects the lead exactly once", async () => {
  const repository = new FakeCrmWriterRepository();
  const event = {
    id: "44444444-4444-4444-8444-444444444444",
    pipelineRunId: "22222222-2222-4222-8222-222222222222",
    correlationId: "11111111-1111-4111-8111-111111111111",
    leadId: "66666666-6666-4666-8666-666666666666",
  };

  await writeCrmProjection(event, repository);
  await writeCrmProjection(event, repository);

  expect(repository.stageHistoryCount).toBe(1);
  expect(repository.notificationCount).toBe(1);
  expect(repository.completions).toBe(1);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm run test:run -- src/inngest/functions/crm-writer.test.ts
```

Expected: FAIL because `crm-writer.ts` does not exist.

- [ ] **Step 3: Register the typed event on the Inngest client**

Replace `src/inngest/client.ts`:

```ts
import { Inngest, eventType, staticSchema } from "inngest";
import type { DomainEvent } from "@/domain/events";

type DiagnosticRequestedData = Extract<DomainEvent, { name: "system/diagnostic.requested" }>;
type LeadSubmittedData = Extract<DomainEvent, { name: "crm/lead.submitted" }>;

export const diagnosticRequested = eventType("system/diagnostic.requested", {
  schema: staticSchema<DiagnosticRequestedData>(),
});

export const leadSubmitted = eventType("crm/lead.submitted", {
  schema: staticSchema<LeadSubmittedData>(),
});

export const inngest = new Inngest({
  id: "property-intelligence-worker",
});
```

- [ ] **Step 4: Implement the CRM Writer**

Create `src/inngest/functions/crm-writer.ts`:

```ts
import "server-only";
import { inngest, leadSubmitted } from "@/inngest/client";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAuditEntry } from "@/modules/audit/write-audit-entry";

export type WorkerRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "review_required"
  | "failed";

export type WorkerRunRecord = { id: string; status: WorkerRunStatus };

export interface CrmWriterRepository {
  upsertWorkerRunQueued(input: {
    pipelineRunId: string;
    idempotencyKey: string;
  }): Promise<WorkerRunRecord>;
  markWorkerRunCompleted(workerRunId: string): Promise<void>;
  recordInitialStageHistory(leadId: string): Promise<void>;
  createLeadSubmittedNotification(input: {
    leadId: string;
    correlationId: string;
  }): Promise<void>;
  completePipelineRun(pipelineRunId: string): Promise<void>;
}

type LeadSubmittedEventData = {
  id: string;
  pipelineRunId: string;
  correlationId: string;
  leadId: string;
};

export async function writeCrmProjection(
  event: LeadSubmittedEventData,
  repository: CrmWriterRepository,
) {
  const idempotencyKey = `crm-writer:${event.pipelineRunId}`;
  const workerRun = await repository.upsertWorkerRunQueued({
    pipelineRunId: event.pipelineRunId,
    idempotencyKey,
  });

  await repository.recordInitialStageHistory(event.leadId);
  await repository.createLeadSubmittedNotification({
    leadId: event.leadId,
    correlationId: event.correlationId,
  });
  await repository.completePipelineRun(event.pipelineRunId);

  if (workerRun.status !== "completed") {
    await repository.markWorkerRunCompleted(workerRun.id);
  }

  return { workerRunId: workerRun.id, status: "completed" as const };
}

class SupabaseCrmWriterRepository implements CrmWriterRepository {
  private readonly client = createServiceClient();

  async upsertWorkerRunQueued(input: { pipelineRunId: string; idempotencyKey: string }) {
    const { data: inserted, error: insertError } = await this.client
      .from("worker_runs")
      .insert({
        pipeline_run_id: input.pipelineRunId,
        worker_type: "crm_writer",
        worker_version: 1,
        idempotency_key: input.idempotencyKey,
        status: "queued",
        started_at: new Date().toISOString(),
      })
      .select("id, status")
      .single();

    if (!insertError && inserted) return { id: inserted.id, status: inserted.status };

    const { data: existing, error: selectError } = await this.client
      .from("worker_runs")
      .select("id, status")
      .eq("idempotency_key", input.idempotencyKey)
      .single();

    if (selectError || !existing) throw new Error("Failed to record CRM writer start");
    return { id: existing.id, status: existing.status };
  }

  async markWorkerRunCompleted(workerRunId: string) {
    await this.client
      .from("worker_runs")
      .update({ status: "completed", finished_at: new Date().toISOString() })
      .eq("id", workerRunId)
      .neq("status", "completed");
  }

  async recordInitialStageHistory(leadId: string) {
    const { data: lead, error: leadError } = await this.client
      .from("leads")
      .select("company_id")
      .eq("id", leadId)
      .single();
    if (leadError || !lead) throw new Error("Failed to load lead for stage history");

    const { error: insertError } = await this.client.from("lead_stage_history").insert({
      company_id: lead.company_id,
      lead_id: leadId,
      from_stage: null,
      to_stage: "new",
      changed_by: null,
    });
    // 23505 = unique_violation: the initial-stage row already exists.
    if (insertError && insertError.code !== "23505") {
      throw new Error("Failed to record initial lead stage");
    }
  }

  async createLeadSubmittedNotification(input: { leadId: string; correlationId: string }) {
    const { data: lead, error: leadError } = await this.client
      .from("leads")
      .select("company_id, name")
      .eq("id", input.leadId)
      .single();
    if (leadError || !lead) throw new Error("Failed to load lead for notification");

    const { error: insertError } = await this.client.from("notifications").insert({
      company_id: lead.company_id,
      lead_id: input.leadId,
      type: "lead_submitted",
      title: `New lead: ${lead.name}`,
      body: "A new lead was submitted and is ready for review.",
      correlation_id: input.correlationId,
    });
    if (insertError && insertError.code !== "23505") {
      throw new Error("Failed to create lead-submitted notification");
    }
  }

  async completePipelineRun(pipelineRunId: string) {
    await this.client
      .from("pipeline_runs")
      .update({ status: "complete", finished_at: new Date().toISOString() })
      .eq("id", pipelineRunId)
      .neq("status", "complete");
  }
}

export const crmWriter = inngest.createFunction(
  { id: "crm-writer", triggers: { event: leadSubmitted } },
  async ({ event, step }) => {
    const repository = new SupabaseCrmWriterRepository();

    const workerRun = await step.run("record-worker-start", () =>
      repository.upsertWorkerRunQueued({
        pipelineRunId: event.data.pipelineRunId,
        idempotencyKey: `crm-writer:${event.data.pipelineRunId}`,
      }),
    );

    await step.run("record-initial-stage", () =>
      repository.recordInitialStageHistory(event.data.leadId),
    );

    await step.run("create-lead-notification", () =>
      repository.createLeadSubmittedNotification({
        leadId: event.data.leadId,
        correlationId: event.data.correlationId,
      }),
    );

    await step.run("complete-pipeline-run", () =>
      repository.completePipelineRun(event.data.pipelineRunId),
    );

    await step.run("record-worker-completion", async () => {
      if (workerRun.status !== "completed") {
        await repository.markWorkerRunCompleted(workerRun.id);
      }
    });

    await step.run("write-audit-entry", async () => {
      const client = createServiceClient();
      const { data: lead } = await client
        .from("leads")
        .select("company_id")
        .eq("id", event.data.leadId)
        .single();
      if (lead) {
        await writeAuditEntry(
          {
            companyId: lead.company_id,
            action: "crm.lead_submitted_processed",
            entityType: "lead",
            entityId: event.data.leadId,
            correlationId: event.data.correlationId,
          },
          client,
        );
      }
    });

    return { ok: true, eventId: event.data.id };
  },
);
```

- [ ] **Step 5: Register the function on the Inngest route**

Modify `src/app/api/inngest/route.ts`:

```ts
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { publishOutbox } from "@/inngest/functions/publish-outbox";
import { processDiagnosticEvent } from "@/inngest/functions/process-diagnostic-event";
import { crmWriter } from "@/inngest/functions/crm-writer";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [publishOutbox, processDiagnosticEvent, crmWriter],
});
```

- [ ] **Step 6: Run gates**

```bash
npm run test:run -- src/inngest
npm run test:run
npm run lint
npm run typecheck
npm run build
```

- [ ] **Step 7: Verify the full submit-to-complete loop locally**

With `npm run dev`, `npm run db:start`, and `npx inngest-cli@latest dev` running, submit a lead at `/leads/new` and confirm in Supabase Studio:

- one `worker_runs` row with `worker_type = 'crm_writer'` and `status = 'completed'`;
- one `lead_stage_history` row with `from_stage is null` and `to_stage = 'new'`;
- one `notifications` row with `type = 'lead_submitted'`;
- the `pipeline_runs` row is now `status = 'complete'`;
- one `audit_log` row with `action = 'crm.lead_submitted_processed'` sharing the same `correlation_id` as the pipeline run.

Replay the event from the Inngest dev dashboard and confirm none of the above rows duplicate.

- [ ] **Step 8: Commit the CRM Writer**

```bash
git add src/inngest src/app/api/inngest
git commit -m "feat: add CRM Writer for lead-submitted projection"
```

---

### Task 5: Build the App Shell and CRM Dashboard

**Files:**
- Create: `src/app/(app)/layout.tsx`
- Move/Modify: `src/app/page.tsx` → `src/app/(app)/page.tsx`
- Move: `src/app/page.test.tsx` → `src/app/(app)/page.test.tsx`
- Move: `src/app/foundation-diagnostics.tsx` → `src/app/(app)/foundation-diagnostics.tsx`
- Create: `src/modules/dashboard/pipeline-totals.ts`
- Create: `src/modules/dashboard/pipeline-totals.test.ts`

**Interfaces:**
- Consumes: `leadStageSchema`
- Produces: `summarizePipelineTotals(rows)`; authenticated route group `(app)` with shared nav

- [ ] **Step 1: Write a failing test for zero-filled pipeline totals**

Create `src/modules/dashboard/pipeline-totals.test.ts`:

```ts
import { expect, test } from "vitest";
import { summarizePipelineTotals } from "./pipeline-totals";

test("zero-fills every stage and counts leads by stage", () => {
  const totals = summarizePipelineTotals([{ stage: "new" }, { stage: "new" }, { stage: "won" }]);

  expect(totals).toEqual({
    new: 2,
    contacting: 0,
    appointment_set: 0,
    estimating: 0,
    proposal_sent: 0,
    won: 1,
    lost: 0,
    nurture: 0,
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm run test:run -- src/modules/dashboard/pipeline-totals.test.ts
```

Expected: FAIL because `pipeline-totals.ts` does not exist.

- [ ] **Step 3: Implement the pure summarizer**

Create `src/modules/dashboard/pipeline-totals.ts`:

```ts
import { leadStageSchema } from "@/domain/crm";

export type PipelineTotals = Record<(typeof leadStageSchema)["options"][number], number>;

export function summarizePipelineTotals(rows: { stage: string }[]): PipelineTotals {
  const totals = Object.fromEntries(
    leadStageSchema.options.map((stage) => [stage, 0]),
  ) as PipelineTotals;

  for (const row of rows) {
    const stage = leadStageSchema.parse(row.stage);
    totals[stage] += 1;
  }

  return totals;
}
```

- [ ] **Step 4: Introduce the authenticated app-shell layout**

Create `src/app/(app)/layout.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: adminProfile } = await supabase
    .from("admin_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (!adminProfile) redirect("/login");

  return (
    <div>
      <header>
        <nav aria-label="Primary">
          <Link href="/">Dashboard</Link>
          <Link href="/pipeline">Pipeline</Link>
          <Link href="/leads/new">New lead</Link>
          <Link href="/notifications">Notifications</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
```

- [ ] **Step 5: Move the dashboard under the app shell and add CRM widgets**

```bash
git mv src/app/page.tsx "src/app/(app)/page.tsx"
git mv src/app/page.test.tsx "src/app/(app)/page.test.tsx"
git mv src/app/foundation-diagnostics.tsx "src/app/(app)/foundation-diagnostics.tsx"
```

Replace `src/app/(app)/page.tsx` (the auth guard moves to the new layout, so this page only renders CRM content):

```tsx
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { summarizePipelineTotals } from "@/modules/dashboard/pipeline-totals";
import { FoundationDiagnostics } from "./foundation-diagnostics";

const STUCK_THRESHOLD_MINUTES = 15;

export default async function DashboardPage() {
  const supabase = await createServerClient();

  const [{ data: leadRows }, { data: newLeads }, { data: stuckRuns }] = await Promise.all([
    supabase.from("leads").select("stage"),
    supabase
      .from("leads")
      .select("id, name, submitted_address, created_at")
      .eq("stage", "new")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("pipeline_runs")
      .select("id, started_at, status")
      .neq("status", "complete")
      .lt("started_at", new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60_000).toISOString()),
  ]);

  const pipelineTotals = summarizePipelineTotals(leadRows ?? []);

  return (
    <main>
      <p>PIW · New Jersey residential roofing</p>
      <h1>Property Intelligence Worker</h1>
      <p>Foundation online</p>

      <section aria-label="New leads">
        <h2>New leads</h2>
        <ul>
          {(newLeads ?? []).map((lead) => (
            <li key={lead.id}>
              <Link href={`/leads/${lead.id}`}>{lead.name}</Link> — {lead.submitted_address}
            </li>
          ))}
          {(newLeads ?? []).length === 0 ? <li>No new leads</li> : null}
        </ul>
      </section>

      <section aria-label="Pipeline totals">
        <h2>Pipeline totals</h2>
        <dl>
          {Object.entries(pipelineTotals).map(([stage, count]) => (
            <div key={stage}>
              <dt>{stage}</dt>
              <dd>{count}</dd>
            </div>
          ))}
        </dl>
        <Link href="/pipeline">View pipeline board</Link>
      </section>

      <section aria-label="Review queue">
        <h2>Review queue</h2>
        <p>0 items awaiting review</p>
      </section>

      <section aria-label="Stuck enrichments">
        <h2>Stuck enrichments</h2>
        <p>
          {(stuckRuns ?? []).length} pipeline runs stuck for over {STUCK_THRESHOLD_MINUTES} minutes
        </p>
      </section>

      <FoundationDiagnostics />
    </main>
  );
}
```

Update `src/app/(app)/page.test.tsx` to mock the three query chains used above:

```tsx
import { render, screen } from "@testing-library/react";
import { test, expect, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "leads") {
        return {
          select: vi.fn((columns: string) => {
            if (columns === "stage") {
              return Promise.resolve({ data: [{ stage: "new" }, { stage: "won" }] });
            }
            return {
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() =>
                    Promise.resolve({
                      data: [
                        {
                          id: "lead-1",
                          name: "Jordan Rivera",
                          submitted_address: "12 Birch St",
                          created_at: "2026-07-29T00:00:00.000Z",
                        },
                      ],
                    }),
                  ),
                })),
              })),
            };
          }),
        };
      }
      if (table === "pipeline_runs") {
        return {
          select: vi.fn(() => ({
            neq: vi.fn(() => ({
              lt: vi.fn(() => Promise.resolve({ data: [] })),
            })),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  })),
}));

const { default: DashboardPage } = await import("./page");

test("shows new leads, pipeline totals, and a link to the pipeline board", async () => {
  render(await DashboardPage());
  expect(screen.getByRole("heading", { name: "Property Intelligence Worker" })).toBeInTheDocument();
  expect(screen.getByText("Jordan Rivera")).toBeInTheDocument();
  expect(screen.getByText("View pipeline board")).toBeInTheDocument();
  expect(screen.getByText("0 items awaiting review")).toBeInTheDocument();
});
```

- [ ] **Step 6: Run gates**

```bash
npm run test:run
npm run lint
npm run typecheck
npm run build
```

- [ ] **Step 7: Manually verify the dashboard**

With `npm run dev` running, sign in and confirm `/` shows the new-leads list, non-zero pipeline totals after Task 3's manual verification lead, a static `0` review queue, and a link to `/pipeline` (which 404s until Task 6 — expected at this point).

- [ ] **Step 8: Commit the dashboard**

```bash
git add "src/app/(app)" src/modules/dashboard
git commit -m "feat: add CRM dashboard and shared app shell"
```

---

### Task 6: Build the Pipeline Board and Stage Changes

**Files:**
- Modify: `supabase/migrations/<timestamp>_crm.sql`
- Modify: `supabase/tests/crm.test.sql`
- Modify: `src/lib/database.types.ts`
- Create: `src/modules/leads/change-lead-stage.ts`
- Create: `src/modules/leads/change-lead-stage.test.ts`
- Create: `src/app/(app)/pipeline/page.tsx`, `pipeline-board.tsx`, `actions.ts`

**Interfaces:**
- Consumes: `leadStageSchema`, `writeAuditEntry`
- Produces: SQL function `change_lead_stage`; `changeLeadStage(input, deps)`; server action `moveLeadStage(leadId, toStage)`; route `/pipeline`

- [ ] **Step 1: Write a failing pgTAP test for atomic stage changes**

Append to `supabase/tests/crm.test.sql` (before `select * from finish();`), and update `select plan(17);` to `select plan(20);`:

```sql
select is(
  (select from_stage from public.change_lead_stage(
    '00000000-0000-4000-8000-000000000001',
    (select lead_id from public.submit_lead_intake(
      '00000000-0000-4000-8000-000000000001',
      'Casey Nguyen', '555-010-2000', 'casey@example.com',
      '9 Maple Ave, Newark, NJ', null,
      '77777777-7777-4777-8777-777777777777', 1
    )),
    'contacting', null, null
  )),
  'new'::public.lead_stage,
  'change_lead_stage returns the prior stage'
);
select is(
  (select stage from public.leads
   where submitted_address = '9 Maple Ave, Newark, NJ'),
  'contacting',
  'change_lead_stage updates the lead stage'
);
select is(
  (select count(*) from public.lead_stage_history
   where lead_id = (select id from public.leads
                     where submitted_address = '9 Maple Ave, Newark, NJ')
     and from_stage = 'new' and to_stage = 'contacting'),
  1::bigint,
  'change_lead_stage appends stage history'
);
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm run db:reset
npm run db:test
```

Expected: FAIL because `public.change_lead_stage` does not exist.

- [ ] **Step 3: Implement `change_lead_stage`**

Append to `supabase/migrations/<timestamp>_crm.sql`:

```sql
create or replace function public.change_lead_stage(
  p_company_id uuid,
  p_lead_id uuid,
  p_to_stage public.lead_stage,
  p_changed_by uuid,
  p_note text
) returns table (from_stage public.lead_stage)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_from_stage public.lead_stage;
begin
  select stage into v_from_stage
  from public.leads
  where id = p_lead_id and company_id = p_company_id
  for update;

  if not found then
    raise exception 'Lead % not found for company %', p_lead_id, p_company_id;
  end if;

  update public.leads
  set stage = p_to_stage, updated_at = now()
  where id = p_lead_id;

  insert into public.lead_stage_history (
    company_id, lead_id, from_stage, to_stage, changed_by, note
  ) values (
    p_company_id, p_lead_id, v_from_stage, p_to_stage, p_changed_by, p_note
  );

  return query select v_from_stage;
end;
$$;

revoke all on function public.change_lead_stage(uuid, uuid, public.lead_stage, uuid, text)
  from public, anon, authenticated;
grant execute on function public.change_lead_stage(uuid, uuid, public.lead_stage, uuid, text)
  to service_role;
```

- [ ] **Step 4: Reset, run pgTAP, and regenerate types**

```bash
npm run db:reset
npm run db:test
npm run db:types -- --schema public > src/lib/database.types.ts
```

Expected: all 20 assertions pass.

- [ ] **Step 5: Write a failing unit test for the stage-change orchestration core**

Create `src/modules/leads/change-lead-stage.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import { changeLeadStage } from "./change-lead-stage";

test("applies the stage change before writing the audit entry", async () => {
  const applyStageChange = vi.fn().mockResolvedValue({ fromStage: "new" });
  const recordAuditEntry = vi.fn().mockResolvedValue(undefined);

  const result = await changeLeadStage(
    { leadId: "lead-1", toStage: "contacting" },
    { applyStageChange, recordAuditEntry },
  );

  expect(result).toEqual({ fromStage: "new", toStage: "contacting" });
  expect(applyStageChange).toHaveBeenCalledWith({ leadId: "lead-1", toStage: "contacting" });
  expect(recordAuditEntry).toHaveBeenCalledWith({
    leadId: "lead-1",
    fromStage: "new",
    toStage: "contacting",
  });
});
```

- [ ] **Step 6: Run and confirm failure**

```bash
npm run test:run -- src/modules/leads/change-lead-stage.test.ts
```

Expected: FAIL because `change-lead-stage.ts` does not exist.

- [ ] **Step 7: Implement the orchestration core**

Create `src/modules/leads/change-lead-stage.ts`:

```ts
import { leadStageSchema } from "@/domain/crm";

export const leadStages = leadStageSchema.options;
export type LeadStage = (typeof leadStages)[number];

export type ChangeLeadStageDependencies = {
  applyStageChange: (input: {
    leadId: string;
    toStage: LeadStage;
  }) => Promise<{ fromStage: LeadStage }>;
  recordAuditEntry: (input: {
    leadId: string;
    fromStage: LeadStage;
    toStage: LeadStage;
  }) => Promise<void>;
};

export async function changeLeadStage(
  input: { leadId: string; toStage: LeadStage },
  deps: ChangeLeadStageDependencies,
) {
  const { fromStage } = await deps.applyStageChange(input);
  await deps.recordAuditEntry({ leadId: input.leadId, fromStage, toStage: input.toStage });
  return { fromStage, toStage: input.toStage };
}
```

- [ ] **Step 8: Wire the real server action and board UI**

Create `src/app/(app)/pipeline/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAuditEntry } from "@/modules/audit/write-audit-entry";
import { changeLeadStage, type LeadStage } from "@/modules/leads/change-lead-stage";

export async function moveLeadStage(leadId: string, toStage: LeadStage) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: adminProfile } = await supabase
    .from("admin_profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!adminProfile) return;

  const service = createServiceClient();

  await changeLeadStage(
    { leadId, toStage },
    {
      applyStageChange: async ({ leadId: id, toStage: stage }) => {
        const { data, error } = await service.rpc("change_lead_stage", {
          p_company_id: adminProfile.company_id,
          p_lead_id: id,
          p_to_stage: stage,
          p_changed_by: user.id,
          p_note: null,
        });
        if (error || !data?.[0]) throw new Error("Failed to change lead stage");
        return { fromStage: data[0].from_stage };
      },
      recordAuditEntry: async ({ leadId: id, fromStage, toStage: stage }) => {
        await writeAuditEntry(
          {
            companyId: adminProfile.company_id,
            actorId: user.id,
            action: "lead.stage_changed",
            entityType: "lead",
            entityId: id,
            metadata: { fromStage, toStage: stage },
          },
          service,
        );
      },
    },
  );

  revalidatePath("/pipeline");
  revalidatePath("/");
  revalidatePath(`/leads/${leadId}`);
}
```

Create `src/app/(app)/pipeline/pipeline-board.tsx`:

```tsx
import { leadStages, type LeadStage } from "@/modules/leads/change-lead-stage";
import { moveLeadStage } from "./actions";

type BoardLead = { id: string; name: string; submitted_address: string; stage: LeadStage };

export function PipelineBoard({ leads }: { leads: BoardLead[] }) {
  return (
    <div>
      {leadStages.map((stage) => (
        <section key={stage} aria-label={stage}>
          <h2>{stage}</h2>
          <ul>
            {leads
              .filter((lead) => lead.stage === stage)
              .map((lead) => (
                <li key={lead.id}>
                  <a href={`/leads/${lead.id}`}>{lead.name}</a>
                  <p>{lead.submitted_address}</p>
                  <form
                    action={async (formData) => {
                      "use server";
                      await moveLeadStage(lead.id, formData.get("toStage") as LeadStage);
                    }}
                  >
                    <label>
                      Move to
                      <select name="toStage" defaultValue={stage}>
                        {leadStages.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit">Move</button>
                  </form>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

Create `src/app/(app)/pipeline/page.tsx`:

```tsx
import { createServerClient } from "@/lib/supabase/server";
import { PipelineBoard } from "./pipeline-board";

export default async function PipelinePage() {
  const supabase = await createServerClient();
  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, submitted_address, stage")
    .order("created_at", { ascending: false });

  return (
    <main>
      <h1>Pipeline</h1>
      <PipelineBoard leads={leads ?? []} />
    </main>
  );
}
```

- [ ] **Step 9: Run gates**

```bash
npm run test:run
npm run lint
npm run typecheck
npm run build
```

- [ ] **Step 10: Manually verify the pipeline board**

With `npm run dev` running, open `/pipeline`, confirm the lead from Task 3 appears under `new`, move it to `contacting`, and confirm: the card moves columns, `leads.stage` updates, a new `lead_stage_history` row appears with `from_stage = 'new'`, and an `audit_log` row with `action = 'lead.stage_changed'` is written.

- [ ] **Step 11: Commit the pipeline board**

```bash
git add supabase/migrations supabase/tests/crm.test.sql src/lib/database.types.ts src/modules/leads/change-lead-stage.ts src/modules/leads/change-lead-stage.test.ts "src/app/(app)/pipeline"
git commit -m "feat: add pipeline board with auditable stage changes"
```

---

### Task 7: Build the Lead Workspace

**Files:**
- Create: `src/modules/leads/activity-timeline.ts`
- Create: `src/modules/leads/activity-timeline.test.ts`
- Create: `src/app/(app)/leads/[leadId]/page.tsx`
- Modify: `src/app/(app)/leads/new/actions.ts`

**Interfaces:**
- Consumes: `lead_stage_history`, `interactions` rows
- Produces: `buildActivityTimeline(stageHistory, interactions)`; route `/leads/[leadId]`

- [ ] **Step 1: Write a failing test for the merged activity timeline**

Create `src/modules/leads/activity-timeline.test.ts`:

```ts
import { expect, test } from "vitest";
import { buildActivityTimeline } from "./activity-timeline";

test("merges stage history and interactions in descending time order", () => {
  const timeline = buildActivityTimeline(
    [{ changed_at: "2026-07-29T10:00:00.000Z", from_stage: null, to_stage: "new" }],
    [{ occurred_at: "2026-07-29T12:00:00.000Z", type: "call", summary: "Left a voicemail" }],
  );

  expect(timeline).toEqual([
    { kind: "interaction", occurredAt: "2026-07-29T12:00:00.000Z", interactionType: "call", summary: "Left a voicemail" },
    { kind: "stage_change", occurredAt: "2026-07-29T10:00:00.000Z", fromStage: null, toStage: "new" },
  ]);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm run test:run -- src/modules/leads/activity-timeline.test.ts
```

Expected: FAIL because `activity-timeline.ts` does not exist.

- [ ] **Step 3: Implement the pure merge function**

Create `src/modules/leads/activity-timeline.ts`:

```ts
export type ActivityItem =
  | { kind: "stage_change"; occurredAt: string; fromStage: string | null; toStage: string }
  | { kind: "interaction"; occurredAt: string; interactionType: string; summary: string };

export function buildActivityTimeline(
  stageHistory: { changed_at: string; from_stage: string | null; to_stage: string }[],
  interactions: { occurred_at: string; type: string; summary: string }[],
): ActivityItem[] {
  const stageItems: ActivityItem[] = stageHistory.map((row) => ({
    kind: "stage_change",
    occurredAt: row.changed_at,
    fromStage: row.from_stage,
    toStage: row.to_stage,
  }));

  const interactionItems: ActivityItem[] = interactions.map((row) => ({
    kind: "interaction",
    occurredAt: row.occurred_at,
    interactionType: row.type,
    summary: row.summary,
  }));

  return [...stageItems, ...interactionItems].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
}
```

- [ ] **Step 4: Build the workspace page**

Create `src/app/(app)/leads/[leadId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { buildActivityTimeline } from "@/modules/leads/activity-timeline";

export default async function LeadWorkspacePage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  const supabase = await createServerClient();

  const [{ data: lead }, { data: stageHistory }, { data: interactions }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, name, phone, email, submitted_address, notes, stage, property_id, properties(canonical_address, resolution_status)")
      .eq("id", leadId)
      .maybeSingle(),
    supabase
      .from("lead_stage_history")
      .select("changed_at, from_stage, to_stage")
      .eq("lead_id", leadId),
    supabase
      .from("interactions")
      .select("occurred_at, type, summary")
      .eq("lead_id", leadId),
  ]);

  if (!lead) notFound();

  const timeline = buildActivityTimeline(stageHistory ?? [], interactions ?? []);

  return (
    <main>
      <h1>{lead.name}</h1>
      <section aria-label="Contact details">
        <p>{lead.phone}</p>
        <p>{lead.email}</p>
        <p>Stage: {lead.stage}</p>
      </section>

      <section aria-label="Property">
        <h2>Property</h2>
        <p>{lead.properties?.canonical_address ?? lead.submitted_address}</p>
        <p>Resolution: {lead.properties?.resolution_status}</p>
      </section>

      {lead.notes ? (
        <section aria-label="Notes">
          <h2>Notes</h2>
          <p>{lead.notes}</p>
        </section>
      ) : null}

      <section aria-label="Activity">
        <h2>Activity</h2>
        <ul>
          {timeline.map((item, index) => (
            <li key={index}>
              {item.kind === "stage_change"
                ? `${item.fromStage ?? "—"} → ${item.toStage}`
                : `${item.interactionType}: ${item.summary}`}{" "}
              ({item.occurredAt})
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

(Tasks 8 and 9 add a `<TaskList>` and `<InteractionList>` to this page.)

- [ ] **Step 5: Point lead intake at the new workspace**

Modify `src/app/(app)/leads/new/actions.ts`, changing the final line from:

```ts
redirect(`/?submitted=${result.leadId}`);
```

to:

```ts
redirect(`/leads/${result.leadId}`);
```

- [ ] **Step 6: Run gates**

```bash
npm run test:run
npm run lint
npm run typecheck
npm run build
```

- [ ] **Step 7: Manually verify the workspace**

Submit a new lead and confirm the redirect lands on `/leads/[leadId]` showing contact details, the property shell (submitted address, `resolution_status: unresolved`), and one activity entry (`— → new`) once the CRM Writer has processed the event.

- [ ] **Step 8: Commit the lead workspace**

```bash
git add src/modules/leads/activity-timeline.ts src/modules/leads/activity-timeline.test.ts "src/app/(app)/leads/[leadId]" "src/app/(app)/leads/new/actions.ts"
git commit -m "feat: add lead workspace with merged activity timeline"
```

---

### Task 8: Implement Lead Tasks

**Files:**
- Create: `src/modules/tasks/schema.ts`
- Create: `src/modules/tasks/schema.test.ts`
- Create: `src/modules/tasks/due-status.ts`
- Create: `src/modules/tasks/due-status.test.ts`
- Create: `src/app/(app)/leads/[leadId]/task-actions.ts`
- Create: `src/app/(app)/leads/[leadId]/task-list.tsx`
- Modify: `src/app/(app)/leads/[leadId]/page.tsx`

**Interfaces:**
- Consumes: `taskStatusSchema`
- Produces: `taskInputSchema`, `dueStatus(task, now)`, server actions `createTask`, `completeTask`

- [ ] **Step 1: Write failing tests for input validation and due-status logic**

Create `src/modules/tasks/schema.test.ts`:

```ts
import { expect, test } from "vitest";
import { taskInputSchema } from "./schema";

test("requires a nonempty title", () => {
  expect(() => taskInputSchema.parse({ title: "" })).toThrow();
  expect(taskInputSchema.parse({ title: "Call homeowner" })).toEqual({
    title: "Call homeowner",
    description: undefined,
    dueAt: undefined,
    assignedTo: undefined,
  });
});
```

Create `src/modules/tasks/due-status.test.ts`:

```ts
import { expect, test } from "vitest";
import { dueStatus } from "./due-status";

const now = new Date("2026-07-29T12:00:00.000Z");

test("an open task past its due date is overdue", () => {
  expect(dueStatus({ dueAt: "2026-07-28T12:00:00.000Z", status: "open" }, now)).toBe("overdue");
});

test("an open task before its due date is upcoming", () => {
  expect(dueStatus({ dueAt: "2026-07-30T12:00:00.000Z", status: "open" }, now)).toBe("upcoming");
});

test("a completed task has no due status", () => {
  expect(dueStatus({ dueAt: "2026-07-28T12:00:00.000Z", status: "complete" }, now)).toBe("none");
});

test("a task without a due date has no due status", () => {
  expect(dueStatus({ dueAt: null, status: "open" }, now)).toBe("none");
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm run test:run -- src/modules/tasks
```

Expected: FAIL because `schema.ts` and `due-status.ts` do not exist.

- [ ] **Step 3: Implement the schema and due-status logic**

Create `src/modules/tasks/schema.ts`:

```ts
import { z } from "zod";
import { uuidSchema } from "@/domain/ids";

export const taskInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  // Plain string, not z.iso.datetime(): an HTML <input type="datetime-local">
  // value has no timezone offset and would fail a strict ISO check.
  dueAt: z.string().min(1).optional(),
  assignedTo: uuidSchema.optional(),
});

export type TaskInput = z.infer<typeof taskInputSchema>;
```

Create `src/modules/tasks/due-status.ts`:

```ts
export type TaskDueStatus = "none" | "upcoming" | "overdue";

export function dueStatus(
  task: { dueAt: string | null; status: "open" | "complete" | "cancelled" },
  now: Date,
): TaskDueStatus {
  if (task.status !== "open" || !task.dueAt) return "none";
  return new Date(task.dueAt).getTime() < now.getTime() ? "overdue" : "upcoming";
}
```

- [ ] **Step 4: Wire the task actions and list UI**

Create `src/app/(app)/leads/[leadId]/task-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { taskInputSchema } from "@/modules/tasks/schema";

export async function createTask(leadId: string, formData: FormData) {
  const input = taskInputSchema.parse(Object.fromEntries(formData));
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: adminProfile } = await supabase
    .from("admin_profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!adminProfile) return;

  await supabase.from("tasks").insert({
    company_id: adminProfile.company_id,
    lead_id: leadId,
    title: input.title,
    description: input.description,
    due_at: input.dueAt,
    assigned_to: input.assignedTo ?? user.id,
    created_by: user.id,
  });

  revalidatePath(`/leads/${leadId}`);
}

export async function completeTask(leadId: string, taskId: string) {
  const supabase = await createServerClient();
  await supabase
    .from("tasks")
    .update({ status: "complete", completed_at: new Date().toISOString() })
    .eq("id", taskId);

  revalidatePath(`/leads/${leadId}`);
}
```

Create `src/app/(app)/leads/[leadId]/task-list.tsx`:

```tsx
import { dueStatus } from "@/modules/tasks/due-status";
import { createTask, completeTask } from "./task-actions";

type Task = {
  id: string;
  title: string;
  due_at: string | null;
  status: "open" | "complete" | "cancelled";
};

export function TaskList({ leadId, tasks }: { leadId: string; tasks: Task[] }) {
  const now = new Date();

  return (
    <section aria-label="Tasks">
      <h2>Tasks</h2>
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            {task.title} — {task.status} ({dueStatus({ dueAt: task.due_at, status: task.status }, now)})
            {task.status === "open" ? (
              <form
                action={async () => {
                  "use server";
                  await completeTask(leadId, task.id);
                }}
              >
                <button type="submit">Mark complete</button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      <form
        action={async (formData) => {
          "use server";
          await createTask(leadId, formData);
        }}
      >
        <label>
          New task
          <input name="title" required />
        </label>
        <label>
          Due
          <input name="dueAt" type="datetime-local" />
        </label>
        <button type="submit">Add task</button>
      </form>
    </section>
  );
}
```

Modify `src/app/(app)/leads/[leadId]/page.tsx`: add a `tasks` query (`supabase.from("tasks").select("id, title, due_at, status").eq("lead_id", leadId).order("created_at")`) to the `Promise.all`, and render `<TaskList leadId={leadId} tasks={tasks ?? []} />` inside `<main>`.

- [ ] **Step 5: Run gates**

```bash
npm run test:run
npm run lint
npm run typecheck
npm run build
```

- [ ] **Step 6: Manually verify tasks**

On a lead workspace, add a task with a due date, confirm it appears as `upcoming` or `overdue`, mark it complete, and confirm the row updates and the "Mark complete" button disappears.

- [ ] **Step 7: Commit tasks**

```bash
git add src/modules/tasks "src/app/(app)/leads/[leadId]"
git commit -m "feat: add lead tasks with due-status tracking"
```

---

### Task 9: Implement Lead Interactions

**Files:**
- Create: `src/modules/interactions/schema.ts`
- Create: `src/modules/interactions/schema.test.ts`
- Create: `src/app/(app)/leads/[leadId]/interaction-actions.ts`
- Create: `src/app/(app)/leads/[leadId]/interaction-list.tsx`
- Modify: `src/app/(app)/leads/[leadId]/page.tsx`

**Interfaces:**
- Consumes: `interactionTypeSchema`
- Produces: `interactionInputSchema`, server action `logInteraction`

- [ ] **Step 1: Write a failing test for interaction input validation**

Create `src/modules/interactions/schema.test.ts`:

```ts
import { expect, test } from "vitest";
import { interactionInputSchema } from "./schema";

test("requires a known type and a nonempty summary", () => {
  expect(() => interactionInputSchema.parse({ type: "carrier_pigeon", summary: "x" })).toThrow();
  expect(() => interactionInputSchema.parse({ type: "call", summary: "" })).toThrow();
  expect(interactionInputSchema.parse({ type: "call", summary: "Left a voicemail" })).toEqual({
    type: "call",
    summary: "Left a voicemail",
    occurredAt: undefined,
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm run test:run -- src/modules/interactions/schema.test.ts
```

Expected: FAIL because `schema.ts` does not exist.

- [ ] **Step 3: Implement the schema**

Create `src/modules/interactions/schema.ts`:

```ts
import { z } from "zod";
import { interactionTypeSchema } from "@/domain/crm";

export const interactionInputSchema = z.object({
  type: interactionTypeSchema,
  summary: z.string().min(1),
  occurredAt: z.string().min(1).optional(),
});

export type InteractionInput = z.infer<typeof interactionInputSchema>;
```

- [ ] **Step 4: Wire the action and list UI**

Create `src/app/(app)/leads/[leadId]/interaction-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { interactionInputSchema } from "@/modules/interactions/schema";

export async function logInteraction(leadId: string, formData: FormData) {
  const input = interactionInputSchema.parse(Object.fromEntries(formData));
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: adminProfile } = await supabase
    .from("admin_profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!adminProfile) return;

  await supabase.from("interactions").insert({
    company_id: adminProfile.company_id,
    lead_id: leadId,
    type: input.type,
    summary: input.summary,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    created_by: user.id,
  });

  revalidatePath(`/leads/${leadId}`);
}
```

Create `src/app/(app)/leads/[leadId]/interaction-list.tsx`:

```tsx
import { logInteraction } from "./interaction-actions";

const INTERACTION_TYPES = ["call", "email", "text", "site_visit", "note"] as const;

type Interaction = { id: string; type: string; summary: string; occurred_at: string };

export function InteractionList({ leadId, interactions }: { leadId: string; interactions: Interaction[] }) {
  return (
    <section aria-label="Interactions">
      <h2>Interactions</h2>
      <ul>
        {interactions.map((interaction) => (
          <li key={interaction.id}>
            {interaction.type}: {interaction.summary} ({interaction.occurred_at})
          </li>
        ))}
      </ul>
      <form
        action={async (formData) => {
          "use server";
          await logInteraction(leadId, formData);
        }}
      >
        <label>
          Type
          <select name="type" defaultValue="call">
            {INTERACTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          Summary
          <input name="summary" required />
        </label>
        <button type="submit">Log interaction</button>
      </form>
    </section>
  );
}
```

Modify `src/app/(app)/leads/[leadId]/page.tsx`: add `id` to the existing `interactions` select and render `<InteractionList leadId={leadId} interactions={interactions ?? []} />` alongside `<TaskList>`.

- [ ] **Step 5: Run gates**

```bash
npm run test:run
npm run lint
npm run typecheck
npm run build
```

- [ ] **Step 6: Manually verify interactions**

On a lead workspace, log a `call` interaction, confirm it appears in the interaction list and in the merged activity timeline built in Task 7.

- [ ] **Step 7: Commit interactions**

```bash
git add src/modules/interactions "src/app/(app)/leads/[leadId]"
git commit -m "feat: add lead interaction logging"
```

---

### Task 10: Implement In-App Notifications

**Files:**
- Create: `src/modules/notifications/badge.ts`
- Create: `src/modules/notifications/badge.test.ts`
- Create: `src/app/(app)/notifications/page.tsx`, `actions.ts`
- Create: `src/app/(app)/notifications-bell.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `notifications` table from Task 2/4
- Produces: `formatNotificationBadge(count)`, server action `markNotificationRead`, `/notifications`, `<NotificationsBell />`

- [ ] **Step 1: Write a failing test for the badge label**

Create `src/modules/notifications/badge.test.ts`:

```ts
import { expect, test } from "vitest";
import { formatNotificationBadge } from "./badge";

test("shows a plain label with zero unread notifications", () => {
  expect(formatNotificationBadge(0)).toBe("Notifications");
});

test("shows the unread count", () => {
  expect(formatNotificationBadge(3)).toBe("Notifications (3)");
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm run test:run -- src/modules/notifications/badge.test.ts
```

Expected: FAIL because `badge.ts` does not exist.

- [ ] **Step 3: Implement the badge formatter**

Create `src/modules/notifications/badge.ts`:

```ts
export function formatNotificationBadge(unreadCount: number): string {
  return unreadCount > 0 ? `Notifications (${unreadCount})` : "Notifications";
}
```

- [ ] **Step 4: Build the bell, the list page, and the mark-read action**

Create `src/app/(app)/notifications-bell.tsx`:

```tsx
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { formatNotificationBadge } from "@/modules/notifications/badge";

export async function NotificationsBell() {
  const supabase = await createServerClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  return <Link href="/notifications">{formatNotificationBadge(count ?? 0)}</Link>;
}
```

Create `src/app/(app)/notifications/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";

export async function markNotificationRead(notificationId: string) {
  const supabase = await createServerClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId);

  revalidatePath("/notifications");
}
```

Create `src/app/(app)/notifications/page.tsx`:

```tsx
import { createServerClient } from "@/lib/supabase/server";
import { markNotificationRead } from "./actions";

export default async function NotificationsPage() {
  const supabase = await createServerClient();
  const { data: notifications } = await supabase
    .from("notifications")
    .select("id, title, body, lead_id, read_at, created_at")
    .order("created_at", { ascending: false });

  return (
    <main>
      <h1>Notifications</h1>
      <ul>
        {(notifications ?? []).map((notification) => (
          <li key={notification.id}>
            <strong>{notification.title}</strong>
            <p>{notification.body}</p>
            {notification.lead_id ? <a href={`/leads/${notification.lead_id}`}>View lead</a> : null}
            {notification.read_at ? (
              <span>Read</span>
            ) : (
              <form
                action={async () => {
                  "use server";
                  await markNotificationRead(notification.id);
                }}
              >
                <button type="submit">Mark read</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

Modify `src/app/(app)/layout.tsx`: replace the static `<Link href="/notifications">Notifications</Link>` nav item with `<NotificationsBell />` (import from `./notifications-bell`).

- [ ] **Step 5: Run gates**

```bash
npm run test:run
npm run lint
npm run typecheck
npm run build
```

- [ ] **Step 6: Manually verify notifications**

Submit a lead so the CRM Writer creates a `lead_submitted` notification. Confirm the nav bell shows `Notifications (1)`, `/notifications` lists it with a link to the lead, and clicking "Mark read" sets `read_at` and drops the bell count to `Notifications`.

- [ ] **Step 7: Commit notifications**

```bash
git add src/modules/notifications "src/app/(app)/notifications" "src/app/(app)/notifications-bell.tsx" "src/app/(app)/layout.tsx"
git commit -m "feat: add in-app notifications"
```

---

### Task 11: Phase 2 Vertical-Slice Verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: every module built in Tasks 1–10
- Produces: a verified, deployable CRM vertical slice

- [ ] **Step 1: Run every automated gate from a clean state**

```bash
npm ci
npm run db:start
npm run db:reset
npm run verify
git diff --check
git status --short
```

Expected: dependency installation is reproducible; migrations (foundation + CRM) replay from zero; all 20 pgTAP assertions pass; lint, types, unit tests, and the production build pass; no stray whitespace or unintended files.

- [ ] **Step 2: Walk the full vertical slice manually**

With `npm run dev`, `npm run db:start`, and `npx inngest-cli@latest dev` running:

1. Submit a lead at `/leads/new`; confirm redirect to `/leads/[leadId]`.
2. Confirm the CRM Writer completes: `worker_runs` shows `crm_writer` completed, `pipeline_runs.status = 'complete'`, one `lead_stage_history` row (`— → new`), one `notifications` row, one `audit_log` row sharing the pipeline's `correlation_id`.
3. Visit `/` and confirm the lead appears under "New leads" and the pipeline totals include it under `new`.
4. Visit `/pipeline`, move the lead to `contacting`; confirm the board updates, a second `lead_stage_history` row appears, and a `lead.stage_changed` audit entry is written.
5. On the lead workspace, add a task with a due date, mark it complete; log an interaction; confirm both appear in the merged activity timeline in the correct order.
6. Confirm the notifications bell shows the unread count; open `/notifications`, follow the link back to the lead, and mark it read; confirm the bell count drops.
7. In the Inngest dev dashboard, replay the `crm/lead.submitted` event and confirm no worker run, stage-history row, notification, or audit entry duplicates.
8. Sign out and confirm every route under `(app)` redirects to `/login`; confirm anonymous Supabase REST calls against `tasks`, `interactions`, `notifications`, and `lead_stage_history` are rejected (matching the pgTAP assertions from Task 2).

- [ ] **Step 3: Update the README**

Add a short "Phase 2: CRM" note to `README.md` alongside the existing Phase 1 links, stating: "Phase 2 adds lead intake, the pipeline board, the lead workspace, tasks, interactions, and in-app notifications. No enrichment pipeline runs yet — the CRM Writer completes each pipeline run immediately."

- [ ] **Step 4: Commit the verification**

```bash
git add README.md
git commit -m "docs: verify PIW CRM vertical slice"
```

## Phase 2 Completion Gate

Do not begin the Property Identity plan until all of the following are true:

- [ ] A clean checkout reaches a working local environment using the existing runbook, now including the CRM migration.
- [ ] Submitting a lead atomically creates a `leads` row, an `unresolved` `properties` row, and a `pipeline_runs` row, and publishes `crm/lead.submitted` through the existing outbox.
- [ ] The CRM Writer processes `crm/lead.submitted` exactly once under duplicate delivery: one initial `lead_stage_history` row, one `notifications` row, one `pipeline_runs` completion, one audit entry.
- [ ] The dashboard shows real new-lead and pipeline-total data, a static zero-state review queue, and a real (if typically empty) stuck-enrichment query.
- [ ] The pipeline board renders all eight commercial stages and stage changes are atomic, audited, and reflected in `lead_stage_history`.
- [ ] The lead workspace shows contact details, the property shell, tasks, interactions, and a correctly time-ordered merged activity history.
- [ ] Tasks can be created and completed, and interactions can be logged, scoped to a single lead, with RLS preventing cross-company access.
- [ ] In-app notifications are created by the CRM Writer, visible via the bell and the notifications list, and can be marked read.
- [ ] `review_tasks` was not created; Phase 3 owns it.
- [ ] Unit, pgTAP, lint, type, and production-build gates pass locally and in GitHub Actions without modification to `.github/workflows/ci.yml` (Phase 1's CI already covers `db:reset`, `db:test`, and the type-diff check for any new migration).
- [ ] The implementation is reviewed against architecture spec §10.1–10.4, §5.8–5.9, and §6.1.

---

### Critical Files for Implementation

- `supabase/migrations/<timestamp>_crm.sql` — the CRM schema, `lead_stage` enum conversion, RLS policies, `submit_lead_intake`, and `change_lead_stage`; everything else depends on this landing correctly.
- `src/domain/events.ts` — extending the discriminated event union is the contract every downstream module (intake, CRM Writer, tests) is built against.
- `src/modules/leads/submit-lead-intake.ts` and `src/app/(app)/leads/new/actions.ts` — the property-first intake vertical slice that produces the first CRM event.
- `src/inngest/functions/crm-writer.ts` — the only Phase 2 worker; its idempotency pattern is the template for every future worker (address validation, GIS, roof analysis, scoring) in Phases 3–5.
- `src/app/(app)/layout.tsx` — the shared authenticated shell every subsequent page (dashboard, pipeline, workspace, notifications) is nested under.
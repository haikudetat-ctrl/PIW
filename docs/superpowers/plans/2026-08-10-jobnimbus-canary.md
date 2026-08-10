# JobNimbus Authenticated Canary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated, tenant-bound JobNimbus connection probe and one-time capped staging import without enabling scheduled JobNimbus ingestion.

**Architecture:** Extend the existing read client with explicit pagination limits and a sanitized one-record probe. Put the manual canary orchestration in a focused domain module, expose it through authenticated server actions on the JobNimbus drill-down, and reuse the existing normalizers and Supabase repository for idempotent persistence.

**Tech Stack:** Next.js 16 App Router and server actions, React 19 `useActionState`, TypeScript, Vitest, Supabase/Postgres, Vercel environment variables, JobNimbus Bearer-authenticated HTTP API.

## Global Constraints

- JobNimbus requests are HTTP `GET` only.
- `JOBNIMBUS_API_KEY` remains server-only and is never returned, rendered, or logged.
- Probe results include only status, record count, sorted field names, and sanitized error category.
- Company scope comes exclusively from the authenticated user's `admin_profiles.company_id`.
- `JOBNIMBUS_PAGE_LIMIT` defaults to 50 and is capped at 500.
- `JOBNIMBUS_MAX_PAGES` defaults to 1 and is capped at 25.
- `INTEGRATIONS_JOBNIMBUS_ENABLED=false` throughout deployment and acceptance.
- `JOBNIMBUS_INCLUDE_SOLD_VALUE=false` throughout deployment and acceptance.
- No database migration is required; existing JobNimbus tables and `integration_sync_runs` are reused.
- Preserve unrelated local worktree changes.

---

### Task 1: Validated JobNimbus import limits

**Files:**
- Modify: `src/lib/env/server.ts`
- Modify: `src/lib/env/shared.test.ts`
- Modify: `src/modules/access-route/vendors.ts`
- Test: `src/modules/access-route/vendors.test.ts`

**Interfaces:**
- Consumes: existing `JobNimbusReadClient` configuration.
- Produces: `pageLimit: number` and `maxPages: number` client options; parsed `JOBNIMBUS_PAGE_LIMIT` and `JOBNIMBUS_MAX_PAGES` server environment values.

- [ ] **Step 1: Write failing environment and pagination tests**

Add assertions that server parsing defaults to 50/1, rejects values above 500/25, and that a client configured with `{ pageLimit: 2, maxPages: 1 }` sends `limit=2`, `offset=0`, and stops after one page.

```ts
it("caps a JobNimbus read to the configured page size and page count", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([
    { id: "1" }, { id: "2" },
  ]));
  const client = new JobNimbusReadClient({
    apiKey: "key",
    pageLimit: 2,
    maxPages: 1,
    fetcher,
  });

  expect(await client.contacts()).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const url = new URL(String(fetcher.mock.calls[0][0]));
  expect(url.searchParams.get("limit")).toBe("2");
  expect(url.searchParams.get("offset")).toBe("0");
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm run test:run -- src/lib/env/shared.test.ts src/modules/access-route/vendors.test.ts`

Expected: FAIL because the two environment values and client options do not exist.

- [ ] **Step 3: Implement minimal validated limits**

Add bounded integer fields:

```ts
JOBNIMBUS_PAGE_LIMIT: z.coerce.number().int().positive().max(500).default(50),
JOBNIMBUS_MAX_PAGES: z.coerce.number().int().positive().max(25).default(1),
```

Replace module constants in `offsetPages` with explicit input values, and pass the configured values from `JobNimbusReadClient`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm run test:run -- src/lib/env/shared.test.ts src/modules/access-route/vendors.test.ts`

Expected: PASS with no warnings.

- [ ] **Step 5: Commit the bounded reader**

```bash
git add src/lib/env/server.ts src/lib/env/shared.test.ts src/modules/access-route/vendors.ts src/modules/access-route/vendors.test.ts
git commit -m "feat: cap JobNimbus read pagination"
```

### Task 2: Sanitized one-record connection probe

**Files:**
- Modify: `src/modules/access-route/vendors.ts`
- Test: `src/modules/access-route/vendors.test.ts`
- Modify: `src/modules/access-route/http.ts`

**Interfaces:**
- Consumes: JobNimbus base URL, paths, API key, and optional fetch dependency.
- Produces:

```ts
export type JobNimbusProbeResult = {
  resource: "contacts" | "jobs";
  ok: boolean;
  status: number;
  recordCount: number;
  fieldNames: string[];
  errorCategory?: "authentication" | "authorization" | "rate_limit" | "upstream" | "invalid_response";
};

JobNimbusReadClient.probe(): Promise<{
  contacts: JobNimbusProbeResult;
  jobs: JobNimbusProbeResult;
}>;
```

- [ ] **Step 1: Write failing probe sanitization tests**

Cover successful contacts/jobs, `401`, `403`, `429`, invalid JSON, and assert that serialized results do not contain any fixture values.

```ts
it("reports only status, count, and field names", async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse([{ id: "contact-secret", email: "person@example.com" }]))
    .mockResolvedValueOnce(jsonResponse([{ id: "job-secret", status: "Won" }]));
  const result = await new JobNimbusReadClient({ apiKey: "key", fetcher }).probe();

  expect(result.contacts).toEqual({
    resource: "contacts",
    ok: true,
    status: 200,
    recordCount: 1,
    fieldNames: ["email", "id"],
  });
  expect(JSON.stringify(result)).not.toContain("contact-secret");
  expect(JSON.stringify(result)).not.toContain("person@example.com");
});
```

- [ ] **Step 2: Run probe tests and verify RED**

Run: `npm run test:run -- src/modules/access-route/vendors.test.ts`

Expected: FAIL because `probe()` and `JobNimbusProbeResult` do not exist.

- [ ] **Step 3: Implement the minimal probe**

Add a single-request helper that always sets `limit=1` and `offset=0`, captures the HTTP status, parses JSON, passes the body through `asArray`, and returns only `Object.keys(rows[0] ?? {}).sort()`.

The helper must use the existing status-category mapping exported from `http.ts` and must not call the paginated import path.

- [ ] **Step 4: Run probe tests and verify GREEN**

Run: `npm run test:run -- src/modules/access-route/vendors.test.ts`

Expected: PASS, including assertions that every request method is `GET` and no fixture values occur in returned metadata.

- [ ] **Step 5: Commit the probe**

```bash
git add src/modules/access-route/http.ts src/modules/access-route/vendors.ts src/modules/access-route/vendors.test.ts
git commit -m "feat: add sanitized JobNimbus connection probe"
```

### Task 3: Tenant-bound manual canary service

**Files:**
- Create: `src/modules/access-route/jobnimbus-canary.ts`
- Create: `src/modules/access-route/jobnimbus-canary.test.ts`
- Modify: `src/modules/access-route/run.ts`

**Interfaces:**
- Consumes: `JobNimbusReadClient`, normalizers, `AccessRouteRepository`, authenticated `companyId`, and parsed JobNimbus environment.
- Produces:

```ts
export type JobNimbusCanaryResult = {
  outcome: "succeeded" | "failed";
  contactsSeen: number;
  contactsWritten: number;
  jobsSeen: number;
  jobsWritten: number;
  errorCategory?: string;
};

export async function importJobNimbusCanary(input: {
  companyId: string;
  environment: JobNimbusEnvironment;
  repository: AccessRouteRepository;
  fetcher?: typeof fetch;
  now?: Date;
}): Promise<JobNimbusCanaryResult>;
```

- [ ] **Step 1: Write failing canary tests**

Test that both probes run first, a failed probe prevents persistence, a successful import writes no more than configured limits, the explicit company ID is applied to every normalized row, sold value remains null, a sync run receives `mode: "canary"`, and repeated imports use repository upserts.

```ts
it("does not persist when either JobNimbus resource probe fails", async () => {
  const result = await importJobNimbusCanary({
    companyId: "company-a",
    environment,
    repository,
    fetcher: probeFailureFetcher,
  });

  expect(result.outcome).toBe("failed");
  expect(repository.upsertJobNimbusContacts).not.toHaveBeenCalled();
  expect(repository.upsertJobNimbusJobs).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run canary tests and verify RED**

Run: `npm run test:run -- src/modules/access-route/jobnimbus-canary.test.ts`

Expected: FAIL because the canary module does not exist.

- [ ] **Step 3: Implement minimal canary orchestration**

Use a unique sync key such as `jobnimbus:canary:<ISO timestamp>`. Begin a run, probe both resources, stop and finish failed when either probe is unsuccessful, otherwise fetch with the configured 50/1 caps, normalize, upsert, and finish the run with counts and `{ mode: "canary", read_only: true }` metadata.

Extract only the shared JobNimbus environment type from `run.ts`; do not route the manual canary through `runAccessRouteSync`, because the scheduled enable flag must remain false.

- [ ] **Step 4: Run canary tests and verify GREEN**

Run: `npm run test:run -- src/modules/access-route/jobnimbus-canary.test.ts src/modules/access-route/vendors.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the canary service**

```bash
git add src/modules/access-route/jobnimbus-canary.ts src/modules/access-route/jobnimbus-canary.test.ts src/modules/access-route/run.ts
git commit -m "feat: add tenant-bound JobNimbus canary import"
```

### Task 4: Authenticated server actions

**Files:**
- Create: `src/app/(app)/access-route/[system]/actions.ts`
- Create: `src/app/(app)/access-route/[system]/actions.test.ts`

**Interfaces:**
- Consumes: Supabase session client, `admin_profiles`, server environment, `JobNimbusReadClient.probe()`, `importJobNimbusCanary()`, service-role repository.
- Produces:

```ts
export type JobNimbusActionState = {
  status: "idle" | "succeeded" | "failed";
  probe?: { contacts: JobNimbusProbeResult; jobs: JobNimbusProbeResult };
  importResult?: JobNimbusCanaryResult;
  message?: string;
};

export async function testJobNimbusConnection(
  previous: JobNimbusActionState,
  formData: FormData,
): Promise<JobNimbusActionState>;

export async function importJobNimbusSample(
  previous: JobNimbusActionState,
  formData: FormData,
): Promise<JobNimbusActionState>;
```

- [ ] **Step 1: Write failing authentication and tenant tests**

Mock only the Supabase and vendor boundaries. Assert that missing user and missing profile return `failed` before any JobNimbus call, and that the import passes the profile's company ID rather than form data.

```ts
it("binds the import to the authenticated admin profile", async () => {
  mockUser("user-a");
  mockAdminProfile({ company_id: "company-a" });
  const formData = new FormData();
  formData.set("companyId", "company-b");

  await importJobNimbusSample(idleState, formData);

  expect(importJobNimbusCanary).toHaveBeenCalledWith(
    expect.objectContaining({ companyId: "company-a" }),
  );
});
```

- [ ] **Step 2: Run action tests and verify RED**

Run: `npm run test:run -- 'src/app/(app)/access-route/[system]/actions.test.ts'`

Expected: FAIL because the actions do not exist.

- [ ] **Step 3: Implement minimal authenticated actions**

Create a private `requireAdminCompany()` helper that calls `supabase.auth.getUser()`, selects `admin_profiles.company_id` by user ID, and returns a generic unauthorized state on failure. Parse environment variables only after authorization succeeds.

The test action creates the client and returns sanitized probe metadata. The import action calls `importJobNimbusCanary`, revalidates `/access-route` and `/access-route/jobnimbus` on success, and returns counts only.

- [ ] **Step 4: Run action tests and verify GREEN**

Run: `npm run test:run -- 'src/app/(app)/access-route/[system]/actions.test.ts'`

Expected: PASS.

- [ ] **Step 5: Commit authenticated actions**

```bash
git add 'src/app/(app)/access-route/[system]/actions.ts' 'src/app/(app)/access-route/[system]/actions.test.ts'
git commit -m "feat: protect JobNimbus canary actions"
```

### Task 5: JobNimbus connection panel

**Files:**
- Create: `src/app/(app)/access-route/[system]/jobnimbus-connection-panel.tsx`
- Create: `src/app/(app)/access-route/[system]/jobnimbus-connection-panel.test.tsx`
- Modify: `src/app/(app)/access-route/[system]/page.tsx`

**Interfaces:**
- Consumes: `testJobNimbusConnection`, `importJobNimbusSample`, and `JobNimbusActionState`.
- Produces: client component rendered only when `system === "jobnimbus"`.

- [ ] **Step 1: Write failing UI tests**

Assert that the panel renders the test button, displays only status/count/field names, hides the import button until both probe results succeed, and displays capped import counts without record values.

```tsx
it("reveals sample import only after both probes pass", async () => {
  render(<JobNimbusConnectionPanel />);
  expect(screen.queryByRole("button", { name: "Import limited sample" })).not.toBeInTheDocument();
  await runSuccessfulProbe();
  expect(screen.getByRole("button", { name: "Import limited sample" })).toBeEnabled();
});
```

- [ ] **Step 2: Run component tests and verify RED**

Run: `npm run test:run -- 'src/app/(app)/access-route/[system]/jobnimbus-connection-panel.test.tsx'`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the minimal panel**

Use `useActionState` independently for probe and import. Render resource results as definition lists. Join field names as labels only. Do not serialize or place raw records in component props. Render the panel before the existing JobNimbus records card.

- [ ] **Step 4: Run component and page tests and verify GREEN**

Run: `npm run test:run -- 'src/app/(app)/access-route/[system]/jobnimbus-connection-panel.test.tsx'`

Expected: PASS.

- [ ] **Step 5: Commit the UI**

```bash
git add 'src/app/(app)/access-route/[system]/jobnimbus-connection-panel.tsx' 'src/app/(app)/access-route/[system]/jobnimbus-connection-panel.test.tsx' 'src/app/(app)/access-route/[system]/page.tsx'
git commit -m "feat: add JobNimbus connection canary UI"
```

### Task 6: Runbook and configuration contract

**Files:**
- Modify: `docs/runbooks/access-route-read-integration.md`
- Modify: `.env.example` if present; otherwise document Vercel-only values in the runbook.

**Interfaces:**
- Consumes: completed action names and environment schema.
- Produces: operator instructions for probe, capped import, evidence review, and the continued disabled schedule.

- [ ] **Step 1: Update the runbook**

Document `JOBNIMBUS_PAGE_LIMIT=50`, `JOBNIMBUS_MAX_PAGES=1`, the two buttons, successful probe criteria, the maximum 50+50 write bound, and that enabling the schedule remains a separate decision.

- [ ] **Step 2: Verify documentation and configuration references**

Run: `rg -n "JOBNIMBUS_(PAGE_LIMIT|MAX_PAGES)|Test JobNimbus connection|Import limited sample" docs .env.example src`

Expected: schema, UI, tests, and runbook references agree on names and values.

- [ ] **Step 3: Commit documentation**

```bash
git add docs/runbooks/access-route-read-integration.md .env.example
git commit -m "docs: document JobNimbus canary workflow"
```

### Task 7: Full local verification and review

**Files:**
- Review all files changed by Tasks 1-6.

**Interfaces:**
- Consumes: complete feature branch.
- Produces: verified commit suitable for deployment.

- [ ] **Step 1: Run focused security checks**

Run:

```bash
rg -n "JOBNIMBUS_API_KEY" src
rg -n "method:\s*[\"'](POST|PUT|PATCH|DELETE)" src/modules/access-route src/app/'(app)'/access-route
```

Expected: the key appears only in server environment/client construction, and no JobNimbus write method exists.

- [ ] **Step 2: Run the complete verification suite**

Run: `npm run verify`

Expected: lint, typecheck, unit tests, database tests, integration tests, and production build all exit 0.

- [ ] **Step 3: Review the final diff**

Run: `git diff origin/main...HEAD --check && git diff --stat origin/main...HEAD`

Expected: no whitespace errors and only JobNimbus canary/spec/runbook changes.

### Task 8: Configure and deploy staging

**Files:**
- No repository files.

**Interfaces:**
- Consumes: verified branch and existing Vercel/Supabase staging projects.
- Produces: deployed authenticated canary with scheduling disabled.

- [ ] **Step 1: Set Vercel staging limits**

Set for Production and Preview:

```text
JOBNIMBUS_PAGE_LIMIT=50
JOBNIMBUS_MAX_PAGES=1
INTEGRATIONS_JOBNIMBUS_ENABLED=false
JOBNIMBUS_INCLUDE_SOLD_VALUE=false
```

Do not read, copy, rotate, or replace `JOBNIMBUS_API_KEY`.

- [ ] **Step 2: Push the feature branch and create a pull request**

Push the isolated feature branch, create a PR against `main`, and require green CI before merge.

- [ ] **Step 3: Merge and redeploy the verified commit**

Redeploy the merged `main` commit to the existing PIW staging host so it receives the current Vercel environment values.

- [ ] **Step 4: Verify the deployment is ready**

Confirm the Vercel deployment reports `READY` with no alias error and the stable staging URL resolves.

### Task 9: Authenticated staging acceptance

**Files:**
- No repository files.

**Interfaces:**
- Consumes: deployed staging canary and existing staging administrator.
- Produces: sanitized connection evidence and, only after two successful probes, one capped import.

- [ ] **Step 1: Run the authenticated connection probe**

Sign in, open `/access-route/jobnimbus`, and click **Test JobNimbus connection**.

Expected for both resources: success, HTTP 200, count 0 or 1, and field names only. Stop if either resource fails.

- [ ] **Step 2: Run one limited import only after both probes pass**

Click **Import limited sample** once.

Expected: success with at most 50 contacts seen/written and at most 50 jobs seen/written.

- [ ] **Step 3: Verify database evidence**

Query the primary staging tenant for the latest JobNimbus canary sync run and per-table counts. Confirm `metadata.mode = "canary"`, no more than 50 records per resource were written by the run, and the control tenant remains unchanged.

- [ ] **Step 4: Verify scheduling remains disabled**

Confirm `INTEGRATIONS_JOBNIMBUS_ENABLED=false` and that no recurring JobNimbus run begins after acceptance.

- [ ] **Step 5: Record sanitized handoff evidence**

Report deployment ID, sync-run ID, timestamps, statuses, counts, field-name lists, and tenant-isolation result. Do not report API keys or customer field values.

# Privacy Consent Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a versioned first-party consent system that defaults nonessential tracking to denied and exposes reliable Analytics and Advertising gates to later scheduling and Meta work.

**Architecture:** A server-only consent module signs an opaque first-party cookie and appends every preference change to tenant-neutral consent evidence. A root client provider receives the verified server snapshot, owns the accessible banner/preferences UI, honors Global Privacy Control, and exposes a narrow `usePrivacyConsent()` interface. No analytics or advertising vendor code is part of this plan.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Zod 4, Supabase/Postgres with pgTAP, Vitest, Testing Library, Node `crypto`.

**Spec:** `docs/superpowers/specs/2026-08-28-calcom-post-assessment-scheduling-design.md`

## Global Constraints

- Consent policy version is exactly `piw-privacy-v1`.
- Cookie name is exactly `piw_privacy`; lifetime is 180 days; `HttpOnly`, `SameSite=Lax`, path `/`, and `Secure` in production.
- Necessary is always `true`; Analytics and Advertising default to `false`.
- Global Privacy Control forces Advertising to `false` until the visitor explicitly changes privacy choices after seeing that state.
- Accept all, Reject nonessential, and Customize are equally accessible.
- Consent must never block lead intake, assessment completion, callback submission, or appointment booking.
- Existing uncommitted workspace changes are user-owned. Preserve them and edit overlapping files surgically.
- Do not load Meta Pixel, create Meta cookies, or send marketing events in this plan.

---

## File Map

- `supabase/migrations/20260828120000_privacy_consent.sql` — evidence table, RLS, grants, and idempotent recorder RPC.
- `supabase/tests/privacy-consent.test.sql` — schema, permission, validation, and idempotency coverage.
- `src/modules/privacy/consent.ts` — consent types, normalization, cookie signing, and verification.
- `src/modules/privacy/consent.test.ts` — cryptographic and policy tests.
- `src/modules/privacy/consent-repository.ts` — narrow repository interface and Supabase implementation.
- `src/app/api/privacy/consent/route.ts` — validated preference update endpoint and cookie writer.
- `src/app/api/privacy/consent/route.test.ts` — route contract tests.
- `src/components/privacy/privacy-consent-provider.tsx` — client state and `usePrivacyConsent()`.
- `src/components/privacy/privacy-consent-banner.tsx` — accessible banner and preferences dialog.
- `src/components/privacy/privacy-consent.css` — isolated component styling.
- `src/components/privacy/privacy-consent-provider.test.tsx` — UI, persistence, revocation, and GPC tests.
- `src/app/layout.tsx` — verify the cookie server-side and mount the provider.
- `src/app/privacy/page.tsx`, `src/app/privacy/page.test.tsx` — public versioned privacy notice and coverage.
- `src/middleware.ts` — keep the privacy notice publicly reachable.
- `src/lib/env/server.ts` and `src/lib/env/shared.test.ts` — signing-secret configuration.
- `docs/runbooks/privacy-consent.md` — policy versioning and verification runbook.

### Task 1: Persist append-only privacy consent evidence

**Files:**
- Create: `supabase/migrations/20260828120000_privacy_consent.sql`
- Create: `supabase/tests/privacy-consent.test.sql`
- Regenerate later: `src/lib/database.types.ts`

**Interfaces:**
- Consumes: existing `companies`, `leads`, `service_role`, and `extensions.gen_random_uuid()`.
- Produces: `privacy_consent_evidence` and `record_privacy_consent(uuid, uuid, uuid, uuid, text, boolean, boolean, boolean, text, inet, text, timestamptz)`.

- [ ] **Step 1: Write the failing pgTAP test**

```sql
begin;
select plan(12);

select has_table('public', 'privacy_consent_evidence');
select has_column('public', 'privacy_consent_evidence', 'consent_id');
select has_column('public', 'privacy_consent_evidence', 'analytics_granted');
select has_column('public', 'privacy_consent_evidence', 'advertising_granted');
select has_function('public', 'record_privacy_consent', array[
  'uuid','uuid','uuid','uuid','text','boolean','boolean','boolean','text','inet','text','timestamp with time zone'
]);

select lives_ok($$
  select * from public.record_privacy_consent(
    'a1000000-0000-4000-8000-000000000001', null, null, null,
    'piw-privacy-v1', false, false, false, 'banner',
    '127.0.0.1', 'pgTAP', '2026-08-28T12:00:00Z'
  )
$$, 'records an anonymous rejection');

select is(
  (select count(*) from public.privacy_consent_evidence
   where consent_id='a1000000-0000-4000-8000-000000000001'),
  1::bigint,
  'one evidence row is stored'
);

select lives_ok($$
  select * from public.record_privacy_consent(
    'a1000000-0000-4000-8000-000000000001', null, null, null,
    'piw-privacy-v1', false, false, false, 'banner',
    '127.0.0.1', 'pgTAP', '2026-08-28T12:00:00Z'
  )
$$, 'a delivery retry is idempotent');

select is(
  (select count(*) from public.privacy_consent_evidence
   where consent_id='a1000000-0000-4000-8000-000000000001'),
  1::bigint,
  'retry does not duplicate evidence'
);

select throws_ok($$
  insert into public.privacy_consent_evidence(
    evidence_id, consent_id, policy_version, necessary_granted,
    analytics_granted, advertising_granted, gpc_detected, source,
    occurred_at
  ) values (
    gen_random_uuid(), gen_random_uuid(), 'piw-privacy-v1', false,
    false, false, false, 'banner', now()
  )
$$, '23514', null, 'necessary consent cannot be false');

select throws_ok($$
  set local role anon;
  select * from public.privacy_consent_evidence
$$, '42501', null, 'anonymous clients cannot read evidence');

select throws_ok($$
  set local role authenticated;
  select * from public.privacy_consent_evidence
$$, '42501', null, 'authenticated clients cannot read evidence directly');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the database test and verify failure**

Run: `npx supabase test db supabase/tests/privacy-consent.test.sql`

Expected: FAIL because `privacy_consent_evidence` does not exist.

- [ ] **Step 3: Add the migration**

```sql
create table public.privacy_consent_evidence (
  evidence_id uuid primary key,
  consent_id uuid not null,
  company_id uuid references public.companies(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  policy_version text not null check (policy_version = 'piw-privacy-v1'),
  necessary_granted boolean not null default true check (necessary_granted),
  analytics_granted boolean not null,
  advertising_granted boolean not null,
  gpc_detected boolean not null,
  source text not null check (source in ('banner','preferences','gpc')),
  request_ip inet,
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (consent_id, policy_version, occurred_at, source)
);

create index privacy_consent_evidence_consent_idx
  on public.privacy_consent_evidence(consent_id, occurred_at desc);
create index privacy_consent_evidence_lead_idx
  on public.privacy_consent_evidence(company_id, lead_id, occurred_at desc)
  where lead_id is not null;

alter table public.privacy_consent_evidence enable row level security;
revoke all on public.privacy_consent_evidence from public, anon, authenticated;
grant all on public.privacy_consent_evidence to service_role;

create or replace function public.record_privacy_consent(
  p_evidence_id uuid,
  p_consent_id uuid,
  p_company_id uuid,
  p_lead_id uuid,
  p_policy_version text,
  p_analytics_granted boolean,
  p_advertising_granted boolean,
  p_gpc_detected boolean,
  p_source text,
  p_request_ip inet,
  p_user_agent text,
  p_occurred_at timestamptz
) returns table(evidence_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.privacy_consent_evidence(
    evidence_id, consent_id, company_id, lead_id, policy_version,
    necessary_granted, analytics_granted, advertising_granted,
    gpc_detected, source, request_ip, user_agent, occurred_at
  ) values (
    p_evidence_id, p_consent_id, p_company_id, p_lead_id, p_policy_version,
    true, p_analytics_granted, p_advertising_granted,
    p_gpc_detected, p_source, p_request_ip,
    nullif(left(trim(p_user_agent), 512), ''), p_occurred_at
  ) on conflict (evidence_id) do nothing;
  return query select p_evidence_id;
end;
$$;

revoke all on function public.record_privacy_consent(
  uuid,uuid,uuid,uuid,text,boolean,boolean,boolean,text,inet,text,timestamptz
) from public, anon, authenticated;
grant execute on function public.record_privacy_consent(
  uuid,uuid,uuid,uuid,text,boolean,boolean,boolean,text,inet,text,timestamptz
) to service_role;
```

Use `p_evidence_id` for retry idempotency. Do not make the browser choose `company_id`; this plan passes `null`, and later lead-intake work may append linked evidence rather than mutating anonymous evidence.

- [ ] **Step 4: Run the focused and full database tests**

Run: `npx supabase test db supabase/tests/privacy-consent.test.sql`

Expected: PASS.

Run: `npm run db:test`

Expected: all pgTAP files PASS.

- [ ] **Step 5: Commit the database boundary**

```bash
git add supabase/migrations/20260828120000_privacy_consent.sql supabase/tests/privacy-consent.test.sql
git commit -m "feat: persist privacy consent evidence"
```

### Task 2: Implement consent policy and signed-cookie primitives

**Files:**
- Create: `src/modules/privacy/consent.ts`
- Create: `src/modules/privacy/consent.test.ts`
- Modify: `src/lib/env/server.ts`
- Modify: `src/lib/env/shared.test.ts`

**Interfaces:**
- Produces: `ConsentPreferences`, `VerifiedConsent`, `normalizeConsentPreferences()`, `signConsentCookie()`, and `verifyConsentCookie()`.
- Cookie payload: `{v:'piw-privacy-v1', cid:string, a:boolean, d:boolean, g:boolean, at:string}`.

- [ ] **Step 1: Write failing unit tests**

```ts
import {describe, expect, test} from "vitest";
import {
  CONSENT_POLICY_VERSION,
  normalizeConsentPreferences,
  signConsentCookie,
  verifyConsentCookie,
} from "./consent";

const secret = "0123456789abcdef0123456789abcdef";

test("defaults nonessential consent to denied", () => {
  expect(normalizeConsentPreferences({})).toEqual({
    necessary: true,
    analytics: false,
    advertising: false,
  });
});

test("GPC forces advertising off", () => {
  expect(normalizeConsentPreferences({analytics: true, advertising: true}, true))
    .toEqual({necessary: true, analytics: true, advertising: false});
});

test("round trips a signed consent cookie", () => {
  const value = signConsentCookie({
    consentId: "11111111-1111-4111-8111-111111111111",
    preferences: {necessary: true, analytics: true, advertising: false},
    gpcDetected: false,
    updatedAt: "2026-08-28T12:00:00.000Z",
  }, secret);
  expect(verifyConsentCookie(value, secret)).toMatchObject({
    policyVersion: CONSENT_POLICY_VERSION,
    consentId: "11111111-1111-4111-8111-111111111111",
    preferences: {necessary: true, analytics: true, advertising: false},
  });
});

test("rejects a tampered cookie", () => {
  const value = signConsentCookie({
    consentId: "11111111-1111-4111-8111-111111111111",
    preferences: {necessary: true, analytics: false, advertising: false},
    gpcDetected: false,
    updatedAt: "2026-08-28T12:00:00.000Z",
  }, secret);
  expect(verifyConsentCookie(`${value}x`, secret)).toBeNull();
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:run -- src/modules/privacy/consent.test.ts src/lib/env/shared.test.ts`

Expected: FAIL because the module and environment variable do not exist.

- [ ] **Step 3: Implement the primitives and environment contract**

```ts
export const CONSENT_POLICY_VERSION = "piw-privacy-v1" as const;
export const PRIVACY_COOKIE_NAME = "piw_privacy" as const;

export type ConsentPreferences = {
  necessary: true;
  analytics: boolean;
  advertising: boolean;
};

export type VerifiedConsent = {
  policyVersion: typeof CONSENT_POLICY_VERSION;
  consentId: string;
  preferences: ConsentPreferences;
  gpcDetected: boolean;
  updatedAt: string;
};

export function normalizeConsentPreferences(
  input: {analytics?: boolean; advertising?: boolean},
  gpcDetected = false,
): ConsentPreferences {
  return {
    necessary: true,
    analytics: input.analytics === true,
    advertising: !gpcDetected && input.advertising === true,
  };
}
```

Encode the payload with base64url JSON. Sign the encoded payload with `createHmac('sha256', secret)`, compare signatures with `timingSafeEqual`, validate UUID and ISO timestamp with Zod, and return `null` for malformed, wrong-version, or tampered values.

Add `PRIVACY_CONSENT_SIGNING_SECRET` as an optional minimum-32-byte server secret. In `superRefine`, require it when `DEPLOYMENT_ENV === 'production'`. Add tests proving production fails without it and test/development can parse without it.

- [ ] **Step 4: Run focused tests**

Run: `npm run test:run -- src/modules/privacy/consent.test.ts src/lib/env/shared.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the consent domain**

```bash
git add src/modules/privacy/consent.ts src/modules/privacy/consent.test.ts src/lib/env/server.ts src/lib/env/shared.test.ts
git commit -m "feat: add signed privacy consent policy"
```

### Task 3: Add the consent persistence API

**Files:**
- Create: `src/modules/privacy/consent-repository.ts`
- Create: `src/app/api/privacy/consent/route.ts`
- Create: `src/app/api/privacy/consent/route.test.ts`

**Interfaces:**
- Consumes: `ConsentPreferences`, `signConsentCookie()`, `record_privacy_consent` RPC.
- Produces: `POST /api/privacy/consent` body `{analytics:boolean, advertising:boolean, gpcDetected:boolean, source:'banner'|'preferences'|'gpc'}` and response `{consent: VerifiedConsent}`.

- [ ] **Step 1: Write failing route tests**

```ts
test("records consent and writes the secure cookie", async () => {
  const record = vi.fn(async () => undefined);
  const response = await handlePrivacyConsentRequest(request({
    analytics: true,
    advertising: false,
    gpcDetected: false,
    source: "banner",
  }), {
    signingSecret: "0123456789abcdef0123456789abcdef",
    deploymentEnvironment: "production",
    requestIp: "127.0.0.1",
    now: () => new Date("2026-08-28T12:00:00Z"),
    createId: () => "11111111-1111-4111-8111-111111111111",
    repository: {record},
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("piw_privacy=");
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(response.headers.get("set-cookie")).toContain("Secure");
  expect(record).toHaveBeenCalledOnce();
});

test("GPC cannot persist advertising consent", async () => {
  const response = await handlePrivacyConsentRequest(request({
    analytics: true,
    advertising: true,
    gpcDetected: true,
    source: "gpc",
  }), dependencies);
  expect(await response.json()).toMatchObject({
    consent: {preferences: {advertising: false}},
  });
});

test("rejects unknown fields", async () => {
  const response = await handlePrivacyConsentRequest(request({
    analytics: false, advertising: false, gpcDetected: false,
    source: "banner", leadId: "not-accepted",
  }), dependencies);
  expect(response.status).toBe(400);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:run -- src/app/api/privacy/consent/route.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement repository and route**

```ts
export type PrivacyConsentEvidenceInput = {
  evidenceId: string;
  consentId: string;
  policyVersion: "piw-privacy-v1";
  preferences: ConsentPreferences;
  gpcDetected: boolean;
  source: "banner" | "preferences" | "gpc";
  requestIp: string;
  userAgent: string;
  occurredAt: string;
};

export interface PrivacyConsentRepository {
  record(input: PrivacyConsentEvidenceInput): Promise<void>;
}
```

The route must:

1. Parse a strict Zod body capped by normal Next JSON limits.
2. Resolve or create `consentId`; never accept it from the request body.
3. Normalize GPC before recording.
4. Persist evidence before returning success.
5. Set the signed cookie with `maxAge: 15_552_000`.
6. Return `cache-control: no-store` and no request IP or evidence ID.
7. Return 503 when persistence or signing configuration is unavailable.

- [ ] **Step 4: Run focused tests**

Run: `npm run test:run -- src/app/api/privacy/consent/route.test.ts src/modules/privacy/consent.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the API**

```bash
git add src/modules/privacy/consent-repository.ts src/app/api/privacy/consent/route.ts src/app/api/privacy/consent/route.test.ts
git commit -m "feat: record public privacy choices"
```

### Task 4: Build the accessible consent UI and provider

**Files:**
- Create: `src/components/privacy/privacy-consent-provider.tsx`
- Create: `src/components/privacy/privacy-consent-banner.tsx`
- Create: `src/components/privacy/privacy-consent.css`
- Create: `src/components/privacy/privacy-consent-provider.test.tsx`
- Modify: `src/app/layout.tsx`
- Create: `src/app/layout.test.tsx`
- Create: `src/app/privacy/page.tsx`
- Create: `src/app/privacy/page.test.tsx`

**Interfaces:**
- Produces: `usePrivacyConsent(): {status:'unset'|'saving'|'saved'; preferences:ConsentPreferences; openPreferences():void; updatePreferences(input):Promise<void>}`.
- Consumes: verified cookie snapshot from the server layout and `POST /api/privacy/consent`.

- [ ] **Step 1: Write failing UI tests**

```tsx
test("offers equally accessible accept, reject, and customize actions", () => {
  render(<PrivacyConsentProvider initialConsent={null}><div /></PrivacyConsentProvider>);
  expect(screen.getByRole("button", {name: "Accept all"})).toBeVisible();
  expect(screen.getByRole("button", {name: "Reject nonessential"})).toBeVisible();
  expect(screen.getByRole("button", {name: "Customize"})).toBeVisible();
});

test("reject keeps necessary on and nonessential off", async () => {
  const fetchMock = vi.fn(async () => Response.json({consent: rejectedConsent}));
  vi.stubGlobal("fetch", fetchMock);
  render(<PrivacyConsentProvider initialConsent={null}><Probe /></PrivacyConsentProvider>);
  fireEvent.click(screen.getByRole("button", {name: "Reject nonessential"}));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    "/api/privacy/consent",
    expect.objectContaining({method: "POST"}),
  ));
  expect(screen.getByTestId("preferences")).toHaveTextContent(
    '{"necessary":true,"analytics":false,"advertising":false}',
  );
});

test("GPC starts with advertising disabled", () => {
  Object.defineProperty(navigator, "globalPrivacyControl", {value: true, configurable: true});
  render(<PrivacyConsentProvider initialConsent={null}><div /></PrivacyConsentProvider>);
  fireEvent.click(screen.getByRole("button", {name: "Customize"}));
  expect(screen.getByRole("checkbox", {name: "Advertising"})).not.toBeChecked();
  expect(screen.getByText(/Global Privacy Control/i)).toBeVisible();
});

test("saved visitors can reopen privacy choices", () => {
  render(<PrivacyConsentProvider initialConsent={rejectedConsent}><div /></PrivacyConsentProvider>);
  fireEvent.click(screen.getByRole("button", {name: "Privacy choices"}));
  expect(screen.getByRole("dialog", {name: "Privacy choices"})).toBeVisible();
});

test("links to the versioned privacy notice", () => {
  render(<PrivacyConsentProvider initialConsent={null}><div /></PrivacyConsentProvider>);
  expect(screen.getByRole("link", {name: "Privacy policy"}))
    .toHaveAttribute("href", "/privacy");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:run -- src/components/privacy/privacy-consent-provider.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement provider, banner, dialog, and layout integration**

```tsx
const PrivacyConsentContext = createContext<PrivacyConsentContextValue | null>(null);

export function usePrivacyConsent() {
  const value = useContext(PrivacyConsentContext);
  if (!value) throw new Error("usePrivacyConsent must be used inside PrivacyConsentProvider");
  return value;
}
```

The provider must submit changes before marking state saved, retain the controls after a failed request, and announce errors with `role="alert"`. The dialog must trap focus, close with Escape, restore focus, label every category, and make Necessary disabled and checked.

Create `/privacy` as a public, static notice labeled `piw-privacy-v1`. It must explain Necessary, Analytics, and Advertising categories; Cal.com scheduling; Meta Pixel/CAPI; retention of consent evidence; how to reopen Privacy choices; and the company contact channel. Add `src/app/privacy/page.test.tsx` assertions for the version label, all three categories, Cal.com, Meta, and the Privacy choices instructions. Add `/privacy` to `PUBLIC_PATHS` in `src/middleware.ts` without changing the behavior of any existing path.

Change `RootLayout` to an async server component, call `cookies()`, verify `piw_privacy` only when the signing secret exists, and pass the verified snapshot into the provider. Import `privacy-consent.css` from the provider, not `globals.css`, to avoid overwriting current user styling changes.

```tsx
<body className="min-h-full flex flex-col">
  <PrivacyConsentProvider initialConsent={initialConsent}>
    {children}
  </PrivacyConsentProvider>
</body>
```

- [ ] **Step 4: Run component, layout, and full unit tests**

Run: `npm run test:run -- src/components/privacy/privacy-consent-provider.test.tsx src/app/layout.test.tsx src/app/privacy/page.test.tsx`

`src/app/layout.test.tsx` must mock `next/headers` and assert that a valid signed cookie supplies the verified initial state while an invalid cookie supplies `initialConsent={null}`.

Expected: PASS.

Run: `npm run test:run`

Expected: all Vitest tests PASS.

- [ ] **Step 5: Commit the UI**

```bash
git add src/components/privacy src/app/layout.tsx src/app/layout.test.tsx src/app/privacy/page.tsx src/app/privacy/page.test.tsx src/middleware.ts
git commit -m "feat: add public privacy choices UI"
```

### Task 5: Regenerate types, document operations, and verify the subsystem

**Files:**
- Modify: `src/lib/database.types.ts`
- Create: `docs/runbooks/privacy-consent.md`

**Interfaces:**
- Consumes: completed Tasks 1–4.
- Produces: generated Supabase types and an operator checklist for `piw-privacy-v1`.

- [ ] **Step 1: Regenerate database types and verify the intended diff**

Run: `npx supabase gen types typescript --local > /tmp/piw-privacy-database.types.ts`

Expected: exit 0.

Use `diff -u src/lib/database.types.ts /tmp/piw-privacy-database.types.ts` to confirm the only new public schema surface is privacy consent. Replace `src/lib/database.types.ts` with the generated output using the repository's approved file-edit workflow.

- [ ] **Step 2: Write the runbook**

```markdown
# Privacy Consent Runbook

## Required configuration

- `PRIVACY_CONSENT_SIGNING_SECRET`: at least 32 random bytes; server-only.
- Policy version: `piw-privacy-v1`.

## Production checks

1. Open a private browser session and verify no `piw_privacy` cookie exists initially.
2. Reject nonessential and verify the signed HttpOnly cookie is created.
3. Reopen Privacy choices, grant Analytics only, and verify Advertising remains off.
4. Enable Global Privacy Control in a fresh session and verify Advertising defaults off.
5. Confirm each change appends one evidence row and browser retries do not duplicate it.
```

- [ ] **Step 3: Run static and focused verification**

Run: `npm run lint`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run test:run`

Expected: PASS.

Run: `npm run db:test`

Expected: PASS.

- [ ] **Step 4: Build the application**

Run: `npm run build`

Expected: production build succeeds with a valid `PRIVACY_CONSENT_SIGNING_SECRET` in the environment and contains no Meta or Cal.com code added by this plan.

- [ ] **Step 5: Commit generated types and documentation**

```bash
git add src/lib/database.types.ts docs/runbooks/privacy-consent.md
git commit -m "docs: add privacy consent operations"
```

## Plan Acceptance

- Fresh visitors begin with Analytics and Advertising denied.
- Accept, reject, customize, revocation, and GPC behavior are tested.
- Every saved choice is append-only, idempotent, and inaccessible to anonymous clients.
- The rest of the application can consume `usePrivacyConsent()` without knowing cookie or database details.
- No marketing vendor code is loaded by this subsystem.

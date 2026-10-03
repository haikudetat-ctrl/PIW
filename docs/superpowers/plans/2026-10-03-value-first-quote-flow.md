# Value-First Quote Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four inconsistent quote forms with one value-first flow (address → roof reveal with measured size → three one-tap questions → contact → price → optional refine), served by PIW on `estimate.allseasonroofingquote.com`, with saved reports for homeowners who leave before the contact step.

**Architecture:** A new tenant-scoped `property_previews` record is an anonymous, pre-lead session bound to a real property. Every entry point only collects an address, then hands off to a PIW preview page on the branded host. The preview reuses the existing Place Details fast path, property identity matching, Google Solar request key and cache, aerial route, analysis sequence, and questionnaire components. Conversion goes through the existing `start_or_resume_roof_assessment` transaction, so the lead, consent evidence, CRM, LeadConduit, Meta, and estimate delivery are unchanged downstream. Everything ships behind `PROPERTY_PREVIEW_ENABLED`, with the legacy forms kept for one release as the rollback.

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19, Supabase/Postgres/PostGIS, pgTAP, Inngest, Google Places API (New), Google Static Maps, Google Solar API, Cloudflare Turnstile, Vitest, Testing Library, Playwright/Chromium Python harnesses, Vercel.

**Spec:** [`docs/superpowers/specs/2026-10-03-value-first-quote-flow-design.md`](../specs/2026-10-03-value-first-quote-flow-design.md)

## Global Constraints

- No Google provider call (Place Details, Static Maps, Solar) before a preview row with committed property-processing evidence exists and Turnstile has verified server-side.
- The browser stays untrusted: no coordinates, roof sizes, or tenant identifiers accepted from request bodies. The tenant comes only from a verified host (PIW) or the authenticated server-to-server transport (website).
- Preview tokens are opaque, single-property capabilities. Store only their SHA-256 hash. A token never reads lead data, contact data, or another property.
- Never log names, email addresses, phone numbers, street addresses, Place IDs, coordinates, preview tokens, continuation capabilities, or signing material.
- Preserve the Google-only quote rule: no range or roof size is shown unless a ready Google Solar record is bound to the exact company and property.
- Lead capture must never depend on provider availability. Budget exhaustion, Solar `review_required`, or a Place Details failure degrades the reveal, never the contact step.
- The three consent rows (`estimate_processing`, `email_contact`, `sms_contact`) are still written for every lead, so downstream gates don't change.
- Legacy forms and the existing `/api/campaign-estimate` contract keep working throughout and until the cleanup task.
- Use TDD for every task: write the failing test, witness RED, implement the smallest change, witness GREEN, then commit only that task's files. Run `git diff --cached --check` before each commit.

---

## Task 0: Measurement hygiene and baseline

Fix the denominator before anything ships, so the stop rule and 60-day review compare like with like.

**Files**

- Modify: `apps/website/lib/arrival-beacon.ts` and its test
- Create: `supabase/migrations/<cli-named>_quote_funnel_measurement.sql`
- Create: `supabase/tests/quote-funnel-measurement.test.sql`

**Steps**

- [x] `isLikelyBot(userAgent, pathname)` also returns true for scanner paths: `/wp-admin`, `/wp-login.php`, `/xmlrpc.php`, `/.env`, `/.git/`, `/vendor/`, `/cgi-bin/`, and any `.php` path. Unit-test each. The database enforces the same rule with an insert trigger (`public.is_scanner_request_path`), so rows from any website deploy are covered.
- [x] Migration: add `experiment_arm text check (experiment_arm in ('legacy','value_first'))` to `website_arrivals`; one-time backfill of `is_likely_bot = true` for existing scanner-path rows.
- [x] Migration: `quote_funnel_daily` view (security invoker, service role only) with, per company and day: non-bot campaign visitor-days, non-bot main-site visitor-days, and leads by surface. Task 10 adds the arm split and preview columns once previews and arm tagging exist.
- [x] pgTAP: scanner flagging, view excludes bots, anon has no access.
- [ ] Record the 30-day baseline (leads per 100 campaign visitor-days) in the rollout runbook created in Task 11.

**Done when:** scanner paths no longer count as visitors and the baseline query runs against production.

## Task 1: Tenant public hosts

**Files**

- Create migration `<cli-named>_company_public_hosts.sql` and `supabase/tests/company-public-hosts.test.sql`
- Create: `src/modules/tenancy/public-host.ts` (+ test)
- Modify: `src/middleware.ts`, `src/middleware.test.ts`
- Modify: `src/lib/database.types.ts` after reset

**Interfaces**

```sql
create table public.company_public_hosts (
  host text primary key check (host = lower(host) and host ~ '^[a-z0-9.-]+$'),
  company_id uuid not null references public.companies(id) on delete cascade,
  brand jsonb not null default '{}'::jsonb,  -- logo, colors, privacy/terms URLs, display name
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
```

```ts
export async function resolvePublicHost(host: string): Promise<{companyId: string; brand: PublicBrand} | null>;
```

**Steps**

- [x] Table with RLS on and no policies; service role only. pgTAP for lowercase/format checks, uniqueness, and access.
- [x] `resolvePublicHost(host, lookup)` strips the port, lowercases, requires `verified_at`, and validates the brand (https URLs only). The Supabase lookup lives in `supabase-public-host-lookup.ts` so the pure helpers stay usable in middleware.
- [x] Middleware: hosts listed in `PUBLIC_ESTIMATE_HOSTS` serve only `/roof-estimate/**`, `/api/property-preview/**`, `/api/roof-estimate/**`, `/privacy`, and the campaign hero assets, with no staff session lookup; everything else returns 404. The allowlist comes from config, not the database, so the middleware adds no per-request query.
- Decided against: redirecting PIW-domain `/roof-estimate` links to the tenant host. Existing links keep working where they are; new links (Tasks 4, 7, 8) are issued on the tenant host.
- Moved to the Task 11 runbook: inserting the All Season `company_public_hosts` row. Company IDs differ per environment, so a migration can't seed it.

**Done when:** a tenant host serves only public estimate routes and resolves the tenant without reading the request body.

## Task 2: Property preview schema and RPCs

**Files**

- Create migration `<cli-named>_property_previews.sql` and `supabase/tests/property-previews.test.sql`
- Modify: `src/lib/database.types.ts`

**Interfaces**

```sql
create table public.property_previews (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  property_id uuid references public.properties(id),
  google_place_id text, submitted_address text not null, address_mode text not null check (address_mode in ('google','manual')),
  campaign text, entry_point text not null, presentation_key text not null,
  attribution jsonb not null default '{}'::jsonb, referrer text,
  experiment_arm text not null default 'value_first',
  reveal_mode text not null default 'full' check (reveal_mode in ('full','skipped')),
  revealed_at timestamptz, contact_viewed_at timestamptz,
  processing_disclosure_version text not null, processing_accepted_at timestamptz not null,
  ip_address inet not null, user_agent text not null,
  responses jsonb not null default '{}'::jsonb,
  saved_email text, saved_email_normalized text,
  email_disclosure_version text, email_accepted_at timestamptz,
  reminders_sent smallint not null default 0, unsubscribed_at timestamptz,
  status text not null default 'active' check (status in ('active','converted','expired')),
  converted_lead_id uuid, submission_id uuid,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.property_preview_rate_buckets (   -- per-IP-hash and per-company windows
  bucket_key text not null, window_start timestamptz not null, count integer not null default 0,
  primary key (bucket_key, window_start)
);

create function public.create_property_preview(...) returns table (preview_id uuid, property_id uuid, rate_limited boolean);
create function public.record_property_preview_responses(p_company_id uuid, p_token_hash text, p_responses jsonb) returns void;
create function public.save_property_preview_email(p_company_id uuid, p_token_hash text, p_email text, p_disclosure_version text, p_accepted_at timestamptz, p_ip inet, p_user_agent text) returns table (allowed boolean);
create function public.expire_property_previews() returns integer;
```

**Steps**

- [x] `create_property_preview` increments rate buckets (10 per hashed IP per hour, configurable per-company daily cap) in the same transaction and returns `rate_limited = true` without inserting when over. It reuses the property of a preview for the same Place ID (or, for manual addresses, the same normalized address) from the last 30 days, otherwise creates an unresolved property the way the intake transaction does, and sets `expires_at = now() + 7 days`. Rate buckets store a SHA-256 digest, never the raw IP.
- [x] `record_property_preview_responses` accepts only `reason`, `roofAge`, `timeline` with the enums from `src/domain/roof-assessment.ts`; rejects other keys; only for `active`, unexpired previews.
- [x] `save_property_preview_email` stores email and evidence, extends expiry to 30 days, and enforces three sends per preview and per normalized email per day (tracked in `property_preview_email_sends`). `mark_property_preview_progress` records `revealed_at` and `contact_viewed_at` for the server-side funnel.
- [x] `expire_property_previews` marks overdue active previews `expired` (called by an Inngest cron in Task 8).
- [x] RLS on with no policies; all functions `security definer`, `service_role` only, `search_path` pinned.
- [x] pgTAP: rate limits, property reuse for the same Place ID, tenant isolation, response key validation, email limits, expiry, no anon/authenticated access.

**Done when:** previews can be created, answered, and emailed purely through RPCs, with limits enforced in the database.

## Task 3: Turnstile verification and preview token helpers

**Files**

- Create: `src/modules/property-preview/turnstile.ts` (+ test)
- Create: `src/modules/property-preview/preview-token.ts` (+ test)
- Modify: `src/lib/env/server.ts` (+ test), `apps/website/lib/env` equivalent if present, `.env.example` files

**Steps**

- [x] `verifyTurnstile(token, remoteIp)` posts to Cloudflare siteverify with `TURNSTILE_SECRET_KEY`, a 3 s timeout, and checks `success`, `hostname`, and `action = "property_preview"`. Timeout or network failure returns `unavailable`, which callers treat as a failed challenge (interactive retry), never as a pass.
- [x] `issuePreviewToken()` returns a 32-byte base64url token and its SHA-256 hex hash; `hashPreviewToken()` for lookups. Mirror the conventions in `continuation-token.ts`.
- [x] PIW env: `PROPERTY_PREVIEW_ENABLED` (default false; requires `TURNSTILE_SECRET_KEY`, roof assessments, and paid providers) and `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. The website's equivalents are added in Task 9 where they're first used.

## Task 4: Preview creation API

**Files**

- Create: `src/app/api/integrations/all-season/property-preview/route.ts` (+ test) — authenticated server-to-server from the website
- Create: `src/app/api/property-preview/route.ts` (+ test) — direct, for PIW-hosted `/roof-estimate`
- Create: `src/modules/property-preview/create-preview.ts` (+ test)
- Modify: `src/modules/roof-assessment/post-consent-property-prefetch.ts` to expose the Place Details fast path for a preview-bound property

**Interfaces**

```ts
type CreatePreviewInput = {
  companyId: string; address: string; googlePlaceId: string | null;
  manual: {line1: string; line2: string | null; city: string; postalCode: string} | null;
  campaign: CampaignSlug | null; entryPoint: EntryPoint; presentationKey: PresentationKey;
  attribution: CampaignAttribution; referrer: string | null;
  clientIp: string; userAgent: string; turnstileToken: string;
};
type CreatePreviewResult =
  | {kind: "created"; previewUrl: string}      // https://estimate.allseasonroofingquote.com/roof-estimate/p/<token>
  | {kind: "challenge_failed"}
  | {kind: "rate_limited"}
  | {kind: "disabled"};
```

**Steps**

- [x] Strict zod schema (`property-preview/schema.ts`) rejects coordinates and mismatched campaign context; the integration route uses the existing shared-secret check.
- [x] `createPropertyPreview`: Turnstile (PIW is the only verifier; the website forwards the browser token, allowed widget hostnames come from `TURNSTILE_ALLOWED_HOSTNAMES`) → resolve the company's verified host → `create_property_preview` (commits processing evidence) → for a Google Place ID, the existing Place Details adapter with a 2,500 ms budget and the same exact-NJ check as the intake fast path → store canonical address and coordinates on the preview → emit `property/preview_measurement_requested`. Any provider or queue failure sets `measurement_status = 'unavailable'` and still returns the preview URL.
- [x] Migration `property_preview_measurement`: `canonical_address`, `latitude`, `longitude`, `place_resolved_at`, `measurement_status`, `roof_insight_id`, with all-or-nothing place and insight constraints.
- [x] `property-preview-measurement-worker` (Inngest): reuses the company's cached `roof_insights` row for the normalized canonical address, otherwise reserves the monthly Solar budget (exhausted → `skipped`, reveal skipped), records a pipeline-less `provider_requests` row (`roof.measurement:preview:<id>`), calls Solar, and upserts the same `roof_insights` cache key the lead worker reads. That is what makes conversion reuse the measurement instead of paying for Solar twice.
- [x] Tests: challenge failure makes no write or provider call; rate-limited makes no provider call; manual and non-exact addresses are never measured; cache hits skip budget and Solar; provider failures degrade without throwing.
- Moved to Task 9: the direct PIW `POST /api/property-preview` route for the tenant-host `/roof-estimate` form (tenant from the host), built alongside that form.

## Task 5: Preview read model and image access

**Files**

- Create: `src/app/api/property-preview/[token]/route.ts` (+ test)
- Create: `src/modules/property-preview/preview-read-model.ts` (+ test)
- Modify: `src/app/api/roof-estimate/[token]/house-image/route.ts` to accept a preview capability, or create a sibling `src/app/api/property-preview/[token]/house-image/route.ts` sharing its loader

**Interfaces**

```ts
type PreviewView = {
  status: "active" | "converted" | "expired";
  address: {display: string; googleConfirmed: boolean};
  image: {state: "ready" | "pending" | "unavailable"};
  roof: {state: "ready"; squares: number; complexity: "simple" | "moderate" | "complex"}
      | {state: "pending"} | {state: "review_required"} | {state: "skipped"};
  answered: Array<"reason" | "roofAge" | "timeline">;
  savedEmail: boolean;
  brand: PublicBrand;
  continuationPath: string | null;  // set once converted
};
```

**Steps**

- [x] `src/domain/roof-complexity.ts`: whole squares on the pricing function's sqft/100 basis; simple (≤4 planes, ≤10° pitch range), complex (≥10 planes or >25° range), moderate otherwise.
- [x] `loadPreviewView`: roof size only from the `roof_insights` row the measurement worker linked, bound by company and id (a cached insight can belong to an earlier property row for the same address). Measurement `no_coverage`/`unavailable` and a missing insight all map to `review_required`; nothing invents a size.
- [x] `GET /api/property-preview/[token]` and `/house-image`: tenant from the host, preview from the token hash, one indistinguishable 404 for bad tokens, unknown hosts, and unknown or expired previews; `no-store` for the view, `private, max-age=3600` for the image.
- [x] The view never contains price, contact data, row identifiers, coordinates, or the Place ID (asserted in tests).

## Task 6: PIW preview experience

**Files**

- Create: `src/app/roof-estimate/p/[token]/page.tsx` and `preview-experience.tsx` (+ tests)
- Create: `src/app/roof-estimate/p/[token]/contact-step.tsx` (+ test)
- Modify for reuse: `assessment-loading.tsx`, `property-satellite-image.tsx`, `assessment-questionnaire.tsx`, `assessment-questions.ts`, `campaign-estimate-shell.tsx`

**Steps**

- [ ] Sequence: analysis (existing 8 s minimum / 12 s imagery ceiling) → reveal (aerial, address with correction link, roof size or “Measuring your roof…”) → three questions (`reason`, `roofAge`, `timeline`) with auto-advance and back → contact step.
- [ ] Refactor `assessment-questionnaire.tsx` so a step list can be passed in; the preview uses the first three, the post-result refine uses the remaining six. Existing assessment tests must still pass unchanged.
- [ ] Contact step: name, email, mobile, TCPA notice built from a new `contactOnlyNotice(submitLabel)` (version `all-season-campaign-estimate-v3`) with the button “Unlock my price”. Notice copy unit-tested.
- [ ] “Email me this roof report” link from the reveal onward opens an inline email field with the email notice (version `all-season-preview-email-v1`).
- [ ] Manual address: neutral placeholder, no “Google-confirmed” copy, no roof size.
- [ ] Brand from `PublicBrand`; campaign theming as today. Reduced motion supported.
- [ ] Tests for each roof state, manual address, back navigation, keyboard and screen-reader labels, and that no price renders before conversion.

## Task 7: Conversion into the canonical intake

**Files**

- Create: `src/app/api/property-preview/[token]/convert/route.ts` (+ test)
- Create: `src/modules/property-preview/convert-preview.ts` (+ test)
- Create migration `<cli-named>_convert_property_preview.sql` and pgTAP test
- Modify: `src/modules/roof-assessment/start-or-resume.ts`, `supabase-assessment-intake-repository.ts`
- Modify: `src/app/roof-estimate/[token]/assessment-experience.tsx` (skip answered questions; refine after result)

**Interfaces**

```sql
create function public.convert_property_preview(
  p_company_id uuid, p_token_hash text, p_submission_id uuid,
  p_name text, p_email text, p_phone text,
  p_contact_disclosure_version text, p_contact_accepted_at timestamptz,
  p_ip inet, p_user_agent text
) returns table (outcome text, continuation_path text);  -- outcome: issued | replay | expired | not_found
```

**Steps**

- [ ] The function locks the preview row, requires `active` and unexpired (or returns `replay` for the same `submission_id` on a converted preview), then calls the existing `start_or_resume_roof_assessment` internals with the preview's property, address, campaign, entry point, attribution, and referrer.
- [ ] Consent evidence: `estimate_processing` from the preview's processing evidence; `email_contact` and `sms_contact` from the contact step. If a saved-report email exists and matches, its evidence is kept as an additional row in the preview, not a fourth consent type.
- [ ] Seed the assessment responses with the three preview answers; the result page shows “Refine your estimate” for the remaining six, and they never block the price.
- [ ] Mark the preview `converted` with `converted_lead_id` and `submission_id` in the same transaction.
- [ ] Meta: browser `Lead` fires on contact submit; server `QualifiedLead` unchanged.
- [ ] pgTAP: double conversion, expiry, tenant mismatch, consent rows and versions, responses copied, existing pipeline gates satisfied. Integration test through `src/integration/canonical-assessment-journey.test.ts` patterns.

## Task 8: Saved reports and reminders

**Files**

- Create: `src/app/api/property-preview/[token]/save-report/route.ts` (+ test)
- Create: `src/inngest/functions/preview-report-sender.ts` (+ test) — report email, 24 h and 4 d reminders, expiry cron
- Create: `src/app/roof-estimate/p/unsubscribe/route.ts` (+ test)
- Create migration `<cli-named>_preview_email_suppression.sql` (+ pgTAP)
- Reuse: provider and template helpers from `src/inngest/functions/estimate-delivery-sender.ts`

**Steps**

- [ ] Save endpoint verifies a fresh Turnstile token, calls `save_property_preview_email`, emits `property/preview_report_requested`.
- [ ] Report email: aerial (signed, short-lived image URL), roof size if ready, and a resume link that carries a newly issued preview token (rotate: store the new hash, keep the old valid until expiry). No price.
- [ ] Reminders run only while the preview is `active`, not unsubscribed, and the email isn't suppressed. Cap at two.
- [ ] One-click unsubscribe (RFC 8058 `List-Unsubscribe-Post`) writes a company-scoped suppression row.
- [ ] Daily cron calls `expire_property_previews`.
- [ ] Tests: no lead, CRM, dialer, or LeadConduit event is ever produced by a saved report; reminders stop on conversion and unsubscribe.

## Task 9: Shared address entry on every entry point

**Files**

- Create: `apps/website/app/api/property-preview/route.ts` (+ test) — Turnstile pass-through and server-to-server forward
- Create: `apps/website/components/address-entry.tsx` (+ test) — wraps the existing `address-autocomplete.tsx`
- Create: `apps/website/public/address-entry.js` (+ test in `lead-forms.test.ts` style) — framework-free version for `index.html` and `contact.html`
- Modify: `apps/website/app/campaigns/campaign-estimate-form.tsx`, `apps/website/public/index.html`, `contact.html`, `script.js`
- Modify: `src/app/roof-estimate/roof-estimate-form.tsx`
- Create: `apps/website/lib/property-preview-notice.ts` with the step-1 notice (version `all-season-property-preview-v1`)
- Delete: `apps/website/public/quote-drawer.js` and `quote-drawer.css` (never loaded on any page)

**Steps**

- [ ] One field with autocomplete, “Enter it manually” fallback, the property-processing notice naming “See my roof”, and invisible Turnstile. On success, `window.location.assign(previewUrl)`.
- [ ] `PROPERTY_PREVIEW_ENABLED=false` renders the legacy form unchanged on every entry point. Set the arrival's `experiment_arm` from the same flag in the proxy.
- [ ] Carry campaign, entry point, presentation key, UTM, `fbclid`, and referrer exactly as the legacy payload does; test the mapping for every entry point.
- [ ] Mobile: single column, 16 px inputs, no layout shift when the Turnstile widget appears.
- [ ] Fix the homepage canonical URL to `https://allseasonroofingquote.com/` while editing `index.html`.

## Task 10: Analytics and server-side funnel

**Files**

- Modify: `apps/website/public/posthog-runtime.js` allowlist and PIW preview components
- Modify: `quote_funnel_daily` view (migration) to add previews created, reveals, questions answered, reports saved, contact steps reached, conversions

**Steps**

- [ ] Browser events (`address_submitted`, `roof_revealed`, `question_answered`, `report_saved`, `contact_step_reached`, `refine_completed`) stay consent-gated and value-free.
- [ ] The server-side funnel uses only PIW records (preview timestamps and status), so it covers every visitor. Write `revealed_at` and `contact_viewed_at` (added in Task 2) from the preview UI through small `POST /api/property-preview/[token]/progress` calls.
- [ ] pgTAP for the view; component tests that events carry no form values.

## Task 11: End-to-end verification and rollout

**Files**

- Modify: `apps/website/scripts/visual-test.py`, `scripts/assessment-session.test.py`
- Create: `docs/runbooks/value-first-quote-flow-rollout.md`

**Steps**

- [ ] Playwright journeys for campaign page, homepage, contact page, and PIW `/roof-estimate`: Google address → reveal → three questions → contact → price; manual address; Solar pending; budget-skipped reveal; saved report then resume; mobile viewport. Intercept provider and lead calls.
- [ ] Runbook: DNS (`estimate.allseasonroofingquote.com` CNAME to Vercel), add the domain to the `piw` project, verify the `company_public_hosts` row, Turnstile keys, env flags, the baseline query, the stop rule (≤1 lead in the first 1,000 non-bot campaign visitor-days → rollback), the cost rule (provider spend per lead above 3× baseline → rollback), and the rollback procedure (set `PROPERTY_PREVIEW_ENABLED=false` on both projects).
- [ ] Rollout order: enable on PIW `/roof-estimate` with internal traffic → one campaign page with internal traffic → all entry points.

## Task 12: Cleanup after the 60-day review

- [ ] Remove the legacy long forms, their tests, and the flag branches.
- [ ] Remove `all-season-campaign-estimate-v1`/`v2` acceptance from new submissions once no legacy form can send them (keep historical rows readable).
- [ ] Record the review outcome in the spec.

## Completion Criteria

- Every entry point starts with one address field and reaches the price through the same PIW flow on `estimate.allseasonroofingquote.com`.
- No provider call happens without committed property-processing evidence and a verified Turnstile token.
- Every converted lead has all three consent rows with the correct disclosure versions, and downstream behavior (CRM, LeadConduit, Meta, estimate delivery) is unchanged.
- Saved reports never create leads and respect unsubscribe.
- The server-side funnel and baseline queries run in production, scanner traffic is excluded, and the rollback flag is tested.
- Website and PIW typecheck, lint, unit, pgTAP, and Playwright suites pass.

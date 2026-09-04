# All Season Meta rollout handoff

Last updated: 2026-09-01 (America/New_York)

This is the operator handoff for completing the consent-gated Meta Pixel and
Conversions API rollout. The implementation is deployed, but Meta event
emission is intentionally disabled until an attended Test Events session is
completed.

The detailed steady-state operating guide is
[`all-season-meta-conversions.md`](./all-season-meta-conversions.md). Use this
handoff for the current release state and the exact remaining sequence.

## Current release state

| Surface | Current state |
| --- | --- |
| Repository | `haikudetat-ctrl/PIW` |
| Branch | `codex/all-season-meta-tracking` |
| Release commit | `51cac90fdedc5f434f38f7912809658955ced143` |
| Independent review | Approved; no release-blocking findings |
| Supabase project | `qituolbocxnoxcmkqrva` |
| Production migration | `20260902005333_meta_tracking_release_boundaries.sql` applied and verified |
| PIW production | <https://piw-sepia.vercel.app> |
| Website production | <https://rake-website.vercel.app> |
| PIW deployment | `dpl_5kREbmdwVu6SviZxswPG8XPa8qrd` — READY |
| Website deployment | `dpl_ERFKK3SdXjsrzWhqqiVEddfuz9Ez` — READY |
| Meta dataset / Pixel | All Season Roofing — `3142520615938086` |
| Tracking state | Disabled in Production and Preview pending Meta Test Events |
| External blocker | Sign in to Meta Events Manager for the All Season business account |

Production HTTP checks after deployment:

- PIW `/api/integrations/health`: HTTP 200
- Website `/`: HTTP 200
- Website `/api/privacy/consent`: HTTP 200

## What is already complete

- One canonical consent model is shared across the website and PIW.
- Global Privacy Control, denial, missing evidence, and later revocation fail
  closed for tracking without blocking lead intake or quote delivery.
- The website and PIW use environment-specific signing secrets. Production and
  Preview secrets are distinct; the two applications match only within the
  same environment.
- Browser `QualifiedLead` and `AssessmentCompleted` events use the same IDs as
  their server CAPI counterparts for Meta deduplication. Browser-only `Lead`
  marks the point where both estimate permissions are checked.
- First result view is durable and cannot be backfilled into a conversion after
  a denied or missing-consent view.
- Public consent and result-view boundaries are atomic and rate-limited in
  PostgreSQL.
- Meta delivery retries are bounded. HTTP 408, 429, and 5xx are retryable; a
  fifth transient failure becomes terminal `retry_exhausted`.
- Missing or invalid Meta configuration disables tracking and does not break
  consent, lead intake, quote delivery, CRM persistence, or Slack alerts.
- Production database ACLs were checked: privileged RPCs are service-role-only,
  use an empty `search_path`, and the affected tables have RLS with no
  anonymous/authenticated DML.

## Verification evidence

The final release commit passed:

- PostgreSQL pgTAP: 25 files, 1,143 assertions
- PIW Vitest: 909 passed, 7 skipped
- Website Vitest: 180 passed
- Integration: 7 passed
- PIW and website TypeScript checks
- PIW and website ESLint; PIW retains 11 pre-existing warnings and no errors
- PIW and website production builds
- `git diff --check`

## Remaining activation sequence

Do these steps in order. Do not enable production tracking early.

### 1. Authenticate to Meta

Sign in to [Meta Events Manager](https://business.facebook.com/events_manager2/)
with access to **All Season Roofing**, dataset `3142520615938086`. Confirm the
dataset ID before creating or changing anything.

### 2. Create the server token

In **Settings → Conversions API**, select the manual/direct integration and
create the CAPI access token for this dataset. Token creation is a privileged
external action and requires the account owner to approve it at action time.

Record only these configuration facts:

- The token itself goes directly into PIW's Vercel secret field.
- The Graph API version must be the exact supported `vN.N` displayed by Meta.
- Never paste the token into Git, Slack, this runbook, a ticket, a screenshot,
  browser source, or a `NEXT_PUBLIC_*` variable.

### 3. Configure Preview only

In the linked PIW project, set Preview values:

```bash
vercel env add META_CAPI_ACCESS_TOKEN preview --sensitive
vercel env add META_GRAPH_API_VERSION preview
vercel env add META_TEST_EVENT_CODE preview --sensitive
vercel env add META_TRACKING_ENABLED preview --force
```

Enter `true` for the final command. In the linked `rake-website` project, set:

```bash
vercel env add NEXT_PUBLIC_META_TRACKING_ENABLED preview --force
```

Enter `true`. The existing Preview Pixel ID and signing secret must remain in
place. Deploy the same commit to both Preview projects. Wait for PIW/Inngest
functions to be available before testing.

### 4. Run attended Test Events QA

Use unique test contact information in a private browser session.

Consent-granted journey:

1. Open the website or one campaign link.
2. Grant Advertising consent.
3. Submit the form and confirm the consent gate transitions into the question
   flow.
4. Complete the assessment and confirm a trusted Good/Better/Best result is
   rendered.
5. Confirm the customer-facing quote link works.
6. Confirm the lead and estimate exist in PIW CRM.
7. Confirm the Slack alert uses the PIW Context Dialer format.
8. In Meta Test Events, confirm `PageView`, browser `Lead`, `QualifiedLead`,
   and `AssessmentCompleted` in that order.
9. Confirm browser and server copies of `QualifiedLead` and
   `AssessmentCompleted` share one event ID and Meta displays one deduplicated
   logical event for each.

Consent-denied journey:

1. Start in a new private browser session and deny Advertising consent.
2. Complete the same form and assessment journey.
3. Confirm quote, CRM, and Slack delivery still work.
4. Confirm there is no request to `connect.facebook.net` or
   `graph.facebook.com`, no Meta cookie creation, and no Test Events activity.

Abort activation if any required check fails. Keep both production flags off,
capture the deployment URL and sanitized failure category, and investigate
without adding customer/property data to logs.

### 5. Remove Test Events configuration

Immediately after QA:

```bash
vercel env rm META_TEST_EVENT_CODE preview
```

Redeploy PIW Preview and confirm the test code is absent. A Meta test code must
never be present in Production.

### 6. Configure and enable Production together

Set PIW Production values using Vercel's secret/config prompts:

```bash
vercel env add META_CAPI_ACCESS_TOKEN production --sensitive
vercel env add META_GRAPH_API_VERSION production
vercel env add META_TRACKING_ENABLED production --force
```

Enter `true` for the tracking flag. Then set the website flag:

```bash
vercel env add NEXT_PUBLIC_META_TRACKING_ENABLED production --force
```

Enter `true`. Redeploy both projects from the same release commit. The website
must be deployed from the repository root because its Vercel project already
uses `apps/website` as its configured Root Directory:

```bash
# PIW, from repository root
vercel deploy --prod --yes

# Website, also from repository root
vercel deploy --prod --yes --project rake-website
```

Do not run the website deploy from inside `apps/website`; Vercel will attempt
to resolve `apps/website/apps/website` and fail its Root Directory check.

### 7. Production acceptance

Run one attended granted-consent journey and one denied-consent journey. Verify
the same customer, PIW CRM, Slack, consent, deduplication, and no-tracking-on-
denial checks used in Preview. Record only:

- timestamp and operator;
- source URL and campaign slug;
- deployment IDs;
- lead/estimate IDs in the approved internal QA record;
- browser/server deduplication result;
- aggregate delivery state and sanitized error category, if any.

Do not record tokens, raw payloads, addresses, property images, roof geometry,
assessment answers, quote amounts, or pricing packages in the release record.

## QA links

- Main website: <https://rake-website.vercel.app/>
- Weather Report: <https://rake-website.vercel.app/campaigns/weather-report>
- Seasonal Shield: <https://rake-website.vercel.app/campaigns/seasonal-shield>
- For Every Season: <https://rake-website.vercel.app/campaigns/for-every-season>
- PIW roof-estimate entry: <https://piw-sepia.vercel.app/roof-estimate>
- PIW health: <https://piw-sepia.vercel.app/api/integrations/health>

Use a newly generated estimate URL for result-page testing. Do not reuse a
previous customer token or post a customer-specific estimate URL in Slack.

## Immediate rollback

The browser and server kill switches must be changed together.

1. Set PIW `META_TRACKING_ENABLED=false` in Production.
2. Set website `NEXT_PUBLIC_META_TRACKING_ENABLED=false` in Production.
3. Redeploy both projects from the last known-good commit.
4. Confirm the website and PIW still return HTTP 200 and that Meta network
   requests stop.
5. Do not delete delivery-ledger rows; they preserve idempotency and accepted
   delivery history.

If the CAPI token is exposed, revoke it in Meta first, disable both flags,
redeploy, create a replacement token, and repeat Preview Test Events before
re-enabling Production.

## Operational monitoring

Use the aggregate SQL queries in
[`all-season-meta-conversions.md`](./all-season-meta-conversions.md#5-delivery-monitoring-and-diagnosis).
Normal states are `pending`, `sending`, `retryable_failed`, `sent`, and
`permanent_failed`. Never manually convert a terminal fifth-attempt failure
back to retryable or delete sent rows.

The `roof_assessment_result_view_attempts` table stores only token hashes,
request IPs, and timestamps for rate limiting. A cleanup/retention policy is a
non-blocking follow-up before long-term table growth; it is not required to
activate this release.

## Handoff completion checklist

- [ ] Meta account authenticated for the correct business/dataset
- [ ] CAPI token created and installed only in PIW
- [ ] Supported Graph API version pinned exactly
- [ ] Preview Test Events code installed temporarily
- [ ] Preview granted-consent journey passed
- [ ] Preview denied-consent journey passed
- [ ] Browser/server `Lead` deduplicated
- [ ] Browser/server `AssessmentCompleted` deduplicated
- [ ] Test Events code removed and Preview redeployed
- [ ] Production token/version installed
- [ ] Both Production tracking flags enabled together
- [ ] Both Production projects redeployed from the same commit
- [ ] Production granted-consent journey passed
- [ ] Production denied-consent journey passed
- [ ] Christopher received the QA links and sanitized release summary

## Slack handoff template

Send this only after Production acceptance is complete:

> All Season's consent-gated Meta conversion rollout is live. PIW and the main
> website are on release `51cac90`; the production database migration is
> applied. Verified: consent gate → questions → Good/Better/Best quote → PIW
> CRM → Context Dialer Slack alert, plus deduplicated Meta `Lead` and
> `AssessmentCompleted`. QA: https://rake-website.vercel.app/ and
> https://piw-sepia.vercel.app/roof-estimate. Runbook: repository
> `docs/runbooks/all-season-meta-rollout-handoff.md`.

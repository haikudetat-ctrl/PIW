# All Season Meta lead distribution runbook

Last updated: 2026-09-03 (America/New_York)

## Required outcome

Every eligible All Season Meta form lead is delivered independently to:

1. ActiveProspect LeadConduit Roofing flow through the pinned PIW source.
2. `roofingleads@allseason.solar` through Resend.

Campaign mapping is exact:

| Meta campaign | Lead source label |
| --- | --- |
| `AS | Campaign 1` | `Meta70` |
| `AS | Campaign 2` | `Meta30` |

The canonical campaign URLs may also send `Meta70` or `Meta30` directly as
`utm_campaign`. Accepted `utm_source` values are `meta`, `facebook`, and
`instagram`. Other traffic is not distributed by this workflow.

## Architecture and safety

- `public.pipeline_runs` transactionally creates two rows in
  `public.lead_distribution_deliveries` and one outbox event.
- Contact PII stays in `public.leads`; the delivery ledger stores routing and
  outcome state only.
- ActiveProspect and email are separate Inngest functions. Failure in one does
  not block the other.
- Claims are scoped to `ACCESS_ROUTE_COMPANY_ID`, exclusive, and recover after
  ten minutes if a worker dies.
- Retryable HTTP/network failures use exponential backoff and become terminal
  after five claims. LeadConduit business rejections and HTTP 4xx responses do
  not retry.
- A five-minute sweeper republishes eligible pending/stale deliveries.
- LeadConduit-originated records are excluded to prevent a routing loop.
- The LeadConduit URL is pinned in code; never make it an environment-supplied
  destination.

## Pinned ActiveProspect endpoint

```text
POST https://app.leadconduit.com/flows/6377949a81800d03d54119b5/sources/6a999da372afc3570dc712a1/submit
Content-Type: application/x-www-form-urlencoded
Accept: application/json
```

The source URL is the submission credential. There is no separate API-key
header in the supplied Submission Docs. Never send `redir_url`.

## Production configuration

PIW requires:

```text
ACCESS_ROUTE_COMPANY_ID=<All Season company UUID>
INTEGRATIONS_LEADCONDUIT_SUBMISSION_ENABLED=true
INTERNAL_LEAD_EMAIL_ENABLED=true
RESEND_API_KEY=<server-only secret>
LEAD_NOTIFICATION_FROM_EMAIL=leads@allseason.solar
```

`VERCEL_PROJECT_PRODUCTION_URL` is supplied by Vercel and is used for the
internal PIW lead link. The sending domain must be verified in Resend before
using `leads@allseason.solar`. Keep each destination flag false until its
attended canary succeeds.

## Release state

- Branch / PR: `codex/all-season-meta-tracking` / PR #42
- Migration: `20260903195713_meta_lead_distribution.sql`
- Supabase project: `qituolbocxnoxcmkqrva`
- Migration applied to production: 2026-09-03
- Local verification:
  - Vitest: 935 passed, 7 skipped
  - pgTAP: 1,170 passed
  - Supabase integration: 7 passed
  - dedicated distribution integration: passed
  - lint: no errors (11 pre-existing warnings)
  - typecheck and production build: passed

## Attended production canary

1. Confirm both destination flags and Resend credentials are present in the
   PIW Production environment. Confirm `META_TEST_EVENT_CODE` is absent.
2. Redeploy PIW Production so Inngest discovers the new functions.
3. Open a production campaign URL with
   `utm_source=meta&utm_campaign=Meta70` and submit a synthetic, clearly marked
   test lead using an inbox and phone controlled by the operator.
4. Confirm the existing Slack notification arrives.
5. Confirm one ActiveProspect record appears with `Meta70` in
   `original_source` and `campaign_source`.
6. Confirm one email arrives at `roofingleads@allseason.solar` with a working
   PIW lead link.
7. Repeat with `utm_campaign=Meta30` and confirm both destinations show
   `Meta30`.
8. Confirm Meta Events Manager records the `Lead` event independently of the
   two distribution destinations.

Do not use a real homeowner for the canary and do not paste contact details,
tokens, or raw payloads into GitHub, Slack, or this runbook.

## Monitoring queries

Aggregate status only:

```sql
select destination, source_label, status, count(*)
from public.lead_distribution_deliveries
where created_at >= now() - interval '24 hours'
group by destination, source_label, status
order by destination, source_label, status;
```

Recent failures without contact PII:

```sql
select id, lead_id, destination, source_label, status, attempt_count,
       left(last_error, 160) as error, updated_at
from public.lead_distribution_deliveries
where status in ('rejected', 'retryable_failed', 'permanent_failed')
order by updated_at desc
limit 25;
```

Healthy delivery means each lead has one `sent` row per destination. A
LeadConduit `rejected` row means the flow accepted the request but rejected the
lead on business rules; investigate its sanitized reason and do not retry it.

## Rollback

1. Set `INTEGRATIONS_LEADCONDUIT_SUBMISSION_ENABLED=false` to stop
   ActiveProspect delivery.
2. Set `INTERNAL_LEAD_EMAIL_ENABLED=false` to stop inbox delivery.
3. Redeploy PIW Production.
4. Leave ledger rows and the migration intact. They preserve idempotency and
   audit history.
5. Correct configuration or code, re-enable one destination at a time, and let
   the recovery sweep process pending rows.

If an API key is exposed, revoke it first, then disable that destination and
redeploy. The Meta CAPI token previously shown in screenshots should be rotated
separately; it is unrelated to this LeadConduit endpoint.

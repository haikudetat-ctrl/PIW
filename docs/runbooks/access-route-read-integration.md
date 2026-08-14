# Access Route read integration (LeadConduit read retired)

## LeadConduit read boundary

LeadConduit API reading is paused, unscheduled, and not required by the direct receipt baseline. It must remain disabled. This is not an operational runbook for LeadConduit: do not configure a LeadConduit API key or base URL, inventory `/flows`, enable a LeadConduit vendor flag, schedule a pull, or add a LeadConduit API reader. The direct receipt baseline is preparation-only until separately approved; its only future configuration reference is [LeadConduit shadow recipient](leadconduit-shadow-recipient.md).

The remaining operational material applies only to the separately scoped LeadMaster and JobNimbus read paths. It does not create or update records in any vendor system and does not change production routing.

The generic `/api/integrations/[vendor]` POST route is hard-disabled for LeadMaster, JobNimbus, and CallTools. Scheduled read flags cannot activate inbound webhook receipt, and the route performs no tenant lookup, body parsing, persistence, or enqueueing.

## What is deployed

- An Inngest schedule runs every 30 minutes in `America/New_York` for approved LeadMaster and JobNimbus reads.
- Each approved vendor pull uses only HTTP `GET` requests.
- Raw vendor payloads are retained for diagnosis with credential-like fields recursively redacted.
- Normalized rows use vendor record IDs as unique keys, so retries upsert rather than duplicate records.
- `integration_sync_runs` records source system, run key, record counts, cursor, outcome, and a non-sensitive error category.
- The dashboard is at `/access-route`; vendor drill-downs are under `/access-route/{vendor}`.

## Required secret configuration

Set secrets in the deployment environment or secret manager, never in tracked files.

Common:

- `ACCESS_ROUTE_COMPANY_ID`: required when the database contains more than one company.

LeadMaster:

- `LEADMASTER_ACCESS_TOKEN`
- `LEADMASTER_BASE_URL=https://devwebapi.leadmaster.com`
- `LEADMASTER_WORKGROUPS=roofing,roofing virtual quote` (replace with the labels returned by the granted account)
- `LEADMASTER_LOOKBACK_MINUTES=1440`
- `INTEGRATIONS_LEADMASTER_ENABLED=true` only after API entitlement and workgroup scope are confirmed.

JobNimbus:

- `JOBNIMBUS_API_KEY` from a View + Export/Reports-only Access Profile.
- `JOBNIMBUS_BASE_URL=https://app.jobnimbus.com`
- `JOBNIMBUS_CONTACTS_PATH=/api1/contacts`
- `JOBNIMBUS_JOBS_PATH=/api1/jobs`
- `JOBNIMBUS_PAGE_LIMIT=50`
- `JOBNIMBUS_MAX_PAGES=1`
- `JOBNIMBUS_INCLUDE_SOLD_VALUE=false` unless the business owner explicitly approves that field.
- `INTEGRATIONS_JOBNIMBUS_CANARY_ENABLED=false` except during an approved, attended staging canary window.
- Keep `INTEGRATIONS_JOBNIMBUS_ENABLED=false` during the staging canary. Confirm both paths against the granted account before any later decision to enable scheduled ingestion. JobNimbus’s current public Platform documentation exposes Bearer authentication but does not list contacts/jobs in its visible service registry, so the paths are deliberately configurable.

Do not grant Delete, billing/settings, or cost/margin permissions. Cost, margin, profit, and commission fields are redacted defensively if a mis-scoped profile returns them. `sold_value` remains null unless its dedicated approval flag is enabled.

## First connection sequence

1. Apply the Supabase migration and confirm `20260804161813_access_route_read_integration.sql` appears in migration history.
2. Confirm the existing `20260801230408_lead_automation_audit_delta.sql` migration is also present; it contains the speed-to-lead prerequisite.
3. Provision one vendor secret at a time with that vendor’s enable flag still false.
4. Validate the credential against its documented read endpoint outside production traffic. Never paste the credential into a ticket, commit, or application log.
5. For LeadMaster, verify the returned workgroup labels and confirm `entered_at` matches the UI’s **Date Entered** value. The integration never sends or reads a Quick Action Date Range filter.
6. For JobNimbus, verify that the access profile can read contacts and jobs and that no write endpoint is permitted. Confirm whether appointment status is present on the returned job record for this account; map any custom appointment field before relying on the no-show panel.
7. Enable only that approved vendor, observe the first `integration_sync_runs` row, and inspect record counts plus a small sample of normalized records.
8. Repeat for the next approved read vendor.

## JobNimbus staging canary

The authenticated JobNimbus drill-down at `/access-route/jobnimbus` provides a deliberately separate staging path. It does not depend on `INTEGRATIONS_JOBNIMBUS_ENABLED`, requires `INTEGRATIONS_JOBNIMBUS_CANARY_ENABLED=true`, and never writes to JobNimbus.

1. Confirm the API key and the JobNimbus paths are set in the staging deployment only.
2. Confirm `INTEGRATIONS_JOBNIMBUS_ENABLED=false`, `JOBNIMBUS_PAGE_LIMIT=50`, `JOBNIMBUS_MAX_PAGES=1`, and `JOBNIMBUS_INCLUDE_SOLD_VALUE=false`; then temporarily set `INTEGRATIONS_JOBNIMBUS_CANARY_ENABLED=true` for the attended test window.
3. Sign in as a staging administrator and select **Test JobNimbus connection**.
4. Verify that both contacts and jobs report a successful HTTP status. The result intentionally shows only status, record count, and field names; it never displays customer values.
5. Only after both probes pass, select **Import limited sample** once. The server repeats both probes before importing, binds all records to the signed-in administrator's company, and enforces the configured page and record caps.
6. Record only the sync-run identifier, outcome, counts, and timestamps. Verify that the control tenant has no new JobNimbus rows.
7. Return `INTEGRATIONS_JOBNIMBUS_CANARY_ENABLED=false` after the canary.

If either probe fails, do not import. Record the endpoint, HTTP status, and sanitized error category (`authentication`, `authorization`, `rate_limit`, `upstream`, or `invalid_response`) without copying response bodies into logs or tickets.

## Status mapping and reconciliation

Reconciliation for approved read vendors prefers `external_lead_id`, then normalized phone, then normalized email. The selected match method is shown in `reconciled_lead_routes`.

Raw statuses never become canonical implicitly. Add a `vendor_status_mappings` row only after reviewing the vendor value. Keep `mapping_basis='assumed'` while the mapping is provisional; change it to `confirmed` after the business owner approves it. LeadMaster “Demo Complete” and JobNimbus “Appointment Complete” must remain separate unless explicitly confirmed.

JobNimbus is not marked authoritative by schema. Its lifecycle role remains an operational decision, and `source_system` stays explicit.

## Failure handling

- Authentication and authorization failures do not retry indefinitely and are stored only as categories.
- Rate limits and transient 5xx responses retry with bounded exponential backoff.
- One vendor’s failure does not stop the other vendor pulls.
- Re-running within the same 30-minute UTC slot is skipped by the unique sync key.
- Approved read sources use idempotent upserts across their bounded read window.

## Verification

Run:

```sh
npm run lint
npm run typecheck
npm run test:run
npm run db:test
npm run test:integration
npm run build
```

Before a live demo, preserve only non-sensitive evidence: migration version, sync-run IDs, record counts, timestamps, and screenshots with homeowner PII obscured.

## Open decisions

- Confirm whether JobNimbus is the sold/job system of record before any authoritative constraint or status rule is added.
- Confirm the account-specific JobNimbus appointment/calendar representation. The current normalizer surfaces appointment fields returned with jobs; custom task/calendar fields may require an additional read endpoint after discovery.
- No write-back approval exists. Do not add vendor writes or production routing changes under this runbook. LeadConduit direct-receipt preparation remains separately approval-gated.

# JobNimbus authenticated canary design

## Purpose

Add a safe staging-only workflow that proves the configured JobNimbus credential and resource paths work before recurring ingestion is enabled. The workflow must never expose customer values in its connection-test response, must remain read-only against JobNimbus, and must bind every database write to the signed-in administrator's company.

## Scope

The change adds two authenticated actions to the existing JobNimbus drill-down at `/access-route/jobnimbus`:

1. **Test JobNimbus connection** performs a one-record read of contacts and jobs and reports sanitized metadata.
2. **Import limited sample** rechecks both resources, then imports a capped sample into the authenticated administrator's staging tenant.

Recurring JobNimbus ingestion remains disabled. No JobNimbus create, update, or delete operation is permitted. Financial data remains excluded.

## Security and authorization

- Both actions execute only on the server and require a valid Supabase user session.
- The server looks up the user in `admin_profiles` and derives `company_id` from that row.
- The client cannot submit or override a company ID.
- A missing session or admin profile returns a generic unauthorized result and performs no vendor request or database write.
- `JOBNIMBUS_API_KEY` remains a server-only Vercel sensitive variable and is never returned, logged, or embedded in rendered HTML.
- JobNimbus responses are processed server-side. The probe response contains only HTTP status, record count, and sorted field names from the first record.
- Errors are reduced to non-sensitive categories such as authentication, authorization, rate limit, invalid response, or upstream failure.

## JobNimbus request behavior

The JobNimbus client continues to use Bearer authentication and HTTP `GET` exclusively.

Connection probes use:

- Contacts: the configured contacts path with `size=1` and `from=0`.
- Jobs: the configured jobs path with `size=1` and `from=0`.

Each resource result contains:

- resource name;
- HTTP status;
- success boolean;
- number of returned records;
- alphabetically sorted top-level field names from the first returned record;
- sanitized error category when unsuccessful.

No record values are included.

## Import limits

Add two validated server environment variables:

- `JOBNIMBUS_PAGE_LIMIT`, positive integer, maximum 500, default 50.
- `JOBNIMBUS_MAX_PAGES`, positive integer, maximum 25, default 1.

The shared pagination helper accepts explicit limits. The scheduled reader will use the configured values when eventually enabled, while the probe always uses one record and one page.

The initial staging configuration will be:

```text
JOBNIMBUS_PAGE_LIMIT=50
JOBNIMBUS_MAX_PAGES=1
INTEGRATIONS_JOBNIMBUS_ENABLED=false
INTEGRATIONS_JOBNIMBUS_CANARY_ENABLED=true
JOBNIMBUS_INCLUDE_SOLD_VALUE=false
```

With these settings, one canary imports at most 50 contacts and 50 jobs.

## Canary import flow

The import action performs these steps as one explicit operator action:

1. Authenticate and resolve the administrator's company.
2. Probe contacts and jobs with one-record requests.
3. Stop without persistence if either probe fails.
4. Fetch contacts and jobs using the configured page and page-count caps.
5. Normalize through the existing JobNimbus normalizers.
6. Upsert contacts by `(company_id, contact_id)` and jobs by `(company_id, job_id)`.
7. Record a JobNimbus `integration_sync_runs` entry with canary metadata, records seen, records written, and sanitized outcome.
8. Return counts only to the UI.

The import does not depend on `INTEGRATIONS_JOBNIMBUS_ENABLED`; that flag controls only scheduled ingestion. The manual path additionally requires the default-off `INTEGRATIONS_JOBNIMBUS_CANARY_ENABLED` gate, authentication, admin membership, tenant derivation, and the explicit button action.

Repeated imports are idempotent because the existing upsert keys remain unchanged.
Contact and job upserts are not a cross-table database transaction. If one persistence step fails after the other succeeds, the run is recorded as failed and the operator can safely rerun the canary without creating duplicates.

## User interface

The JobNimbus drill-down adds a compact connection panel above the records table.

- **Test JobNimbus connection** is available to an authenticated admin only while `INTEGRATIONS_JOBNIMBUS_CANARY_ENABLED=true`.
- The result lists Contacts and Jobs with success/failure, HTTP status, record count, and field names.
- **Import limited sample** becomes available only after both probes succeed in the current page session.
- The server independently reruns the probes before importing; client state is never trusted as authorization or safety proof.
- Import results display contacts seen/written, jobs seen/written, and the sync-run outcome.
- No homeowner or job values appear in either action result.

## Error handling

- `401` maps to `authentication`.
- `403` maps to `authorization`.
- `429` maps to `rate_limit`.
- Invalid JSON maps to `invalid_response`.
- Other non-success responses and network failures map to `upstream`.
- A failed probe prevents import.
- A persistence or normalization failure records `persistence_or_mapping` without leaking vendor payloads.
- Existing bounded retries for rate limits and transient upstream failures remain available to imports; authentication, authorization, and invalid-response failures do not retry indefinitely.

## Testing

Implementation follows test-driven development. Tests will prove:

- probe requests use only `GET`, `size=1`, `from=0`, and Bearer authentication;
- probe responses contain field names but no field values;
- invalid JSON and relevant HTTP statuses map to sanitized categories;
- unauthenticated and non-admin callers cannot probe or import;
- company ID comes from `admin_profiles`, never request input;
- import stops when either probe fails;
- configured import limits cap contacts and jobs at 50 records and one page;
- the manual canary works while `INTEGRATIONS_JOBNIMBUS_ENABLED=false`;
- normalization and upsert behavior remains idempotent;
- the full existing verification suite remains green.

## Deployment and acceptance

1. Add the two limit variables and the dedicated canary flag to the PIW staging deployment. Keep both scheduled ingestion and the canary false until the controlled test window.
2. Deploy the implementation to the existing PIW staging host.
3. Sign in as the staging administrator.
4. Run **Test JobNimbus connection**.
5. Continue only if both contacts and jobs succeed.
6. Run one limited sample import.
7. Verify the resulting `integration_sync_runs` row and confirm no more than 50 contacts and 50 jobs were written for the primary staging tenant.
8. Verify tenant isolation and confirm the JobNimbus API received only `GET` requests.
9. Return `INTEGRATIONS_JOBNIMBUS_CANARY_ENABLED=false` after the canary window.

The recurring JobNimbus schedule remains disabled after acceptance. Enabling it requires a separate explicit decision.

## Out of scope

- JobNimbus writes or webhook registration.
- Enabling recurring JobNimbus ingestion.
- Importing financial, margin, profit, commission, or sold-value data.
- Treating JobNimbus as the authoritative sold/job system.
- Mapping account-specific appointment fields beyond reporting the fields returned by the canary.

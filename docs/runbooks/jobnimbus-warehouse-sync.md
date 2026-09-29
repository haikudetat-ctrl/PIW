# JobNimbus warehouse sync

Read-only JobNimbus sync that feeds the customer journey dashboard. Ported
from `haikudetat-ctrl/2stack-roof-quote` (`lib/integrations/jobnimbus/*`),
where it has run hourly against the All Season account since September 2026.
That repository's `docs/jobnimbus.md` is the field guide to the JobNimbus API
and applies unchanged.

It replaces the `access-route` JobNimbus reader, which never ran in
production. That reader and its `jobnimbus_contacts` / `jobnimbus_jobs` tables
are removed in a follow-up once this sync is verified.

## What it does

Every hour at minute 17 (America/New_York), for each company with an enabled
`company_integrations` row, the `jobnimbus-warehouse-sync` Inngest function
syncs contacts, then jobs, then estimates:

1. **Mode.** A full scan when no full scan has completed or the last one is
   more than 24 hours old; otherwise an incremental scan on `date_updated`
   with a 48-hour overlap. The full scan is the daily reconciliation: a run
   whose record count differs from JobNimbus's total is marked
   `reconcile_mismatch` and lands nothing.
2. **Filter proof.** JobNimbus answers 200 to filters it ignores, so every
   incremental run first asks for records updated a year in the future and
   fails unless zero come back.
3. **Raw landing.** `land_jobnimbus_batch` upserts into `jobnimbus_records`
   keyed by `(company_id, jnid)` with a content hash. Older reads never
   overwrite newer versions, and the watermark never moves backwards.
4. **Projection.** `jn_contacts`, `jn_jobs` and `jn_estimates` are rebuilt from
   raw rows. Contact phone and email use the same normalization as PIW leads,
   so they match `leads.phone_e164` and `leads.email_normalized`.
5. **Bookkeeping.** Every run writes a `jobnimbus_sync_runs` row with counts,
   API calls, rate-limit responses, and a sanitized error category.

Requests are serial and paced at 350 ms with exponential backoff on 429 and
5xx. The function runs with a concurrency limit of one. Custom fields are
read by their stable `cf_*` key through `company_integrations.field_map`,
never by display name.

All tables are deny-all to `anon` and `authenticated`; only the service role
reads or writes them until role-scoped dashboard access is added.

## Enable for All Season

1. Deploy the migration `20260929160000_jobnimbus_warehouse.sql` and confirm
   it appears in migration history.
2. Confirm `JOBNIMBUS_API_KEY` is set in PIW Production. It is the same
   read-only key 2stack-roof-quote uses.
3. Create the integration row, disabled. The field map is copied from
   2stack-roof-quote's All Season integration; the earliest All Season
   JobNimbus record is from June 2025.

   ```sql
   insert into public.company_integrations
     (company_id, provider, env_key_name, field_map, history_start, enabled)
   values (
     '<All Season company UUID>',
     'jobnimbus',
     'JOBNIMBUS_API_KEY',
     '{"cf_string_12": "shingle_line", "cf_string_13": "job_type"}',
     '2025-06-01T00:00:00Z',
     false
   );
   ```

4. Set `INTEGRATIONS_JOBNIMBUS_SYNC_ENABLED=true` in PIW Production and
   redeploy so Inngest registers the function.
5. Enable the row: `update public.company_integrations set enabled = true
   where company_id = '<All Season company UUID>' and provider = 'jobnimbus';`
6. After the next run, verify with aggregate queries only:

   ```sql
   select record_type, mode, status, records_seen, records_changed,
          api_calls, rate_limit_error_count, error, started_at
   from public.jobnimbus_sync_runs
   order by started_at desc
   limit 10;

   select status_name, count(*)
   from public.jn_jobs
   group by status_name
   order by count(*) desc;
   ```

   Job, contact and estimate counts should match 2stack-roof-quote's
   `jn_jobs` and raw record counts within the last hour's changes.

## Rollback

Set `enabled = false` on the integration row, or set
`INTEGRATIONS_JOBNIMBUS_SYNC_ENABLED=false` and redeploy. Warehouse rows are
left in place; they are read-only copies and rebuild from JobNimbus on the
next full scan.

## Adding another company

Each JobNimbus account needs its own key and field map. Store the key as
`JOBNIMBUS_API_KEY_<NAME>` (the database only accepts names of that form),
derive the `cf_*` mapping by comparing `cf_*` keys with their display aliases
in one sampled record, and insert a row as above.

# SQL sandbox

Runs `supabase/migrations/20261025120000_google_search_ads_attribution.sql`
and its pgTAP test on a plain Postgres 17 when the Supabase stack (Docker,
PostGIS) is not available. `google_ads_stub_schema.sql` stands in for the
tables the migration touches; `pgtap_shim.sql` implements the handful of
pgTAP functions the tests use. CI still runs the real test with
`npm run db:test`.

```bash
PGHOST=/tmp PGPORT=55432 PGUSER=postgres scripts/sql-sandbox/run.sh
```

`sandbox-only.test.sql` covers cases that need fixtures the full schema makes
expensive (roof assessments, admin profiles).

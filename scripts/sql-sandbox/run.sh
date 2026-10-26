#!/usr/bin/env bash
# Runs the Google Search Ads migration and its pgTAP test against a throwaway
# database on a plain Postgres 17 (no PostGIS or Supabase stack needed).
#   PGHOST=/tmp PGPORT=55432 PGUSER=postgres scripts/sql-sandbox/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
db="google_ads_sandbox_$$"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "create database $db"
trap 'psql -q -d postgres -c "drop database if exists $db" >/dev/null' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$here/google_ads_stub_schema.sql"
psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/migrations/20261025120000_google_search_ads_attribution.sql"
psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$here/pgtap_shim.sql"
psql -v ON_ERROR_STOP=1 -q -t -d "$db" -f "$root/supabase/tests/google-search-ads.test.sql" | grep -E "not ok|RESULT|PLAN|FAILED" || true
psql -v ON_ERROR_STOP=1 -q -t -d "$db" -f "$here/sandbox-only.test.sql" | grep -E "not ok|RESULT|PLAN|FAILED" || true

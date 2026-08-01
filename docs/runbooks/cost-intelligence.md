# All Season cost intelligence

The cost worker runs through Inngest at 9:00 AM and 9:00 PM in
`America/New_York`. It uses a calendar-month budget of $1,500 and sends a
digest to the Slack incoming webhook configured for `#rake-ops-alerts`.

## Accuracy model

- **Invoice**: Google Cloud Billing export and DigitalOcean invoice preview.
- **Provider meter**: Vercel billing charges and application request counters.
- **Rate card**: known monthly resource commitments such as Droplet compute.
- **Manual estimate**: Supabase plan, compute, and usage values. Supabase's
  supported Management API does not expose the dashboard's Upcoming Invoice,
  so reconcile these values against the invoice once per month.

Application API telemetry is shown beside provider billing but contributes $0
to the consolidated total. This avoids counting a Google request once in
`provider_cost_entries` and again in Google Cloud Billing.

## Required production settings

Set these as encrypted Vercel production environment variables on the `piw`
project. Do not add tokens to `.env` or commit them.

| Variable | Value |
| --- | --- |
| `COST_INTELLIGENCE_ENABLED` | `true` after every collector below is configured |
| `COST_MONTHLY_BUDGET_USD` | `1500` |
| `SLACK_COST_DIGEST_WEBHOOK_URL` | Incoming webhook restricted to `#rake-ops-alerts` |
| `VERCEL_TEAM_ID` | `team_MXcG1DR2Kt0Po6YyfhPe9zPB` |
| `VERCEL_API_TOKEN` | Token that can read team billing usage |
| `DIGITALOCEAN_TOKEN` | Token with `billing:read` and `droplet:read` |
| `GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON` | Minified service-account JSON |
| `GOOGLE_CLOUD_BILLING_PROJECT_ID` | Project used to run the BigQuery job |
| `GOOGLE_CLOUD_BILLING_TABLE` | Full `project.dataset.table` export name |
| `SUPABASE_COST_CONFIG_JSON` | Versioned monthly plan/compute/usage snapshot described below |
| `COST_RESOURCE_MAP_JSON` | All Season resource allowlist and allocation map |

## Resource scope

Use this inventory as the starting `COST_RESOURCE_MAP_JSON`. Charges carrying a
different Vercel, Google, or DigitalOcean resource ID are excluded instead of
silently being assigned to All Season.

```json
{
  "vercel:prj_CZO7VM61En70UCOeUbqLwwyZbEDa": { "environment": "production", "allocationBucket": "piw" },
  "vercel:prj_GOGruhncNZVjZKD9eL2MuvjeS7T7": { "environment": "production", "allocationBucket": "rake_website" },
  "vercel:prj_6QoV2fgSZavsirsd9cSSWNxsECsB": { "environment": "staging", "allocationBucket": "all_season_demo" },
  "vercel:prj_Q1OFGDTqvlDAlAYXxZIZePdJCtpP": { "environment": "staging", "allocationBucket": "all_season_demo" },
  "vercel:prj_8ypeJAUL9WLr3iyAlN6U9IYgtZAp": { "environment": "production", "allocationBucket": "all_season_webpage" },
  "digitalocean:589252224": { "environment": "production", "allocationBucket": "n8n_production" }
}
```

Add the QA Droplet ID and Google billing project IDs before enabling the worker.

## Supabase allocation

Supabase bills the organization rather than each project. Keep resource compute
direct, then allocate the shared plan and compute credit in proportion to All
Season's active projects. Review this JSON when projects, compute sizes, or
usage change.

```json
{
  "organizations": [{
    "slug": "japzqnjlknvqfzzcbdrb",
    "name": "All Season allocated Supabase",
    "planMonthlyUsd": 10,
    "computeCreditsUsd": 4,
    "projects": [
      { "ref": "kljrgnfwrcbbiualgufd", "name": "allseason-revops-hub", "environment": "production", "computeMonthlyUsd": 10 },
      { "ref": "prtcoeznzbbcijwzgcpu", "name": "allseason-revops-staging", "environment": "staging", "computeMonthlyUsd": 10 }
    ],
    "usage": []
  }]
}
```

## Google Cloud Billing export

Enable the standard or detailed Cloud Billing export to BigQuery. Grant the
worker service account `roles/bigquery.jobUser` on the query project and
`roles/bigquery.dataViewer` on only the billing dataset. Add each All Season
Google project to `COST_RESOURCE_MAP_JSON` as `google_cloud:<project-id>`.

## Operations

The collection slot is unique by Eastern date and hour, so Inngest retries do
not produce duplicate messages. A partially configured or failed provider is
shown in the digest and stored in `cost_collection_runs`; successful facts are
stored in `cost_line_items`. Review provider dashboards whenever the worker
reports stale or missing data, and reconcile the calendar month against final
invoices before closing the month.

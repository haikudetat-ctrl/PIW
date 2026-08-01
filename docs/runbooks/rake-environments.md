# Rake staging and production

This runbook maps the Rake / All Season engineering brief to the repository.

## Environment boundaries

| Concern | Staging | Production |
|---|---|---|
| n8n | Dedicated Droplet, Postgres volume, encryption key, hostname | Separate Droplet, Postgres volume, encryption key, hostname |
| Supabase | `allseason-revops-staging` (`prtcoeznzbbcijwzgcpu`) | `allseason-revops-hub` (`kljrgnfwrcbbiualgufd`) |
| Website | Vercel preview project/environment | Vercel production deployment from `main` |
| Workflow source | Imported/exported from `n8n/workflows` | Reviewed exports from `main` only |

Never implement staging as another schema in the production Supabase project.

## Supabase deployment audit

Before deploying any of the legacy brief files, inspect migration history and
query for the tables/functions they create. Do not rerun a schema file merely
because its filename is absent from migration history: it may have been applied
through the SQL editor.

The brief references `roof-lookup-schema.sql`, `speed-to-lead-schema.sql`, and
`meta-capi-schema.sql`, but those source files were not supplied in this repo.
Production's actual migration history contains `revops_stage1_schema`,
`advisor_cleanup`, and `website_quote_engine`; those exact migrations were
deployed to staging on 2026-08-01. Schema dumps confirmed the same 18 public
tables in both environments. The missing named files are still required before
their contents can be independently audited or deployed.

Deploy checked-in migrations with a dry run first:

```bash
npx supabase link --project-ref <staging-ref>
npx supabase db push --dry-run
npx supabase db push
```

Repeat against production only after staging tests and database advisors pass.

## AI content cache

`supabase/migrations/20260801162720_ai_content_cache.sql` enables pgvector,
creates an RLS-protected cache, and exposes a service-only lookup that prefers
an approved exact context key before cosine similarity. The pgTAP suite inserts
and retrieves both exact and semantic fixtures.

## Vendor inventory gap

The source workbook `allseasonvendorinventory.xlsx` is required before any
backfill. Do not invent owners or next actions. Once supplied, reconcile the
Master Index into `vendor_systems`, then run:

```sql
select id, name, owner_approver, immediate_next_action
from public.vendor_systems
where active
  and (owner_approver is null or immediate_next_action is null);
```

Every remaining row must have a documented, reviewed reason before acceptance.

## Website intake verification

Set the website preview variables to the staging n8n intake webhook. Submit a
test lead containing a unique email, then verify the resulting staging row and
the Meta attribution fields. The API returns `202` only after the upstream
webhook accepts the payload.

## Alerts

- Import `n8n/workflows/slack-execution-failure.json` and select it as the
  global error workflow on each n8n instance.
- Add an incoming webhook for `#rake-ops-alerts` (`C0BMGN8JY9J`) as the
  `SLACK_DEPLOY_WEBHOOK_URL` GitHub Actions secret for Vercel deployment status
  messages, and use the same channel for the n8n alert webhook.
- Configure DigitalOcean host health alerts in the control panel after each
  Droplet exists; the installed connector does not expose alert-policy APIs.

Trigger one controlled failure per integration and retain its Slack timestamp
as deployment evidence.

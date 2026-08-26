# Deployment runbook

Procedure for standing up the PIW foundation in Supabase, Inngest, and
Vercel. Account-level changes require an authenticated operator or connector;
the checked-in migrations and CI gates remain the source of truth.

## Current PIW staging semantics

As of August 14, 2026, `https://piw-sepia.vercel.app` is the dedicated PIW staging application even though Vercel labels its deployment target `Production`. Its database is the dedicated Supabase staging project `qituolbocxnoxcmkqrva`. Do not interpret the Vercel target label as authorization for customer production traffic, and do not substitute an older project reference from another runbook.

## 1. Create Supabase projects

Create two Supabase projects: one for **production** and one for **preview**.
Note each project's URL, publishable key, and service role key.

## 2. Push the schema

Link the CLI to each project and push migrations, dry-running first:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push --dry-run
npx supabase db push
```

Do this for both the preview and production projects. Never run
`supabase db reset --linked` against either — it is destructive and wipes
the remote database.

## 3. Create the first admin

For each environment, create the first Supabase Auth user (email + password,
auto-confirmed) through the Supabase dashboard, then insert a matching row
into `admin_profiles` for the seeded company (or a company you create for
that environment) via the SQL editor:

```sql
insert into public.admin_profiles (id, company_id, display_name)
values ('<user-uuid>', '<company-uuid>', 'Admin Name');
```

There is no self-service sign-up; every admin is provisioned this way.

## 4. Configure Inngest

Create an Inngest app, and generate an event key and a signing key. These
map to `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`.

## 5. Configure Vercel environment variables

Set these per environment (Production / Preview) in the Vercel project
settings — never with the `NEXT_PUBLIC_` prefix for the service role or
signing keys, since that prefix ships the value to the browser bundle:

| Variable | Production | Preview |
|---|---|---|
| `NODE_ENV` | `production` | `production` |
| `DEPLOYMENT_ENV` | `production` | `preview` |
| `NEXT_PUBLIC_SUPABASE_URL` | prod project URL | preview project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | prod publishable key | preview publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | prod service role key | preview service role key |
| `INNGEST_EVENT_KEY` | prod event key | preview/dev event key |
| `INNGEST_SIGNING_KEY` | prod signing key | preview/dev signing key |
| `PAID_PROVIDERS_ENABLED` | `true` to process consented estimates | `false` (enforced — preview cannot enable paid providers) |
| `ACCESS_ROUTE_COMPANY_ID` | server-bound staging tenant UUID | preview tenant UUID or blank |
| `INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED` | `false` until separately approved | `false` |
| `INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RECEIVER_ENABLED` | `false` until separately approved | `false` |
| `LEADCONDUIT_ROOFING_FLOW_ID` / `LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID` | exact approved flow IDs | blank |
| `LEADCONDUIT_*_WEBHOOK_TOKEN` / `_NEXT` / `_NEXT_EXPIRES_AT` | server-only per-flow values | separate synthetic values or blank |
| `INTEGRATIONS_LEADMASTER_ENABLED` | `false` until read approval | `false` |
| `INTEGRATIONS_JOBNIMBUS_ENABLED` | `false` until recurring-read approval | `false` |
| `INTEGRATIONS_JOBNIMBUS_CANARY_ENABLED` | `true` only during an attended staging canary | `false` |
| `JOBNIMBUS_API_KEY` / `JOBNIMBUS_BASE_URL` / paths | read-only staging credential and `/api1` paths | blank |
| `JOBNIMBUS_PAGE_LIMIT` / `JOBNIMBUS_MAX_PAGES` | `50` / `1` for a canary | `50` / `1` |
| `JOBNIMBUS_INCLUDE_SOLD_VALUE` | `false` | `false` |
| `INTEGRATIONS_CALLTOOLS_ENABLED` | `false` | `false` |
| `GOOGLE_MAPS_API_KEY` | server-restricted key with Places API (New), Solar API, and Maps Static API access | blank |
| `GOOGLE_MAPS_BROWSER_API_KEY` | browser key restricted by HTTP referrer; Maps JavaScript API + Places API (New) only | preview-domain browser key or blank |
| `ROOF_ESTIMATE_COMPANY_ID` | company UUID receiving public leads | preview company UUID if form testing is needed |
| `ALL_SEASON_INTAKE_COMPANY_ID` | company UUID receiving All Season website leads | preview company UUID |
| `ALL_SEASON_INTAKE_SHARED_SECRET` | random secret expected from the All Season website deployment | separate preview secret |
| `ESTIMATE_SMS_WEBHOOK_URL` | approved SMS provider/automation webhook | test endpoint or blank |
| `ESTIMATE_EMAIL_WEBHOOK_URL` | approved email provider/automation webhook | test endpoint or blank |
| `ESTIMATE_DELIVERY_SHARED_SECRET` | bearer secret expected by both delivery webhooks | separate preview secret |
| `SLACK_CONTEXT_DIALER_WEBHOOK_URL` | incoming webhook for the dedicated Context Dialer channel | separate QA channel webhook or blank |
| `COST_INTELLIGENCE_ENABLED` | `true` after billing collectors and Slack are configured | `false` |
| `COST_MONTHLY_BUDGET_USD` | `1500` | `1500` |
| `SLACK_COST_DIGEST_WEBHOOK_URL` | incoming webhook for `#rake-ops-alerts` | blank |
| `VERCEL_API_TOKEN` / `VERCEL_TEAM_ID` | team billing-read credentials | blank |
| `DIGITALOCEAN_TOKEN` | token scoped to `billing:read` and `droplet:read` | blank |
| `GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON` | BigQuery billing-export reader | blank |
| `GOOGLE_CLOUD_BILLING_PROJECT_ID` / `GOOGLE_CLOUD_BILLING_TABLE` | billing export query target | blank |
| `SUPABASE_COST_CONFIG_JSON` / `COST_RESOURCE_MAP_JSON` | scoped rate card and resource inventory | blank |
| `CONTEXT_DIALER_BASE_URL` | stable application origin, such as `https://piw-sepia.vercel.app` | preview origin when Slack QA is enabled |

On the separate All Season website project, set:

- `INTAKE_WEBHOOK_URL` to `https://<matching-piw-domain>/api/integrations/all-season/intake`.
- `CAMPAIGN_ESTIMATE_WEBHOOK_URL` to `https://<matching-piw-domain>/api/integrations/all-season/campaign-estimate`.
- `PIW_PUBLIC_APP_URL` to the same matching PIW origin so accepted campaign submissions continue to the homeowner result.
- `INTAKE_WEBHOOK_SHARED_SECRET` to the matching PIW shared secret.
- `GOOGLE_PLACES_API_KEY` to the server-restricted Places API (New) key used by campaign address autocomplete.

Never point a preview website deployment at PIW production. The campaign
webhook URL and public result origin must always target the same PIW environment.

Use separate Google keys. Restrict `GOOGLE_MAPS_API_KEY` to Places API (New),
Solar API, and Maps Static API, and never expose it to the browser. Restrict
`GOOGLE_MAPS_BROWSER_API_KEY` by HTTP referrer (for example,
`https://piw-sepia.vercel.app/*`) and by API to Maps JavaScript API and Places
API (New). The form falls back to manual address entry when the browser key is
not configured or Google cannot load.

The generic vendor webhook is intentionally hard-disabled and has no shared-secret setting. LeadMaster and JobNimbus flags control scheduled reads only. Remove obsolete `INTEGRATIONS_LEADCONDUIT_ENABLED` and `INTEGRATIONS_WEBHOOK_SHARED_SECRET` values from deployment configuration if present; neither authorizes a receiver.

## 6. Connect GitHub to Vercel

Import the repository into Vercel with the Next.js framework preset. Confirm
the project's Node.js version is pinned to 24.x in Vercel's project settings
to match `package.json`'s `engines.node`.

## 7. Require CI before merging

In GitHub branch protection for `main`, require the `website`, `application`,
and `database` jobs from `.github/workflows/ci.yml` to pass before merging.

## 8. Deploy and verify Inngest sync

After the first deploy, confirm Inngest's dashboard shows the app synced and
includes `address-validation-worker`, `roof-estimate-worker`,
`estimate-delivery-sender`, and `publish-outbox`. If it does
not sync automatically, trigger a manual sync from the Inngest dashboard
against `https://<your-domain>/api/inngest`.

## 9. Run and retain a diagnostic event

Sign in as the provisioned admin and use the **Foundation diagnostics**
panel's "Run diagnostic" button. Confirm it reports "Completed" with a
correlation ID, and record that correlation ID as the first verified
production (or preview) run.

Before opening public estimate traffic, set a Google Cloud budget alert and
keep the Solar API project quota at or below the intended ceiling. PIW's
database reservation gate stops new Building Insights requests after 9,500 in
the calendar month; cached addresses do not consume another reservation.

## 10. Verify backups and recovery ownership

Confirm Supabase's automatic backup schedule is enabled for the production
project, and record who owns recovery procedures for this project.

# Deployment runbook

Procedure for standing up the PIW foundation in Supabase, Inngest, and
Vercel. Account-level changes require an authenticated operator or connector;
the checked-in migrations and CI gates remain the source of truth.

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
| `GOOGLE_MAPS_API_KEY` | server-restricted key with Places API (New), Solar API, and Maps Static API access | blank |
| `GOOGLE_MAPS_BROWSER_API_KEY` | browser key restricted by HTTP referrer; Maps JavaScript API + Places API (New) only | preview-domain browser key or blank |
| `ROOF_ESTIMATE_COMPANY_ID` | company UUID receiving public leads | preview company UUID if form testing is needed |
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

Use separate Google keys. Restrict `GOOGLE_MAPS_API_KEY` to Places API (New),
Solar API, and Maps Static API, and never expose it to the browser. Restrict
`GOOGLE_MAPS_BROWSER_API_KEY` by HTTP referrer (for example,
`https://piw-sepia.vercel.app/*`) and by API to Maps JavaScript API and Places
API (New). The form falls back to manual address entry when the browser key is
not configured or Google cannot load.

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

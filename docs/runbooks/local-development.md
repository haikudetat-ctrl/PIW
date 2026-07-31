# Local development runbook

Reproducible steps to run the PIW foundation locally from a clean checkout.

## Prerequisites

- Node.js 24.x and npm 11.x
- Docker (required by the Supabase CLI to run Postgres, Auth, and Storage locally)

## Bootstrap

```bash
npm ci
npm run db:start
npm run db:reset
cp .env.example .env.local
```

Fill in `.env.local` with the values printed by `npm run db:start` (or `npx supabase status -o env`):

- `NEXT_PUBLIC_SUPABASE_URL` — the local `API_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — the local `PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — the local `SECRET_KEY`

Also add, so the Inngest SDK talks to the local dev server instead of
attempting signed requests against Inngest Cloud:

```dotenv
INNGEST_DEV=1
```

`INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` can be any non-empty string
locally; they are not checked in dev mode.

To exercise the public roof-estimate workflow, also set:

```dotenv
PAID_PROVIDERS_ENABLED=true
GOOGLE_MAPS_API_KEY=<server-side-key>
GOOGLE_MAPS_BROWSER_API_KEY=<http-referrer-restricted-browser-key>
ROOF_ESTIMATE_COMPANY_ID=00000000-0000-4000-8000-000000000001
ESTIMATE_SMS_WEBHOOK_URL=<optional-test-webhook>
ESTIMATE_EMAIL_WEBHOOK_URL=<optional-test-webhook>
ESTIMATE_DELIVERY_SHARED_SECRET=<optional-shared-secret>
```

The public form is `/roof-estimate`. Provider calls occur only after all three
consents are recorded. If delivery webhooks are blank, composed SMS/email rows
remain queued and can be inspected without sending externally.

## Run the app

In separate terminals:

```bash
npx inngest-cli@latest dev
npm run dev
```

Then run the full local gate:

```bash
npm run verify
```

`verify` runs lint, typecheck, unit tests, the pgTAP database suite, local
Supabase integration tests, and a production build in sequence and exits
non-zero on the first failure. Integration tests obtain ephemeral local
credentials from `supabase status`; they do not require hosted-project
secrets.

## Create a local admin

The app is invitation-only: there is no sign-up form. Create the first local
admin through Supabase Studio (`npx supabase status` prints its URL, typically
`http://127.0.0.1:<studio-port>`):

1. In Studio, go to **Authentication → Users → Add user** and create a user
   with a password, with **Auto Confirm** enabled.
2. Copy the new user's UUID.
3. Insert an `admin_profiles` row linking that UUID to the seeded local
   company:

   ```sql
   insert into public.admin_profiles (id, company_id, display_name)
   values ('<user-uuid>', '00000000-0000-4000-8000-000000000001', 'Local Admin');
   ```

You can now sign in at `/login` with that user's email and password.

## Verify the vertical slice

With the app, Supabase, and the Inngest dev server running, sign in and use
the **Foundation diagnostics** panel's "Run diagnostic" button. It should
report "Completed" with a correlation ID within a few seconds of the
`publish-outbox` cron tick (every minute). The Inngest dev server dashboard
(`http://localhost:8288`) shows the diagnostic, address validation, Google roof
estimate, delivery sender, and outbox functions as discovered functions.

## Notes

- `supabase db reset` recreates the **local** database from the committed
  migrations and reseeds it. It is safe to run at any time locally.
- `supabase db reset --linked` targets a **remote, linked** project and is
  destructive. Never run it against production.
- Regenerate `src/lib/database.types.ts` after any migration change:

  ```bash
  npx supabase gen types typescript --local --schema public > src/lib/database.types.ts
  ```

  CI fails the `database` job if the committed types file drifts from what
  the migrations actually produce.

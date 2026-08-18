# All Season website

Standalone Next.js App Router website for campaign and content work. Vercel
should use `apps/website` as this project's root directory. PR branches produce
preview deployments; `main` is production.

The `/api/intake` route validates public form submissions, captures `fbclid`,
`_fbp`, and `_fbc`, and forwards the normalized payload to PIW's authenticated
All Season intake endpoint. It never exposes the PIW URL or shared secret to
browsers. Configure `INTAKE_WEBHOOK_URL` to the matching PIW environment and
use the same secret as PIW's `ALL_SEASON_INTAKE_SHARED_SECRET`.

```bash
cp .env.example .env.local
npm install
npm run dev
```

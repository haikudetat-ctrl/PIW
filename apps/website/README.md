# Rake website

Standalone Next.js App Router website for campaign and content work. Vercel
should use `apps/website` as this project's root directory. PR branches produce
preview deployments; `main` is production.

The `/api/intake` route validates public form submissions, captures `fbclid`,
`_fbp`, and `_fbc`, and forwards the normalized payload to the configured n8n
intake webhook. It never exposes the webhook URL or shared secret to browsers.

```bash
cp .env.example .env.local
npm install
npm run dev
```

# PIW

Property Intelligence Worker — a Next.js application, on Supabase/PostGIS and
Inngest, that gives a single New Jersey residential roofing company a
property-first CRM and intelligence platform.

PIW v1 supports New Jersey residential roofing and does not include weather
or storm intelligence.

## Documentation

- [Architecture design](docs/superpowers/specs/2026-07-29-property-intelligence-worker-architecture-design.md)
- [Foundation implementation plan](docs/superpowers/plans/2026-07-29-piw-foundation-implementation.md)
- [Local development runbook](docs/runbooks/local-development.md)
- [Deployment runbook](docs/runbooks/deployment.md)

## Local development

```bash
npm ci
npm run db:start
npm run db:reset
cp .env.example .env.local   # then fill in values, see the local-development runbook
npm run dev
npm run verify
```

See the [local development runbook](docs/runbooks/local-development.md) for
the full bootstrap procedure, including creating a local admin.

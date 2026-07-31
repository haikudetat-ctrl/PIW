# PIW

Property Intelligence Worker — a Next.js application, on Supabase/PostGIS and
Inngest, that gives a single New Jersey residential roofing company a
property-first CRM and intelligence platform.

PIW v1 supports New Jersey residential roofing and does not include weather
or storm intelligence.

Phase 2 adds lead intake, the pipeline board, the lead workspace, tasks,
interactions, and in-app notifications.

The current estimate intake at `/roof-estimate` captures explicit processing,
email, and SMS consent before PIW calls Google Geocoding and Google Solar
Building Insights. Measurements are cached for 180 days, Solar calls are
atomically capped at 9,500 per calendar month, and the result is priced at the
configured New Jersey baseline of $500–$750 per roofing square. PIW stores the
lead, evidence, estimate, and delivery state as the operational source of truth.

The earlier Census/NJGIN runtime adapters have been retired. Their historical
schema and records remain available for audit and older lead workspaces.

## Documentation

- [Architecture design](docs/superpowers/specs/2026-07-29-property-intelligence-worker-architecture-design.md)
- [Foundation implementation plan](docs/superpowers/plans/2026-07-29-piw-foundation-implementation.md)
- [CRM implementation plan](docs/superpowers/plans/2026-07-29-piw-crm-implementation.md)
- [Property Identity implementation plan](docs/superpowers/plans/2026-07-29-piw-property-identity-implementation.md)
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

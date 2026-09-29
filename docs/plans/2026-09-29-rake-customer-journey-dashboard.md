# Plan: Rake customer journey dashboard

Status: draft for owner review · Target: live in 14 days (hard limit 30)

## Goal

One view of every All Season customer from ad click to paid job, with tiered
access, built in Rake (this repository). Rake is the product that spans lead →
sale → nurture. 2Stack Roof Quote stays a standalone product and sales wedge.

## Decisions

| Question | Decision |
|---|---|
| Where the dashboard lives | Rake (this repo), extending the app shell. Not a BI tool. |
| JobNimbus owner inside Rake | Port 2Stack Roof Quote's proven sync into Rake. Retire PIW's `access-route` JobNimbus reader. |
| 2Stack Roof Quote | Stays standalone with its own JobNimbus sync and quote engine. No code merge in this window. |
| Sold set | `Signed Contract`, `Job Completed`, `Job Prep`, `Final Walk Through`, `Pending Payments` (confirmed). |
| Sold value | Shown. JobNimbus `approved_estimate_total`, falling back to `last_estimate`. |
| Stage ownership | LeadMaster: intake and scheduling. JobNimbus: sales → production handoff onward. |
| Filtered ActiveProspect leads | Tracked for possible recovery. |
| Sync cadence | 30–60 min polling. Real time only where PIW already sends. |
| Ad spend | Not ingested. Cost per sale uses a manually maintained per-source cost table. |
| Access tiers | SuperAdmin → CompanyAdmin → Manager → Employee. |

## Journey stages and their source of truth

| Stage | System | Signal |
|---|---|---|
| Source / ad | PIW | `leads.source_system`, `utm_*`, `original_lead_source`, website arrivals |
| Lead received | PIW, ActiveProspect | PIW lead row; LeadConduit source event |
| AP accepted / rejected / filtered | ActiveProspect | LeadConduit events API (read-only), with outcome and reason |
| Contacted | LeadMaster | Record status / last activity |
| Appointment set | LeadMaster | Opportunity status / appointment date |
| Appointment ran / no-show | LeadMaster, then JobNimbus | LeadMaster outcome; JobNimbus `Appointment Scheduled`, `No Show` |
| Handoff to sales | JobNimbus | Job created (`jnid`) |
| Quoted | JobNimbus | `Quoted`, estimates |
| Sold | JobNimbus | Sold set above, `date_status_change` |
| In production / complete | JobNimbus | `Job Prep`, `Final Walk Through`, `Job Completed` |
| Paid | JobNimbus | `Pending Payments` → completion. JobNimbus invoicing is unused on this account, so "paid" is inferred until a payment source is named. |

## Architecture

```
Meta / website ─┐
Other sources ──┼─▶ ActiveProspect flows ──(events API, read)──┐
PIW intake ─────┘         ▲                                     │
      │                   └──(submit, existing)── PIW           │
      ▼                                                         ▼
  PIW leads ───────────────┐                         leadconduit_events
  LeadMaster (read) ───────┼──▶ customer_identities ──▶ customer_journey_events ──▶ /journey
  JobNimbus (ported sync) ─┘         (canonical ID)          (one row per stage transition)
```

- **Canonical customer ID.** `customer_identities` links PIW lead IDs,
  LeadConduit lead IDs, LeadMaster record IDs and JobNimbus contact and job
  `jnid`s. Match order: known IDs → E.164 phone → normalized email → normalized
  address (via existing property identity). Ambiguous matches go to the
  existing review queue; never auto-merge on address alone.
- **Journey events.** Append-only `customer_journey_events`
  (`customer_id`, `stage`, `occurred_at`, `source_system`, `source_ref`).
  Every dashboard metric — funnel, handoff rates, time-in-stage, cost per sale
  — derives from this one table. It is rebuildable from the raw vendor tables.
- **PIW lead ID round-trip.** Add the PIW lead ID to outbound LeadConduit
  submissions so PIW's own leads are recognized when they come back.

## Porting the JobNimbus sync from 2Stack Roof Quote

Port, with their tests, from `haikudetat-ctrl/2stack-roof-quote`:

- `lib/integrations/jobnimbus/client.ts` — paging, date-window partitioning, 429 backoff, filter verification
- `lib/integrations/jobnimbus/sync.ts` — raw landing by `jnid` + content hash, watermarks with overlap
- `lib/integrations/jobnimbus/project.ts` — projection into `jn_jobs`, `jn_estimates`
- `lib/integrations/jobnimbus/reconcile.ts` — nightly count reconciliation
- Tables: `jobnimbus_records`, `jn_jobs`, `jn_estimates`, `sync_runs`, `sync_state`, and the `cf_*` field map

Adapt `account_id` to Rake's `company_id`, schedule through Inngest instead of
Vercel Cron, and keep roof-quote's `docs/jobnimbus.md` rules (bind to `cf_*`
keys, epoch-second dates, two workers max). Do not port Roofr report parsing or
the quote engine.

Remove PIW's `access-route` JobNimbus reader, canary UI, and
`jobnimbus_contacts` / `jobnimbus_jobs` tables once the port is verified. They
hold no production data.

Both apps will poll the same All Season JobNimbus account. At this volume an
hourly incremental pull is a handful of requests, so double-polling is
acceptable. Revisit if a rate limit appears.

## Tiered access

Today PIW has one role (every `admin_profiles` row is a full admin of one
company). Roof Quote has `2stack_admin` and `quote_user`. Neither has four
tiers.

| Role | Scope |
|---|---|
| SuperAdmin | All companies, integrations, configuration |
| CompanyAdmin | Everything in one company, including users and cost table |
| Manager | Their team's customers and aggregate company metrics — **to confirm** |
| Employee | Customers assigned to them — **to confirm** |

Implementation: a `company_memberships` table (`user_id`, `company_id`,
`role`, `manager_id`) replacing single-company `admin_profiles`, enforced in
RLS, not only in the UI. "Assigned to" needs a rep identity that maps across
PIW, LeadMaster and JobNimbus users.

## 14-day schedule

| Days | Work |
|---|---|
| 1–2 | Access: ActiveProspect read-only API key, LeadMaster API token. Roles and memberships migration. Retention policy draft. Fix the stuck lead distribution. |
| 3–5 | Port the JobNimbus sync and backfill. Revive the LeadConduit events reader for Roofing and Roofing Virtual Quote. Enable the LeadMaster reader if the token has arrived. |
| 5–8 | `customer_identities`, matching, `customer_journey_events`, status mappings, cost table. |
| 8–11 | `/journey`: funnel by source, stage-to-stage handoff rates, time in stage, cost per sale, revenue, rejected-lead recovery queue, per-customer timeline. Role-scoped. |
| 12–14 | Backfill, reconcile against JobNimbus and LeadMaster UI counts, owner acceptance, production. |
| 15–30 | ActiveProspect in-flow recipient (Phase C) if real time is needed; LeadMaster fallback if access slips; hardening. |

## Risks

- **LeadMaster access.** It owns contacted and appointment-set. PIW already has
  a reader for LeadMaster's web API, but it needs a token with API entitlement.
  Fallback: CSV export on a schedule, and JobNimbus appointment statuses for
  the stages after handoff.
- **Rep identity.** Employee-level scoping needs a rep mapping across three
  systems.
- **Retention.** Filtered-lead evidence needs an approved retention schedule
  before live candidate traffic (see the LeadConduit shadow recipient runbook).
- **Unversioned production code.** The live PIW deployment contains
  forgot-password pages that are not in git. Commit them before the next
  deploy from `main`.

## Open questions

1. What exactly may a Manager and an Employee see (own records, team, company aggregates, revenue)?
2. How are reps identified across LeadMaster and JobNimbus (email, name, user ID)?
3. Who is the LeadMaster admin who can request API access?
4. Can All Season's ActiveProspect admin issue a read-only API key?
5. What counts as "paid", given JobNimbus invoicing is unused?
6. Per-source costs: per-lead vendor price, monthly spend, or both?

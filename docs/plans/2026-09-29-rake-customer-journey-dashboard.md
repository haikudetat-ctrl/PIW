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
| ActiveProspect data path | No API key is available, so flow insertion (Phase C) is the primary path, with checkpoint recipients placed so filtered leads are visible. See below. |
| Rep identity | Supabase auth UID, with email as the matching key to LeadMaster and JobNimbus users. |
| Paid | Out of scope for v1. The journey ends at `Pending Payments` / `Job Completed`; QuickBooks is a later source. |
| Source costs | Both per-lead vendor price and monthly spend per source, in one cost table. |
| Sync cadence | 30–60 min polling. Real time only where PIW already sends. |
| Ad spend | Not ingested. Cost per sale uses a manually maintained per-source cost table. |
| Access tiers | SuperAdmin → CompanyAdmin → Manager → Employee. |
| LeadConduit flow edits | The owner has flow-edit rights and performs the Phase C insertion. |
| Retention of filtered-lead evidence | Approved 2026-09-29: contact details kept 30 days for delivered leads, 90 days for filtered leads, redacted daily. |
| LeadMaster data path | Owner-run scheduled exports, a few per day, uploaded into Rake. No API dependency in v1. |

## Journey stages and their source of truth

| Stage | System | Signal |
|---|---|---|
| Source / ad | PIW | `leads.source_system`, `utm_*`, `original_lead_source`, website arrivals |
| Lead received | PIW, ActiveProspect | PIW lead row; LeadConduit source event |
| AP accepted / rejected / filtered | ActiveProspect | Checkpoint recipients inserted in each flow (see below) |
| Contacted | LeadMaster | Record status / last activity |
| Appointment set | LeadMaster | Opportunity status / appointment date |
| Appointment ran / no-show | LeadMaster, then JobNimbus | LeadMaster outcome; JobNimbus `Appointment Scheduled`, `No Show` |
| Handoff to sales | JobNimbus | Job created (`jnid`) |
| Quoted | JobNimbus | `Quoted`, estimates |
| Sold | JobNimbus | Sold set above, `date_status_change` |
| In production / complete | JobNimbus | `Job Prep`, `Final Walk Through`, `Job Completed` |
| Paid | Not tracked in v1 | Likely QuickBooks. The v1 journey ends at `Pending Payments` / `Job Completed`. |

## Architecture

```
Meta / website ─┐
Other sources ──┼─▶ ActiveProspect flows ──(checkpoint recipients)─┐
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

## ActiveProspect without an API key: checkpoint recipients

A LeadConduit recipient only sees leads that reach its position in the flow,
so one recipient at the end cannot see filtered leads. Instead, insert
fail-open Custom JSON recipients at checkpoints in both the Roofing and
Roofing Virtual Quote flows:

| Checkpoint | Position | Tells us |
|---|---|---|
| `intake` | Immediately after source acceptance, before any filter | Every lead that entered the flow |
| `after_corelogic` | Already designed (after step 26 / 15) | Lead survived the early filters; CoreLogic outcome |
| `delivered` | After the last client destination | Lead was accepted and delivered |

A lead seen at `intake` but not at a later checkpoint within a time window
was filtered between those two points. Where a filter step exposes its
outcome and reason as step output, pass it in the next checkpoint's body.
Add a checkpoint before a specific filter only when a stage needs a precise
reason.

This extends the existing receiver (`/api/integrations/leadconduit/[flow]`,
`src/modules/access-route/leadconduit-shadow-receipt.ts`), which today accepts
only `after_corelogic`. It keeps the Phase C safety rules from
`docs/runbooks/leadconduit-shadow-recipient.md`: synthetic Test Flow first,
fail-open on timeout / non-2xx / network error, no reordering or editing of
existing steps, and rollback by disabling only the PIW recipients. The owner
has flow-edit rights and performs the insertion from a step-by-step checklist
that PIW's receiver work produces.

The events API reader stays a later option if an API key turns up.

## LeadMaster through scheduled exports

LeadMaster has no confirmed API path, so v1 uses exports the owner runs a few
times a day:

- **Upload page** at `/journey/imports` (CompanyAdmin and above): drop a CSV,
  see a preview of row counts and detected columns, confirm.
- **Idempotent.** Rows upsert on the LeadMaster record ID, so overlapping or
  repeated exports never duplicate. Each upload is an `integration_sync_runs`
  row with counts and outcome, like the API readers.
- **Validated headers.** The import is refused if a required column is
  missing or renamed, rather than silently loading nulls.
- **Stage events.** Status and appointment-date changes between uploads
  become `customer_journey_events`, so the journey stays accurate even though
  LeadMaster history arrives in snapshots.
- **Freshness shown.** The dashboard labels LeadMaster-owned stages with the
  last upload time.

Needs: one sample export per report type (header row plus a few rows with
contact details removed) to fix the column mapping. Later, if LeadMaster can
email scheduled reports, an inbound address can replace the manual upload
without changing the import logic.

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
| Manager | Every customer in their company, revenue and cost per sale; can reassign customers. Cannot manage users, integrations, or the cost table. |
| Employee | Only customers assigned to them, and their own KPIs. No company revenue or source costs. |

Implementation:

- `company_memberships` (`user_id`, `company_id`, `role`), replacing
  single-company `admin_profiles`. Existing `admin_profiles` rows migrate to
  `company_admin`; the owner account becomes `super_admin`.
- `rep_identities` (`user_id`, `source_system`, `external_user_id`, `email`):
  matched automatically by email, with a manual override for mismatches.
- `customer_assignments` derived from the LeadMaster and JobNimbus owner /
  sales-rep fields through `rep_identities`.
- Scope enforced in RLS and in the dashboard queries, not only in the UI.

## 14-day schedule

| Days | Work |
|---|---|
| 1–2 | Port the JobNimbus sync and backfill. Roles, memberships and rep identities migration. Retention policy draft. Fix the stuck lead distribution. Owner supplies sample LeadMaster exports. |
| 3–5 | Extend the LeadConduit receiver for checkpoints; owner runs Test Flow with synthetic leads, then enables in both flows. LeadMaster export upload and import. |
| 5–8 | `customer_identities`, matching, `customer_journey_events`, status mappings, cost table. |
| 8–11 | `/journey`: funnel by source, stage-to-stage handoff rates, time in stage, cost per sale, revenue, rejected-lead recovery queue, per-customer timeline. Role-scoped. |
| 12–14 | Backfill, reconcile against JobNimbus and LeadMaster UI counts, owner acceptance, production. |
| 15–30 | Automate LeadMaster exports if scheduled report emails exist; LeadConduit events API if a key turns up; hardening. |

## Risks

- **LeadMaster freshness.** Contacted and appointment-set are only as fresh
  as the latest manual export, and a missed export leaves a gap. The
  dashboard shows the last upload time; a stale-data banner appears after
  one business day without an upload. JobNimbus `Appointment Scheduled` /
  `No Show` cover the stages after handoff regardless.
- **Flow edits.** Filtered-lead visibility depends on inserting recipients
  into live client flows. A misconfigured recipient that is not fail-open
  could block lead delivery; the Test Flow gate exists for this reason.
- **Rep identity.** Employee-level scoping needs a rep mapping across three
  systems.
- **Unversioned production code.** The forgot-password pages in the live
  deployment are being committed in PR 57; merge it before the next deploy
  from `main`.

## Open questions

1. Sample LeadMaster exports: which reports exist (leads, opportunities, appointments), and their columns.

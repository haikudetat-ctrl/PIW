# Merge 2stack-roof-quote and the review/referral portal into PIW

**Date:** 2026-10-13
**Goal:** one product (Rake), one domain (`app.rake.2-stack.com`), one login, one
JobNimbus connection.

## Where things stand

| System | Supabase project | Role today |
|---|---|---|
| PIW | `qituolbocxnoxcmkqrva` | Staff CRM, kanban pipeline, estimates, CertainTeed catalog, JobNimbus warehouse |
| 2stack-roof-quote | `wkrbdpnprlvyhpcknnsr` | Quote engine, quote workspace + PDF, JobNimbus dashboards, Roofr report extraction |
| rake-review-referral-app | `wbimatafpieznmveybsg` | Homeowner portal, feedback/recovery, referrals (schema built, almost no data) |

**JobNimbus is synced twice today.** PIW and roof-quote both pull All Season's
account hourly with the same client (`client.ts` is byte-identical). PIW holds
2,716 jobs / 6,672 contacts / 3,526 estimates; roof-quote holds 2,718 / — / 3,541
plus 33,621 file records. JobNimbus is the source of truth, so its data is
re-pulled into PIW rather than copied.

What roof-quote has that PIW does not:

| Capability | PIW today | Plan |
|---|---|---|
| Jobs, contacts, estimates sync | ✅ Inngest, hourly | Keep |
| Reconcile (detect deletes / drift) | ✅ daily full scan fails on count mismatch | Keep |
| File records (`/files`) | ❌ excluded | **Step 1** |
| Roofr PDF → measured squares, pitch, waste | ❌ | **Step 1** |
| Census (field fill rates per sync) | ❌ | Step 3, with the Quality dashboard that reads it |
| Quote workspace + PDF | ❌ (Figma proposal builder designed) | Step 2 |
| Accuracy / production / revenue / quality dashboards | partial | Step 3 |

Unique roof-quote data and what happens to it:

| Data | Rows | Disposition |
|---|---|---|
| `measurement_truth` (Roofr) | 14 | Re-derived in PIW by re-running extraction on the same 28 Roofr PDFs, keyed by JobNimbus job instead of a roof-quote quote, so all ~20 readable reports count, not only the 14 that matched a quote |
| `jobnimbus_report_ingestions` | 23 | Re-derived (same) |
| `jobnimbus_quote_links` | 14 | All `normalized_address`; re-derivable against PIW properties in Step 3 |
| `quotes` / `leads` | 1,183 (208 approved) | Past-jobs dry run. Kept in the archived project; not migrated |
| `jobnimbus_records`, `jn_*` | 52k+ | Re-pulled from JobNimbus |

## Steps

Each step is its own PR. roof-quote keeps running until Step 4.

### Step 1 — JobNimbus files and Roofr extraction in PIW

- Sync `file` records alongside contact/job/estimate; project to `jn_files`.
- Port Roofr text extraction and parsing (`unpdf`) unchanged, with its tests and
  fixture.
- Store one row per processed Roofr file in `jobnimbus_roofr_reports`: outcome
  plus the measurement when ingested. Measurements key on the JobNimbus job, so
  no quote match is required.
- Process the newest Roofr file per job after each file sync, a bounded number
  per run, inside the existing single-concurrency Inngest function so JobNimbus
  never sees two of our clients at once.
- **Cut-over:** once PIW's Roofr outcomes cover the same files roof-quote
  processed, disable roof-quote's `/api/cron/jobnimbus` (Vercel cron) so a
  single sync remains.

### Step 2 — Proposal workspace in PIW

The roof-quote workspace and PDF become the **Proposal** step on a PIW lead,
following the Figma proposal builder: Good / Better / Best from the CertainTeed
catalog, measurements from Google Solar or Roofr, add-ons from adjustments, and a
PDF. The kanban pipeline stays the home view; roof-quote's
`/dashboard/pipeline/[jnid]` detail folds into the lead workspace.

### Step 3 — Reports

Accuracy (Google Solar vs Roofr), production, revenue and quality dashboards move
into PIW Reports. Census moves here with the Quality view that reads it.

### Step 4 — One domain, retire roof-quote

- `app.rake.2-stack.com` → PIW Vercel project (DNS is on Vercel). Add the origin
  to Supabase Auth redirect URLs.
- roof-quote's address redirects to the new domain; its Supabase project is
  paused, not deleted.

### Step 5 — Homeowner portal

rake-review-referral-app becomes PIW's homeowner portal (`/portal`): customers,
projects, feedback/recovery and referrals move onto PIW's `customers`, so a
referral is a PIW lead (the Figma "one customer, one thread"). Its JobNimbus
webhook folds into PIW's JobNimbus module. Homeowners sign in with magic link /
SMS OTP against the same Supabase Auth; RLS keeps them out of staff data. The
data to carry is small (2 organizations, 3 customers, 0 referrals).

## Single login

Steps 1–4 leave staff with one app and one login. Step 5 puts homeowners on the
same Supabase Auth with a separate, RLS-scoped role. No cross-project session
sharing is needed.

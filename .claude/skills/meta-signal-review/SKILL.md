---
name: meta-signal-review
description: Audit whether the Meta ads measurement loop is actually trustworthy before anyone reads it as performance. Grades every signal source (Supabase arrival/lead/CAPI ledgers, PostHog, Vercel, an optional Meta Ads Manager CSV export), computes conversion coverage and the funnel gaps between them, and writes a dated report to docs/audits/meta-signal-review/. Use when asked to review ad signals, check Meta tracking health, diagnose why Meta reports different numbers than PIW, audit conversion coverage or Event Match Quality, check CAPI delivery failures, or before committing or changing paid spend.
---

# Meta signal review

## What this skill is for

Before anyone decides that an ad is working, something has to establish that
the numbers describing it are real. That is this skill's only job.

It produces a graded, provenance-tagged audit of every signal source feeding
Meta ads decisions for All Season, and it writes the result to a dated report
in `docs/audits/meta-signal-review/`.

It is **not** a performance or budget-recommendation skill. It does not tell
you which ad to scale. It tells you whether you are entitled to an opinion
about that yet, and where the measurement is lying to you.

## The governing rule

> Every number in the report carries its source and that source's grade. No
> claim may rest on a source graded `DEGRADED`, `DARK`, `ABSENT`, or
> `UNKNOWN` without that grade stated in the same sentence.

This exists because the failure mode here is not missing data — it is
confident analysis of biased data. A consent-gated analytics source that sees
30% of traffic will produce clean-looking charts that are wrong by a factor of
three, and nothing in the chart says so.

When in doubt, downgrade. An over-cautious grade costs a sentence of hedging;
an over-confident one costs a budget.

## Hard constraints

These are not style preferences. Violating any of them is a failed run.

1. **Read-only, everywhere.** No `INSERT`, `UPDATE`, `DELETE`, `ALTER`,
   `CREATE`, no migrations, no Vercel env changes, no Meta Events Manager
   changes, no PostHog writes. This skill observes.
2. **Never select contact data.** `public.leads` holds `name`, `phone`,
   `email`, `submitted_address`, `phone_e164`, `email_normalized`,
   `client_ip_address`, `fbp`, `fbc`. Query them only inside aggregates
   (`count(*)`, `count(x) filter (...)`). Never `SELECT` them as rows, never
   put a value from them in the report, never paste one into the terminal.
   The delivery ledgers are deliberately PII-free — prefer them.
3. **No secrets in the report.** No `META_CAPI_ACCESS_TOKEN`, no
   `PRIVACY_CONSENT_SIGNING_SECRET`, no `META_TEST_EVENT_CODE`, no PostHog
   personal API key, no raw CAPI request or response body. Report that a
   variable is set or unset, never its value.
4. **The Meta CSV export is never committed.** It lives in the scratchpad
   directory for the duration of the run. Only aggregates derived from it
   reach the report.
5. **Aggregates only in the report.** Counts, rates, ratios, medians. Never a
   row that identifies one homeowner.

## Procedure

### Step 0 — Establish the window and declare it

Default window: the trailing 14 days, in `America/New_York`. That timezone is
not arbitrary — `public.website_arrivals_daily` buckets its dates that way, so
any other timezone silently misaligns every join in this skill.

Accept an explicit window from the user if given. Record the exact window at
the top of the report. Never mix windows between sources without saying so.

### Step 1 — Grade every source before reading any of it

Run the reachability checks in `references/sources.md` and assign each source
one grade from `references/grading.md`:

| Grade | Meaning |
| --- | --- |
| `LIVE` | Reachable, flowing, and unbiased for the window. Safe to reason from. |
| `DEGRADED` | Flowing but structurally biased — gated, sampled, partial, or stale. Usable with the bias named. |
| `DARK` | Wired and reachable, but switched off or returning zero rows for a known configuration reason. |
| `ABSENT` | Not wired in this repository at all. |
| `UNKNOWN` | Could not be reached this run. An access problem, not a data finding — say which. |

Do this **first**, before looking at any metric. Grading after the fact
invites grading to fit the story.

Write the grade table into the report before writing any finding.

### Step 2 — Run the checks

Each check has a query in `queries/` and a stated purpose. Run them in order;
later checks interpret earlier ones.

| # | Check | Source | Query |
| --- | --- | --- | --- |
| 1 | Arrival truth — did the click reach the origin? | Supabase | `queries/01-arrivals.sql` |
| 2 | Consent yield — how much of reality can any tracker see? | Supabase | `queries/02-consent.sql` |
| 3 | Real funnel — arrivals to leads to assessments | Supabase | `queries/03-funnel.sql` |
| 4 | Conversion coverage — what fraction of real leads Meta received | Supabase | `queries/04-capi-coverage.sql` |
| 5 | Distribution — did the paid lead reach its buyer? | Supabase | `queries/05-distribution.sql` |
| 6 | Attribution integrity — is per-ad analysis even possible? | Supabase | `queries/06-attribution-integrity.sql` |
| 7 | Delivery health — did a deploy break the funnel? | Vercel | `references/sources.md` |
| 8 | Browser funnel, gated | PostHog | `references/sources.md` |
| 9 | Cost join — cost per *real* lead | Meta CSV | `references/meta-export.md` |

Checks 1–6 are the backbone: they are server-side, consent-independent, and
they work today. Checks 7–9 are supplementary and frequently unavailable —
degrade to a stated grade rather than skipping silently.

### Step 3 — Compute the three headline numbers

These are the report's reason for existing. Compute each one, or state
precisely why you cannot.

**A. Click-to-arrival gap** — `paid_arrivals` (check 1) against Meta-reported
link clicks (check 9). A large negative gap means clicks are being paid for
that never became a page view: redirect loss, slow landing page, or invalid
traffic. Requires the CSV; without it, report `paid_arrivals` alone and say
the comparison is unavailable.

**B. Conversion coverage** — Meta-delivered `QualifiedLead` events against
real accepted leads in the same window (check 4). This is the single most
important number in the report. If coverage is 40%, Meta's optimizer is
learning from 40% of your conversions and every downstream cost metric in Ads
Manager is inflated by roughly 2.5×. Computable from Supabase alone; it never
needs the CSV and never needs consent-gated data.

**C. Cost per real lead** — spend (check 9) ÷ leads actually in the database
(check 3), *not* ÷ Meta-reported conversions. These two differ by exactly the
coverage gap in B, and the database number is the true one.

### Step 4 — Write findings

A finding needs four parts. Anything missing one is an observation, not a
finding, and belongs in the appendix.

1. **What** — the observed number, with its source and grade.
2. **Why it matters** — the decision it distorts, in money or in optimizer
   behavior.
3. **Confidence** — high / medium / low, driven by the grade of the weakest
   source it rests on.
4. **Next action** — a specific, checkable step, with the runbook or file that
   owns it.

Order findings by the size of the decision they distort, not by severity
adjectives. Cap at the ten that matter; the rest go in the appendix.

Do not invent a finding to fill a section. "Check 5 found no distribution
failures in the window" is a complete and useful result.

### Step 5 — Write the report

Copy `assets/report-template.md` to
`docs/audits/meta-signal-review/YYYY-MM-DD-meta-signal-review.md` and fill
every section. Keep the section order — the report is meant to be diffed
against the previous run, and reordering destroys that.

Before saving, re-read the Hard constraints above against your own draft.
Check specifically for a leaked contact value, a secret, or an unhedged claim
resting on a `DEGRADED` source.

## Known state of this system (read before interpreting anything)

As of the last repository read, these facts shape every result. Re-verify them
each run rather than trusting this list — it will go stale, and a stale
assumption here produces a confidently wrong report.

- `META_TRACKING_ENABLED` and `NEXT_PUBLIC_META_TRACKING_ENABLED` are `false`
  pending an attended Meta Test Events session. See
  `docs/runbooks/all-season-meta-rollout-handoff.md`. While this holds, Meta
  receives **nothing**, and conversion coverage is 0% by configuration rather
  than by fault. Report it as `DARK`, not as a failure.
- `NEXT_PUBLIC_ANALYTICS_DEFAULT_ON` is `false`. Analytics is off for new
  visitors until they opt in, so PostHog and Vercel Analytics see only the
  consenting subset. Anything derived from them is `DEGRADED` by construction.
- `public.website_arrivals` is written from edge middleware **before** any
  consent decision exists. It is the only unbiased population count in the
  system and the correct denominator for every rate in this report.
- PostHog autocapture and session recording are disabled, and custom event
  properties are allowlisted to exclude form contents and phone numbers. The
  five events are `form_view`, `address_selected`, `step2_reached`,
  `lead_submitted`, `phone_clicked`.
- `meta_event_deliveries` and `lead_distribution_deliveries` are
  service-role-only under RLS. A `permission denied` is an access finding —
  grade the source `UNKNOWN` and say so. It is not evidence of zero rows.

## What this skill deliberately will not do

Say so plainly if asked for any of these, rather than producing a degraded
version:

- Recommend budgets, bids, or audience changes. That needs trustworthy
  conversion data, which is precisely what this skill exists to establish the
  absence of.
- Score creative. Nothing in this repository observes creative.
- Write to Meta, Supabase, Vercel, or PostHog.
- Claim a per-ad result when check 6 shows `utm_content` coverage is poor.
  Without ad-level attribution, per-ad numbers are noise wearing a label.

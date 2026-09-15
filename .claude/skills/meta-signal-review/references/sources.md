# Signal sources

One section per source: what it can honestly tell you, what it cannot, how to
reach it, and how to grade it when it is not fully available.

The ordering is deliberate — it runs from most trustworthy to least. When two
sources disagree, the one higher in this file wins, and the disagreement
itself is a finding.

---

## 1. Supabase — `public.website_arrivals` (ground truth)

**What it is.** A pre-consent, server-side record that a request reached the
origin, written from edge middleware before any consent decision exists.

**Why it is first.** It is the only population count in the system that no
consent gate, ad blocker, or tracking flag can suppress. Every rate in the
report should use it as the denominator. If you find yourself computing a
conversion rate off a PostHog number, stop and use this instead.

**Deliberate limits, by design, not by defect:**
- No raw IP and no contact details.
- `visitor_hash` is `sha256(daily_salt || client_ip || user_agent)` and rotates
  daily. It supports unique-visit counting **within one day only**. Counting
  distinct visitors across a multi-day window double-counts returning
  visitors, and the error grows with the window. Never present a multi-day
  `distinct_visitors` as unique people.
- `is_likely_bot` is advisory. Rows are never dropped at write time, so filter
  at query time. Report bot share as its own number — a spike in it is a media
  quality finding.

**Rollup view.** `public.website_arrivals_daily` pre-aggregates by
`arrival_date` (in `America/New_York`), `campaign_slug`, `ad_name`
(= `utm_content`), and `meta_placement`. Its comment says it is shaped for
reconciliation against the Meta export — use it rather than re-deriving.

**Grade.** `LIVE` when rows exist for the window. `DARK` if zero rows across a
window with known traffic — that is a middleware or deployment finding, and an
urgent one, since it means the only unbiased source has stopped recording.

---

## 2. Supabase — leads, assessments, and the delivery ledgers

**What it is.** The operational source of truth: `public.leads`,
`public.roof_assessments`, `public.meta_event_deliveries`,
`public.lead_distribution_deliveries`, `public.privacy_consent_evidence`.

**The key asymmetry this skill exists to expose.** A lead is persisted when the
server accepts it, regardless of consent. A Meta conversion is delivered only
after explicit advertising consent, with valid signed evidence, with no GPC,
and with tracking enabled. **PIW therefore knows about conversions Meta can
never be told about.** The size of that gap is headline number B, and it is
the difference between Ads Manager's cost-per-lead and the real one.

**PII boundary.** `public.leads` holds `name`, `phone`, `email`,
`submitted_address`, and the attribution migration added `phone_e164`,
`email_normalized`, `client_ip_address`, `fbclid`, `fbp`, `fbc`. Touch these
only inside aggregates. The two delivery ledgers are intentionally PII-free
and carry no outbound payload — prefer them whenever they can answer the
question.

**Access.** `meta_event_deliveries` and `lead_distribution_deliveries` have
`revoke all` with `grant select to service_role`. Under a lesser role a query
returns `permission denied`, which is **not** zero rows. Grade `UNKNOWN`,
report it as an access finding, and do not let it read as "no failures."

**Grade.** `LIVE` when queries return. `UNKNOWN` on permission denial.

---

## 3. Vercel — runtime logs, deployments, Web Analytics

**What it can tell you that nothing else can.** Whether a metric change is a
market change or a deploy. A step-change in arrivals or lead rate that lands
on a deployment boundary is almost always the deploy. Check this before
attributing any drop to ad performance — it is the single most common
misreading in this kind of review.

**Use it for:**
- Runtime errors on the intake, consent, and CAPI routes during the window.
- Deployment timestamps for both `piw` and `rake-website`, to overlay on any
  step-change in checks 1–5.
- Web Analytics visitor counts, compared against `website_arrivals`
  `distinct_visitors` for the same day. The ratio sizes how much consent
  gating hides. That comparison is the intended use recorded in the
  `website_arrivals_daily` view comment.

**Limits.** Web Analytics is consent-gated in this deployment and so
undercounts the same way PostHog does. Log retention is finite — for a window
older than retention, grade `UNKNOWN` rather than reporting zero errors.

**Grade.** `DEGRADED` for Web Analytics numbers (consent-gated by
construction). `LIVE` for deployment timestamps and runtime errors within
retention.

---

## 4. PostHog — browser funnel

**Read this before using PostHog for anything.** It is the weakest source in
the system, and the report should treat it as corroboration, never as
evidence.

**The five allowlisted events**, per
`docs/runbooks/all-season-analytics-funnel.md`:

| Event | Trigger |
| --- | --- |
| `form_view` | A campaign or embedded form is visible with analytics enabled, or the quote drawer opens |
| `address_selected` | A campaign suggestion is selected or a valid manual address advances |
| `step2_reached` | A valid campaign address advances to contact details |
| `lead_submitted` | The server accepts a campaign, embedded, or drawer lead |
| `phone_clicked` | A website telephone link is clicked |

**Four compounding limitations:**
1. Analytics defaults off (`NEXT_PUBLIC_ANALYTICS_DEFAULT_ON=false`), so
   PostHog sees only visitors who actively opted in.
2. Autocapture and session recording are disabled, so there is no behavioral
   detail beyond these five events.
3. Event properties are allowlisted and exclude form contents and phone
   numbers.
4. No PostHog credential is wired in this repository — no `POSTHOG_*` variable
   exists in either `.env.example`.

**Consequence.** PostHog can never produce a population number. Its one
genuinely valuable use is as a *ratio*: PostHog `lead_submitted` ÷ Supabase
accepted leads for the same window estimates the consent-visible fraction of
reality. Report that ratio; do not report PostHog counts as counts.

**`phone_clicked` measures call intent, not a completed call.** The runbook
says so explicitly. Never present it as calls.

**Access.** Needs `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, and
`POSTHOG_HOST` in the environment. If any is unset, grade `ABSENT`, state that
it is unwired, and continue — the backbone checks do not depend on it.

**Grade.** `ABSENT` when unwired. `DEGRADED` whenever it does work, always,
because the consent gate is structural. It is never `LIVE`.

---

## 5. Meta — Events Manager and the Ads Manager export

**No API access.** There is no Marketing API integration in this repository.
The only Meta hits in the codebase are the server-side CAPI delivery in
`src/modules/marketing/meta-conversions.ts`. Spend, impressions, frequency,
and CPM reach this skill only through a manual CSV export.

See `meta-export.md` for the expected columns, the join, and the staleness
rule.

**What the repository can tell you without any export:**
- Whether tracking is enabled (`META_TRACKING_ENABLED`,
  `NEXT_PUBLIC_META_TRACKING_ENABLED`).
- Delivery outcomes per event from `meta_event_deliveries`: status, attempt
  count, HTTP status, error category, and latency from `event_time` to
  `sent_at`.
- Deduplication structure: browser and server events share an `event_id`, and
  unique partial indexes enforce one `Lead`, one `QualifiedLead`, and one
  `AssessmentCompleted` per lead or assessment.

**What only Events Manager can tell you**, which a human must read manually:
Event Match Quality, Meta's own deduplication rate, and diagnostics warnings.
These matter — EMQ drives delivery cost — so the report should name them as a
standing manual gap rather than pretending the ledger covers them.

**Grade.** `DARK` while the tracking flags are `false`. `DEGRADED` when
enabled but the export is missing or stale. `LIVE` only with tracking enabled
and a current export covering the window.

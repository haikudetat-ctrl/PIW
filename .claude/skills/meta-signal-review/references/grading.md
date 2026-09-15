# Grading rubric

Grade every source in Step 1, before reading any metric from it. Grading after
you have seen the numbers invites grading that fits the story you have already
started telling.

## The grades

### `LIVE`
Reachable, returning data for the window, and structurally unbiased for the
question being asked. Safe to state as fact without a hedge.

Bias is per-question, not per-source. `website_arrivals` is `LIVE` for
"how many paid arrivals" and `DEGRADED` for "how many unique people this
month," because `visitor_hash` rotates daily. Grade the source for the use.

### `DEGRADED`
Returning data, but biased in a known direction. Usable — with the bias named
in the same sentence, and with the direction stated.

"PostHog recorded 47 `lead_submitted` events (DEGRADED — consent-gated, so
this is a floor, not a count)" is correct. "PostHog recorded 47 leads" is not.

Always say which way it is wrong. A floor and a ceiling lead to opposite
decisions.

### `DARK`
Wired and reachable, but switched off or empty for a known configuration
reason you can name and point at.

`DARK` is a statement about configuration, not about performance. Meta
receiving zero events while `META_TRACKING_ENABLED=false` is `DARK` and
expected. Meta receiving zero events while tracking is enabled is a `LIVE`
source reporting total failure — a completely different and much worse
finding. Do not blur them.

### `ABSENT`
Not wired in this repository at all. No credential, no integration, no code
path. Nothing to check.

`ABSENT` is not a problem by itself. It becomes a finding only when something
in the report needed it.

### `UNKNOWN`
Could not be reached this run: permission denied, an expired credential, a
timeout, a window outside log retention.

**`UNKNOWN` is never reported as zero.** A `permission denied` on
`lead_distribution_deliveries` means you do not know whether deliveries
failed; it does not mean none did. Say which specific access failed so the
next run can fix it.

## Confidence follows the weakest source

A finding's confidence is capped by the worst-graded source it depends on.
This is not a guideline — it is how confidence is assigned.

| Weakest source | Maximum confidence |
| --- | --- |
| All `LIVE` | High |
| Any `DEGRADED` | Medium |
| Any `DARK`, `ABSENT`, or `UNKNOWN` | Low — and say what would raise it |

A finding at low confidence still belongs in the report if the decision it
touches is large enough. Say what it would take to raise the confidence. That
next step is often the most valuable line in the report.

## When two sources disagree

The disagreement is itself a finding, and frequently the most informative one
in the run. Do not average them, do not pick the friendlier number, and do not
quietly drop the inconvenient one.

Resolution order, most to least trustworthy:

1. Supabase server-side ledgers — `website_arrivals`, `leads`, the delivery
   tables. Unconditional, server-written.
2. Vercel deployment and runtime facts. Infrastructure truth.
3. Meta's own reporting, from the export. Modeled, attributed on Meta's
   window, and blind to anything consent suppressed.
4. PostHog and Vercel Analytics. Consent-gated browser data.

Report both numbers, name the gap, and explain the mechanism that produces it.
"Meta reports 120 results, the database holds 210 accepted leads, a 43% gap
consistent with the measured consent-grant rate" is a finding. "Roughly 150
leads" is a fabrication.

## Grade drift between runs

The report is meant to be diffed. When a source's grade changes from the
previous report in `docs/audits/meta-signal-review/`, say so in the grade
table and name the cause. A source moving `LIVE` → `UNKNOWN` is an incident;
`DARK` → `LIVE` usually means someone completed a rollout step and the
baseline just moved under every trend in the report.

# Meta Ads Manager export

There is no Marketing API access in this repository, so spend and delivery
data arrive as a manual CSV export. This file defines what the export must
contain, how it joins to server-side truth, and when it must be refused.

## Getting the export

Ads Manager → the All Season ad account → set the date range to **match the
review window exactly** → Reports → Export → CSV.

Breakdown: by **Ad**, by **Day**. Ad-level is required — the join key is the
ad name, and an ad-set-level export cannot join to `utm_content` at all.

Save it to the scratchpad directory. **Never commit it.** It is not covered by
the repository's PII rules, but it is commercial data and it goes stale, which
makes a committed copy actively misleading later.

## Required columns

Meta's exact column labels shift between UI versions, so match case-insensitively
and on substring. Refuse the export rather than guessing at an ambiguous header.

| Meaning | Typical label | Required |
| --- | --- | --- |
| Ad name | `Ad name` | **Yes** — this is the join key |
| Day | `Day`, `Date` | **Yes** |
| Amount spent | `Amount spent (USD)` | **Yes** |
| Link clicks | `Link clicks` | **Yes** — needed for the click-to-arrival gap |
| Impressions | `Impressions` | No |
| Reach | `Reach` | No |
| Frequency | `Frequency` | No |
| Results / conversions | `Results`, `Leads` | No — but it enables the coverage cross-check |
| Cost per result | `Cost per result` | No — recompute it; do not trust it |

If a required column is missing, grade the Meta source `DEGRADED`, compute
what the present columns allow, and name the missing column and the number it
cost. Do not silently drop headline A or C.

## The join

The join key is **Meta ad name ↔ `website_arrivals.utm_content`**, which the
`website_arrivals_daily` view already exposes as `ad_name`.

This join is exactly as reliable as the team's UTM naming discipline. Check 6
(`queries/06-attribution-integrity.sql`) measures that discipline, and it must
run **before** this join is attempted.

1. Normalize both sides: trim, collapse internal whitespace, casefold.
2. Join on the normalized name and the day.
3. Count and report three populations:
   - **Matched** — an ad name present on both sides.
   - **Spend with no arrivals** — Meta charged for clicks that never reached
     the origin. Investigate as click-to-arrival loss or invalid traffic.
   - **Arrivals with no spend row** — organic traffic, a stale export, or an
     ad renamed mid-window. Renaming an ad mid-window silently splits its
     history on both sides; call it out when the pattern looks like one.

If matched rows are under 80% of spend, the join is unsound. Report per-campaign
totals only, state that per-ad analysis was refused, and say why.

## Staleness

The export carries its own date range. Compare it against the review window
before computing anything from it.

- **Export covers the window** → proceed.
- **Export is partial** → compute cost metrics only over the overlap, and
  state the narrowed window next to every number derived from it.
- **Export predates the window entirely** → refuse. Grade Meta `DEGRADED`,
  report headline B (which never needs the export) and omit A and C rather
  than joining across disjoint periods.

Never extrapolate spend across days the export does not cover.

## Cost per real lead

This is headline C, and it is the number the export exists to produce.

```
cost_per_real_lead = spend (export) / accepted leads (Supabase, same window)
```

The denominator is the database, **not** Meta's reported results. The two
differ by exactly the conversion coverage gap in headline B, and the database
number is the true one.

Report both alongside each other, always:

```
Cost per result (Ads Manager): $X    ← what Meta believes
Cost per real lead (database): $Y    ← what actually happened
```

When coverage is below 100%, `$Y` is lower than `$X` — often far lower. That
difference is the direct cost of the measurement gap, and it is usually the
single most persuasive line in the whole report.

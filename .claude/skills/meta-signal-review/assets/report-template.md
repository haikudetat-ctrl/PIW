# Meta signal review — {{YYYY-MM-DD}}

**Window:** {{WINDOW_START}} → {{WINDOW_END}} (America/New_York)
**Run by:** {{operator}}
**Previous report:** {{link or "none — first run"}}

---

## 1. Source grades

Graded before any metric was read. Confidence on every finding below is capped
by the weakest source it rests on.

| Source | Grade | Basis | Change since last run |
| --- | --- | --- | --- |
| Supabase — `website_arrivals` | | | |
| Supabase — leads / assessments | | | |
| Supabase — `meta_event_deliveries` | | | |
| Supabase — `lead_distribution_deliveries` | | | |
| Supabase — `privacy_consent_evidence` | | | |
| Vercel — deploys / runtime | | | |
| Vercel — Web Analytics | | | |
| PostHog | | | |
| Meta — tracking flags | | | |
| Meta — Ads Manager export | | | |

**Configuration read this run:**

- `META_TRACKING_ENABLED`: {{set/unset — value only if it is a boolean flag}}
- `NEXT_PUBLIC_META_TRACKING_ENABLED`: {{}}
- `NEXT_PUBLIC_ANALYTICS_DEFAULT_ON`: {{}}
- Meta export present and covering the window: {{yes/no/partial}}

---

## 2. Headline numbers

### A. Click-to-arrival gap
| Meta-reported link clicks | Server-side paid arrivals | Gap | Gap % |
| --- | --- | --- | --- |
| | | | |

*Source and grade:* {{}}
*Reading:* {{what the gap means, or why it could not be computed}}

### B. Conversion coverage — what Meta actually received
| Real accepted leads | `QualifiedLead` sent | Coverage % |
| --- | --- | --- |
| | | |

*Source and grade:* {{}}
*Reading:* {{If coverage is below 100%, state the implied inflation factor on
every Ads Manager cost metric. If 0%, say whether that is DARK-by-configuration
or a live pipeline failure — they look identical in the data and differ
completely in what to do next.}}

### C. Cost per real lead
| Spend | Meta-reported results | Cost per result (Meta) | Real leads (DB) | Cost per real lead |
| --- | --- | --- | --- | --- |
| | | | | |

*Source and grade:* {{}}
*Reading:* {{The two cost figures differ by exactly the coverage gap in B.}}

---

## 3. Findings

Ordered by the size of the decision each one distorts. Each has: what, why it
matters, confidence, next action.

### F1. {{title}}
- **What:** {{number, source, grade}}
- **Why it matters:** {{the decision it distorts, in money or optimizer behavior}}
- **Confidence:** {{high/medium/low}} — {{weakest source it rests on}}
- **Next action:** {{specific, checkable, with the owning file or runbook}}

### F2. {{title}}
- **What:**
- **Why it matters:**
- **Confidence:**
- **Next action:**

{{...up to ten. Fewer is fine. Do not invent findings to fill the section.}}

---

## 4. Check results

### Check 1 — Arrival truth
{{per-ad table: arrivals, paid arrivals, paid share, bot share}}

### Check 2 — Consent yield
{{decisions, analytics grant %, advertising grant %, GPC %, by source}}

Consent decisions recorded: {{n}} against {{n}} arrivals — {{%}} of visitors
made an explicit choice. The remainder are invisible to every browser-side
source in this report.

### Check 3 — Real funnel
{{arrivals → leads → assessments started → completed, per ad}}

### Check 4 — Conversion coverage and CAPI health
{{per event_name: ledger rows, sent, failures by category, median lag}}

### Check 5 — Lead distribution
{{per source_label and destination: sent %, rejected, failed, median latency}}

### Check 6 — Attribution integrity
| Surface | Rows | utm_content coverage % | Distinct ad names | Paid without ad name |
| --- | --- | --- | --- | --- |
| `website_arrivals` | | | | |
| `leads` | | | | |

Per-ad analysis: {{sound / stated-gap / REFUSED}} — {{threshold applied}}

### Check 7 — Vercel delivery health
{{runtime errors on intake/consent/CAPI routes; deployment boundaries overlaid
on any step-change in checks 1–5}}

### Check 8 — PostHog browser funnel
{{Always DEGRADED or ABSENT. If present, report the ratio of PostHog
`lead_submitted` to Supabase accepted leads as the consent-visible fraction —
never the raw counts as counts.}}

### Check 9 — Meta export join
{{matched spend %, spend with no arrivals, arrivals with no spend row}}

---

## 5. Standing manual gaps

Things this skill structurally cannot see. Carry them forward every run until
they are closed or accepted.

- **Event Match Quality** — only visible in Events Manager. Drives delivery
  cost. Last checked manually: {{date or "never"}}.
- **Meta's own deduplication rate** — the ledger proves events were sent with
  shared IDs; only Meta reports whether it deduplicated them.
- **Events Manager diagnostics warnings** — {{date last read}}.
- **Spend freshness** — the export is manual and goes stale between runs.

---

## 6. What changed since the last report

{{Diff against the previous file in this directory: grade changes, coverage
movement, new or resolved findings. Skip on a first run and say so.}}

---

## 7. Provenance

- Queries run: {{list from queries/}}
- Supabase project: {{project ref}}
- Read-only run: {{confirm no writes were issued}}
- PII check: {{confirm no contact value, token, or raw payload appears above}}

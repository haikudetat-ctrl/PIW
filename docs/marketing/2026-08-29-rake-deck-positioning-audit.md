# RAKE deck audit and positioning reconciliation

**Date:** 2026-08-29
**Subject:** `RAKE by 2Stack — Operational Intelligence for Contractors` (9 pp.)
**Companion:** `2026-08-29-piw-multi-tenant-go-to-market-plan.md`

**Bottom line:** the deck's diagnosis is excellent and should survive. The
product it then promises is roughly two quarters ahead of the build, and it
omits the one capability that is finished, differentiated, and hard to copy.
Keep the message. Change the wedge.

---

## 1. What the deck says

| Element | Copy |
| --- | --- |
| Category | "Operational intelligence for contractors and home-service operators" |
| Headline | "Contractors do not need another CRM. They need visibility." |
| Core claim | "Most contractors do not have a sales problem. They have a visibility problem." |
| Problem frame | "The data exists. It is just scattered." → CRM, accounting, email, phone, spreadsheets, production, marketing → **owner memory** as the source of truth |
| Scope frame | "Stop ending the story at the invoice." Lead → Estimate → Job → Customer → Referral → Lifetime Value |
| Product | Owner Scorecard + five "Engines" |
| Close | "Certainty comes from visibility." / "Built for owners who want the truth without another meeting." |
| CTA | "Book a RAKE Walkthrough" |
| Adjacent offer | 2Stack **Launch System** for newer contractors not yet ready |

---

## 2. What is genuinely strong — keep all of this

This is better positioning writing than most vertical SaaS produces, and three
things in particular are worth protecting:

**"They have a visibility problem, not a sales problem."** This is a real
reframe. It moves the conversation off price and feature comparison and onto a
problem the owner already feels but has not named. It also disqualifies you from
the crowded "we get you more leads" bucket that every contractor has been
burned by.

**"The owner becomes the source of truth. That works until it does not."**
This is the best line in the deck. It is specific, it is true, and it names the
buyer's private anxiety without insulting them. Do not lose it in any rewrite.

**"Not another CRM."** Strategically correct, and it matches the GTM plan's
core recommendation to land alongside JobNimbus and AccuLynx rather than against
them. The deck and the plan agree here.

**The Engines packaging.** Naming discrete outcome-shaped capabilities — Lead
Response, Profitability, Referral, Estimate Recovery — is a strong device. It
sells outcomes rather than screens and it scales into a roadmap cleanly. See §6
for how to use it honestly.

---

## 3. The core finding

**The deck sells a business-intelligence layer. The repository contains an
acquisition engine.** These are different products, and the gap runs in both
directions.

### 3.1 What the deck promises that is not built

Verified against the schema and source, not inferred:

| Deck promise | Repository reality | Verdict |
| --- | --- | --- |
| Revenue, projected revenue, gross margin, average job size | `public.jobs` has `status`, `notes`, `lead_id`, `property_id` — **no revenue, cost, or value column anywhere**. No margin, COGS, labor, or material tracking in any migration | ❌ Not built |
| Close rate, referral rate | No referral tracking, no review-request records, no close-rate aggregation | ❌ Not built |
| "Which crews create callbacks" | **No crew or callback entity exists** | ❌ Not built |
| Profitability Engine (jobs, customers, crews, lead sources) | Requires accounting integration. No QuickBooks, Xero, or any accounting connector in the codebase | ❌ Not built |
| Referral Engine ("who to ask today") | Nothing. The Google reviews route is read-only display on the public website | ❌ Not built |
| Owner Scorecard | `src/modules/dashboard/pipeline-totals.ts` counts leads per stage. That is the entire dashboard layer | ❌ Not built |
| "5 missed calls that never got a same-day text" | **No call-log or missed-call integration exists.** CallTools is a disabled flag with no phone-event ingestion | ❌ Not built |
| "9 new leads waiting longer than 15 minutes" | `speed_to_lead_events` table exists; the workflow that writes to it does not ship (`n8n/workflows/` contains one Slack alert file) | 🟠 Schema only |
| "7 estimates older than 14 days" / Estimate Recovery | `roof_estimates` and an abandonment worker exist; no "likely to close" scoring | 🟠 Partial |
| "2 lead sources spending without clear job attribution" | See §3.3 | 🟠 Partial, and ironic |
| "Which lead sources work" | UTM and Meta identifiers are captured and persisted per lead — the genuine foundation of this claim | ✅ Foundation exists |

**Four of the five "What needs attention" bullets on page 6 have no data source
in this codebase.** That page is the deck's money shot — it is the screen that
makes an owner lean forward — and it is the least supported thing in the
document.

### 3.2 What is built that the deck never mentions

The instant address-to-measured-roof-estimate does not appear anywhere in nine
pages. Neither does RoofCheck, the campaign-to-quote continuity, the
assessment's need/intent/urgency scoring, or the context dialer.

This is the inverse of the usual problem. The capability that is finished,
tested, in production with a real customer, genuinely differentiated, and
expensive for a competitor to copy has been left out of the marketing entirely,
while five capabilities that do not exist are on the cover.

### 3.3 One uncomfortable detail

The deck promises to surface "lead sources spending without clear job
attribution." As documented in the companion All Season plan, **this exact
failure is live in your own stack**: there is no Meta Pixel, GA4, or GTM
anywhere on the website, so the `_fbp` and `_fbc` cookies the intake routes read
are always null and the CAPI loop has nothing to match against.

This is fixable and it is on the roadmap. But it cannot be sold until it is
fixed, because the first thing a sharp prospect will do is ask you to
demonstrate it on your own reference customer.

---

## 4. The decisive practical argument: the demo

Positioning arguments can go around in circles. This one does not.

**The scorecard cannot be demoed.** An owner scorecard is only persuasive with
the prospect's own data, and populating it requires integrations into their CRM,
accounting, and phone systems — weeks of work, per prospect, before they have
paid anything. A demo with invented numbers is exactly the demo an owner has
already been shown by four other vendors and has learned to discount.

**The roof estimate demos in forty seconds, on their own house, with nothing
integrated.** Ask for an address on the call. Enter it. They watch their own
roof get measured, priced, and scored.

That asymmetry decides the sequencing on its own. One product can be sold this
quarter and one cannot.

---

## 5. Recommended reconciliation

**Keep the deck's diagnosis. Change the first engine you deliver.**

The deck already contains its own bridge and does not appear to know it. Page 6:
*"Stop ending the story at the invoice. Everyone can track lead to estimate to
job to invoice. RAKE helps owners see what happens before and after."*

**"Before" is where the build is.** The deck's own funnel — Lead → Estimate →
Job → Customer → Referral → LTV — starts at Lead. Sell the front of that funnel
now and expand rightward as you build.

So the narrative becomes:

1. **Diagnosis (keep verbatim):** you do not have a sales problem, you have a
   visibility problem, and you are the source of truth. That works until it
   does not.
2. **Narrow the first cut (new):** the most expensive blindness is at the front
   — you are dispatching reps to roofs you could have disqualified from a desk,
   and you cannot see which ads produced the jobs you actually won.
3. **Wedge (built, demoable today):** every inbound lead gets its roof measured,
   priced, and scored before anyone is dispatched, and what closes goes back to
   the ad platform.
4. **Expansion (the Engines, honestly staged):** as jobs flow through, the same
   spine lights up Estimate Recovery, then Profitability, then Referral, then
   the full Owner Scorecard.

This keeps "not another CRM" (you sit in front of it), keeps the visibility
frame (you are making the invisible front half visible), keeps the Engines, and
makes the roadmap a reason to buy early rather than a set of claims to defend.

**Positioning line, reconciled:**

> *You do not have a sales problem. You have a visibility problem — and it
> starts before the first appointment. RAKE measures, prices, and scores every
> lead's roof before you send anyone, then shows you which ads actually produced
> the jobs you won.*

---

## 6. Using the Engines honestly

The Engines are good packaging. Stage them with visible status rather than
presenting five equals:

| Engine | Status to show | Reality |
| --- | --- | --- |
| **Property Intelligence** (new, lead engine) | **Live** | Built, in production |
| **Lead Response** | **Live at launch** | Needs the speed-to-lead workflow shipped — days, not quarters |
| **Estimate Recovery** | **Beta** | Abandonment worker exists; scoring does not |
| **Attribution** (split out of the Scorecard) | **Beta** | Needs Pixel + CAPI. High value, low effort, big proof |
| **Profitability** | **On the roadmap** | Needs accounting integration. Do not sell a date |
| **Referral** | **On the roadmap** | Not started |
| **Owner Scorecard** | **Roadmap, framed as the destination** | Genuinely the right long-term product |

A roadmap shown as a roadmap is an asset in a design-partner motion — it is
precisely what a partner is buying influence over. A roadmap shown as a
shipping product is a refund conversation.

**Split Attribution out of the Scorecard and promote it.** It is the highest
value-to-effort item on the list, it is the one scorecard claim with real
foundations in the schema, and it powers the free "attribution teardown"
diagnostic in the GTM plan (§8.2) that opens conversations.

---

## 7. Claims hygiene

The page-5 scorecard shows $412,000 revenue, $687,000 projected, 38% close rate,
$14,800 average job, 17% referral rate, 31% gross margin, 42 open estimates.

These read as illustrative UI, and in context they probably are. Two changes:

1. **Label them.** "Illustrative data" in the figure itself. A prospect who
   assumes they are a customer's real results and later learns otherwise has
   lost trust over something you never intended to claim.
2. **Note the brand inconsistency.** The product enforces, at the database and
   in a reviewed runbook, that pending states "must not emit sample or
   placeholder dollars" to homeowners. It is a genuine principle and §2.3 of the
   GTM plan recommends selling on it. A deck that shows contractors placeholder
   dollars undercuts the story you would most like to tell about yourself.

Replace the mock scorecard with the one screen you can populate truthfully
today: a real RoofCheck result on a real property.

---

## 8. Open questions this raises

**Audience width.** The deck says "contractors and home-service operators."
The build is roofing-specific and New Jersey-locked (GTM plan §3.2). Widening
the stated audience widens the credibility gap and the demo problem, since the
roof-measurement wedge does not apply to a plumber. Recommend narrowing the
stated audience to roofing and exterior contractors until the Profitability and
Scorecard engines exist — those *are* trade-agnostic, and they are the right
vehicle for widening later.

**The Launch System.** The deck references a separate 2Stack offer for newer
contractors. Worth clarifying whether that is a distinct product line, a
qualification off-ramp, or a lower tier — it affects packaging in GTM plan §7.2
and is currently ambiguous to a reader.

**Who wrote the scorecard spec.** If the page-5 and page-6 screens came from
real conversations with owners, that is valuable primary research and it should
drive the roadmap order. If they are aspirational, the roadmap should instead
be driven by the design partners in GTM plan §9.1.

---

## 9. Recommended actions

| # | Action | Effort |
| --- | --- | --- |
| 1 | Add the property-intelligence wedge to the deck as the lead capability | Low |
| 2 | Restage the Engines with honest status labels (§6) | Low |
| 3 | Label the mock scorecard as illustrative; replace the hero screen with a real RoofCheck result | Low |
| 4 | Narrow the stated audience to roofing/exterior for now | Low |
| 5 | Split Attribution out as its own engine and promote it | Low |
| 6 | Keep §2's copy verbatim — do not let a rewrite lose "the owner becomes the source of truth" | — |
| 7 | Ship Pixel + CAPI before the deck's attribution claims go in front of anyone | Medium |
| 8 | Ship speed-to-lead so the "15 minutes" claim becomes true | Medium |
| 9 | Reconcile `rake.2-stack.com` against the same findings | Medium |

---

## Appendix — verification method

Claims were checked against the repository, not inferred:

- `grep -rniE "gross_margin|margin|profit|crew|labor_cost|material_cost|cogs"` over
  `supabase/migrations` and `src` — no matches outside the infrastructure cost module.
- `grep -rniE "referral|review_request"` — no matches.
- `grep -rniE "quickbooks|xero|missed_call|call_log"` — no matches.
- `public.jobs` definition — `supabase/migrations/20260730161506_job_permit_tracking.sql`.
- Dashboard surface — `src/modules/dashboard/pipeline-totals.ts` in full.
- `speed_to_lead_events` — `supabase/migrations/20260801230408_lead_automation_audit_delta.sql`.
- Shipped workflows — `n8n/workflows/` contains `slack-execution-failure.json` and a
  `reference` directory.
- Pixel/GA4/GTM absence — `grep` over `apps/website`.

Note that the infrastructure cost module (`src/modules/costs`) tracks **Rake's own
Vercel, Google, DigitalOcean, and Supabase spend** — not tenant job profitability.
The two are easy to conflate from the outside and are unrelated.

# RAKE deck audit and positioning reconciliation

**Date:** 2026-08-29
**Subject:** `RAKE by 2Stack — Operational Intelligence for Contractors` (9 pp.)
**Companion:** `2026-08-29-piw-multi-tenant-go-to-market-plan.md`

**Bottom line:** the deck's diagnosis is excellent and should survive. The
product it then promises is roughly two quarters ahead of the build, and it
omits the one capability that is finished, differentiated, and hard to copy.
Keep the message. Change the wedge.

**Updated 2026-08-29 following owner input.** The strategy is now front door and
back door — acquisition in, reviews and referrals out, with the messy middle
left to the incumbent CRM. This is stronger than the scorecard frame and
resolves most of the gap below by making two of the unbuilt engines
off-strategy rather than overdue. See §5. Audience is "all contractors" (§6);
the scorecard screens are confirmed aspirational (§8.1); and All Season is not
yet live, so there is no case study and the demo carries the early sale
(§8.2).

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
sells outcomes rather than screens and it scales into a roadmap cleanly. §5.2
reclassifies them against the front/back-door strategy.

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
tested, deployed, genuinely differentiated, and expensive for a competitor to
copy has been left out of the marketing entirely, while five capabilities that
do not exist are on the cover. (It is built and demoable but not yet running
live traffic — see §8.2.)

### 3.3 One uncomfortable detail

The deck promises to surface "lead sources spending without clear job
attribution." As documented in the companion All Season plan, **this exact
failure is live in your own stack**: there is no Meta Pixel, GA4, or GTM
anywhere on the website, so the `_fbp` and `_fbc` cookies the intake routes read
are always null and the CAPI loop has nothing to match against.

This is fixable and it is near the top of the roadmap. But it cannot be sold
until it is fixed — attribution is the one claim a prospect can ask you to
demonstrate on your own business, and right now the honest answer is that it
does not work yet.

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

## 5. Recommended positioning: the front door and the back door

**Owner direction (2026-08-29):** be the front door and the back door of the
customer lifecycle. Acquisition in; reviews and referrals out. A review/referral
product is the planned back-end build. *"Everything else is messy in these
businesses."*

This is a better strategy than the scorecard frame, and it resolves the audit's
central gap cleanly. It should become the positioning.

### 5.1 The frame

The deck's own funnel is Lead → Estimate → Job → Customer → Referral → Lifetime
Value. The strategy is to own both ends and deliberately decline the middle:

```
   FRONT DOOR                 THE MIDDLE                 BACK DOOR
   (RAKE)                     (their CRM — not us)       (RAKE)

   Lead → Estimate            Job, scheduling,           Customer → Referral
   measured, scored,          crews, materials,          → Lifetime Value
   responded to, attributed   accounting                 review, referral, repeat
        ▲                                                        │
        └────────────── the back door feeds the front ───────────┘
```

**This makes "not another CRM" a positive claim instead of a negative one.** The
deck currently says what RAKE is not. The front/back-door frame says what it is,
and the refusal to touch job production and accounting becomes a deliberate
product decision rather than a missing feature. That is a far stronger answer to
"how are you different from AccuLynx" than "we're a visibility layer."

**The loop is the real story.** Reviews and referrals are not a back-office
nicety; they are the cheapest acquisition channel a contractor has. The back
door feeds the front door. Roofing is referral-dense, and All Season's own
4.5★ / 397-review profile is the proof that reputation drives inbound in this
trade. Framing it as a loop rather than as two features is what makes this a
platform story instead of a bundle.

### 5.2 What this does to the Engines

The strategy reclassifies them, and this is the most useful output of the audit:

| Engine | Position | Verdict |
| --- | --- | --- |
| **Property Intelligence** | Front door | ✅ Built. Lead with it |
| **Lead Response** | Front door | Ship next. Days of work, and trade-agnostic |
| **Attribution** | Front door | Ship next. High value, low effort, trade-agnostic |
| **Estimate Recovery** | Front door | Partial. Natural follow-on |
| **Referral** | **Back door** | **Promote.** Was "roadmap"; it is now strategically core |
| **Profitability** | Messy middle | **Drop from the near-term message.** Needs accounting integration — the exact mess being declined |
| **Owner Scorecard** | Mostly messy middle | **Demote.** Revenue, margin, crews, and callbacks all require the middle. A front/back-door scorecard is a different, smaller, buildable thing |

The gap analysis in §3 therefore reads differently now. Profitability and the
full Scorecard are not "promised but unbuilt" — they are **off-strategy**. That
is a cleaner story and it removes the two hardest integration projects from the
roadmap entirely.

### 5.3 Reconciled positioning copy

Keep the deck's diagnosis verbatim (§2), then:

> **Your CRM runs your jobs. RAKE runs your front door and your back door.**
>
> Every lead measured, scored, and answered in minutes — with attribution back
> to the ad that produced it. Every finished job turned into a review, a
> referral, and the next lead.
>
> The messy middle stays where it is. We don't want it.

That last line is worth keeping. Contractors have been sold "one system for
everything" repeatedly and it has repeatedly failed them. An explicit refusal to
own the mess is credible, memorable, and differentiating.

---

## 6. Audience: "all contractors" — how to make it work

**Owner direction:** claim all contractors, not roofing only.

That widens the credibility gap the audit flagged, but the front/back-door
strategy largely closes it — provided the capabilities are sequenced by which
ones are trade-agnostic. This is the key distinction:

| Capability | Trade-agnostic? |
| --- | --- |
| Lead response / speed-to-lead | ✅ Yes |
| Attribution (ad spend → won jobs) | ✅ Yes |
| Estimate recovery | ✅ Yes |
| **Review / referral engine (back door)** | ✅ **Yes — entirely** |
| **Roof measurement (property intelligence)** | ❌ **No — roofing only** |

So the honest framing for a wide audience is:

- **The platform is for contractors.** Front door and back door. Lead response,
  attribution, estimate recovery, reviews, referrals — all trade-agnostic.
- **Roofing gets a superpower on top.** Aerial roof measurement, pricing, and
  scoring before dispatch. Sold as a vertical advantage, not as the platform's
  definition.

This keeps the wide TAM, keeps the demo devastating for roofers, and gives
non-roofing prospects a real product rather than a shrug.

**Two consequences to accept deliberately:**

1. **The 40-second demo only works for roofers.** For every other trade the
   demo is speed-to-lead and attribution — which do not exist yet (§3.1). Until
   they ship, *sell roofing.* Claim the wider audience in the positioning; run
   the pipeline in roofing. This is a normal and honest sequencing, but it must
   be a conscious choice rather than a drift.
2. **Design partners should be roofers.** Not because the strategy is
   roofing-only, but because they are the only segment with a demoable product
   today, and because you have a roofing reference customer.

---

## 7. Roadmap implications

Reordered around front door / back door, with the messy middle removed:

| Stage | Build | Why |
| --- | --- | --- |
| **Now** | Pixel + CAPI; speed-to-lead workflow | Makes the front door true and trade-agnostic. Both are days-to-weeks, both are already promised in the deck |
| **Next** | Review / referral engine (back door v1) | Strategically core, trade-agnostic, and the thing that widens the audience beyond roofing. Request → review → referral tracking, on the consented SMS/email channels already captured |
| **Then** | Estimate recovery scoring; front/back-door scorecard | A small scorecard covering only what RAKE owns — response time, source attribution, estimate aging, review and referral velocity. Buildable without touching accounting |
| **Dropped** | Profitability engine; revenue/margin/crew scorecard | Requires the middle. Off-strategy |

Note the back-door build is the highest-leverage item after the front door is
true: it is the piece that makes "all contractors" honest, and it is the loop
that makes the platform compound.

---

## 8. Claims hygiene and the proof problem

### 8.1 The mock scorecard

Page 5 shows $412,000 revenue, $687,000 projected, 38% close rate, $14,800
average job, 17% referral rate, 31% gross margin, 42 open estimates. **Confirmed
aspirational**, not from customer data.

Three actions:

1. **Label as illustrative** in the figure, or remove it. Most of what it shows
   is now off-strategy anyway (§5.2), so removal is the simpler fix.
2. **Note the brand inconsistency.** The product enforces at the database level
   that pending states "must not emit sample or placeholder dollars" to
   homeowners. Showing contractors placeholder dollars undercuts exactly the
   integrity story worth selling.
3. **Do not treat these metrics as validated demand.** They are a product
   vision, not research. Roadmap order should come from design partners.

### 8.2 There is no case study yet

**All Season is not live in production** — flags are still off and no real
traffic is running. This is the most consequential answer in the set, and it
resets several assumptions:

- **No proof exists.** Every early sales conversation leads with the *demo*, not
  with results. Plan accordingly: the demo environment is now the single most
  important sales asset (GTM plan §11.2).
- **The case study moves to Q1 2027.** It needs the All Season program running
  60–90 days with working attribution first (companion plan Phase 0).
- **Phase 0 is now double-blocking.** The Pixel/CAPI and speed-to-lead work
  gates All Season's own marketing *and* every RAKE claim about attribution and
  response time. It is the highest-priority engineering work in either plan.
- **Design partners are founding customers, not references.** Price and pitch
  accordingly — they are buying influence and early access, and they should be
  told plainly there is no reference customer yet. That is a survivable pitch
  for three partners; it is not survivable for ten.

---

## 9. Recommended actions

| # | Action | Effort |
| --- | --- | --- |
| 1 | Rewrite the deck around front door / back door (§5.3). Keep §2's copy verbatim — do not lose "the owner becomes the source of truth" | Low |
| 2 | Add property intelligence as the lead front-door capability; add the review/referral engine as the named back door | Low |
| 3 | Cut the Profitability Engine and the revenue/margin/crew scorecard from the message — they are the middle you are declining | Low |
| 4 | Promote Referral from roadmap item to strategic pillar | Low |
| 5 | Remove or clearly label the mock scorecard; replace the hero screen with a real RoofCheck result | Low |
| 6 | Split Attribution out as its own front-door engine | Low |
| 7 | Keep "all contractors" in the positioning, but state the roofing superpower explicitly and run the early pipeline in roofing (§6) | Low |
| 8 | Ship Pixel + CAPI and the speed-to-lead workflow — makes the front door true, trade-agnostic, and demoable beyond roofing | Medium |
| 9 | Build review/referral v1 — the back door, and what makes "all contractors" honest | Medium |
| 10 | Reconcile `rake.2-stack.com` against all of the above | Medium |
| 11 | Clarify how the 2Stack Launch System relates to RAKE: separate product, qualification off-ramp, or lower tier (affects GTM plan §7.2) | Low |

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

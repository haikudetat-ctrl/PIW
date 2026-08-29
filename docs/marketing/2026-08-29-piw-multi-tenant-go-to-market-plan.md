# PIW multi-tenant go-to-market plan

**Date:** 2026-08-29
**Status:** Proposed. Naming resolved (Rake, §4). All Season exclusivity
resolved — no contractual constraint on reselling (§14.1). **Strategy updated
2026-08-29: front door and back door — see the deck audit
(`2026-08-29-rake-deck-positioning-audit.md`) §5, which supersedes the
positioning in §6 below.** Open: territory sequencing, and pricing pending
COGS (§7.4).
**Scope:** Taking the platform in this repository to market as a product sold to
roofing contractors beyond All Season.
**Companion document:** `2026-08-29-all-season-growth-marketing-plan.md` covers
demand generation *for* All Season. This document covers selling the *platform*
to other tenants.

**Evidence discipline:** Repository facts are cited to files. Market claims,
competitor behavior, and financial figures I could not verify from the code are
marked **[ASSUMPTION]** or **[VERIFY]** and must be confirmed before anyone
commits money or makes a claim to a prospect.

---

## 1. Executive summary

**The honest position.** This is a working, well-engineered, single-market
vertical MVP with one production tenant. It is not a self-serve SaaS and should
not be sold as one. The correct motion for the next two quarters is a
**high-touch, done-for-you, territory-exclusive managed platform** sold founder-
led to a small number of design partners, deployed per-tenant, invoiced
manually.

**The good news, and it is better than the architecture doc implies.** The
architecture spec lists "multiple companies or tenants" under *Excluded*
(§2.2). The database disagrees. There is a `companies` table, a `company_id`
foreign key on roughly 49 tables across 14 migrations, **row-level security
enabled on 62 tables with 68 policies**, and a `current_company_id()` function
that scopes every authenticated read and write to the caller's company via
`admin_profiles`. The hardest and least glamorous part of building multi-tenant
software — provable data isolation — is substantially done and tested (20 pgTAP
suites, 126 test files, CI-gated).

**What actually blocks a second tenant** is not the data model. It is four
specific things: New Jersey is hard-coded into database `CHECK` constraints and
Zod literals in ~13 places; tenant identity is pinned per-deployment by
environment variable; brand is a TypeScript constant; and there is no
onboarding or billing of any kind. These are bounded, well-understood
engineering tasks — not an architectural rewrite. §3 sizes each.

**The wedge.** Do not sell a CRM. The market has AccuLynx and JobNimbus and
contractors are exhausted by migrations. Sell the thing that sits *in front of*
the CRM: turning ad spend into measured, scored, pre-qualified appointments, and
feeding conversion data back to the ad platforms so acquisition compounds.
A JobNimbus integration already exists in this repo
(`src/modules/access-route/`, `INTEGRATIONS_JOBNIMBUS_ENABLED`). **Landing
alongside the incumbent CRM instead of replacing it is the single most
important GTM decision in this document.**

**No contractual blocker.** All Season is buying access to the platform, not
ownership of it; there is no exclusivity or IP constraint on selling to other
contractors, New Jersey included (§14.1). What remains is commercial judgment
with a short shelf life: All Season is the only source of the case study, so
avoid their immediate South Jersey radius until it is published, then sell on
merit.

---

## 2. What is actually built — the sellable asset

Everything in this section is in the repository today. This is the inventory a
salesperson may honestly claim, subject to the feature flags in §3.4.

### 2.1 The differentiated core: pre-appointment property intelligence

A homeowner enters an address. Before any human is involved, the system:

- Resolves and canonicalizes the address through Google Places, restricted to
  the US and biased to New Jersey.
- Measures the roof through Google Solar Building Insights.
- Prices it from stored per-square cents with a `pricing_version` tag
  (`supabase/migrations/20260731152200_google_roof_estimates.sql`: defaults
  50000 / 75000 cents, version `nj-asphalt-v1`).
- Runs a nine-question assessment producing `need`, `intent`, and `urgency`
  scores and a recommendation of `monitor_or_repair` /
  `replacement_may_make_sense` (`src/domain/roof-assessment.ts`).
- Returns a themed result page carrying the homeowner's own satellite image,
  bound server-side to the campaign they arrived from.

**This is the product.** Competitors measure roofs *after* a rep is on site or
after a photo capture. This measures and scores *before* anyone is dispatched.
That is the entire economic argument: it moves qualification upstream of the
most expensive resource a roofing company has, which is a rep in a truck.

### 2.2 Supporting capability, all shipped

| Capability | Evidence |
| --- | --- |
| Multi-tenant data isolation | `companies`, `company_id` on ~49 tables, RLS on 62 tables, 68 policies, `current_company_id()` |
| Durable event pipeline | Inngest workers, `domain_events`, `event_outbox`, correlation/causation IDs, idempotency keys |
| Evidence and confidence model | `observations`, `evidence_artifacts`, `source_records`, field-level confidence, `audit_log` |
| Lead pipeline and workspace | `leads`, `lead_stage_history`, `tasks`, `interactions`, `notifications`, review queue |
| Context dialer | `src/modules/context-dialer`, static map + Slack delivery, so a rep dials with the property on screen |
| Abandonment recovery | `src/inngest/functions/assessment-abandonment-worker.ts` |
| Consultation booking | Contact method (call/text/email) + call window (asap/morning/midday/afternoon/evening), `America/New_York` |
| Cross-device resume | Twilio Verify, with a deliberate 8.25s timing floor against enumeration |
| Attribution capture | 5 UTM params + `fbclid` + `_fbp` + `_fbc` persisted per lead; `lead_attribution_touches`, `meta_conversion_events` |
| Consent and suppression | `lead_consents`, `lead_consent_evidence`, `suppression_list` |
| Integration edge | JobNimbus, LeadConduit, LeadMaster, CallTools, Twilio — all flag-gated |
| Per-tenant cost intelligence | `src/modules/costs`, twice-daily digest, invoice/meter/rate-card/estimate confidence labeling |
| Engineering rigor | 126 test files, 20 pgTAP suites, CI runs lint + typecheck + tests + db tests + build |

### 2.3 Two under-appreciated assets

**Cost intelligence is a differentiator, not plumbing.** The cost worker
(`docs/runbooks/cost-intelligence.md`) already reconciles Vercel, Google Cloud
Billing, DigitalOcean, and Supabase spend against a monthly budget, and — this
is the important part — **labels every figure by confidence**: invoice, provider
meter, rate card, or manual estimate. Almost no vertical SaaS shows a customer
their true cost per acquired lead with that kind of honesty. Packaged as a
tenant-facing "what did this lead actually cost you" dashboard, it is a
differentiated feature and a retention hook. It needs per-tenant scoping to get
there (§3.5).

**The refusal to fabricate is a sales asset.** The rollout runbook states that
pending and professional-review states "must not emit sample or placeholder
dollars," and that a dollar range is valid only when backed by a same-company,
same-property `google_solar` insight with success status, a positive measured
area, and increasing real cent values. In a category full of instant-quote
tools that guess, *"we will tell your homeowner we do not know yet, rather than
make up a number that blows up your first appointment"* is a closing argument.
Lead with it.

---

## 3. Multi-tenant readiness gate

Sales motion must be gated on engineering reality. This is the honest status.

### 3.1 🟢 GREEN — data isolation

Done and tested. Tenancy is enforced at the database by RLS keyed to
`current_company_id()`, which resolves from `admin_profiles` via `auth.uid()`.
`service_role` bypasses RLS by design for trusted server-side workers, with
explicit grants and a comment explaining why. This is the right shape.

**Remaining work:** a formal cross-tenant isolation test suite — deliberately
attempting cross-company reads and writes as an authenticated user of another
tenant — plus a third-party penetration test. Both are *sales* deliverables as
much as engineering ones; mid-market contractors' insurers increasingly ask.

### 3.2 🔴 RED — New Jersey is hard-coded

The geographic lock is real and appears at every layer:

- `supabase/migrations/20260729161911_foundation.sql:40` —
  `state_code text not null default 'NJ' check (state_code = 'NJ')`
- `supabase/migrations/20260729224416_property_identity.sql:45` — same constraint
- `20260730013930_harden_property_identity_transactions.sql:271,313` — NJ in
  transaction functions
- `src/domain/property-identity.ts:19` — `z.literal("NJ")`
- `src/app/roof-estimate/form-data.ts`, `src/app/(app)/leads/new/…`,
  `src/app/api/integrations/all-season/campaign-estimate/schema.ts` —
  `z.literal("NJ")`
- `src/modules/providers/adapters/google-places.ts:60,74` and
  `src/inngest/functions/address-validation-worker.ts:29,903` — NJ gates

**Sizing [ASSUMPTION]:** this is a bounded refactor — replace the constraint
with a per-company served-states allowlist, lift the Zod literals to a
configured enum, and parameterize the two adapter gates. The parcel/MOD-IV
identity logic is genuinely NJ-specific (NJGIN, PAMS PIN, block/lot/qualifier)
and is the one part that does *not* generalize cheaply. Note, though, that the
**Google Solar measurement path does not depend on NJ parcel data at all** —
which means an out-of-state tenant can get the full instant-estimate product
with a degraded property-identity layer. That is a viable first-out-of-state
configuration and it materially de-risks expansion.

### 3.3 🔴 RED — one tenant per deployment

Tenant identity is pinned by environment variable —
`ALL_SEASON_INTAKE_COMPANY_ID`, `ROOF_ESTIMATE_COMPANY_ID`,
`ACCESS_ROUTE_COMPANY_ID` — and brand is a compile-time constant:

```
src/config/roof-estimate-brand.ts
  name, phoneDisplay, phoneHref, websiteUrl,
  googleListingUrl, googleRating, googleReviewCount, testimonial
```

Campaign definitions are likewise a TypeScript record (`src/config/campaigns.ts`).
Adding a tenant today means a code change and a separate deployment.

**This is survivable for the first 3–5 tenants and should not be
over-engineered away before then.** Per-tenant deployments give strong blast-
radius isolation and let you charge for a managed service. Plan to move brand,
campaign registry, pricing, and served states into per-company database
configuration when tenant #4 is signed — not before.

### 3.4 🟠 AMBER — the revenue engine ships disabled

`.env.example` defaults: `ROOF_ASSESSMENT_ENABLED=false`,
`PAID_PROVIDERS_ENABLED=false`, `TWILIO_VERIFY_ENABLED=false`,
`INTEGRATIONS_JOBNIMBUS_ENABLED=false`, `INTEGRATIONS_CALLTOOLS_ENABLED=false`,
both LeadConduit receivers off. The flags are correct engineering practice; the
GTM consequence is that **the demo does not exist until they are on in a
production-shaped environment**. Two `all_season_demo` staging Vercel projects
already exist in the cost resource map — use them as the sales demo environment
(§11).

### 3.5 🟠 AMBER — no onboarding, no billing, no per-tenant cost attribution

- **Onboarding:** "The app is invitation-only: there is no sign-up form"
  (`docs/runbooks/local-development.md`). A new admin is a manual Supabase
  Studio user plus a hand-written `insert into admin_profiles`. Fine for a
  done-for-you motion; fatal for self-serve. Do not build self-serve yet.
- **Billing:** no Stripe, subscriptions, plans, seats, or usage metering
  anywhere in the codebase. Invoice manually for the first cohort. Build
  metering when you can name the metric you would meter — probably measured
  estimates delivered.
- **Cost attribution:** `COST_RESOURCE_MAP_JSON` maps costs to allocation
  buckets by Vercel/Google/DigitalOcean resource ID, and excludes anything
  unrecognized rather than misassigning it. That design extends to per-tenant
  gross margin cleanly, but the mapping is currently All Season-shaped. **You
  cannot price confidently until per-tenant COGS is measured** — see §7.4.

### 3.6 🔴 RED — the analytics gap would ship to every tenant

There is no Meta Pixel, GA4, or GTM anywhere in `apps/website`, so the `_fbp`
and `_fbc` cookies the intake routes read are always null and the Meta CAPI
loop has nothing to match against (documented fully in the companion plan, §2.1).
Shipping that to a paying tenant would be selling an attribution product that
cannot attribute. **This must be fixed before the first paid tenant, not
before the first demo.**

### 3.7 Readiness summary

| Gate | Status | Blocks |
| --- | --- | --- |
| Data isolation | 🟢 | — |
| NJ hard-coding | 🔴 | Any out-of-state tenant |
| Per-deployment tenancy | 🔴 | Scale past ~5 tenants; not tenant #2 |
| Feature flags / demo | 🟠 | Any credible demo |
| Onboarding & billing | 🟠 | Self-serve; not done-for-you |
| Per-tenant COGS | 🟠 | Confident pricing |
| Pixel / CAPI | 🔴 | First **paid** tenant |

**Read this as: tenant #2 is a quarter of work away, not a year.** Tenant #2 in
New Jersey needs only §3.4 and §3.6. Tenant #2 out of state additionally needs
§3.2.

---

## 4. Naming and brand architecture

"Property Intelligence Worker" describes the mechanism to an engineer. It says
nothing to a roofing contractor about money, and "Worker" actively suggests
infrastructure plumbing. It should not go to market.

**Recommended: a two-tier brand.**

**Tier 1 — the platform, sold to contractors: `Rake`.**
This is already the decision in practice. `Rake` is the operating name
throughout the repo (`rake-website`, `#rake-ops-alerts`,
`docs/runbooks/rake-environments.md`), and **an initial marketing pass already
exists at `rake.2-stack.com`**. Adopting it costs nothing and reclaims work
already done.

The name also happens to be well chosen: **"rake" is roofing vocabulary** — the
rake edge is the sloped edge of a gable roof. A name native to the trade signals
that you build for roofers specifically, which is exactly the vertical-SaaS
credibility you want. Short, ownable, verb-adjacent ("raking in leads" is a gift
to a copywriter).

*Risk:* collides with the Ruby `rake` build tool, which complicates domain and
search acquisition. **[VERIFY]** trademark availability in class 42, and decide
whether the long-term home is a dedicated apex domain rather than a subdomain of
`2-stack.com` — a subdomain reads as an internal project, which undercuts the
premium positioning in §7.

**Action — audit the existing pass.** `rake.2-stack.com` is blocked from this
environment's network egress, so I could not read it. Before writing any new
positioning, reconcile it against §6 of this document: keep whatever already
lands, and check specifically that (a) it does not promise capability behind the
disabled flags in §3.4, (b) it positions against CRMs as a *partner* rather than
a replacement (§6.2), and (c) it does not carry inherited "Property Intelligence
Worker" or infrastructure language.

**Tier 2 — the homeowner-facing artifact: `RoofCheck`.**
This is already the product's own language — "Your personalized RoofCheck,"
"Your seasonal RoofCheck," "Your four-season RoofCheck"
(`src/config/roof-assessment.ts`). It is a strong consumer name and it is
already written into the copy.

The architecture matters commercially. Contractors get real marketing value
from a recognizable homeowner-facing brand on their estimate page — the way
contractors advertise that they use a known measurement tool. A co-branded
"RoofCheck, powered by Rake" result page turns every tenant's homeowners into
distribution for the platform. **That is the closest thing this product has to
a viral loop, and it is nearly free.**

**Alternatives, if `Rake` does not clear:**

| Name | Rationale | Risk |
| --- | --- | --- |
| **Pitch** | Roof pitch *and* sales pitch; the double meaning is genuinely on-strategy | Common word, hard to own in search |
| **Eaves** | Roofing vocabulary; calm, premium | Less energetic; weak verb form |
| **Underlay** | "The layer beneath your CRM" — an accurate positioning metaphor | Three syllables; more abstract |

Whatever is chosen, fix it before outbound. Renaming after a case study is
published is expensive.

---

## 5. Ideal customer profile

### 5.1 Primary ICP

**Stated audience is all contractors** (owner direction). The platform —
front door and back door — is trade-agnostic. Roof measurement is the roofing
superpower on top, not the platform's definition. See deck audit §6.

**Run the early pipeline in roofing regardless**, because it is the only segment
with a demoable product until the back door and speed-to-lead ship. Claim wide,
sell narrow, and make that a conscious sequencing choice rather than a drift.

Target profile — residential contractors with:

- **Revenue [ASSUMPTION]:** $3M–$25M. Below that, no marketing budget and no
  ops capacity. Above that, procurement cycles and in-house dev teams.
- **Paid acquisition already running:** spending meaningfully on Meta and/or
  Google every month. **This is the hardest qualifier and the most important
  one.** The product optimizes ad spend; a contractor with no ad spend has
  nothing to optimize and will churn.
- **2–15 sales reps** driving to appointments. The value is proportional to the
  cost of a wasted truck roll.
- **An incumbent CRM** — JobNimbus or AccuLynx. Presence of a CRM is a *buying
  signal*, not an objection, because integration is the wedge.
- **Buying aggregator leads** from Angi, Modernize, or LeadConduit flows and
  unhappy about quality or cost.
- **Owner-operator or a marketing lead** empowered to sign. Avoid anything
  needing committee approval at this stage.

### 5.2 Disqualifiers

Say no to these. Early wrong-fit customers in a done-for-you motion are
catastrophic, because each one consumes founder time that has no leverage.

- No existing ad spend. ("We get everything from referrals.")
- Storm-chasing and insurance-restoration-led businesses. Weather, hail,
  storm-probability, and insurance-claims intelligence are explicitly out of
  scope (architecture spec §2.2). Half their workflow is missing.
- Commercial roofing. Also out of scope; unsupported types create review tasks.
- Wants to replace their CRM. That is a different, much larger product.
- Wants self-serve, month-to-month, no onboarding call.

### 5.3 Expansion sequence

1. **Roofing** — now. The only segment with a demoable product today.
2. **Exterior trades** (siding, windows, gutters) — once the back door ships.
   They share the property-first model, and aerial measurement partially
   transfers.
3. **All contractors and home-service** — once the back door and trade-agnostic
   front door (speed-to-lead, attribution) are live. At that point the wide
   claim is backed by product for every prospect, not just roofers.

Note that solar and non-roofing exterior services are excluded from the v1
architecture, so step 2 is a product decision, not just a marketing one.

---

## 6. Positioning and competitive frame

### 6.1 Positioning statement

**Superseded by the deck audit §5 — front door and back door.** The current
statement:

*Your CRM runs your jobs. Rake runs your front door and your back door.* Every
lead measured, scored, and answered in minutes, with attribution back to the ad
that produced it. Every finished job turned into a review, a referral, and the
next lead. The messy middle — job production, scheduling, crews, accounting —
stays where it is.

For roofing specifically, the front door carries a capability no one else has:
every lead's roof measured, priced, and scored before a rep is dispatched.

Two notes on why this is the stronger frame. It converts "not another CRM" from
a negative claim into a positive one — an explicit refusal to own the mess, which
is credible to owners who have been sold all-in-one systems before. And the two
ends form a loop rather than a bundle: reviews and referrals are the cheapest
acquisition channel a contractor has, so the back door feeds the front.

### 6.2 The category frame

The strongest framing is a sequence, because it tells the prospect where you
sit without attacking their existing vendors:

```
  FRONT DOOR (RAKE)        THE MIDDLE            BACK DOOR (RAKE)
                           (their CRM)
  Ads → measure, score,    JobNimbus/AccuLynx    reviews, referrals,
  respond, attribute       jobs, crews, $$$      repeat, lifetime value
        ▲                                                │
        └──────── the back door feeds the front ─────────┘
```

The loop is the defensible part. Measurement tools do not close it to the ad
account. CRMs hold the outcome data but do not send it back. Review tools sit
downstream of everything and know nothing about where the customer came from.
Rake is positioned as the only component that spans ad click → contract →
referral and returns the signal to the top.

### 6.3 Competitive landscape

**[VERIFY every specific below with current public materials before using it in
a sales conversation. Competitor capabilities change quickly and stale claims
destroy credibility.]**

| Category | Examples | How Rake differs |
| --- | --- | --- |
| Aerial measurement reports | EagleView | Per-report cost, ordered for a known job. Rake measures *every inbound lead* automatically, pre-qualification |
| Photo/3D capture | Hover | Requires a person on site capturing. Rake requires only an address |
| Instant quote + proposals | Roofr | **Closest competitor.** Differentiate on the campaign→CRM→ad-platform loop, the evidence/confidence model, and refusal to fabricate ranges |
| Roofing CRM / production | AccuLynx, JobNimbus | Post-sale work management. Rake is pre-sale. **Partner, do not compete** |
| Speed-to-lead messaging | Podium, Hatch | Contact speed without property intelligence. Rake dials *with the measured roof on screen* |
| Lead marketplaces | Angi, Modernize | Sell you leads. Rake makes leads you already paid for convert better |

**The honest competitive weakness:** several of these are mature, funded,
multi-market products with support organizations. Rake is a one-tenant MVP
locked to New Jersey. Do not compete on breadth. Compete on the specific
economic claim in §6.1 and on being the vendor that will actually build what a
design partner asks for.

### 6.4 Message hierarchy

1. **Diagnosis (keep from the deck):** "You do not have a sales problem. You
   have a visibility problem — and you are the source of truth. That works
   until it does not."
2. **Economic (front door):** "Stop sending reps to roofs you could have
   disqualified from a desk."
3. **Compounding (the loop):** "Every job you win teaches Meta what a good lead
   looks like, and every job you finish produces the next one. Your cost per job
   falls as you use it."
4. **Scope (the refusal):** "Your CRM keeps the middle. We do not want your job
   costing."
5. **Trust:** "When we do not know, we say so. We will never hand your
   homeowner a made-up number."

---

## 7. Packaging, pricing, and territory

### 7.1 Territory exclusivity as the core commercial mechanic

Recommended: **sell county-level or DMA-level exclusivity.** In contractor
software this is a well-understood construct, and it does two things at once: it
creates genuine urgency ("Ocean County is open, and it will not be after we sign
someone"), and it justifies premium pricing. Because there is no contractual
constraint from All Season (§14.1), this is a lever you are choosing for
commercial reasons, not a concession — which also means you set the territory
granularity to whatever prices best, rather than to whatever avoids a conflict.

The cost is that it caps total addressable revenue per market and demands
careful territory definition. That is an acceptable trade for the first
20 customers.

### 7.2 Packaging

| Tier | Contents | Fit |
| --- | --- | --- |
| **Pilot** (90 days) | One campaign funnel, instant estimate, speed-to-lead, CRM sync, weekly review. Done-for-you setup. | Design partners |
| **Core** | Everything in Pilot + all three campaign themes, abandonment recovery, consultation routing, attribution reporting, one county exclusive | Primary offer |
| **Managed** | Core + Rake runs the ad account, creative production, multi-county exclusivity, cost-intelligence dashboard | Highest ACV, lowest scale |

**Managed is where the near-term money is** and it is where the companion
All Season plan becomes reusable intellectual property. You have already built
and documented a complete demand-gen program for one roofer; selling that
program as a service, with the platform underneath it, is a far easier first
sale than selling software alone.

### 7.3 Pricing model

Recommended shape: **platform fee + usage, with a floor.**

- Monthly platform fee covering the deployment, support, and territory
  exclusivity.
- Per-measured-estimate usage above an included allowance — this is the
  component that tracks real COGS (Google Solar calls, which are metered and
  capped at 9,500/month with a 180-day cache).
- Setup fee for done-for-you onboarding, which is real founder labor and should
  never be free. Discount it for design partners in exchange for a case study,
  not for nothing.

**All figures below are [ASSUMPTION] placeholders showing the shape of the
model, not recommended prices.** Set real numbers only after §7.4.

| Tier | Monthly | Setup | Included estimates | Overage |
| --- | --- | --- | --- | --- |
| Pilot | $1,500 | waived for design partners | 250 | $4 |
| Core | $3,000 | $5,000 | 750 | $3.50 |
| Managed | $6,000+ | $10,000 | 2,000 | $3 |

Sanity check against the buyer's economics: at the placeholder unit economics
in the companion plan (~$15.6k average contract, ~35% margin), **a single
additional closed job per month covers the Core tier several times over.** That
is the arithmetic to put in front of a prospect — and it means price is very
unlikely to be the real objection. Trust and switching cost will be.

### 7.4 You cannot price until you measure COGS

Known cost facts: Google Solar is capped at 9,500 calls/month with 180-day
caching; the current infrastructure budget is $1,500/month monitored twice
daily. But that $1,500 covers All Season plus staging, demo, and shared
infrastructure — it is **not** the marginal cost of tenant #2.

**Required before pricing is set:**
1. **[VERIFY]** Google Solar Building Insights and Places per-call pricing at
   current published rates. Do not estimate this; it is the dominant variable
   cost and it is directly checkable.
2. Extend `COST_RESOURCE_MAP_JSON` to allocate per tenant.
3. Measure marginal infrastructure cost of a second deployment.
4. Model support and success labor per tenant per month — in a done-for-you
   motion this is usually the largest real cost and the one founders
   systematically underestimate.

The 9,500/month cap deserves specific attention as a multi-tenant constraint.
For one tenant it is not binding (the companion plan shows saturating it would
require roughly half a million landing-page sessions). Across many tenants
sharing a Google Cloud project it becomes a genuine capacity ceiling and a
noisy-neighbor risk. Decide early whether tenants get isolated Google projects
and quotas; per-tenant projects are the safer design and also make COGS
attribution exact.

---

## 8. Proof assets

An MVP with one customer sells on proof, not features. Build these before
outbound.

### 8.1 There is no case study yet — plan around it

**All Season is not live in production.** The flags are still off and no real
traffic is running (owner confirmation, 2026-08-29). This is the most
consequential constraint in the plan and it must not be papered over.

Consequences:

- **The demo carries the entire early sale.** There is no reference customer, no
  before/after numbers, and no logo to show. §11.2 is therefore not one section
  among many — it is the product's only proof.
- **The case study moves to Q1 2027.** It requires the All Season program in the
  companion plan to run 60–90 days *with working attribution* before it can
  contain a single honest number.
- **Phase 0 is double-blocking.** Pixel/CAPI and speed-to-lead gate All Season's
  own marketing *and* every Rake claim about attribution and response time. It
  is the highest-priority engineering work across both plans.
- **Design partners are founding customers, not reference-followers.** Tell them
  plainly that they are first. That is a fine pitch for three partners who are
  buying influence and early pricing; it does not survive being scaled to ten.

**When it does exist**, the raw material is strong: 20+ years in business,
in-house NJ Electrical and HIC licenses, and a Google profile carrying **4.5
stars across 397 reviews** as of July 31, 2026
(`src/config/roof-estimate-brand.ts`). Publish it with four honest, specific,
attributable metrics — cost per lead, cost per consultation, speed to first
contact, close rate on measured versus unmeasured leads. In a trade where every
vendor claims to triple your leads, four checkable numbers beat one big round
one, and it is consistent with a product whose core promise is that it will not
fabricate figures.

### 8.2 The rest of the proof stack

| Asset | Purpose |
| --- | --- |
| **Live demo environment** | Uses the existing `all_season_demo` Vercel projects with flags on and seeded data |
| **ROI calculator** | Prospect enters ad spend, close rate, and average job value; returns cost of wasted truck rolls. Grounded in *their* numbers, not yours |
| **Security one-pager** | RLS-per-tenant, audit log, consent evidence, suppression list, cross-tenant isolation test results. Mid-market buyers and their insurers ask |
| **Sample RoofCheck** | A real result page a prospect can look at on their own house — the demo that sells itself |
| **Attribution teardown** | Show a prospect their own broken attribution. Most contractors have the same Pixel/CAPI gap this repo has, which makes the diagnosis both free and disarming |
| **Rake marketing site** | `rake.2-stack.com` already exists as an initial pass — audit and rework it against §6 rather than starting over (§4) |

That last one deserves emphasis. **The fastest way to earn a roofing
contractor's trust is to show them, in five minutes and at no charge, that
their ad platform is optimizing against data it does not have.** It is a real
finding, it is checkable, and it makes you the person who found it.

---

## 9. Go-to-market motion

### 9.1 Stage 1 — Design partners (Q4 2026)

**Target: 3 signed design partners. Not 10.** Each one consumes founder time
that does not scale; three is enough to learn from and few enough to serve well.

The offer: heavily discounted or free platform access for 90 days, full
done-for-you setup, direct roadmap influence, weekly working sessions — in
exchange for a written case study, a reference call commitment, and permission
to publish anonymized metrics.

Sourcing, in priority order:
1. **Chris's and All Season's existing network.** Roofing is relationship-
   dense; a warm introduction from a respected operator outperforms any
   outbound sequence.
2. **New Jersey roofing contractors.** No contractual restriction (§14.1); the
   only self-imposed limit is All Season's immediate South Jersey radius while
   they remain the intended case study. Staying in-state means no NJ refactor is
   needed to sign tenant #2. Note that with All Season not yet live (§8.1), the
   case-study restraint is worth less than it was — reassess if a good South
   Jersey partner appears.
3. **Trade associations** — NJ and regional roofing contractor associations.
4. **Targeted outbound** to contractors whose ads are visibly running in Meta's
   public Ad Library. This is a genuinely good sourcing channel: it pre-
   qualifies on the hardest criterion (active ad spend), and you can reference
   their actual live ads in the first email.

### 9.2 Stage 2 — Repeatable sale (Q1 2027)

Gate on: 3 design partners live, one published case study with real numbers,
per-tenant onboarding down from weeks to days, and per-tenant COGS measured.

Then: 10–15 paying tenants, territory-exclusive, still founder-led and still
done-for-you, but with a documented onboarding runbook and a repeatable
90-day launch program derived from the companion All Season plan.

### 9.3 Stage 3 — Leverage (Q2 2027+)

Only once §3.3 is resolved and onboarding is genuinely repeatable. Options at
that point: partner-led distribution through roofing consultants and marketing
agencies serving the trade, or a JobNimbus/AccuLynx marketplace listing.
**Distribution through the CRM's own marketplace is the highest-leverage
channel available to this product** and is worth building toward deliberately.

Do not build self-serve signup in this window unless the sales data demands it.
The done-for-you motion is a feature of a complex, high-ACV product, not a
temporary limitation.

---

## 10. Channel plan for the B2B motion

Roofing contractors are not reached the way SaaS buyers are reached. Weight
accordingly.

| Channel | Priority | Notes |
| --- | --- | --- |
| **Founder-led outbound** | **Highest** | Ad Library-sourced, referencing their live ads. 20–30 highly researched contacts beats 2,000 generic ones |
| **Referral and network** | **Highest** | The dominant channel in this trade |
| **Trade associations and events** | High | Regional roofing shows and association meetings. In-person credibility converts here in a way it does not online |
| **Roofing communities** | High | Owner-heavy forums and groups. Contribute expertise, especially attribution teardowns; never pitch cold |
| **Content / SEO** | Medium | Long payback, real compounding. Target contractor-intent terms: "roofing lead cost," "roofing Meta ads attribution," "reduce wasted roofing appointments" |
| **Trade publications and podcasts** | Medium | Roofing media is receptive to a technical operator with a real system |
| **Partner / CRM marketplace** | Medium now, **highest later** | Requires §3.3 |
| **Paid B2B ads** | **Low** | Small, hard-to-target audience. Defer until the sale is proven repeatable |

Note the asymmetry with the companion plan: for All Season, paid social is the
primary channel; for Rake, it is nearly last. Do not port the B2C playbook.

---

## 11. Sales process and the demo

### 11.1 Process

1. **Qualify (15 min).** Ad spend, rep count, CRM, lead sources, average job
   value. Disqualify fast and without apology against §5.2.
2. **Attribution teardown (30 min).** Free diagnostic of their tracking. Lead
   with value, not with slides.
3. **Demo (45 min).** See below.
4. **Economics (30 min).** ROI calculator using their numbers.
5. **Pilot proposal.** 90 days, defined success metrics, defined territory.
6. **Onboarding (2–4 weeks currently).** Deployment, integrations, campaign
   build, flag enablement per the rollout runbook, smoke tests, then traffic.

### 11.2 The demo — one rule

**Demo the prospect's own house.**

Ask for their address at the start of the call. Enter it live. Let them watch
their own roof get measured, priced, and scored, and let them see the result
page with their own satellite image on it. Nothing in a slide deck competes
with a contractor seeing their own roof measured in forty seconds by software
they did not know existed.

Then, and only then, show the operator side: the lead landing in the pipeline
with the score and the measurement attached, and the context dialer with the
property on screen.

Sequencing matters: **homeowner experience first, operator tooling second.**
The homeowner experience is the differentiated part; the pipeline view looks
like every CRM they have already seen.

Demo prerequisites: `ROOF_ASSESSMENT_ENABLED=true`, `PAID_PROVIDERS_ENABLED=true`,
Google credentials configured, and a verified real dollar range rendering in the
demo environment. **A demo that returns "professional review" instead of a
number loses the deal.** Test the exact demo path before every call.

### 11.3 Objection handling

| Objection | Response |
| --- | --- |
| "We already have JobNimbus." | Good — keep it. We sync to it. We work before it. |
| "How accurate is the measurement?" | Google Solar aerial data, cached 180 days, with a stored per-square pricing model your team sets. It is a preliminary range for qualification, not a final quote, and it is never presented as a survey. |
| "What if it can't measure?" | It says so. It will never invent a number and blow up your first appointment. |
| "You only have one customer." | True. That is why you are getting founder-level attention, roadmap influence, and design-partner pricing that will not exist in six months. |
| "We tried an instant quote tool." | Most price a roof. This one also scores intent and urgency, routes by call window, and sends what actually closed back to Meta. |
| "Is my data separate from other contractors'?" | Row-level security keyed to your company on every table, enforced by the database rather than application code. Here is the isolation test report. |

That "one customer" answer matters. **Do not hide the MVP status — price it.**
Design-partner scarcity is a real and honest close.

---

## 12. Roadmap: engineering unlocks gating GTM stages

| Quarter | Engineering | GTM unlocked |
| --- | --- | --- |
| **Q4 2026 (early)** | Pixel/GTM/GA4 + CAPI; ship speed-to-lead; enable flags in a demo environment; cross-tenant isolation tests | Credible demo; attribution teardown; security one-pager; reworked deck and `rake.2-stack.com`; **front door becomes true and trade-agnostic** |
| **Q4 2026 (late)** | **Review/referral engine v1 (the back door)**; per-company brand, campaign registry and pricing moved to DB config; onboarding runbook; per-tenant cost allocation | Design partners #1–3; **"all contractors" becomes an honest claim**; COGS-based pricing |
| **Q1 2027** | Lift the NJ lock: served-states allowlist, Zod literals → configured enum, parameterized adapter gates. Google-Solar-only mode for non-NJ | Out-of-state tenants; real TAM; **All Season case study publishes** |
| **Q1–Q2 2027** | Front/back-door scorecard (response time, attribution, estimate aging, review and referral velocity — nothing requiring accounting); tenant admin UI; usage metering; billing | 10–15 tenants without founder onboarding each one |
| **Q2 2027+** | Public API; CRM marketplace listing; partner tooling | Partner-led distribution |
| **Not planned** | Profitability engine; revenue/margin/crew reporting | Off-strategy — this is the middle, and it stays with their CRM |

The ordering is deliberate. Everything in the first row is required for the
*first conversation*. Everything in the second is required for the *first
dollar* — and note that the back-door build sits there, because it is what makes
the wide audience claim honest rather than aspirational. The NJ lock — which
looks like the scariest item — is deliberately third, because tenant #2 can be a
New Jersey roofer and does not need it.

The final row matters as much as the others. Deciding *not* to build job
costing removes the two hardest integration projects from the roadmap and is
what keeps a small team's surface area survivable.

---

## 13. Metrics

**Stage 1 (design partners)** — learning, not revenue:

| Metric | Target **[ASSUMPTION]** |
| --- | --- |
| Design partners signed | 3 |
| Time from contract to first live lead | < 21 days, trending to < 7 |
| Design partner activation (running paid traffic through the platform) | 3 of 3 |
| Partner-reported improvement in cost per appointment | Measured honestly, whatever it is |
| Case studies published with real numbers | 1 |
| Founder hours per tenant per month | Tracked from day one — this is the scale ceiling |

**Stage 2 (repeatable):** CAC and sales-cycle length, pilot→paid conversion,
logo and revenue retention, gross margin per tenant, expansion revenue from
territory additions.

**The leading indicator that matters most is founder hours per tenant per
month.** If it is not falling, nothing else in this plan scales, regardless of
how good the revenue looks.

---

## 14. Risks and open questions

### 14.1 The All Season relationship — legally clear, commercially still worth managing

**Resolved.** The owner confirms the contractual position: All Season is buying
*access to the platform*, not ownership of it. There is no exclusivity or IP
constraint on reselling to other contractors, including in New Jersey. This was
the one item that could have invalidated the plan; it does not.

Three consequences follow, and they are all favorable:

1. **The design-partner pool is the whole market, not a carve-out.** §9.1 no
   longer has to filter for non-competing geography. That matters, because the
   non-competing-North-Jersey pool was small and the filter was the main
   constraint on Stage 1 sourcing.
2. **Territory exclusivity becomes a pure commercial instrument** rather than a
   conflict-management device. It is now something you sell because it creates
   urgency and justifies price (§7.1), not something you concede because you
   have to.
3. **The story to future partners and investors is cleaner.** All Season is
   tenant #1 on a platform Chris owns — not a bespoke build he happens to be
   reusing. That is a materially better narrative for a CRM marketplace
   partnership or any outside capital conversation.

**What remains is commercial judgment, not legal constraint,** and it is
narrow: for the next 60–90 days you need All Season cooperative, because they
are the only source of the case study, the reference call, and the real
before/after numbers in §8.1. Signing their closest South Jersey competitor
*during that window* buys one deal and risks the asset that unlocks the next
ten.

**Recommendation:** treat it as sequencing, not policy.

- **Now through case study publication:** sell anywhere except All Season's
  immediate South Jersey service radius. This is a short, self-expiring
  restraint you are choosing, not one you owe.
- **After publication:** open. Sell on commercial merit. If a South Jersey deal
  is worth more than the reference, take it with eyes open.
- **Worth raising early either way:** offer All Season something for the
  reference — fee credit, locked pricing, or a revenue share on introductions
  they make. An anchor customer who actively refers is worth more than the
  restraint costs, and roofing is a referral-dense trade. Their 4.5★/397-review
  reputation is itself a distribution asset.

### 14.2 Risk register

| Risk | Severity | Mitigation |
| --- | --- | --- |
| **No reference customer — All Season is not live** | **Critical** | Phase 0 is double-blocking (§8.1). Cap design partners at 3 and pitch them as founding customers |
| Claiming "all contractors" while only roofers have a demoable product | **High** | State the roofing superpower explicitly; run the early pipeline in roofing; ship the back door to make the claim honest |
| Selling ahead of the product; demo returns "professional review" | **Critical** | §12 gates; verify the demo path before every call |
| Shipping the attribution gap to a paying tenant | **Critical** | §3.6 before first paid tenant |
| Done-for-you motion does not scale; founder becomes the bottleneck | **High** | Track founder hours/tenant; cap design partners at 3 |
| Wrong-fit early customers consume all capacity | **High** | Enforce §5.2 disqualifiers without exception |
| Pricing set below COGS because Google API costs were assumed | **High** | §7.4 before quoting anyone |
| Google Solar 9,500/month cap shared across tenants | Medium | Per-tenant Google projects and quotas |
| Losing All Season's cooperation before the case study publishes | **High** | Not a legal risk (§14.1) but a reference risk. Avoid their South Jersey radius until publication; offer fee credit or referral share for the reference |
| A funded competitor ships the same loop | Medium | Move fast on design partners; the evidence/confidence model and the CRM-feedback loop are the durable parts |
| Google Solar coverage gaps outside NJ | Medium | **[VERIFY]** coverage before selling a territory |
| Support burden as tenants scale | Medium | Runbooks exist and are good; extend them per tenant |
| Name collision on `Rake` | Low | **[VERIFY]** trademark and domain before launch |

---

## 15. What this plan deliberately does not do

- **It does not build self-serve.** Wrong motion for a complex, high-ACV,
  configuration-heavy product with one reference customer.
- **It does not chase storm and insurance restoration.** Explicitly out of
  scope; entering it means building a materially different product.
- **It does not compete with JobNimbus or AccuLynx.** It integrates with them.
  This is the highest-leverage strategic choice in the document.
- **It does not lift the NJ lock first.** Tenant #2 can be a New Jersey
  contractor, and with no contractual restriction (§14.1) that pool is now the
  full state minus a short, self-imposed South Jersey pause. Sequencing the
  refactor third buys a quarter.
- **It does not claim results All Season has not yet produced.** The case study
  waits for the companion plan to run with working attribution. A product whose
  core promise is "we will not fabricate a number" cannot fabricate its own.
- **It does not price anything.** Every figure in §7.3 is a placeholder pending
  §7.4.

---

## Appendix A — Evidence index

| Claim | Source |
| --- | --- |
| `companies` table; `admin_profiles.company_id` | `supabase/migrations/20260729161911_foundation.sql` |
| `company_id` on ~49 tables across 14 migrations | `grep` over `supabase/migrations/*.sql` |
| RLS on 62 tables, 68 policies | `grep -c "enable row level security"`, `grep -c "create policy"` |
| `current_company_id()` resolves via `auth.uid()` → `admin_profiles` | `foundation.sql:209-219` |
| `service_role` bypass is deliberate and documented | `foundation.sql:240-248` |
| NJ `CHECK` constraint on `properties.state_code` | `foundation.sql:40` |
| NJ constraint on property identity | `property_identity.sql:45`; `harden_property_identity_transactions.sql:271,313` |
| NJ Zod literals | `src/domain/property-identity.ts:19`; `src/app/roof-estimate/form-data.ts:16`; `src/app/(app)/leads/new/lead-intake-form-data.ts:14`; `campaign-estimate/schema.ts:48` |
| NJ adapter and worker gates | `google-places.ts:60,74`; `address-validation-worker.ts:29,903` |
| Tenant pinned by env var | `.env.example` — `ALL_SEASON_INTAKE_COMPANY_ID`, `ROOF_ESTIMATE_COMPANY_ID`, `ACCESS_ROUTE_COMPANY_ID` |
| Brand is a compile-time constant; 4.5★ / 397 reviews | `src/config/roof-estimate-brand.ts` |
| Campaign registry is a TS record | `src/config/campaigns.ts` |
| Pricing stored per estimate with `pricing_version` | `20260731152200_google_roof_estimates.sql:68-76` |
| Invitation-only; no sign-up form | `docs/runbooks/local-development.md:72` |
| No billing/subscription/Stripe code | `grep` over `src` and `supabase/migrations` |
| Feature flags default off | `.env.example` |
| Demo Vercel projects exist | `docs/runbooks/cost-intelligence.md` (`all_season_demo`) |
| Cost confidence labeling | `docs/runbooks/cost-intelligence.md` |
| No placeholder dollars; range validity rules | `docs/runbooks/all-season-assessment-rollout.md` |
| Assessment scoring and recommendations | `src/domain/roof-assessment.ts` |
| Abandonment worker | `src/inngest/functions/assessment-abandonment-worker.ts` |
| "RoofCheck" already in product copy | `src/config/roof-assessment.ts` |
| Multi-tenancy listed as excluded | `docs/superpowers/specs/2026-07-29-property-intelligence-worker-architecture-design.md` §2.2 |
| Weather, insurance, solar, commercial out of scope | same, §2.2 |
| 126 test files; 20 pgTAP suites; CI gates | `find`; `supabase/tests`; `.github/workflows/ci.yml` |
| Google Solar 9,500/month cap; 180-day cache | `README.md` |
| JobNimbus integration exists | `src/modules/access-route/jobnimbus-canary.ts`; `.env.example` |
| No Pixel/GA4/GTM | `grep` over `apps/website` |
| Existing Rake marketing pass at `rake.2-stack.com` | Reported by the repository owner; page not readable from this environment (egress blocked) |
| No contractual exclusivity or IP constraint on reselling the platform; All Season buys access | Confirmed by the repository owner, 2026-08-29. Not verifiable from this repository — the agreements are not in it |

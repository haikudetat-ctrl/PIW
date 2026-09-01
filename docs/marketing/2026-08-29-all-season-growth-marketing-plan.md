# All Season growth marketing plan

**Date:** 2026-08-29
**Status:** Proposed — awaiting owner sign-off on budget and Phase 0 sequencing
**Scope:** Demand generation and revenue operations for All Season (New Jersey
residential roofing, roof-first solar), executed on the PIW platform in this
repository.
**Author's note on evidence:** Every capability, constraint, route, and flag
cited below was read from this repository. Anything that is a benchmark,
assumption, or target rather than a repository fact is marked
**[ASSUMPTION]** and must be replaced with All Season's actuals before spend
is committed.

---

## 1. What this codebase actually is

This is not a generic web property. It is a closed-loop acquisition system with
four separable parts:

| Part | Path | Marketing role |
| --- | --- | --- |
| Public website | `apps/website/public` | Organic and AEO surface: 34 sitemapped URLs, 21 NJ county pages, 2 service pages, 4 resource guides |
| Campaign landing pages | `apps/website/app/campaigns` | Paid-traffic destinations; 3 live themed funnels |
| PIW dashboard and pipeline | `src` | Lead workspace, pipeline board, review queue, context dialer, tasks, notifications |
| Automation and integration edge | `n8n`, `infrastructure/n8n`, `src/modules/access-route` | Speed-to-lead, Meta CAPI feedback, LeadConduit, JobNimbus, CallTools, LeadMaster |

The strategically important property is the **instant property-specific
estimate**. A homeowner enters an address on a campaign page, and PIW resolves
the property through Google Places, measures the roof through Google Solar
Building Insights, prices it at the configured New Jersey baseline of
**$500–$750 per roofing square**, and returns a themed result page bound to the
campaign the homeowner arrived from
(`docs/superpowers/specs/2026-08-25-all-season-campaign-quote-continuity-design.md`).

That is the moat. Most New Jersey roofing competitors offer "free estimate"
forms that produce a callback. All Season can offer a measured number on the
homeowner's own roof, within one session, with the satellite image of their
house as the hero of the result page. The marketing plan below is built to
exploit that single asymmetry as hard as possible.

### 1.1 Positioning inputs already encoded in the product

Drawn from `apps/website/public/llms.txt`, `services/roofing.html`, and
`src/config/roof-assessment.ts`:

- New Jersey roofing contractor, founded **2009**, office at 28 S New York Rd,
  Galloway, NJ 08205, phone (888) 832-5050.
- **In-house** roofing and solar crews; NJ Electrical License and NJ HIC
  License held in-house — not subcontracted. This is a genuine differentiator
  in a subcontractor-heavy trade.
- Roof-first, not solar-first: solar is coordinated "when roof condition and
  homeowner goals support it." The site's own resource guide is literally
  *Roof or Solar First?*
- Long-term workmanship coverage; the `for-every-season` campaign asserts
  "20+ years in business," `seasonal-shield` asserts "Lifetime warranty."
- The product's own voice is restraint: "no pressure," "no guesswork," "plain
  language," "only the work your home actually needs," and a hard product rule
  that pending states **must never emit sample or placeholder dollars**
  (`docs/runbooks/all-season-assessment-rollout.md`).

**Positioning statement.** *For New Jersey homeowners who suspect their roof
needs work but do not trust roofing salespeople, All Season is the local,
in-house-licensed roofing company that gives you a measured number on your own
roof before anyone sets foot on your property — because we would rather be
right than be first in the door.*

The wedge is **the removal of the sales ambush**, not price and not speed.
Every campaign asset in the repo already speaks this way; the media plan must
not contradict it with urgency-bait creative.

---

## 2. Phase 0 — blockers that must clear before any paid spend

These are not recommendations. Spending on paid media before these are fixed
burns money into an unmeasurable void.

### 2.1 CRITICAL: there is no browser tracking on the website at all

`grep` across `apps/website` for `fbq`, `gtag`, `dataLayer` initialization,
`googletagmanager`, or `connect.facebook.net` returns **no Meta Pixel, no GA4,
no GTM container, and no analytics of any kind**. The only hits are two
defensive `dataLayer.push()` calls
(`apps/website/public/quote-drawer.js:48`,
`apps/website/app/campaigns/campaign-estimate-form.tsx:10`) that push into an
array **nothing ever creates**.

The consequence is specific and severe. The server routes read Meta click
identifiers from cookies:

```
apps/website/app/api/campaign-estimate/route.ts:138
    fbp: request.cookies.get("_fbp")?.value,
    fbc: request.cookies.get("_fbc")?.value,
```

Only the Meta Pixel sets `_fbp` and `_fbc`. With no Pixel deployed, **every
website-sourced lead is written to PIW with `fbp` and `fbc` null**. The Meta
Conversions API feedback loop is designed to match a downstream Purchase back
to the originating ad using exactly those fields, and the import notes say so
explicitly: leads from the website "need `fbclid`, `fbp`, and `fbc` captured at
form-fill time and written onto the lead record, or this workflow has nothing
to match the eventual Purchase event back to the original ad"
(`docs/audits/source/lead-automation-2026-08-01/speed-to-lead-and-meta-capi-notes.md`).

`fbclid` alone survives as a URL parameter, which is partial mitigation, but
iOS and browser-level attribution loss makes click-ID-only matching materially
worse than the Pixel plus CAPI pair.

**Action:** deploy GTM (or direct tags) across `apps/website/public/*.html`,
`apps/website/app/layout.tsx`, and the campaign route, carrying Meta Pixel and
GA4. Initialize `window.dataLayer` so the two existing pushes stop being
no-ops. Verify `_fbp`/`_fbc` land on a real campaign-estimate submission before
turning on spend.

### 2.2 CRITICAL: the Meta CAPI and speed-to-lead workflows are not shipped

`n8n/workflows/` contains only `slack-execution-failure.json` and a `reference`
directory. The rake environments runbook is blunt about it: the brief
"references `roof-lookup-schema.sql`, `speed-to-lead-schema.sql`, and
`meta-capi-schema.sql`, but those source files were not supplied in this repo"
(`docs/runbooks/rake-environments.md`).

The import notes further document that the speed-to-lead skeleton has its
business-hours timezone **hardcoded to `America/Chicago`** for a company in
`America/New_York`, and that after-hours leads are parked at
`speed_to_lead_status = 'queued_after_hours'` with **no scheduled job that ever
drains that queue**. Both are lead-losing defects, not polish items.

**Action:** ship these two workflows as Phase 0 deliverables. Speed-to-lead
fires in parallel off raw lead insert, not downstream of enrichment. CAPI ships
the Purchase event first; `JobCompleted` is a later value-optimization
refinement, not a launch requirement. Keep `event_id` as
`{lead_id}-{event_name}` so a client-side Pixel Purchase, if ever added,
dedupes rather than double-counts.

### 2.3 HIGH: `do-it-right-once` is documented as live and is retired in code

`docs/campaigns/README.md` lists **four** campaign routes including
`/campaigns/do-it-right-once` with asset status "Ready," and hero artwork still
sits in `apps/website/public/campaigns/do-it-right-once/`. But the slug is
absent from both registries (`apps/website/app/campaigns/campaigns.ts`,
`src/config/campaigns.ts`) and is explicitly rejected by canonical estimate
intake — asserted by tests in
`apps/website/app/api/campaign-estimate/route.test.ts:180` and
`campaigns.test.ts:15`, and stated in `apps/website/README.md:28`.

Any media buyer reading the docs README would point ad spend at a dead route.
**Action:** correct `docs/campaigns/README.md` to three live campaigns before
anyone builds a media plan from it, and decide deliberately whether "Do It
Right. Once." — arguably the strongest of the four positions — gets rebuilt.

### 2.4 HIGH: the revenue engine is gated off

`.env.example` ships with `ROOF_ASSESSMENT_ENABLED=false`,
`PAID_PROVIDERS_ENABLED=false`, `TWILIO_VERIFY_ENABLED=false`,
`INTEGRATIONS_JOBNIMBUS_ENABLED=false`, `INTEGRATIONS_CALLTOOLS_ENABLED=false`,
and both LeadConduit receivers disabled. With paid providers off, the system
correctly yields "pending" or "professional review" results rather than
inventing dollars — which is the right safety behavior and the wrong launch
state. **The instant-estimate promise the entire media plan rests on does not
exist until these flags are on in production.**

**Action:** run `docs/runbooks/all-season-assessment-rollout.md` in its stated
order — migrations, PIW, website, smoke tests, then traffic — and confirm a
real dollar range renders end to end on a preview deployment before the first
ad impression is bought.

### 2.5 MEDIUM: no consented nurture path is wired

`ESTIMATE_SMS_WEBHOOK_URL` and `ESTIMATE_EMAIL_WEBHOOK_URL` are declared and
blank. Consent for processing, email, and SMS is captured at intake, and the
campaign forms promise "Your preliminary range will arrive by email and text."
Until those webhooks resolve to a real sender, All Season is collecting consent
it cannot act on and making a delivery promise it cannot keep.

### Phase 0 exit criteria

Do not buy media until all five are true:

1. Pixel and GA4 fire on every public page; `_fbp` and `_fbc` are non-null on a
   test campaign-estimate lead in production.
2. Speed-to-lead is live, on `America/New_York`, with an after-hours drain job
   running at ~8:01 AM ET.
3. Meta CAPI Purchase events post successfully and appear in Events Manager
   with match quality reported.
4. A real dollar range renders end-to-end on at least one production test lead
   per live campaign slug.
5. Email and SMS delivery of the estimate is functioning against captured
   consent.

---

## 3. Target market and segmentation

### 3.1 Geography

The site already publishes guides for **all 21 New Jersey counties**
(`apps/website/data/service-areas.json`, 21 entries; 21 county pages in the
sitemap). The office is in Galloway, Atlantic County.

Publishing 21 county pages is an SEO decision. **Buying media in 21 counties is
a mistake.** Crew travel time, staging, and dumpster logistics — all of which
PIW's GIS worker is designed to reason about
(`docs/superpowers/specs/2026-07-29-property-intelligence-worker-architecture-design.md` §5.4)
— degrade margin with distance from Galloway.

Recommended paid geography, three concentric tiers:

| Tier | Counties | Role | Suggested share of paid budget **[ASSUMPTION]** |
| --- | --- | --- | --- |
| **Core** | Atlantic, Cape May, Cumberland, Ocean | Home turf; shortest drive; densest referral base | 60% |
| **Adjacent** | Burlington, Gloucester, Camden, Salem, Monmouth | Proven-reachable expansion | 30% |
| **Test** | Middlesex, Mercer | Read-only test cells; expand only on demonstrated CPA | 10% |

The remaining 10 northern counties stay **organic-only** until Core and
Adjacent CPA is stable. Their county pages keep earning long-tail search
without spending a dollar.

### 3.2 Homeowner segments — taken from the product's own scoring model

`src/domain/roof-assessment.ts` already segments homeowners. The assessment
asks nine ordered questions and produces three scores — `need`, `intent`,
`urgency` — plus one of three recommendations: `monitor_or_repair`,
`replacement_may_make_sense`, and an intermediate state. It flags
`highIntent` at `intent >= 3 || urgency >= 3`, and weights the reason
`known_replacement` at 4 and `transaction` (a pending home sale) at 1.

Marketing should use the same taxonomy the product uses, so segments survive
the handoff from ad to CRM without translation loss:

| Segment | Assessment signature | Marketing treatment |
| --- | --- | --- |
| **Known replacement** | `reason: known_replacement`, high need | Highest-value. Bid up. Route to immediate call. |
| **Damage-aware** | `conditionSignals` includes `active_leak`, `missing_shingles` | Urgency is real and earned — do not manufacture more. Speed-to-lead is the entire game. |
| **Transaction-driven** | `reason: transaction` | Home sale or purchase. Deadline-bound, price-sensitive, needs documentation. |
| **Planners** | `reason: planning`, `timeline: researching` | Long nurture. The resource guides are built for exactly this person. |
| **Solar-curious** | Arrives via solar resource pages | Roof-first reframe. This is All Season's structural advantage over pure-play solar installers. |
| **Uncertain** | `roofAge: unknown`, `conditionSignals: ["unsure"]` | The schema deliberately accepts uncertainty as a complete answer. Creative must too. |

That last row is a real creative constraint. The assessment was designed so a
homeowner who knows nothing about their roof can finish it. Ad creative that
demands the homeowner already self-diagnose ("Missing shingles? Call now")
filters out a segment the product is explicitly built to serve.

---

## 4. Funnel model and the metrics that matter

### 4.1 The funnel as the code actually implements it

```
Ad impression
  → Campaign landing page  (/campaigns/<slug>)
  → Address entry          (Google Places autocomplete, NJ-biased, US-restricted)
  → Contact + dual consent (processing + email/SMS)
  → POST /api/campaign-estimate  (captures 5 UTM params, fbclid, _fbp, _fbc)
  → PIW campaign-estimate intake (server-to-server, shared secret, tenant-scoped)
  → Assessment: 9 questions → need / intent / urgency → recommendation
  → Google Solar measurement → $ range at $500–750/square
  → Themed result page  /roof-estimate/[token]
  → Consultation request (call | text | email; window: asap/morning/midday/afternoon/evening)
  → Speed-to-lead dial + SMS
  → Pipeline → estimate → contract → Meta CAPI Purchase
```

Each arrow is a measurable drop-off and each is already a distinct persisted
state. Nothing new has to be built to instrument this funnel — only tagged.

### 4.2 Core KPI set

**Primary:** Cost per *Consultation Requested* — not cost per lead. An address
submission is cheap and abundant; a homeowner who saw their number and still
asked to talk is the qualified unit. This should be the ad platform's
optimization event once volume supports it.

Full scorecard:

| Layer | Metric | Source of truth |
| --- | --- | --- |
| Media | Spend, impressions, CTR, CPC, frequency | Meta / Google Ads |
| Landing | Landing page view → address-entry start | GA4 + `dataLayer` (Phase 0) |
| Conversion | Address start → submitted lead | `/api/campaign-estimate` 2xx rate |
| Fulfillment | Leads receiving a **real** dollar range vs. pending / professional-review | `roof_insights` provider `google_solar`, status `success` |
| Qualification | % `highIntent`; recommendation mix | `calculateRoofAssessment` outputs |
| Intent | **Consultation request rate** | consultation status `requested` |
| Speed | Median seconds, lead insert → first outbound touch | speed-to-lead workflow |
| Sales | Consultation → appointment → contract | Pipeline stage transitions |
| Revenue | Contract value; CAC by campaign slug and UTM | CAPI Purchase + pipeline |
| Cost | Google Solar calls consumed vs. the 9,500/month cap | Cost intelligence worker |

### 4.3 Attribution architecture

Two identifiers, two jobs, and they must not be confused:

- **Campaign slug** (`weather-report`, `seasonal-shield`, `for-every-season`)
  is the durable landing-page identity, stored on the lead, and is what PIW
  uses to theme the result page. It is trusted only from the server-side
  intake, never from a query parameter — the continuity design states PIW
  "does not trust a campaign name supplied in a result URL or browser query
  parameter."
- **UTM parameters** carry channel, ad set, and creative. All five
  (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`) are
  already captured and persisted.

**Mandatory UTM convention** — enforce it in a shared ad-URL builder, because
inconsistent casing here silently fragments every report:

```
utm_source   = meta | google | bing | email | sms | yardsign | referral
utm_medium   = paid_social | cpc | lsa | organic | email | sms | offline
utm_campaign = <slug>_<geo-tier>_<yyyymm>      e.g. seasonal-shield_core_202609
utm_content  = <creative-id>_<format>          e.g. shield-aerial-01_9x16
utm_term     = <audience-or-keyword>           e.g. homeowners-45plus-atlantic
```

Everything lowercase, hyphens inside a field, underscores between fields.

---

## 5. Channel plan

### 5.1 Meta paid social — primary, ~55% of paid budget **[ASSUMPTION]**

The entire stack is built for Meta: CAPI feedback loop, `fbp`/`fbc`/`fbclid`
capture, campaign landing pages with per-campaign themes. This is where the
instant-estimate hook does its most differentiated work, because Meta traffic
is interruption traffic that needs a reason to stop — and "see your roof's
number in 60 seconds, without a salesperson" is that reason.

- **Structure:** one campaign per geo tier; ad sets by audience; the three
  landing-page slugs as the creative-strategy axis.
- **Optimization:** start on Lead / custom conversion at
  campaign-estimate submission for volume, then graduate to the
  Consultation-Requested event once it clears the platform's learning threshold
  **[ASSUMPTION: ~50 events/week/ad set — confirm against Meta's current
  guidance]**.
- **Audiences:** homeowners in tier geographies, age 35+, homeowner and
  home-improvement behavioral signals; lookalikes seeded from *contracted*
  customers rather than from raw leads once CAPI Purchase has enough volume —
  this is precisely the payoff of shipping 2.2.
- **Retargeting:** the highest-ROI segment in this system is *saw their
  estimate, did not request a consultation*. They have seen a real number on
  their own roof. Retarget them with the result-page satellite framing and a
  single question: "Ready to talk through your number?"

### 5.2 Google Search, LSA, and PMax — ~30% **[ASSUMPTION]**

High-intent demand capture. Someone searching "roof replacement cost Ocean
County NJ" is mid-decision, and All Season can answer the query literally
rather than with a callback form.

- **Local Services Ads first.** Google Guaranteed badging is disproportionately
  valuable for a licensed, in-house-crew contractor and directly reinforces the
  positioning.
- **Search:** county-modified head terms, cost terms, and the roof-vs-solar
  timing cluster the resource pages already target. Point cost queries at the
  campaign pages; point research queries at the resource guides.
- **Hold PMax** until conversion data is trustworthy. PMax with broken
  attribution optimizes toward noise.

### 5.3 Organic search and answer-engine optimization — ~0% of paid budget, disproportionate return

This is the repository's quietest strength and it is genuinely ahead of the
category. `robots.txt` explicitly welcomes `GPTBot`, `ClaudeBot`,
`PerplexityBot`, `Google-Extended`, and `CCBot`, and `llms.txt` publishes a
structured company summary with services, service areas, resources, phone,
address, and credentials. Very few regional roofing contractors have done this.

Program:

1. **Keep `llms.txt` current.** It is the canonical machine-readable brief. It
   currently says "All Season Solar" while the site title says "All Season
   Roofing" — reconcile the brand string, because inconsistency across the
   exact surface that AI assistants read is self-inflicted.
2. **Deepen the 21 county pages.** They exist and are generated
   (`scripts/generate-service-areas.mjs`). Differentiate them with genuinely
   local substance: county permit realities, prevailing housing stock and roof
   age, shore-exposure wind considerations for Atlantic/Cape May/Ocean. Twenty-
   one near-identical pages are a thin-content liability; twenty-one genuinely
   local pages are a durable moat. **This is the single highest-leverage
   organic project.**
3. **Extend the resource cluster.** Four guides exist. The obvious gaps, all
   supported by the product's own logic: *How Much Does a Roof Replacement Cost
   in New Jersey?* (built directly on the $500–750/square model), *How to Read
   a Roofing Estimate*, *When a Roof Repair Is Enough* (mirrors the
   `monitor_or_repair` recommendation), and *Selling Your Home With an Aging
   Roof* (mirrors the `transaction` reason code).
4. **Structured data.** Add `LocalBusiness` / `RoofingContractor`,
   `AggregateRating` fed by the Google reviews route, `FAQPage` on resources,
   and `Service` + `areaServed` on county pages.
5. **Google Business Profile** — weekly posts, photo cadence, Q&A seeding. For
   local roofing this typically outperforms most content marketing per hour
   spent.

### 5.4 Reviews and social proof — continuous

`apps/website/app/api/google-reviews/route.ts` already pulls live Google
reviews through the Places API with rating, review count, author attribution,
and Maps deep links, server-side and rate-limited. The mechanism is built; what
is missing is a *review generation* process feeding it.

Install a post-completion review request through the same consented SMS and
email channels as the estimate delivery, triggered on job completion. Target
**[ASSUMPTION]** a sustained 25%+ request-to-review rate and a steady monthly
review velocity — recency weighs heavily in local pack ranking, and a stale
five-star profile underperforms a fresh 4.8.

Then reuse the reviews as paid creative. Real review text over the homeowner's
own neighborhood aerial is the highest-trust ad unit this stack can produce.

### 5.5 Email and SMS — owned, ~5% **[ASSUMPTION]**

Consent is captured; the transport is not wired (see 2.5). Once live:

- **Estimate delivery** (immediate) — the promised range, with the result-page
  link.
- **No-consultation sequence** (day 1, 3, 7, 21) — for homeowners who saw a
  number and went quiet. Educational, not pushy; the brand voice is "no
  pressure" and the sequence must honor that.
- **Planner nurture** (monthly) — for `timeline: researching`. Seasonal roof
  content, resource guides.
- **Post-completion** — review request, then referral ask, then annual
  check-in.

Honor the suppression list already in the schema
(`supabase/migrations/20260730155018_suppression_list.sql`) on every send.

### 5.6 Referral and offline — ~10% **[ASSUMPTION]**

Neighborhood density is worth more than raw volume for a roofer: crew mobilization
amortizes across nearby jobs, and the GIS worker is explicitly designed to
"identify nearby completed company projects." Run a structured neighbor
campaign around every completed job — door hangers and a geofenced Meta radius
around the job site — and a customer referral incentive tracked with
`utm_source=referral`.

---

## 6. Campaign and creative strategy

### 6.1 The three live campaigns are three distinct emotional bets

| Slug | Theme | Promise | Best-fit segment |
| --- | --- | --- | --- |
| `weather-report` | Forecast | "Your home gets no days off." Weather readiness before the next storm. | Damage-aware; seasonal spikes |
| `seasonal-shield` | Shield | "The roof above everything that matters." Protection and accountability. | Family-protective; warranty-motivated |
| `for-every-season` | Seasons | "One roof. A lifetime of confidence." 20+ years, local, lasting. | Planners; trust-first buyers |

They share one intake contract but differ in theme, artwork, proof points, and
result-page treatment. That is a well-built creative testing apparatus — use it
as one.

### 6.2 Testing matrix

Test **one variable at a time**, holding the others fixed:

1. **Landing-page theme** — the three slugs, equal budget, same audience, same
   creative concept. Read on cost per consultation request, not cost per lead.
2. **Hook** — measurement ("see your roof measured from the air") vs. protection
   ("what's above everything that matters") vs. no-pressure ("a number before a
   salesperson").
3. **Format** — 9:16 vertical, 4:5 feed, 1:1. The Drive masters are already
   organized by aspect ratio (`1.1`, `4.5`, `9.16`, `16.9`), so this test is
   cheap to run.
4. **Proof** — review-led vs. credential-led (in-house NJ Electrical + HIC) vs.
   tenure-led (since 2009).
5. **Seasonality** — `weather-report` ahead of forecast storm windows and
   through fall; `for-every-season` in stable spring and summer.

**[ASSUMPTION]** Minimum 100 conversions per cell before calling a winner; run
each test at least 14 days to clear day-of-week effects.

### 6.3 Creative guardrails, derived from product behavior

These are not brand-police preferences; each maps to a hard product constraint.

- **Never promise an exact price in an ad.** The product returns a *range*, and
  the rollout runbook forbids emitting placeholder dollars. "Get your roof
  estimate" is safe. "Your roof for $12,400" is not, and would break trust at
  the exact moment the result page loads.
- **Never promise instant delivery unconditionally.** With paid providers
  disabled or a Google Solar lookup that fails, the honest result is "pending"
  or "professional review." Say "a first look at your roof," not "an instant
  quote in 60 seconds guaranteed."
- **Never manufacture urgency the assessment does not find.** The model
  computes real urgency from real answers. Fake scarcity contradicts the
  product one click later.
- **Do not require self-diagnosis in the hook.** The assessment accepts
  "unknown" and "unsure" as complete answers by design.
- **Keep the homeowner's property the hero.** The continuity spec is explicit:
  campaign artwork is "an atmospheric frame" and "must not obscure the property
  or make the result look like another advertisement."

---

## 7. Budget, unit economics, and the constraints that bound them

### 7.1 Known cost facts from the repository

- Google Solar Building Insights calls are **atomically capped at 9,500 per
  calendar month**; measurements cache for **180 days**.
- Infrastructure north-star budget is **$1,500/month**, monitored twice daily
  by the cost worker with a Slack digest to `#rake-ops-alerts`.
- Pricing baseline is **$500–$750 per roofing square**.

### 7.2 The Solar cap is a hard demand ceiling — and it is generous

9,500 measurements/month is the ceiling on address submissions that can receive
a measured range, less cache hits. At **[ASSUMPTION]** a 2% landing-page
conversion rate, saturating that cap would require roughly 475,000 landing-page
sessions per month — far beyond any plausible regional roofing budget. The cap
is therefore **not a practical constraint at launch**, but it is a real one for
a scaled or scraper-abused funnel, and it should be alarmed at 70% consumption
rather than discovered at 100%.

### 7.3 Unit economics frame

All inputs below are **[ASSUMPTION]** and exist to show the arithmetic, not to
assert All Season's numbers. Replace each with actuals from the first 60 days.

| Input | Placeholder | Where the real number comes from |
| --- | --- | --- |
| Avg. roof size | 25 squares | `roof_insights` measured area, actual distribution |
| Avg. contract value | $15,625 (25 × $625) | Closed contracts in pipeline |
| Gross margin | 35% → ~$5,470 | Finance |
| Consultation → contract | 20% | Pipeline transitions |
| Lead → consultation request | 25% | Consultation status rate |
| **Implied max CAC at 3:1 LTV:CAC** | **~$1,820/contract** | Derived |
| **Implied target cost/consultation** | **~$364** | Derived |
| **Implied target cost/lead** | **~$91** | Derived |

Two things follow. First, roofing tolerates a high cost per lead — a
$91 target lead cost is comfortable in most NJ paid-social markets, which means
the binding constraint is almost certainly **close rate and speed to contact,
not media cost**. Second, that is exactly why the speed-to-lead workflow
(§2.2) matters more than any bidding optimization in this document.

### 7.4 Suggested allocation **[ASSUMPTION — set against actual budget]**

| Line | Share | Notes |
| --- | --- | --- |
| Meta paid social | 55% | Primary demand generation |
| Google Search + LSA | 30% | Demand capture; LSA first |
| Email / SMS tooling | 5% | Owned channel |
| Referral / offline | 10% | Neighbor campaigns, door hangers |
| *Content and SEO* | *separate line* | Labor, not media; highest long-run ROI |

---

## 8. 90-day roadmap

Phase order intentionally mirrors the rollout runbook's invariant: migrations,
PIW, website, smoke tests, **then** traffic. Do not reorder to launch sooner.

### Days 1–30 — Instrument and unblock (no meaningful paid spend)

| # | Deliverable | Owner |
| --- | --- | --- |
| 1 | GTM + Meta Pixel + GA4 across website and campaign routes; initialize `dataLayer` | Eng |
| 2 | Verify `_fbp`/`_fbc` non-null on a production test lead | Eng + Marketing |
| 3 | Ship speed-to-lead workflow; timezone `America/New_York`; after-hours drain at 8:01 AM ET | Eng |
| 4 | Ship Meta CAPI Purchase feedback loop; confirm in Events Manager | Eng |
| 5 | Run the assessment rollout runbook; enable `ROOF_ASSESSMENT_ENABLED` and paid providers in production | Eng |
| 6 | Wire `ESTIMATE_SMS_WEBHOOK_URL` and `ESTIMATE_EMAIL_WEBHOOK_URL` | Eng |
| 7 | Fix `docs/campaigns/README.md` (three live campaigns); decide `do-it-right-once` | Marketing |
| 8 | Reconcile "All Season Solar" vs. "All Season Roofing" across `llms.txt`, titles, GBP | Marketing |
| 9 | Add structured data; claim/optimize Google Business Profile; apply for LSA | Marketing |
| 10 | Publish the UTM convention and a shared ad-URL builder | Marketing |
| 11 | Small validation spend **[ASSUMPTION: ~$2–3k]** in Core tier only, to prove tracking end to end | Marketing |

**Gate:** do not proceed to Days 31–60 until every Phase 0 exit criterion in
§2 passes.

### Days 31–60 — Launch and learn

- Full Meta launch across Core and Adjacent tiers; three landing-page slugs at
  equal budget as Test 1.
- Google LSA live; Search campaigns on cost and county-modified terms.
- Retargeting live for saw-estimate-no-consultation.
- Email/SMS sequences live, suppression-list-aware.
- Review generation program live on job completion.
- Deepen 6–8 county pages, prioritized by paid volume.
- Publish 2 new resource guides.
- **Weekly** scorecard review; **daily** speed-to-lead median check.

### Days 61–90 — Optimize and compound

- Shift Meta optimization to the Consultation-Requested event.
- Build lookalikes from CAPI Purchase (contracted customers, not raw leads).
- Declare a landing-page theme winner; reallocate; begin Test 2 (hook).
- Replace every **[ASSUMPTION]** in §7.3 with measured actuals; recompute
  target CPA and reset bids.
- Expand Test tier only if Core/Adjacent CPA holds.
- Evaluate whether `do-it-right-once` returns as a fourth funnel.
- First full CAC-by-campaign-slug and CAC-by-UTM report.

---

## 9. Risk register

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Spend before Pixel/CAPI ship → unattributable, unoptimizable budget | **Critical** | Phase 0 gate; validation spend only |
| Slow first contact → lost leads regardless of media quality | **Critical** | Ship speed-to-lead; alarm on median time-to-first-touch |
| Ads promise an exact price the product returns as a range | High | Creative guardrails §6.3; legal/owner review of every claim |
| TCPA/consent exposure on SMS | High | Dual consent already captured at intake; honor suppression list on every send; retain consent evidence |
| Google Solar cap or quota exhaustion at scale or under abuse | Medium | Alarm at 70% of 9,500; 180-day cache; rate limits already in place |
| Paid providers disabled → "pending" results on paid traffic | High | Verify flags before each spend increase; monitor real-range rate |
| Thin-content penalty across 21 near-identical county pages | Medium | Differentiate with genuinely local substance |
| Infra cost drift past $1,500/month as volume grows | Medium | Cost worker digest already running twice daily |
| Parcel/measurement data presented as authoritative | Medium | Architecture is explicit that geometry "must not be presented as a legal survey" — keep that language in homeowner-facing copy |
| Over-reliance on Meta as a single channel | Medium | LSA and organic build a second and third leg |
| Brand-name inconsistency degrades AI-assistant answers | Low | §5.3 item 1 |

---

## 10. Operating cadence

| Cadence | Review | Attendees |
| --- | --- | --- |
| Daily | Speed-to-lead median; new leads; failed enrichments; consultation requests | Sales + Ops |
| Weekly | Full scorecard §4.2; creative performance; test status; spend pacing | Marketing + Owner |
| Monthly | CAC by slug and UTM; unit economics refresh; cost-intelligence reconciliation; review velocity | Marketing + Owner + Finance |
| Quarterly | Positioning, geo tiers, channel mix, campaign portfolio | All |

**Single source of truth:** PIW. Ad platforms report their own conversions and
will over-claim; the pipeline holds contracts. When they disagree, the pipeline
wins.

---

## 11. What this plan deliberately does not do

- **It does not add channels the stack cannot measure.** No TikTok, no
  programmatic display, no radio until Meta and Google attribution is proven.
- **It does not market PIW as a SaaS product.** The architecture is explicitly
  single-tenant — "one roofing company," multi-tenancy listed under *Excluded*.
  Productizing it is a real opportunity and a different plan; it would require
  tenancy, onboarding, and support work that does not exist yet.
- **It does not assume storm or insurance demand.** Weather, hail, storm-
  probability, and insurance-claims intelligence are explicitly out of scope for
  v1. The `weather-report` campaign sells *readiness*, not storm-damage claims
  assistance, and the creative must respect that distinction.
- **It does not invent All Season's historical performance.** Every benchmark
  is labeled and must be replaced with actuals.

---

## Appendix A — Evidence index

| Claim | Source |
| --- | --- |
| No Pixel/GA4/GTM anywhere on the site | `grep` across `apps/website`; only orphan `dataLayer.push` at `public/quote-drawer.js:48`, `app/campaigns/campaign-estimate-form.tsx:10` |
| `_fbp`/`_fbc` read from cookies | `apps/website/app/api/campaign-estimate/route.ts:138-139`; `app/api/intake/route.ts:29` |
| Website leads need fbp/fbc/fbclid for CAPI matching | `docs/audits/source/lead-automation-2026-08-01/speed-to-lead-and-meta-capi-notes.md` |
| CAPI/speed-to-lead workflows not in repo | `n8n/workflows/` contents; `docs/runbooks/rake-environments.md` |
| Speed-to-lead timezone `America/Chicago`; after-hours queue undrained | speed-to-lead import notes |
| `do-it-right-once` retired | `apps/website/README.md:28`; `app/campaigns/campaigns.test.ts:15`; `app/api/campaign-estimate/route.test.ts:180` |
| Four campaigns still documented as live | `docs/campaigns/README.md` |
| Feature flags default off | `.env.example` |
| $500–750 per square; 9,500/month Solar cap; 180-day cache | `README.md` |
| No placeholder dollars; rollout order | `docs/runbooks/all-season-assessment-rollout.md` |
| Assessment scoring: need/intent/urgency, `highIntent` threshold | `src/domain/roof-assessment.ts` |
| Consultation methods and call windows | `src/modules/roof-assessment/consultation-preference.ts` |
| Campaign slug not trusted from query params | `docs/superpowers/specs/2026-08-25-all-season-campaign-quote-continuity-design.md` |
| AI crawlers welcomed; structured company brief | `apps/website/public/robots.txt`, `public/llms.txt` |
| 21 county pages; 34 sitemap URLs | `apps/website/data/service-areas.json`, `public/sitemap.xml` |
| Live Google reviews feed | `apps/website/app/api/google-reviews/route.ts` |
| $1,500/month infra budget; twice-daily digest | `docs/runbooks/cost-intelligence.md` |
| Weather/insurance out of scope; single tenant | `docs/superpowers/specs/2026-07-29-property-intelligence-worker-architecture-design.md` §2.2 |
| Suppression list exists | `supabase/migrations/20260730155018_suppression_list.sql` |

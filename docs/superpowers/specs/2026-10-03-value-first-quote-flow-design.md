# Value-first quote flow design

## Objective

Increase completed leads by showing homeowners something real about their roof before asking for contact details, and by replacing four inconsistent entry forms with one flow.

Today every entry point asks for name, phone, and email before the homeowner sees anything. After submitting, they wait through a loading sequence, answer nine assessment questions, and only then see a price. The new flow reverses the exchange: address first, then the homeowner's own roof and its measured size, then three one-tap questions, then contact details to unlock the price.

Primary metric: leads per 100 campaign visitor-days, measured server-side from `website_arrivals` and leads, so it doesn't depend on analytics consent. Guardrails: lead quality (consultation request rate, contact rate), Google provider spend per lead, and bot/abuse volume. See **Measurement** for why this is a monitored rollout, not a split test.

## Current state

| Entry point | Steps | Address entry |
|---|---|---|
| Campaign landing pages (`apps/website/app/campaigns`) | Address → contact | Google autocomplete |
| Quote drawer (`apps/website/public/quote-drawer.js`) | One long step | Five manual fields |
| Homepage and contact forms (`index.html`, `contact.html`, `script.js`) | One long step | Manual fields |
| PIW `/roof-estimate` | Address → contact | Google autocomplete |

After any submission: secure continuation → eight-second analysis sequence → property reveal → nine questions (reason, roof age, condition, visibility, stories, complexity, priority, timeline, ownership) → Good/Better/Best range.

Pricing depends only on Google Solar measured roof squares. The questions feed need, urgency, and recommendation scoring, not the dollar range.

## New experience

The whole flow runs on a branded host (see **Branded domain**).

1. **Address.** One field with Google autocomplete and a manual-entry fallback. A passive property-processing notice sits above the button: “By clicking ‘See my roof,’ you authorize All Season Solar to review this address using property records, maps, and imagery.” An invisible Cloudflare Turnstile check runs on submit.
2. **Analysis and reveal.** The existing qualitative analysis sequence (eight-second minimum, twelve-second imagery ceiling) followed by the aerial image, the confirmed address with a correction link, and the measured roof size: “About 24 roofing squares · moderately complex roof.” No dollar figure.
   A secondary link, “Email me this roof report,” is available from the reveal onward (see **Saved reports**).
3. **Three one-tap questions.** Reason for checking the roof, roof age, and timeline. Each auto-advances on tap; a back link is always present. These are the inputs that drive need and urgency scoring and lead routing.
4. **Contact.** Name, email, and mobile phone with the existing TCPA notice naming the button (“Unlock my price”). The notice drops the property-processing clause because step 1 already recorded it.
5. **Price.** The existing Good/Better/Best result and consultation CTA.
6. **Refine (optional).** The remaining six questions (condition, visibility, stories, complexity, priority, ownership) are offered after the result as “Refine your estimate.” Answers update the recommendation and lead score but never block the price.

### When roof size is not available yet

Google Solar normally completes within two seconds of coordinates. If it is still pending at reveal, show the aerial with “Measuring your roof…” and continue to the questions; the size fills in when ready. If Solar returns `review_required`, show the aerial and say a specialist will confirm the measurement; the price step follows the existing review-required result. The flow never invents a size or range.

### Manual addresses

Manual addresses skip the fast path, as today. The reveal shows the address and a neutral image placeholder, never Google-confirmed copy, and roof size is omitted. Questions and contact proceed normally; the price follows the existing slower validation path.

## Architecture

### One flow, hosted by PIW

The flow after the address step is implemented once, in PIW's public `/roof-estimate` experience, which already owns the analysis sequence, aerial loading, questions, result, campaign theming, and secure continuation.

Every entry point becomes an address step only:

- **Campaign pages** render the shared address component with their campaign slug.
- **Quote drawer, homepage, and contact forms** replace their long forms with the same address field (a small framework-free bundle reusing the campaign autocomplete behavior and server proxy).
- **PIW `/roof-estimate`** uses the same component directly.

Each address step posts to the website's `/api/property-preview` route (PIW's own route for `/roof-estimate`). The route verifies Turnstile, forwards the authenticated server-to-server request to PIW, and redirects the browser to the returned preview URL. Campaign, entry point, presentation key, UTM parameters, `fbclid`, and referrer travel with the preview so attribution is unchanged.

Alternatives rejected:

- **Duplicating the flow on the website.** Keeps the homeowner on the brand domain longer, but splits the reveal, questions, and result into two implementations that would drift.
- **Embedding the PIW flow in an iframe.** Breaks autocomplete focus, analytics consent, and mobile keyboard behavior.

Today the homeowner lands on the PIW domain after submitting. With value-first that hop would happen at the address step, so the flow moves to a branded host instead.

### Branded domain

The preview, questions, contact, result, and refine steps are served by PIW on a tenant host, recommended `estimate.allseasonsolar.net` (the brand named in the notices and privacy policy). The campaign domain `allseasonroofingquote.com` keeps its landing pages and hands off to the same host.

- A `company_public_hosts` table maps each verified host to one company. PIW resolves the tenant from the request host, never from the URL or request body.
- On a tenant host, PIW's proxy serves only the public estimate pages, their APIs, and the image routes. Staff routes return 404, so the PIW app is never reachable under a customer brand.
- Pages on the host use the tenant's logo, colors, privacy policy, and terms links. Cookies are host-only.
- Analytics and advertising consent cross from the website through the existing signed consent handoff, which already works across domains.
- Continuation links, estimate emails, and texts use the tenant host. Existing PIW-domain links keep working and redirect to the tenant host when one exists.
- `PIW_PUBLIC_APP_URL` on the website becomes the tenant host. Vercel serves it as an additional domain on the PIW project; DNS is a CNAME the client adds.

### Property preview

A new `property_previews` record represents an anonymous, pre-lead session:

| Column | Purpose |
|---|---|
| `id`, `company_id` | Tenant-scoped identity |
| `token_hash` | Hash of the opaque preview capability in the URL; the raw token is never stored |
| `property_id` | Resolved through existing property identity matching (Place ID first, then normalized address) |
| `google_place_id`, `submitted_address`, `address_mode` | Address as entered |
| `campaign`, `entry_point`, `presentation_key`, `attribution`, `referrer` | Attribution, as on today's intake |
| `processing_disclosure_version`, `processing_accepted_at`, `ip_address`, `user_agent` | Property-processing evidence from step 1 |
| `responses` | The three pre-contact answers |
| `status` | `active`, `converted`, `expired` |
| `converted_lead_id`, `submission_id` | Set once contact is submitted |
| `expires_at` | Seven days after creation |

Properties already exist independently of leads, so the preview resolves the real property record and reuses the existing Google Solar request key, property-level quote reuse, and monthly usage reservation. Repeat lookups of the same property return the stored result without new provider calls.

### Conversion

Submitting contact details calls the existing canonical intake transaction with the preview token instead of raw address fields. The transaction:

1. Locks the preview and requires `status = active` and an unexpired preview.
2. Creates the lead bound to the preview's property, campaign, and attribution.
3. Writes `lead_consent_evidence`: `estimate_processing` from the preview's step-1 evidence (its own disclosure version and timestamp), and `email_contact` and `sms_contact` from the contact step.
4. Stores the three answers as the initial assessment responses.
5. Marks the preview `converted`, then returns the existing continuation, so result, follow-up, CRM writes, LeadConduit, and Meta `QualifiedLead` behave as today.

Submission UUID idempotency is unchanged. A converted preview cannot be converted again; a replay returns the existing continuation.

The downstream pipeline still requires all three consent rows, so no gate changes.

### Consent

The property-processing and contact notices separate:

- `all-season-property-preview-v1` for the step-1 notice, stored on the preview and copied to `estimate_processing` evidence.
- `all-season-campaign-estimate-v3` for the contact-only TCPA notice.
- `all-season-preview-email-v1` for the optional “Email me this” notice, stored on the preview.

This replaces the rule in the 2026-08-28 prefetch design that consent must commit before Place Details: property-processing consent now commits at the address step, before any provider call, and contact consent at the contact step.

### Saved reports (“Email me this”)

For homeowners who leave before the contact step, the reveal offers “Email me this roof report.” It asks for an email address only, with its own notice: “By clicking ‘Send my report,’ you agree All Season Solar may email you this report and follow up about your roof. Unsubscribe anytime.”

- The email and its evidence (`all-season-preview-email-v1`, timestamp, IP, user agent) are stored on the preview. The preview's expiry extends to 30 days.
- The report email shows the aerial image, roof size, and a resume link that returns to the next unfinished step. The resume link carries a fresh preview capability; the original URL token is not emailed.
- Follow-up: one reminder after 24 hours and one after 4 days, sent only while the preview is unconverted. Every email has a one-click unsubscribe that suppresses further preview emails for that address and company.
- A saved report is **not** a lead. Leads require a phone number and feed the dialer, CRM, and LeadConduit; a saved report does none of that. The PIW dashboard counts saved reports separately.
- If the homeowner later converts, the preview's email evidence becomes the lead's `email_contact` row, and the contact step still collects phone and SMS consent.
- Delivery reuses the existing estimate email sender and its provider configuration.

| Column added to `property_previews` | Purpose |
|---|---|
| `saved_email`, `saved_email_normalized` | Email for the report and reminders |
| `email_disclosure_version`, `email_accepted_at` | Email consent evidence |
| `reminders_sent`, `unsubscribed_at` | Follow-up state |

## Abuse and cost protection

Anonymous previews trigger Place Details, Static Maps, and Google Solar calls, so they need limits:

- **Cloudflare Turnstile**, invisible in most cases, verified server-side before any provider call. A failed challenge falls back to the interactive widget, never to a silent block.
- **Rate limits:** per IP (e.g. 10 previews/hour) and per company per day, enforced in Postgres alongside existing usage reservations.
- **Cache first:** a property with a stored Solar result costs no new Solar call; aerial images use the existing private response cache.
- **Budget cap:** when the monthly provider reservation is exhausted, the preview skips the reveal and goes straight to questions and contact. Lead capture never breaks.
- Preview tokens are single-property capabilities; they cannot read leads, contact data, or other properties.
- “Email me this” is limited to three sends per preview and per email address per day, so it can't be used to spam an inbox.

## Analytics

The existing allowlisted events gain preview steps. All remain consent-gated and value-free:

| Event | Trigger |
|---|---|
| `address_submitted` | Preview created |
| `roof_revealed` | Reveal shown, with `size_available: true/false` |
| `question_answered` | Each of the three questions, with question ID only |
| `report_saved` | “Email me this” accepted |
| `contact_step_reached` | Contact step shown |
| `lead_submitted` | Conversion accepted (unchanged) |
| `refine_completed` | Optional questions finished |

Meta `Lead` moves to contact submission; `QualifiedLead` stays server-issued after acceptance.

## Measurement

A split test isn't viable at current traffic. Production data from 2026-09-21 to 2026-10-02 (non-bot arrivals):

| Surface | Visitor-days | Leads (last 60 days) |
|---|---:|---:|
| Campaign pages | 466 | 3 |
| Main site (home, contact, drawer) | 927 | 0 |

That puts campaign conversion near 0.6% with roughly 39 campaign visitor-days a day. At 80% power and 5% significance:

| True lift | Visitors per arm | Time at current traffic |
|---|---:|---:|
| +20% | ~67,000 | ~9 years |
| +50% | ~12,000 | ~21 months |
| +100% (2×) | ~3,600 | ~6 months |

Even the higher-volume address-submit rate needs two to three months to detect a 30% lift. So this ships as a full rollout with guardrails and an instant rollback, not a split test:

- **Baseline:** leads per 100 campaign visitor-days for the 30 days before launch, from `website_arrivals` and leads.
- **Funnel diagnostics:** server-side counts of previews created, reveals, questions answered, reports saved, contact steps reached, and leads. These come from PIW's own records, not consent-gated analytics, so they cover every visitor.
- **Stop rule:** at the baseline rate, 1,000 campaign visitor-days should produce about 6 leads. If the new flow produces one or fewer in its first 1,000 campaign visitor-days (a 1% chance if conversion is unchanged), roll back and investigate.
- **Cost guardrail:** roll back if Google provider spend per lead exceeds three times the pre-launch figure.
- **Review:** after 60 days, compare leads per 100 visitor-days, saved reports, and lead quality against the baseline. The comparison is directional, not statistically conclusive, at this volume.
- **Experiment arm:** `website_arrivals`, previews, and leads record which flow served the visitor (`legacy` or `value_first`), so a future split test needs no schema change if traffic grows.

### Main-site leads

The main site produced no leads from 927 visitor-days in 60 days. Before launch, confirm that the homepage, contact, and drawer forms submit successfully in production. If they're broken, fixing them is a separate, faster win, and the baseline above should be set after that fix.

## Rollout

1. Fix or confirm the main-site forms and record the 30-day baseline.
2. Ship the preview tables, API, Turnstile verification, limits, branded host, and saved reports behind `PROPERTY_PREVIEW_ENABLED` (off).
3. Verify end to end on the branded host with PIW `/roof-estimate`, then on one campaign page with internal traffic.
4. Enable for every entry point at once. The legacy forms stay in the code behind the same flag for one release, so rollback is a flag change.
5. Apply the stop and cost rules during the first 1,000 campaign visitor-days, then run the 60-day review.
6. Remove the legacy forms after the review.

Old continuation links and in-flight submissions keep working throughout.

## Testing

- **Database:** preview creation, property matching, rate limits, conversion locking, consent evidence copy, idempotent replay, expiry, tenant isolation.
- **Domain and API:** Turnstile required, coordinates never accepted from the browser, budget-cap fallback, attribution carried through, tenant resolved only from a verified host, staff routes unreachable on tenant hosts.
- **Saved reports:** email consent recorded, resume link returns to the right step, reminders stop on conversion or unsubscribe, send limits, no lead or dialer record created.
- **UI:** reveal with ready, pending, and review-required Solar states; manual address; auto-advance and back on questions; contact notice naming the button; reduced motion.
- **End to end:** each entry point through to the price, with intercepted provider and lead requests.

## Decisions

1. **Branded domain:** yes. The flow runs on a tenant host, recommended `estimate.allseasonsolar.net`.
2. **Saved reports:** yes. “Email me this” captures email only, with two reminders, and is not a lead.
3. **Counsel review:** approved the separate property-processing, email, and contact notices.
4. **Split test:** not viable at current traffic. Monitored full rollout with stop and cost rules instead (see **Measurement**).

## Open questions

1. Confirm the host name (`estimate.allseasonsolar.net` or a host under `allseasonroofingquote.com`). It's a DNS and config choice and doesn't change the design.

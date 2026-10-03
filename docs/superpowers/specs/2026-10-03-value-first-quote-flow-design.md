# Value-first quote flow design

## Objective

Increase completed leads by showing homeowners something real about their roof before asking for contact details, and by replacing four inconsistent entry forms with one flow.

Today every entry point asks for name, phone, and email before the homeowner sees anything. After submitting, they wait through a loading sequence, answer nine assessment questions, and only then see a price. The new flow reverses the exchange: address first, then the homeowner's own roof and its measured size, then three one-tap questions, then contact details to unlock the price.

Primary metric: address-entered → lead-submitted completion rate. Guardrails: lead quality (consultation request rate, contact rate), Google provider spend per lead, and bot/abuse volume.

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

1. **Address.** One field with Google autocomplete and a manual-entry fallback. A passive property-processing notice sits above the button: “By clicking ‘See my roof,’ you authorize All Season Solar to review this address using property records, maps, and imagery.” An invisible Cloudflare Turnstile check runs on submit.
2. **Analysis and reveal.** The existing qualitative analysis sequence (eight-second minimum, twelve-second imagery ceiling) followed by the aerial image, the confirmed address with a correction link, and the measured roof size: “About 24 roofing squares · moderately complex roof.” No dollar figure.
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

The homeowner already lands on the PIW domain after submitting today; this moves that hop earlier. A branded custom domain is listed under open questions.

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

This replaces the rule in the 2026-08-28 prefetch design that consent must commit before Place Details: property-processing consent now commits at the address step, before any provider call, and contact consent at the contact step.

## Abuse and cost protection

Anonymous previews trigger Place Details, Static Maps, and Google Solar calls, so they need limits:

- **Cloudflare Turnstile**, invisible in most cases, verified server-side before any provider call. A failed challenge falls back to the interactive widget, never to a silent block.
- **Rate limits:** per IP (e.g. 10 previews/hour) and per company per day, enforced in Postgres alongside existing usage reservations.
- **Cache first:** a property with a stored Solar result costs no new Solar call; aerial images use the existing private response cache.
- **Budget cap:** when the monthly provider reservation is exhausted, the preview skips the reveal and goes straight to questions and contact. Lead capture never breaks.
- Preview tokens are single-property capabilities; they cannot read leads, contact data, or other properties.

## Analytics

The existing allowlisted events gain preview steps. All remain consent-gated and value-free:

| Event | Trigger |
|---|---|
| `address_submitted` | Preview created |
| `roof_revealed` | Reveal shown, with `size_available: true/false` |
| `question_answered` | Each of the three questions, with question ID only |
| `contact_step_reached` | Contact step shown |
| `lead_submitted` | Conversion accepted (unchanged) |
| `refine_completed` | Optional questions finished |

Meta `Lead` moves to contact submission; `QualifiedLead` stays server-issued after acceptance.

## Rollout

1. Ship the preview tables, API, Turnstile verification, and limits behind `PROPERTY_PREVIEW_ENABLED` (off).
2. Ship the PIW preview flow and conversion; test on PIW `/roof-estimate` first.
3. Move the campaign pages to the address step behind a per-entry-point flag and run a split test against the current form.
4. Switch the drawer, homepage, and contact forms after the campaign result is in.
5. Remove the old long forms once every entry point has converted and completion has held for two weeks.

Old continuation links and in-flight submissions keep working throughout.

## Testing

- **Database:** preview creation, property matching, rate limits, conversion locking, consent evidence copy, idempotent replay, expiry, tenant isolation.
- **Domain and API:** Turnstile required, coordinates never accepted from the browser, budget-cap fallback, attribution carried through.
- **UI:** reveal with ready, pending, and review-required Solar states; manual address; auto-advance and back on questions; contact notice naming the button; reduced motion.
- **End to end:** each entry point through to the price, with intercepted provider and lead requests.

## Open questions

1. **Custom domain.** Should the flow run on a branded host (e.g. `quote.allseasonsolar.com`) instead of the PIW domain?
2. **Abandon recovery.** Without contact details there's no follow-up. Should the reveal offer “Email me this” as a lighter capture before the full contact step?
3. **Counsel review** of the split property-processing and contact notices.
4. **Split-test threshold.** What completion lift and sample size justify rolling out beyond campaign pages?

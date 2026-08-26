# All Season Canonical Post-Submit Roof Assessment

## Objective

Make the existing roof assessment the canonical post-consent journey for every All Season quote form and campaign route. Every successful submission should enter the same resumable assessment, while campaign context changes the presentation and result narrative without changing the questions, scoring, or persistence model.

The system must preserve trust: it may show a dollar range only when the property calculation is reliable. External imagery and measurement services may enhance the experience but must never block the homeowner from continuing.

## Scope

### Entry points

- Main website homepage quote form
- Main website contact-page quote form
- Main website global quote drawer
- `/roof-estimate`
- `/campaigns/weather-report`
- `/campaigns/seasonal-shield`
- `/campaigns/for-every-season`

### Included

- One canonical intake and resume transaction
- Shared assessment questions and scoring
- Campaign-specific presentation and result framing
- Progressive answer persistence
- Five-second minimum property-analysis experience
- Asynchronous imagery and roof calculation
- Trustworthy-range, calculation-pending, and professional-review result states
- One-click consultation intent with contact preference
- Broad Eastern Time call-window preference for phone contacts
- Same-browser resume and Twilio Verify SMS-protected cross-device resume
- Attribution-touch history, consent evidence, lifecycle events, and database migrations
- Route-level, database, API, component, accessibility, and mobile verification

### Deferred

- Calendar booking and appointment-slot reservation
- Automated abandonment email or SMS reminders
- Campaign-specific assessment questions or scoring
- Provisional or answer-only dollar estimates

## Canonical Homeowner Journey

1. The homeowner submits a consented quote form.
2. Intake atomically creates or safely resumes the lead, property, estimate, assessment, attribution touch, and public access state.
3. The browser redirects into `/roof-estimate/[token]`.
4. A branded property-analysis screen runs for at least five seconds while property imagery and measurements are requested asynchronously.
5. The homeowner confirms the property or uses the small address-correction link.
6. The homeowner completes the shared assessment questions. Each answer is persisted before advancing.
7. The result immediately shows a campaign-framed project outlook.
8. A dollar range appears only when the property calculation is trustworthy. Pending work refreshes in place; an unreliable result becomes a professional-review outcome.
9. “Turn this range into an exact quote” opens a contact-preference panel rather than replaying the loader.
10. The homeowner chooses call, text, or email. Call reveals “as soon as possible,” morning, midday, afternoon, or evening in Eastern Time.
11. One confirmation records consultation intent and shows an in-flow acknowledgement. No contact information is re-entered.

## Architecture

### Shared intake service

A server-side `startOrResumeRoofAssessment` domain service will own the intake contract. Entry points remain thin transport adapters:

- Next forms call the service through their server action.
- The static website calls a same-origin public endpoint that forwards through the authenticated All Season integration boundary.

Both transports validate the same normalized input and invoke the same atomic database function. The browser never receives internal lead, property, score, or pipeline identifiers.

The service input includes:

- Submission UUID
- Company identity derived server-side
- Name, normalized email, and normalized phone
- Structured New Jersey address and Google Place ID when available
- Campaign presentation key and entry-point source
- UTM and click attribution
- Consent values, disclosure version, timestamp, IP address, and user agent

The service returns a short-lived continuation URL rather than an existing public assessment token. The homeowner's browser follows that URL onto the assessment origin, where the assessment cookie is available. Continuation resolution produces one of:

- `started`: set the assessment session and redirect to a new public assessment URL
- `resumed`: redirect to an existing assessment after same-browser session authorization
- `verification_required`: redirect to Twilio Verify SMS before releasing a rotated public assessment token
- An idempotent replay of the original continuation URL for a duplicate submission UUID

### Assessment presentation

One reusable presentation configuration controls:

- Analysis eyebrow and stage copy
- Fallback imagery and image description
- Property-confirmation copy
- Question helper text and trust cues
- Result headline, interpretation, consultation framing, and accent treatment

The main website receives its own All Season presentation key. Campaign routes use their campaign key. Presentation configuration cannot alter question identifiers, response values, scoring rules, progress semantics, or persistence.

### External property services

Property imagery and roof calculation begin as soon as intake succeeds. The interface treats both as asynchronous enhancements:

- The analysis screen has a five-second minimum display time.
- Imagery that is not ready uses the configured fallback asset.
- The homeowner can proceed once the minimum branded buffer finishes.
- Calculation status refreshes quietly during the questionnaire and result.
- A trustworthy measurement produces the range.
- An unavailable or low-confidence measurement produces professional review.
- No code path creates a fabricated placeholder dollar value.

## Data Model

### `roof_assessments`

The existing table remains canonical. Add or revise lifecycle support for:

- Status values `in_progress`, `abandoned`, and `completed`
- `current_step`
- Versioned progressive `responses`
- Derived `scores` and `recommendation`
- `presentation_key`
- `entry_point`
- `property_revealed_at`
- `last_answered_at`
- `result_viewed_at`
- `started_at`, `updated_at`, `abandoned_at`, and `completed_at`

An abandoned assessment may transition back to `in_progress` after authorized resumption. Completion requires a valid recommendation and completion timestamp. The table remains inaccessible directly to anonymous clients; token-scoped server routes perform public operations.

### `lead_attribution_touches`

Create an append-only attribution record for every accepted submission:

- Company and lead
- Assessment and estimate when applicable
- Submission UUID
- Entry point and campaign/presentation key
- UTM fields and click identifiers
- Referrer when available
- Occurrence timestamp

The first touch preserves original acquisition. Later submissions add touches without overwriting the original lead source.

### `consultation_requests`

Create an idempotent consultation-intent record containing:

- Company, lead, property, estimate, and assessment
- Contact method: call, text, or email
- Call window when contact method is call
- Time zone fixed to `America/New_York` for this New Jersey flow
- Status suitable for later booking handoff
- Creation and update timestamps
- Nullable future booking reference

### `roof_assessment_access_attempts`

Create a server-only operational table for the short-lived cross-origin continuation and resume decision:

- Company, submission, assessment candidate, and attempt kind
- Hash of the opaque continuation secret; the raw secret is returned only once
- Normalized verification destination, request IP, expiry, send counters, and provider attempt metadata
- Verification, consumption, and token-rotation timestamps

This is not a marketing or CRM record. It exists so the main-site adapter never receives an existing assessment token and so the assessment origin can safely choose a new journey, same-browser resume, or Twilio verification.

### Consent evidence

Append consent evidence for each accepted submission. Store disclosure version, consent type, source, granted state, timestamp, IP address, and user agent. Resuming an existing assessment does not overwrite earlier evidence.

## Resume, Deduplication, and Access Security

Every intake is idempotent by company and submission UUID.

A possible 30-day resume match requires:

- Same company
- Same Google Place ID, or the same normalized New Jersey address when a Place ID is unavailable
- At least one matching normalized contact identifier: phone or email
- An incomplete assessment updated within the previous 30 days

Matching identity is not sufficient authorization to reveal prior answers.

- Same-browser resume uses a signed, secure, HTTP-only session cookie bound to the assessment.
- Cross-device resume requires a Twilio Verify v2 SMS one-time passcode sent to the normalized phone already associated with the lead.
- A `ResumeVerificationProvider` interface isolates verification start and check operations; Twilio Verify is the production implementation.
- Twilio credentials and the Verify Service SID remain server-only configuration. The application stores only request metadata needed for auditing and rate limiting, never the one-time passcode.
- Verification follows Twilio Verify's managed 10-minute lifecycle. Application-level throttling permits one send per minute and no more than five starts per phone and IP address per hour.
- Successful cross-device verification rotates the public access token.
- Expired, reused, or invalid verification artifacts fail closed.
- Verification delivery is transactional access control, not abandonment marketing or contact consent.
- If verification delivery is unavailable, the system does not expose the existing assessment. It offers a safe retry path without revealing whether a matching assessment exists.

Rate limits apply to intake, verification creation, verification attempts, assessment writes, and consultation requests. Logs and public API responses must not contain raw verification secrets or unnecessary personally identifiable information.

## Progressive Persistence and Events

Each answer saves before the UI advances. A failed save leaves the current answer selected and provides an in-place retry. Returning to a saved assessment restores the exact authorized step and answers.

Domain events remain concise:

- Assessment started
- Meaningful high-intent signal
- Assessment abandoned after 24 hours without an answer or lifecycle interaction
- Assessment resumed
- Assessment completed
- Result viewed
- Consultation requested

Per-answer writes do not create CRM timeline noise. A scheduled lifecycle check marks an incomplete assessment abandoned after 24 hours of inactivity and publishes the abandonment event, but this phase sends no automated homeowner messages.

## Result and Consultation Behavior

The result has three property-calculation states:

1. `ready`: show the Google-derived range and relevant measurement context.
2. `pending`: show the personalized outlook immediately and refresh the calculation in place without a new full-screen loader.
3. `review_required`: explain that a trustworthy automated range was not available and that a professional will review the property.

The consultation action is available in all three states. It opens inline preference controls and never restarts the assessment. Call-window choices are broad service preferences, not appointment reservations.

Submission creates one consultation request, emits its domain event, and renders an acknowledgement describing the next contact step. Retrying the same action cannot create duplicate requests.

## Error Handling

- Invalid form input remains on the source form with field-level guidance.
- Intake retries are safe through submission UUID idempotency.
- Imagery failure uses campaign fallback imagery.
- Calculation timeout does not block questions or invent a range.
- Assessment save failure preserves the local selection and provides retry.
- Invalid or expired public access fails closed without confirming that a lead exists.
- Consultation failure keeps selected preferences and provides retry.
- All external-service failures use structured internal logging while returning concise homeowner-safe copy.

## Migration and Rollout

1. Add lifecycle fields, attribution touches, consultation requests, constraints, indexes, and atomic database functions.
2. Backfill existing assessments with a valid presentation key and entry point.
3. Deploy the shared intake domain service while existing adapters remain operational.
4. Update each form adapter to the canonical result contract and public URL.
5. Enable signed same-browser sessions and verified cross-device resume.
6. Verify each entry point in production-like environments.
7. Remove superseded duplicate intake logic only after successful route-level verification.

The database changes are additive until the final cleanup step. Rollback before cleanup consists of returning adapters to their previous intake paths; existing leads, estimates, assessments, attribution touches, and consultation requests remain valid records.

## Verification Strategy

### Database

- Atomic creation of lead, property, estimate, assessment, consent, attribution touch, and event state
- Submission UUID idempotency
- 30-day matching boundaries
- Address and contact normalization
- Tenant isolation and RLS
- Valid assessment lifecycle transitions
- Consultation idempotency and call-window constraints

### Domain and API

- Shared validation and result contracts for both transports
- Same-browser resume authorization
- Twilio Verify SMS issuance, ten-minute expiry, successful check, rotation, provider failure, and rate limiting
- Progressive writes and exact-step restoration
- Sparse event publication
- Pending, ready, and review-required calculation behavior

### Experience

- All seven entry points redirect into the canonical flow
- Each entry point preserves source and campaign attribution
- Main-site and campaign-specific presentation render correctly
- Five-second minimum analysis and non-blocking fallbacks
- Every question and action fits supported mobile viewports without page scrolling
- Result updates in place and never shows an invented range
- Consultation preferences, conditional call windows, retry, and confirmation
- Keyboard, screen-reader, focus, reduced-motion, and contrast coverage

### Release gates

- Unit and component tests
- Database migration and pgTAP tests
- API integration tests
- Route-level end-to-end tests
- Typecheck and lint with no new errors
- Production build
- Browser verification across desktop and supported mobile viewport sizes

## Success Criteria

- Every approved quote form enters the same assessment URL contract after consented submission.
- Campaigns feel distinct without fragmenting questions or backend behavior.
- Homeowners can continue despite slow property services.
- No result presents an unsupported dollar range.
- Progressive answers and attribution are available to the sales workflow without noisy per-answer events.
- Consultation intent is captured without repeated personal information or a false booking promise.
- Existing assessments can resume securely without exposing prior answers through known contact information.

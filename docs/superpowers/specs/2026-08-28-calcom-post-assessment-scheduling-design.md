# Cal.com Post-Assessment Scheduling Design

## Objective

Add a polished Cal.com scheduling experience to the end of the completed roof-assessment journey. A homeowner who finishes the assessment can book one 30-minute phone consultation without re-entering known information, then see and manage the confirmed appointment from the estimate result.

This project also adds the first-party consent foundation and Meta Pixel plus Conversions API integration needed to measure consented scheduling conversions reliably.

## Scope

Scheduling appears only after a homeowner completes the full roof assessment. It is available in every completed result state:

- A preliminary dollar range is ready.
- The property requires manual review.
- A trustworthy automated estimate is unavailable.

The result presents two actions:

1. **Schedule a 30-minute phone consultation** — primary.
2. **Request a callback** — secondary and always available.

The project includes:

- A branded full-screen scheduling modal.
- A hosted Cal.com account, shared calendar, and universal event configuration.
- Prefilled but editable attendee information.
- Provider webhook ingestion and PIW appointment synchronization.
- Appointment confirmation, rescheduling, cancellation, and rebooking states.
- Appointment-specific contact discrepancy review.
- Lead timeline lifecycle events.
- A first-party consent banner and persistent privacy controls.
- PIW scheduling-funnel analytics.
- Meta Pixel and server-side Conversions API `Schedule` tracking.
- Operational monitoring, tests, and setup documentation.

Explicitly out of scope:

- JobNimbus synchronization.
- Round-robin or territory routing.
- SMS booking notifications or reminders.
- A custom-built availability and booking interface.
- Multiple simultaneous appointments for one assessment.
- A new staff appointment-management dashboard.
- Percentage-based rollout.
- Self-hosting Cal.com.

## Selected Architecture

Use Cal.com's embedded booking interface inside a PIW-owned modal. Cal.com owns availability calculation, booking creation, calendar placement, hosted management links, and booking emails. PIW owns the public journey, consent, application state, operational appointment projection, analytics, and downstream events.

The browser embed provides immediate lifecycle feedback. Signed Cal.com webhooks are authoritative for changing PIW appointment state. A browser event can improve responsiveness, but it cannot directly create, reschedule, or cancel the durable PIW appointment.

This boundary avoids duplicating calendar logic while ensuring that browser closure, network loss, or webhook retries cannot produce missing or duplicate application records.

## Homeowner Experience

### Result actions

Every completed assessment result shows the primary scheduling action and the secondary callback action. The scheduling action is available for ready, manual-review, and estimate-unavailable results.

If an active appointment already exists, the actions are replaced by an appointment card containing:

- Appointment date.
- Start time.
- `Eastern Time` label.
- 30-minute duration.
- Status.
- Cal.com-hosted reschedule link.
- Cal.com-hosted cancellation link.
- The appointment-specific phone number the representative will call.

Only one active appointment is allowed per assessment. A cancelled appointment restores the scheduling action and permits a new booking.

### Scheduling modal

Selecting the primary action opens a full-screen modal rather than navigating away. The modal:

- Uses All Season typography, colors, spacing, header treatment, and reassuring copy.
- Contains a lightly customized Cal.com embed.
- Traps focus, closes with Escape, restores focus to the trigger, and prevents background scrolling.
- Works at mobile viewport heights and respects reduced-motion preferences.
- Clearly states that an All Season representative will call the homeowner.
- Keeps callback and direct-call fallbacks available.

Name, email, phone, and property address are prefilled from PIW. The homeowner may edit them before booking. All availability and appointment copy use `America/New_York`; the UI does not auto-switch to the viewer's local timezone.

The embed lifecycle is:

1. CTA click opens the modal and starts the booking session.
2. Cal.com's ready event replaces the modal skeleton with the interactive scheduler.
3. Cal.com's failure event or a 12-second loading timeout renders the fallback state.
4. Booking success renders a brief `Confirming your appointment` state.
5. PIW polls its public-safe appointment status every 500 milliseconds for at most 10 seconds while the webhook is processed.
6. When the durable appointment is present, the modal closes and the result renders the appointment card.
7. If PIW confirmation is delayed, the UI shows Cal.com's returned appointment time and explains that an email confirmation is being sent. The webhook continues reconciliation, and a later page load renders canonical PIW state.

Cal.com's booking-success embed event is not treated as durable confirmation because the provider documents that the booking might not yet be confirmed.

### Fallback behavior

The modal must never strand the homeowner. A load failure, timeout, configuration disablement, or unavailable calendar renders:

- `Request a callback`, using the existing consultation-preference flow.
- The All Season phone number as a direct-call link.
- A retry action when retrying is safe.

Closing the modal always returns to the completed estimate result without losing assessment state.

## Cal.com Configuration

Create one hosted Cal.com account and one universal event type with these launch settings:

- Event: 30-minute phone consultation.
- Host behavior: the All Season representative calls the homeowner.
- Calendar: a standalone shared consultation calendar.
- Availability: Monday through Friday, 9:00 AM–5:00 PM Eastern.
- Minimum notice: 24 hours.
- Buffer: 15 minutes between calls.
- Booking horizon: rolling 14 days.
- Attendees: one homeowner and the single configured company host.
- Confirmation: email immediately after booking.
- Reminders: email 24 hours and 1 hour before the appointment.
- Management: Cal.com-hosted reschedule and cancellation links.
- Timezone: fixed to `America/New_York` in the homeowner experience.

PIW passes supported embed configuration for name, email, attendee phone, and non-sensitive metadata. It passes the original acquisition UTM values separately from current-session attribution rather than forwarding all page query parameters blindly.

## Booking Correlation

Opening the scheduler creates an opaque booking session with a two-hour lifetime, associated server-side with the completed assessment, estimate, lead, property, and company. The opaque value is passed to Cal.com in embed metadata and returned in the webhook.

The metadata contains no internal database ID, public estimate token, name, email, phone, address, or advertising identifier. The server accepts a metadata value only when it:

- Resolves to an unexpired booking session.
- Belongs to the configured company and Cal.com event type.
- References a completed assessment.
- Has not already been consumed by an incompatible booking.

The session may be reused only to reconcile retries for the same Cal.com booking UID. It cannot authorize a second active appointment.

## Data Model

### `appointments`

Extend the existing appointment projection with provider-managed booking fields:

- `property_id`.
- `estimate_id`.
- `assessment_id`.
- `source`, fixed to `calcom` for these records.
- `provider_booking_uid`.
- `provider_event_type_id`, stored as the configured Cal.com numeric event-type ID.
- `timezone`, fixed to `America/New_York` for this flow.
- Appointment-specific attendee name, normalized email, and normalized phone.
- Provider reschedule and cancellation URLs.
- `provider_synced_at`.
- `contact_review_required`.
- A stable Meta conversion event ID.

The existing `scheduled_at`, `duration_minutes`, and `status` fields remain the current operational projection. Duration is 30 minutes for this event.

Constraints enforce:

- Unique Cal.com booking UID per company.
- At most one `scheduled` or `confirmed` appointment per assessment.
- Company-consistent relationships among appointment, lead, property, estimate, and assessment.
- A new booking after cancellation without mutating the cancelled historical record into a different booking.

### Booking sessions

Add a server-only booking-session table containing:

- SHA-256 hash of the opaque session secret; the raw secret is returned to the browser only once.
- Company, lead, property, estimate, and assessment.
- Expected Cal.com event type.
- Creation and expiration timestamps.
- Consumed timestamp and provider booking UID when reconciled.

Anonymous and authenticated browser clients receive no direct table access. Public reads and writes pass through token-scoped server endpoints.

### Contact discrepancies

If Cal.com's attendee email or phone differs from the normalized PIW lead contact, store the submitted values on the appointment and set `contact_review_required`. Do not overwrite the lead automatically.

The appointment card and representative workflow use the appointment-specific phone number. The existing lead remains historical acquisition truth until staff reviews and intentionally reconciles the difference.

### Consultation requests

Exact bookings remain in `appointments`; they do not fabricate a broad call window to fit `consultation_requests`.

If a callback request already exists for the same assessment when a booking is confirmed, update it to `booked` and attach its booking reference. If none exists, do not create a callback request merely to represent the appointment.

### Integration and lifecycle history

Every accepted Cal.com webhook is first recorded in the existing `integration_events` ledger with:

- Source system `calcom`.
- Provider event type.
- A company-scoped idempotency key derived from the provider event and booking identity.
- A minimized, redacted payload sufficient for audit and replay.

The current appointment is a projection; the append-only integration events preserve booking, reschedule, cancellation, and retry history.

## Webhook Processing

Expose a dedicated Cal.com webhook endpoint. Processing order is:

1. Read the bounded raw body.
2. Verify the provider signature using the server-only webhook secret.
3. Parse a strict, versioned payload schema.
4. Reject events from an unconfigured event type or account.
5. Resolve and validate the opaque booking-session metadata.
6. Record the minimized integration event idempotently.
7. Atomically create or update the appointment projection and enqueue domain events.
8. Mark the integration event processed or record a safe error category.

Supported launch events are `BOOKING_CREATED`, `BOOKING_RESCHEDULED`, and `BOOKING_CANCELLED`. No-show and completion synchronization are outside this release.

Webhook retries for the same event return success after confirming that the corresponding projection already exists. Invalid signatures fail before persistence. Responses and logs never include secrets or unnecessary personal data.

## Domain Events and Lead Timeline

Add versioned domain events for:

- Appointment scheduled.
- Appointment rescheduled.
- Appointment cancelled.

Each lifecycle idempotency key is a deterministic SHA-256 digest of the verified trigger name, provider booking UID, scheduled start, and provider update timestamp. The events update the existing lead activity timeline with one meaningful entry per lifecycle transition. Webhook retries cannot create duplicate timeline entries.

Booking confirmation also activates the existing representative-introduction workflow only when a representative is assigned and the existing workflow prerequisites are satisfied. The Cal.com integration does not invent a representative record or send a duplicate booking reminder.

## Consent Management

This patch adds a lightweight first-party consent manager to the public lead and assessment experience.

The banner provides equally accessible actions:

- Accept all.
- Reject nonessential.
- Customize preferences.

Categories are:

- Necessary — always enabled.
- Analytics — PIW scheduling-funnel measurement.
- Advertising — Meta Pixel, Meta cookies, and Meta Conversions API.

Consent defaults to denied. Global Privacy Control defaults Advertising to denied. The banner does not block necessary lead intake or scheduling. A persistent `Privacy choices` control allows later changes.

Store the current choice in a versioned, integrity-protected first-party cookie. A random first-party consent ID links browser changes without fingerprinting the visitor. Add an append-only, server-only `privacy_consent_evidence` table containing the consent ID, optional lead link when one becomes available, policy version, category states, source, timestamp, and bounded request metadata needed for audit. Revocation prevents future nonessential collection; it does not rewrite historical evidence.

Meta's script and cookies do not load before Advertising consent. Server-side Meta events follow the same consent snapshot. Events are not sent retroactively if a homeowner grants consent after booking.

## Analytics and Meta

### PIW funnel events

Record these events when Analytics consent exists:

- `schedule_cta_viewed`.
- `schedule_cta_clicked`.
- `scheduler_loaded`.
- `booking_confirmed`.
- `booking_rescheduled`.
- `booking_cancelled`.

Persist consented events in an append-only, server-only scheduling-funnel table. Events reference the company, lead, assessment, appointment when available, consent version, original attribution, current-session attribution, and occurrence time. Client-submitted names are strict and server allowlisted, and a uniqueness key prevents duplicate lifecycle events.

Essential error telemetry may count an embed load failure without persistent browser, lead, or advertising identifiers. It must not become a shadow analytics system for visitors who rejected Analytics.

### Attribution

Preserve both:

- Original lead acquisition: primary for reporting and Meta conversion context.
- Current booking session: secondary, for return-visit analysis.

Supported attribution includes campaign and presentation keys, landing/referrer context, UTM fields, `fbclid`, `_fbp`, and `_fbc` when legitimately available under consent. Cal.com receives only the attribution fields needed for the booking record; it does not receive unrestricted page query parameters.

### Meta conversion

A confirmed appointment sends the standard Meta `Schedule` event only. The initial quote submission remains the `Lead` event. Rescheduling, cancellation, CTA interaction, and scheduler loading do not emit additional Meta standard or custom events in this release.

When Advertising consent exists:

1. The browser Pixel sends `Schedule` with an event ID generated and stored by PIW.
2. PIW enqueues the matching Conversions API delivery through the existing durable event workflow.
3. The server event uses the same event name and event ID.
4. Email, phone, and PIW external lead identifier are normalized and SHA-256 hashed before transmission.
5. `_fbp`, `_fbc`, source URL, event time, and permitted request context are included when available.
6. Delivery attempts are idempotent and observable.

The matching event name and ID follow Meta's recommended browser/server deduplication contract.

## Public APIs and Components

The implementation introduces or extends these boundaries:

- A server endpoint that creates a short-lived booking session for a completed assessment token and returns public-safe embed configuration.
- A public-safe appointment-status endpoint used by initial server rendering and bounded post-booking confirmation polling.
- A signed Cal.com webhook endpoint.
- A server-only Meta Conversions API adapter behind a narrow interface.
- A consent manager used by public lead and assessment surfaces.
- A scheduling modal component isolated from the assessment-result copy and calculation logic.
- An appointment card component that renders only public-safe appointment fields.
- An analytics adapter that enforces consent and an event allowlist.

No Cal.com API key, webhook secret, Meta access token, raw lead identifier, or internal relationship ID is serialized into the browser.

## Error Handling and Recovery

- **Embed script or frame failure:** show callback, direct-call, and safe retry actions.
- **No availability:** keep callback and direct-call options visible; do not create an appointment.
- **Expired booking session:** request a fresh session while the completed assessment token remains valid.
- **Invalid webhook signature:** reject without persistence.
- **Unknown event type/account:** record a safe rejected integration outcome and return a non-success response; do not mutate appointments.
- **Duplicate webhook:** return success after idempotent verification.
- **Database failure after integration-event receipt:** retain an error outcome suitable for replay.
- **Delayed webhook:** show provider success details, continue server reconciliation, and render canonical state on return.
- **Meta browser failure:** do not block booking; the consented server event remains retryable.
- **Meta server failure:** retry durably without resending a second logical conversion event.
- **Consent unavailable or denied:** complete the booking with no Meta or nonessential analytics calls.

## Security and Privacy

- Cal.com API keys, Meta credentials, and webhook secrets are server-only environment values.
- Webhook payload sizes and schemas are bounded.
- Provider signatures are verified against the exact raw request body.
- Public estimate access continues through the existing opaque-token contract.
- Booking metadata is opaque and contains no PII or durable authorization secret.
- Appointment and booking-session tables remain tenant-scoped and protected by RLS and explicit grants.
- Public appointment responses expose only the fields required to show and manage that homeowner's booking.
- Logs and integration payloads redact contact information that is not necessary for replay.
- Meta transmission requires Advertising consent and uses normalized hashes for customer matching fields.
- Consent evidence is versioned and append-only.

## Testing

### Unit and component tests

- CTA hierarchy in ready, manual-review, and unavailable estimate states.
- Accessible modal focus, Escape behavior, focus restoration, and reduced motion.
- Prefill configuration contains editable public-safe fields and opaque metadata only.
- Ready, failure, timeout, confirming, confirmed, and fallback states.
- Appointment card rendering in Eastern time.
- Cancelled appointments restore the CTA.
- Callback remains available independently of scheduling.
- Consent defaults, Accept, Reject, Customize, persistence, revocation, and GPC behavior.
- Meta code cannot load or fire before Advertising consent.

### Database and service tests

- Booking-session expiry and consumption.
- Completed-assessment authorization.
- One active appointment per assessment.
- Unique provider booking identity.
- Idempotent create, reschedule, cancel, and retry processing.
- Rebooking after cancellation.
- Company-consistent foreign keys and RLS behavior.
- Contact discrepancy detection without lead mutation.
- Existing callback request transitions to booked when applicable.
- Domain-event and timeline deduplication.

### Security and contract tests

- Invalid, missing, and stale webhook signatures.
- Malformed and oversized payloads.
- Wrong Cal.com account or event type.
- Missing, expired, or mismatched metadata.
- PII-safe errors, logs, and public responses.
- Secret-free browser bundles and serialized props.

### Meta tests

- Pixel and CAPI use `Schedule` and the same event ID.
- Browser and server events are suppressed without Advertising consent.
- Contact matching values and external ID are normalized and hashed.
- Original attribution is primary and current-session attribution is retained.
- Retries do not create a second logical conversion.
- Reschedule and cancellation do not emit `Schedule` again.

### End-to-end acceptance

In production configuration, complete one real assessment and exercise:

1. Scheduler load.
2. Booking.
3. Durable PIW appointment creation.
4. Appointment-card rendering.
5. Email confirmation.
6. Rescheduling.
7. Cancellation.
8. CTA restoration and rebooking.
9. Meta Test Events browser/server deduplication with Advertising consent.
10. No Meta activity after consent rejection.

## Operations and Rollout

Provision and verify before deployment:

- Cal.com account and universal event.
- Shared consultation calendar.
- Availability, notice, buffer, horizon, and email reminders.
- Production webhook and secret.
- Cal.com API credential used for server reconciliation.
- Meta Business assets, Dataset/Pixel, domain association, and Conversions API token.
- Versioned consent policy and public privacy copy.
- Required server and public environment configuration.

Deployment enables scheduling for all completed assessments immediately. A server configuration kill switch is retained for emergency fallback; disabling it shows callback and direct-call actions without changing or deleting existing appointments.

Monitor:

- Scheduler opens and successful loads.
- Webhook verification failures.
- Integration-event processing errors and replay backlog.
- Confirmed Cal.com bookings missing a PIW appointment.
- Duplicate-prevention conflicts.
- Meta CAPI delivery failures and deduplication diagnostics.

Launch success is operational reliability:

- At least 95% of scheduler opens reach the interactive scheduler.
- Every confirmed Cal.com booking creates exactly one PIW appointment.

No booking-conversion percentage is a launch acceptance gate.

## References

- [Cal.com embed events](https://cal.com/help/embedding/embed-events)
- [Cal.com embed prefilling and metadata](https://cal.com/help/embedding/prefill-booking-form-embed)
- [Cal.com UTM tracking in embeds](https://cal.com/help/embedding/utm-tracking-embed)
- [Cal.com webhook API](https://cal.com/docs/api-reference/v2/webhooks/create-a-webhook)
- [Meta Pixel and Conversions API event deduplication](https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events/)

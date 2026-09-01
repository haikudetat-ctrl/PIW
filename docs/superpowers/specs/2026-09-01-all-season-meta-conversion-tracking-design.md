# All Season Meta Conversion Tracking Design

**Date:** 2026-09-01  
**Status:** Approved for implementation planning  
**Dataset / Pixel:** All Season Roofing (`3142520615938086`)

## Objective

Connect every All Season public landing page and canonical quote flow to Meta with consent-aware browser Pixel events and reliable server-side Conversions API delivery. The system must measure both saved leads and completed personalized assessments without allowing Meta failures to interfere with lead intake, quote delivery, PIW CRM persistence, or operational Slack alerts.

## Approved Decisions

- Track both the saved lead and the completed assessment.
- `Lead` fires only after a valid consent submission has been durably saved in PIW.
- `AssessmentCompleted` fires only after a real quote has been generated and rendered successfully. Error pages, unavailable estimate links, fallback states, and invented price ranges never qualify.
- Reserve `VerifiedLead` for the later Twilio phone-verification project.
- Load Meta only for visitors who grant Advertising consent. Declining Advertising consent never blocks the quote flow.
- Send Meta normalized and SHA-256-hashed email and phone plus request IP, user agent, `_fbp`, and `_fbc` when available.
- Never send Meta the homeowner's name, street address, property imagery, assessment answers, roof geometry, quote amounts, or package selections.
- Use one persisted `event_id` for the browser and server copies of each conversion so Meta can deduplicate them.
- Track consented `PageView` activity across all All Season public pages; conversion events originate only from the canonical lead and assessment pipeline.
- Keep Meta delivery first-party inside PIW rather than delegating the critical conversion path to n8n.

## Scope

### Included

- All Season main-site pages served from `apps/website`.
- All active campaign routes that use the canonical intake adapters.
- PIW quote and assessment routes served from `src/app`.
- A consent-gated Meta Pixel provider.
- Durable, retryable Meta Conversions API delivery for `Lead` and `AssessmentCompleted`.
- Browser/server deduplication, delivery diagnostics, feature flags, tests, and an operator runbook.
- Events Manager Test Events validation before production enablement.

### Excluded

- Cal.com scheduling and the `Schedule` conversion.
- Twilio phone verification and `VerifiedLead`.
- Meta campaign creation, ad-set optimization changes, or historical event backfills.
- Sending quote values, property attributes, or assessment details to Meta.
- Replacing PIW's CRM, Slack, or existing lead-delivery behavior.

## Architecture

The public website and PIW assessment application share a small first-party Meta event contract. The browser side loads the Meta Pixel only after verified Advertising consent. The server side reserves eligible conversion events in Postgres, enqueues delivery through Inngest, and sends them to Meta's Conversions API with bounded retries.

The database is the source of truth for event identity and delivery state. Browser event IDs are never independently invented. A successful canonical operation returns or exposes the server-reserved event ID, and the browser uses that exact ID when it emits its matching Pixel event.

```text
Advertising consent
        |
        +-- denied --> normal quote flow; no Pixel, cookies, or CAPI
        |
        +-- granted
              |
              +-- page rendered --> browser PageView
              |
              +-- lead saved --> reserve Lead event
              |                    |-- browser Lead(eventID)
              |                    `-- Inngest --> Meta CAPI Lead(event_id)
              |
              `-- real quote rendered --> completion acknowledgement
                                   --> reserve AssessmentCompleted event
                                        |-- browser event(eventID)
                                        `-- Inngest --> Meta CAPI(event_id)
```

## Event Contract

| Event | Trigger | Browser | Server | Deduplication |
|---|---|---:|---:|---|
| `PageView` | A public All Season page is visible after Advertising consent | Yes | No | Not applicable |
| `Lead` | Canonical lead persistence succeeds | Yes | Yes | Shared persisted `event_id` |
| `AssessmentCompleted` | A completed assessment with a real quote is acknowledged as rendered by the client | Yes | Yes | Shared persisted `event_id` |
| `VerifiedLead` | Reserved for future Twilio verification | Future | Future | Future shared `event_id` |

`AssessmentCompleted` is a Meta custom event. It must not be substituted with `Purchase`, because the user has not purchased anything, and it must not include monetary value.

### Timing and idempotency

- A double click, route retry, React remount, webhook retry, or Inngest retry must reuse the same event row and event ID.
- `Lead` is unique per lead.
- `AssessmentCompleted` is unique per completed roof assessment.
- Granting Advertising consent after an eligible action does not cause a retroactive event.
- Revoking Advertising consent immediately prevents future Pixel and CAPI events. Events already accepted by Meta cannot be recalled.
- The assessment completion acknowledgement is accepted only when the server confirms that the token belongs to a completed assessment with non-placeholder pricing evidence.

## Consent Boundary

This work depends on the privacy-consent foundation described in `docs/superpowers/plans/2026-08-28-privacy-consent-foundation.md`. If that plan has not been implemented on the target branch, it is a release prerequisite rather than an optional enhancement.

- Necessary consent remains always enabled.
- Analytics and Advertising default to denied.
- Meta script loading, `_fbp`/`_fbc` access, Pixel calls, and CAPI calls all require verified Advertising consent under policy `piw-privacy-v1`.
- Accept all, reject nonessential, and preference controls remain equally accessible.
- Global Privacy Control defaults Advertising to denied.
- Consent evidence is append-only and associated with a lead only through a server-controlled operation.
- The browser may report its consent identifier, but it cannot assert that Advertising consent exists; the server verifies the signed consent cookie and stored evidence.

## Persistence Model

Add a dedicated `meta_event_deliveries` table rather than expanding the older `meta_conversion_events` audit table, whose current `Purchase` / `JobCompleted` contract serves a different integration.

Required fields:

- `id uuid primary key`
- `company_id uuid not null`
- `lead_id uuid not null`
- `assessment_id uuid null`
- `consent_id uuid not null`
- `policy_version text not null`
- `event_name text check in ('Lead','AssessmentCompleted')`
- `event_id uuid not null`
- `event_time timestamptz not null`
- `status text check in ('pending','sending','sent','retryable_failed','permanent_failed')`
- `attempt_count integer not null default 0`
- `payload_hash text null`
- `meta_http_status integer null`
- `meta_trace_id text null`
- `last_error_category text null`
- `last_attempted_at timestamptz null`
- `sent_at timestamptz null`
- standard creation and update timestamps

Privacy and integrity requirements:

- Do not persist the outbound Meta payload or raw email/phone in this table.
- Store only a payload hash and sanitized response metadata needed for diagnosis.
- RLS is enabled. Anonymous and authenticated browser roles cannot insert, update, or read rows directly.
- Service-role RPCs reserve events, claim pending delivery, and update delivery outcomes.
- Partial unique indexes enforce one `Lead` per lead and one `AssessmentCompleted` per assessment.
- Reservation RPCs verify company relationships, event eligibility, persisted Advertising consent, and assessment completion inside the transaction.

## Browser Integration

A shared Pixel provider owns script loading and event emission.

- The provider receives verified consent state from the existing privacy context.
- It does not render or request `connect.facebook.net` while Advertising is denied.
- After consent is granted, it initializes Pixel ID `3142520615938086` and records the current `PageView` once.
- Client-side route changes record one additional `PageView` after the destination route is visible.
- Revocation prevents all later events and removes PIW-owned access to `_fbp` and `_fbc`; it does not claim to delete cookies owned by other unrelated sites.
- Conversion helpers accept only a server-issued event envelope containing the allowlisted event name and UUID.
- The provider sends no custom data beyond the event name and `eventID`.
- The main website and PIW application use the same event-envelope type and behavioral test suite.

## Server Integration

### Lead

After canonical intake has committed the lead and linked consent evidence, the server attempts an idempotent `Lead` reservation. When eligible, the response includes a short-lived event envelope for the browser and publishes an internal Inngest event referencing only the delivery-row ID.

### Assessment completion

After the quote UI has rendered a trusted completed assessment, the browser posts an acknowledgement to a token-scoped endpoint. The endpoint validates the assessment token, completion state, trusted pricing evidence, lead relationship, current consent, and CSRF/origin requirements before reserving or returning the existing `AssessmentCompleted` event. The response provides the same event ID used by the server delivery.

### Conversions API worker

The worker loads the eligible lead and request attribution server-side, normalizes and hashes email and phone, builds the CAPI payload, and sends it using the configured Graph API version.

Payload boundaries:

- `event_name`, `event_time`, `event_id`, `action_source: 'website'`, and the canonical public `event_source_url`.
- Hashed normalized email and phone.
- IP address, user agent, `_fbp`, and `_fbc` only when present and covered by the stored Advertising-consent evidence.
- No `custom_data` containing property, pricing, quote, or assessment information.

Retry transient network errors, timeouts, HTTP 429, and Meta 5xx responses. Treat invalid credentials, malformed payloads, and permission failures as permanent after a bounded attempt policy. A delivery failure never changes the business transaction that caused it.

## Configuration

Server-only secrets:

- `META_CAPI_ACCESS_TOKEN`
- `META_TEST_EVENT_CODE` during Test Events validation only

Shared or non-secret configuration:

- `META_TRACKING_ENABLED`
- `NEXT_PUBLIC_META_PIXEL_ID=3142520615938086`
- `META_GRAPH_API_VERSION`, pinned to the version supported when the production token is generated

The feature flag defaults to disabled when any required production setting is missing. Server startup validation must never expose the token value. Preview deployments use Test Events or remain disabled; they must not pollute the production dataset silently.

## Security Boundaries

- The CAPI token is available only to the PIW server runtime and is never returned by an API, embedded in JavaScript, logged, or stored in Postgres.
- Meta event endpoints are allowlisted and derive identity from canonical records rather than accepting arbitrary contact data.
- Event source URLs are constructed from approved application origins, not supplied verbatim by clients.
- Error logs contain delivery IDs and categories, not contact fields or outbound payloads.
- Browser event envelopes expire and are scoped to the relevant lead or assessment action.
- Rate limits protect the assessment acknowledgement endpoint even though database uniqueness remains the final idempotency boundary.

## Testing Strategy

### Database

- Schema, constraints, indexes, RLS, and grants.
- Advertising-denied reservations return no event.
- Duplicate reservations reuse one event ID.
- Cross-company and mismatched lead/assessment requests fail.
- Placeholder or incomplete assessments cannot reserve `AssessmentCompleted`.
- Anonymous and authenticated browser roles cannot access the ledger.

### Application

- No Meta script, cookie access, Pixel call, or server reservation while Advertising is denied.
- Granting consent loads Pixel and records one current `PageView`.
- `Lead` occurs only after persistence succeeds.
- Intake errors do not emit `Lead`.
- Completed, trusted quotes emit one browser event and reserve one server event.
- Error, fallback, and unavailable-token pages emit no completion event.
- Browser and CAPI payloads use the same event ID.
- Normalization and SHA-256 test vectors cover email and E.164 phone handling.
- Meta failures do not alter lead, quote, CRM, or Slack outcomes.
- Retry classification and permanent-failure behavior are deterministic.

### Production-like verification

Use Meta Events Manager's Test Events tab for one explicitly consented test journey:

1. Visit an All Season landing page and grant Advertising consent.
2. Confirm browser `PageView`.
3. Submit a valid lead and confirm browser/server `Lead` are deduplicated.
4. Complete the assessment with trusted pricing and confirm browser/server `AssessmentCompleted` are deduplicated.
5. Confirm the lead, assessment, PIW CRM record, and Slack alert remain correct.
6. Repeat with Advertising denied and verify that the full customer flow succeeds with zero Meta activity.

## Rollout

1. Implement and deploy the privacy-consent prerequisite with Meta disabled.
2. Apply the Meta delivery-ledger migration.
3. Create the Pixel/CAPI integration in Events Manager and generate a least-scope production token.
4. Configure preview with a Test Events code and run the production-like verification.
5. Configure production secrets while leaving `META_TRACKING_ENABLED=false`.
6. Deploy the main website and PIW adapters.
7. Enable Meta tracking for the main site and all campaign routes together.
8. Monitor delivery counts, deduplication, match quality, retry rate, and permanent failures.
9. Remove `META_TEST_EVENT_CODE` from production and record the final runbook evidence.

## Operational Acceptance Criteria

- Meta Test Events shows `PageView`, deduplicated `Lead`, and deduplicated `AssessmentCompleted` for a consented journey.
- A denied-consent journey completes successfully and produces no Meta traffic.
- No event contains property data, answers, pricing, or raw email/phone.
- The browser bundle contains the Pixel ID but never the CAPI access token.
- The delivery ledger proves event identity, attempts, and final status without storing raw outbound payloads.
- Meta downtime cannot block or roll back any customer-facing or CRM workflow.
- An operator runbook documents token rotation, feature-flag rollback, Test Events use, and failure diagnosis.


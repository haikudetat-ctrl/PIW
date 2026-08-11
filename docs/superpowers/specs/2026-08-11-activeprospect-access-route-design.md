# ActiveProspect access-route design

**Status:** Approved design

**Date:** 2026-08-11

**Product boundary:** ActiveProspect LeadConduit → PIW

## Objective

Connect PIW to the client’s `Roofing` and `Roofing Virtual Quote` LeadConduit flows without replacing, proxying, or interrupting any existing source, filter, destination, or downstream system.

The first testing release uses read-only shadow ingestion. The production release adds real-time, non-blocking delivery of accepted leads while retaining five-minute API polling as the reconciliation and rejected-lead discovery path. Potentially over-filtered leads enter a human review workflow inside PIW. Approved rescues become PIW working leads only; PIW does not write back to ActiveProspect, LeadMaster, or JobNimbus.

## Product naming

ActiveProspect is the vendor and LeadConduit is the product used by these flows. PIW continues to model this source system as `leadconduit`. It must not add a parallel `activeprospect` vendor type unless a later project integrates a distinct ActiveProspect product such as TrustedForm.

## Goals

- Observe both approved LeadConduit flows without changing live routing during the testing release.
- Receive accepted production leads in PIW within five seconds.
- Discover rejected, filtered, retried, and errored events within five minutes.
- Explain where a rejected lead stopped, why PIW considers it potentially rescuable, and the recommended next action.
- Keep a human in the loop for every rescue decision.
- Create approved rescue leads in PIW only.
- Preserve an auditable learning loop from rejection through reviewer decision and eventual PIW outcome.
- Keep all integration capabilities disabled by default and independently controllable per flow.

## Non-goals

- Replacing a source submission URL or putting PIW in front of LeadConduit.
- Changing, bypassing, or automatically tuning client filters.
- Automatically rescuing, resubmitting, contacting, or routing rejected leads.
- Writing to ActiveProspect, LeadMaster, or JobNimbus.
- Adding a pre-filter real-time mirror in the first production release.
- Claiming TrustedForm certificates or changing consent handling.
- Treating PIW as a source of truth for the original LeadConduit outcome.

## Approved architecture

### Accepted-lead path

Each approved flow receives one optional PIW custom JSON recipient as its final step, after the client’s existing authoritative destinations:

1. A source submits to the existing LeadConduit flow.
2. Existing acceptance rules, filters, enhancements, and destinations run unchanged.
3. A lead that reaches the final PIW step is delivered to the flow-specific PIW endpoint.
4. PIW authenticates the request, binds it to the configured company and flow, validates it, and stores it idempotently.
5. PIW returns success immediately after durable storage.
6. PIW performs normalization and working-lead creation asynchronously.

The endpoints are:

- `POST /api/integrations/leadconduit/roofing`
- `POST /api/integrations/leadconduit/roofing-virtual-quote`

The two routes share implementation but have separate server-side configuration and secrets. The route name maps to exactly one company and one expected LeadConduit flow ID. Submitted tenant or flow identity is never trusted for authorization.

### Reconciliation and rejected-lead path

A five-minute reader uses the documented LeadConduit API:

- `GET /flows` for inventory and configuration snapshots.
- `GET /flows/{flow_id}/sources/{source_id}/meta` for source field and acceptance metadata.
- `GET /events` with ascending sort, bounded page size, and `after_id` cursoring.
- `GET /events/{event_id}` only when a single event requires diagnostic detail.

The reader retains only the two approved flow IDs, even if the account credential can see other flows. It records source, filter, recipient, retry, feedback, and final source events needed for reconciliation and explanation.

Polling serves three purposes:

1. Recover an accepted lead whose real-time recipient delivery was missed.
2. Discover rejected, filtered, retry, and error events that never reach the final recipient.
3. Reconcile ActiveProspect outcomes with PIW, LeadMaster, and JobNimbus without duplicates.

The polling API uses HTTP Basic authentication as documented by ActiveProspect. PIW’s runtime client exposes GET operations only and contains no flow update or deployment method.

References:

- [LeadConduit authentication](https://developers.activeprospect.com/pages/leadconduit/authentication)
- [List LeadConduit events](https://developers.activeprospect.com/api-reference/leads/list-all-events)
- [LeadConduit source metadata](https://developers.activeprospect.com/api-reference/flows/retrieve-metadata-for-a-specific-source-within-a-flow)
- [Custom JSON recipient](https://support.activeprospect.com/hc/en-us/articles/44098323129876-JSON-integration)

## Real-time endpoint contract

### Required logical fields

The exact LeadConduit mapping names are confirmed during read-only discovery. The delivery contract must include:

- Schema version.
- LeadConduit delivery event ID.
- LeadConduit lead ID.
- Flow ID and flow name.
- Source ID and source name.
- Submission timestamp.
- Test-lead marker when available.
- External lead or attribution identifier when available.
- Standard contact and property fields needed to create a PIW lead.
- TrustedForm certificate URL when already present in the flow.
- Selected campaign and attribution fields already collected by the flow.

The endpoint rejects a payload that lacks the event ID, lead ID, expected flow ID, or minimum PIW lead identity. It does not infer a company from payload content.

### Authentication

- Each flow uses a distinct server-managed bearer token.
- Tokens are never placed in URLs, rendered HTML, application logs, or database payloads.
- Rotation supports an active and next token during a bounded overlap window.
- A token for one flow cannot authenticate to the other flow’s endpoint.

### Responses

- A new valid delivery is durably stored and returns HTTP 200 with a small success object and a non-sensitive receipt ID.
- A duplicate event ID returns the same successful outcome without creating another event or lead.
- Invalid authentication returns HTTP 401 without stating which portion was wrong.
- Invalid schema returns HTTP 400 with field names and categories only, never submitted values.
- Oversized input returns HTTP 413.
- Temporary persistence failure returns HTTP 503 so LeadConduit automated retry can recover it.

LeadConduit must be configured to continue processing when the PIW recipient returns failure or error. Automated retry operates independently and must not alter the original source response or existing destination behavior.

## Persistence and idempotency

The implementation reuses the existing tenant-scoped LeadConduit flow/event and integration-run foundations where their contracts fit. It adds focused rescue-case persistence rather than overloading vendor events with review state.

The logical records are:

- **LeadConduit flow snapshot:** exact flow ID, name, enabled state, source IDs, destination IDs, field IDs, and observed configuration timestamp.
- **LeadConduit event:** immutable vendor event ID, flow/source identity, event type, outcome, reason category, timestamps, normalized matching identifiers, test marker, redacted raw payload, and ingestion channel (`webhook` or `poll`).
- **Delivery receipt:** flow-bound receipt and processing state for the real-time endpoint.
- **Rescue case:** the source event, stopping filter/event, eligibility state, PIW rationale, supporting evidence, confidence, and recommended next action.
- **Rescue decision:** reviewer identity, decision, structured reason, note, corrected fields, and decision timestamp.
- **PIW rescue link:** the idempotent relationship between an approved rescue case and its single PIW lead.

Uniqueness is enforced at least by company plus LeadConduit event ID. A webhook delivery and later API observation merge into one logical event. Repeated approvals cannot create multiple PIW leads.

The original vendor event and rejection outcome remain immutable after review. Corrected values are stored as reviewer evidence and are not written over the original submission.

## Rescue classification

### Candidate categories

A rejected lead may enter rescue review when the observed reason appears correctable or contradicted by stronger PIW evidence, including:

- Address normalization disagreement.
- Geolocation disagreement or service-area boundary ambiguity.
- Missing or malformed non-compliance data that PIW can safely interpret or request for review.
- A lead-specific downstream delivery error that remains unresolved after normal retry handling.
- Conflicting property or jurisdiction evidence.

Account-wide authentication failures, vendor outages, rate limits, and other systemic failures create operational incidents and sync-run failures. They do not create one rescue case per affected lead.

### Excluded categories

The following are non-rescuable by default:

- Missing, invalid, or withdrawn consent.
- Suppression or do-not-contact matches.
- Fraud, prohibited-source, or client blocklist rules.
- Confirmed duplicates.
- Any rule explicitly marked non-rescuable by the client.

Excluded events remain visible in aggregate diagnostics but never receive a rescue recommendation or approval action.

### Case states

`observed → candidate → under_review → rescued_to_piw | not_rescuable | needs_information`

State changes are audited and tenant-bound. Only an authenticated company administrator can decide a rescue case.

## Human review experience

Each rescue case presents three sections:

1. **Why it stopped** — flow, step, exact rejection category, timestamp, and relevant submitted values.
2. **Why it may be rescuable** — conflicting PIW evidence, corrected interpretation, confidence, and limitations.
3. **Recommended next step** — verify address, confirm serviceability, correct data, request more information, rescue to PIW, or leave rejected.

The reviewer chooses:

- **Rescue to PIW**
- **Do not rescue**
- **Needs information**

Every decision requires a structured reason. Free-text notes are optional and must not be exported to vendors automatically. Approval creates one PIW working lead linked to the original LeadConduit event. It does not resubmit the lead, create a vendor record, or initiate automatic outreach.

## Learning loop

The system records:

- Original flow, filter, rule, outcome, and reason.
- PIW candidate category, supporting evidence, recommendation, and confidence.
- Reviewer decision, reason, note, and corrected fields.
- Subsequent PIW pipeline outcomes such as contacted, appointment set, won, lost, or duplicate.

Initial learning is reporting-only. The system calculates review volume, rescue rate, agreement rate, correction patterns, appointment rate, and downstream value by filter category. It may suggest that a rule deserves investigation, but it cannot retrain itself, change thresholds, alter LeadConduit, or auto-approve future rescues.

## Security and tenant isolation

- All vendor credentials and flow tokens remain server-only.
- Request paths map to an explicit company and expected flow ID.
- The service role performs ingestion; authenticated users receive tenant-scoped read access through RLS.
- No service-role key is exposed to a browser.
- Raw payloads are recursively redacted for credential-like fields before persistence.
- Logs and error responses contain request IDs, status, counts, field names, and categories only.
- Payload size and content type are bounded before parsing.
- Flow-specific rate limits protect the endpoints from misuse.
- The reader filters records by approved flow IDs before persistence and again before presentation.
- Security-invoker views preserve caller RLS.

## Flags and operating modes

All capabilities default to disabled. Configuration separates:

- Read-only connection probe.
- Capped manual import.
- Five-minute scheduled polling.
- `Roofing` real-time receipt.
- `Roofing Virtual Quote` real-time receipt.
- Asynchronous lead processing.
- Rescue recommendation generation.
- Rescue-to-PIW approval action.

Receipt and processing are separate controls. During an incident, PIW can continue authenticating, storing, and acknowledging deliveries while asynchronous processing is paused. This prevents the optional recipient from generating avoidable LeadConduit retries while preserving data for later recovery.

## Failure handling

- The PIW recipient sits after existing authoritative destinations.
- LeadConduit continues after PIW failure and uses automated retry for transient errors.
- Polling recovers missing webhook deliveries within five minutes.
- One flow’s credential, payload, or processing failure cannot block the other flow.
- Cursor advancement occurs only after a page is safely processed.
- Vendor 401/403 responses stop bounded retries and surface an authentication category.
- Rate limits and transient 5xx responses use bounded backoff.
- Duplicate delivery returns success and does not enqueue duplicate work.
- Malformed customer data creates a sanitized failure record and never appears in logs.
- A failed rescue approval does not advance the case or create a partial working lead.

## Rollout

### Phase 1: Read-only discovery

1. Keep all ActiveProspect flags disabled.
2. Test the credential with GET requests only.
3. Identify the exact IDs for `Roofing` and `Roofing Virtual Quote`.
4. Snapshot sources, filters, steps, destinations, fields, and deployment state.
5. Inspect source metadata and confirm field mappings with the flow owner.
6. Record accepted, rejected, and error baselines by flow and filter.
7. Run a sanitized probe that reports only status, counts, flow names, and field names.

### Phase 2: Shadow release

1. Import a capped sample from each flow with schedules disabled.
2. Verify tenant isolation, idempotency, field normalization, reconciliation, and failure display.
3. Classify historical rejections and review the explanations without vendor writes.
4. Enable five-minute polling after sample acceptance.
5. Compare PIW totals to LeadConduit totals for the same time window.

### Phase 3: Real-time canary

1. Deploy and directly test both PIW endpoints before changing a flow.
2. Save the existing flow configuration and changelog evidence for rollback.
3. Add the PIW recipient as the final optional step in the lower-volume flow.
4. Configure continuation on failure and automated retry.
5. Save and test the flow change before explicit deployment when ActiveProspect draft testing is available. If it is unavailable for the account, use the single synthetic lead immediately after deployment as the controlled test and keep the snapshotted configuration ready for immediate rollback.
6. Deploy the flow change and submit one synthetic lead.
7. Confirm every existing destination behaves exactly as before and PIW receives the lead once.
8. Observe for at least 24 hours and 25 leads. If volume is below 25, extend observation until 25 leads are seen.
9. Repeat for the second flow only after the first meets every acceptance condition.

The lower-volume flow is selected from the discovery baseline. The chosen order is recorded in the release checklist.

## Acceptance criteria

- Exact flow and source IDs are confirmed with the client flow owner.
- Only `Roofing` and `Roofing Virtual Quote` data is persisted.
- Accepted leads are durably received by PIW within five seconds at the 95th percentile.
- Polling reconciliation completes within five minutes of event availability.
- Webhook retry and polling overlap create no duplicate events or PIW leads.
- Existing destination counts and outcomes show no regression during the comparison window.
- A PIW outage does not change the original source response or block an existing destination.
- Rescue cases show the stopping rule, evidence, rationale, confidence, and recommended next step.
- Consent, suppression, fraud, prohibited-source, and confirmed-duplicate events are never recommended for rescue.
- Only a human administrator can create a PIW lead from a rescue case.
- Approved rescue creates one PIW lead and no vendor write.
- Control-tenant users cannot read, review, or act on another tenant’s records.
- Failure displays and logs contain no customer values or credentials.
- Every integration and rescue flag defaults to false.
- Existing application, database, integration, end-to-end, and production build suites pass before either flow is deployed.

## Rollback

1. Pause asynchronous PIW processing while continuing to authenticate, store, and acknowledge valid deliveries.
2. Preserve polling and reconciliation so visibility is not lost.
3. Remove or disable the optional PIW recipient from the affected saved flow.
4. Deploy the previously snapshotted flow configuration.
5. Confirm existing destination counts and outcomes return to baseline.
6. Resume PIW processing only after the cause is understood and a new canary passes.

## Implementation prerequisite

The current generic `POST /api/integrations/[vendor]` route must not be attached to a live LeadConduit flow as-is. It currently chooses a primary company rather than a flow-bound tenant, and its asynchronous processor does not yet implement LeadConduit normalization or PIW lead creation.

Implementation must first add explicit flow-to-company binding, separate per-flow credentials, strict payload contracts, real event normalization, durable receipt state, and sanitized operational diagnostics. Work must begin from an up-to-date clean branch because the current checkout contains unrelated uncommitted website and UI changes.

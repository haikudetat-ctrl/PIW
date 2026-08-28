# Post-Consent Property Intelligence Prefetch

**Date:** 2026-08-28
**Status:** Approved design, awaiting specification review

## Objective

Make the property aerial and Google Solar calculation begin from trusted coordinates immediately after the homeowner grants consent. The branded analysis sequence should cover normal provider latency instead of repeatedly polling while PIW waits for a separate address-validation pipeline.

This change must preserve the consent boundary, CRM capture, tenant isolation, submission idempotency, secure assessment continuation, Google-only quote ranges, and the slower recovery path for manual or temporarily unresolved addresses.

## Production Evidence

Vercel runtime logs from three fresh production journeys on 2026-08-27 show that coordinate availability, not image transfer or Google Solar processing, is the current bottleneck:

| Stage | Observed duration |
|---|---:|
| First image request to coordinates available | 21s, 27s, 40s |
| Aerial response after coordinates were available | 0.45s–1.87s; median approximately 0.64s |
| Google Solar worker | 1.28s–1.74s; median approximately 1.39s |

The sample is small and should not be treated as a durable percentile baseline. It is sufficient to show that the existing 12-second imagery ceiling cannot reliably hide the asynchronous coordinate-resolution delay. The current image endpoint behaves correctly once coordinates exist.

## Scope

### Included

- Google-selected addresses submitted from every canonical All Season form
- Immediate server-side Google Place Details resolution after the consent transaction commits
- Atomic persistence of canonical address, Place ID, coordinates, and validation evidence
- Immediate aerial retrieval and Google Solar dispatch from the committed coordinates
- Eight-second minimum analysis experience and twelve-second imagery ceiling
- A premium in-box imagery loader after the ceiling
- Existing asynchronous recovery for transient provider failures and manual addresses
- Idempotent provider dispatch and timing telemetry
- Database, domain, API, route, component, integration, and production-browser coverage

### Excluded

- Changing the address-autocomplete suggestions UI
- Accepting browser-supplied latitude or longitude
- Blocking CRM capture on a transient Google failure
- Inventing a quote range while Google Solar is pending or unavailable
- Replacing Google Static Maps or Google Solar
- Changing assessment questions, scoring, consent copy, or consultation behavior
- Making manual addresses appear Google-verified

## Selected Architecture

Resolve coordinates at the trusted PIW consent intake boundary, immediately after the canonical consent transaction commits and before the continuation response returns.

The website continues sending only the selected Google Place ID and formatted address. PIW exchanges that Place ID for Place Details using its server-side credential. This preserves the browser trust boundary while avoiding the current delay between consent acceptance and asynchronous address validation.

The alternatives are rejected:

- Resolving coordinates in the browser would expose an unnecessary client-controlled coordinate payload and still require server verification.
- Extending the loader without changing intake would hide rather than fix the observed 21–40 second delay.

## Canonical Data Flow

### Google-selected fast path

1. The homeowner selects an autocomplete result. The website retains its Place ID and formatted address.
2. The homeowner supplies contact details and grants both existing consents.
3. The website submits the canonical campaign-estimate payload. It does not send coordinates.
4. PIW authenticates the server-to-server request and validates the existing intake contract.
5. The canonical intake transaction commits the consent evidence, lead/property/assessment identity, access attempt, and intake idempotency state.
6. A replay or resume candidate follows its existing authorization path and does not invoke the fast-path provider again.
7. For a first issue with a Google Place ID, PIW calls Google Place Details within a 2,500ms fast-path budget.
8. PIW accepts the fast-path result only when it is a precise New Jersey street or premise match with a canonical address and finite coordinates.
9. A dedicated service-role database function locks the exact company, assessment, and property; atomically persists the validated property evidence; and enqueues the existing property-discovery work with those coordinates.
10. The browser receives and follows the existing secure continuation contract.
11. The analysis page immediately requests the aerial while the property-discovery worker requests Google Solar in parallel.
12. The analysis sequence remains visible for at least eight seconds. If the aerial is ready, property confirmation appears at eight seconds. If it remains unavailable, analysis continues until twelve seconds.
13. At twelve seconds, property confirmation appears with the real address and an in-box premium imagery loader. The aerial keeps retrying and replaces the loader when it arrives.
14. Google Solar may complete during the loader, confirmation, or questions. Only its trusted completed result can produce a dollar range.

### Transient Place Details failure

1. PIW records a sanitized fast-path failure metric.
2. PIW still accepts and persists the consented lead and assessment using the existing address and Place ID contract.
3. The existing asynchronous address-validation pipeline remains responsible for coordinates.
4. The analysis page follows the same eight-second minimum and twelve-second ceiling, then uses the in-box loading state until imagery becomes available.
5. No provider error, coordinate state, or lead-match detail is exposed to the homeowner.

### Manual-address path

Manual addresses never enter the immediate-coordinate fast path. They retain the current background validation and review behavior. The UI may use the longer in-box imagery state, but it must not label a manually entered address as Google-confirmed.

## Intake Contract

The public website-to-PIW payload remains unchanged. The internal post-consent prefetch use case constructs a validated-property object containing:

- Google Place ID
- Canonical formatted address
- Latitude and longitude
- Municipality, county, state, and postal code when returned
- Match method and confidence
- Provider identifier and retrieval timestamp

Only the PIW server may construct this object after the intake transaction returns a first-issue result. The integration route must not project latitude or longitude from incoming JSON, even if extra properties are supplied.

A dedicated idempotent service-role database function accepts the validated-property object plus the server-held company, assessment, and property identity. It must row-lock the assessment/property boundary, validate finite coordinate bounds, preserve company ownership, bind the validation evidence to the same property, and write the canonical address before emitting downstream work in the same transaction. The first implementation flag is `ROOF_ASSESSMENT_PROPERTY_PREFETCH_ENABLED`.

## Persistence and Idempotency

The existing property/address identity tables remain authoritative. The fast path adds evidence rather than creating a parallel coordinate store.

Required guarantees:

- Company plus submission UUID remains the intake idempotency boundary.
- A replay cannot create a second assessment, property, discovery event, provider request, or public capability.
- Property identity matching remains serialized at the existing tenant/property boundary.
- Place ID remains the primary property match when available; normalized address remains the fallback.
- The initial consent transaction commits before Place Details is called.
- A fast-path evidence write and its discovery outbox entry commit or roll back together in the post-consent transaction.
- The asynchronous validator may observe the completed validation and exit idempotently; it must not overwrite newer exact evidence or emit duplicate discovery work.
- Google Solar retains its existing provider request key, cache lookup, and monthly usage reservation.
- A repeated aerial request may reuse its private response cache but cannot expose the Google API key or cross property/token boundaries.

## Analysis and Imagery Behavior

The analysis experience changes from a five-second minimum to:

- Minimum duration: 8,000ms
- Imagery ceiling: 12,000ms from analysis mount
- Retry cadence while pending: honor a valid `Retry-After`; otherwise wait 2,500ms

An initial `coordinates_pending` or other retryable response must not be treated as a terminal image failure at eight seconds. The loading component continues attempting until the twelve-second ceiling. Non-retryable responses may stop the loading-screen retries but still use the safe in-box state.

After twelve seconds:

- The homeowner reaches property confirmation.
- The address and correction link remain available.
- The image box shows a branded neutral loading treatment, not unrelated property imagery.
- Retry continues every 2,500ms for no more than 36 post-reveal attempts, matching the current bounded recovery window.
- The rest of the assessment remains usable.
- Copy says imagery is being prepared; it never claims that imagery was reviewed before it loaded.

The eight-second sequence is an intentional minimum, not fake percentage progress. The scrolling stages remain qualitative and support reduced motion.

## Google Solar Behavior

Google Solar starts from the same committed validated coordinates as the aerial request. It remains asynchronous and does not gate property confirmation or questions.

The result contract remains unchanged:

- `ready`: a Google Solar success record bound to the exact company and property may produce the calculated range.
- `pending`: show the personalized project outlook without a dollar range and refresh quietly.
- `review_required`: explain that a trustworthy automated calculation was unavailable.

No answer-only, sample, cached-from-another-property, or provisional range is permitted.

## Security and Privacy Boundaries

- Consent must be committed before Place Details prefetch, property imagery, or Google Solar work begins. Address autocomplete suggestions remain the existing pre-consent form aid and return no coordinates.
- Places, Static Maps, and Solar credentials remain server-only.
- Browser-supplied coordinates are ignored and rejected by strict schemas where applicable.
- The validated-property object is accepted only from the authenticated internal transport.
- Public image access remains scoped by the existing estimate token and exact tenant/property lookup.
- Application structured log bodies must not contain names, emails, phone numbers, full addresses, public tokens, Place IDs, coordinates, provider URLs, or API keys. Vercel may retain the requested route path as platform access metadata.
- Timing logs use request IDs, pipeline IDs where already approved, outcome enums, cache state, and durations.
- Provider failures return homeowner-safe states and do not reveal whether a prior lead or property exists.

## Observability

Add structured timing events for:

- Consent request received
- Place Details started and completed
- Intake transaction completed
- Consent-to-coordinates duration
- Discovery event enqueued
- Aerial request outcome and duration
- Google Solar worker outcome and duration
- Analysis result: ready at eight seconds, ready between eight and twelve seconds, or in-box continuation at twelve seconds

Production dashboards should distinguish:

- Google-selected fast path
- Google-selected fallback path
- Manual-address path
- Provider cache hit
- Retryable coordinates pending
- Terminal provider failure

Initial alerting should be based on failures and missing events, not tight latency percentiles, until enough production samples exist.

## Error Handling

- Invalid or imprecise Place Details results do not enter the fast path.
- A transient Places failure or the 2,500ms fast-path timeout does not discard consent or CRM capture.
- Intake transaction failure returns the existing retry-safe source-form error.
- A post-consent validated-property transaction failure returns the existing continuation, records a sanitized fallback outcome, and leaves asynchronous validation responsible for recovery.
- Aerial failure never blocks questions.
- Google Solar failure never invents a range.
- Duplicate submissions reuse the canonical intake identity and do not repeat paid provider work.
- If fast-path persistence succeeds but provider dispatch fails, the committed outbox remains retryable.
- If the post-consent validated-property transaction fails, it emits neither partial evidence nor fast-path discovery work.

## Migration and Rollout

1. Add the idempotent post-consent validated-property persistence function and pgTAP coverage without changing existing callers.
2. Teach property discovery to reuse committed exact coordinates and suppress duplicate validation/discovery work.
3. Add the PIW Place Details fast path behind a server-side feature flag.
4. Change the loader to the eight-second minimum, twelve-second ceiling, and in-box continuation behavior.
5. Add structured timings before enabling production traffic.
6. Deploy PIW with the feature disabled and verify migrations, existing manual flow, and continuation security.
7. Enable the fast path for All Season production traffic.
8. Run one Google-selected journey from each canonical website entry point and at least one manual-address fallback.
9. Compare consent-to-coordinates, aerial-ready, and Solar completion timings before declaring the rollout complete.

Rollback disables the fast-path feature flag. The additive validated address evidence remains valid, and all traffic returns to the existing asynchronous property-validation path without losing leads or assessments.

## Verification Strategy

### Database

- Consent transaction completes before the validated-property provider is invoked
- Atomic validated address evidence plus discovery outbox in the post-consent function
- Exact company/property binding
- Coordinate bounds and null handling
- Submission replay and provider idempotency
- Concurrent duplicate intake produces one discovery event and provider request
- Async validator cannot regress exact fast-path evidence
- Transaction rollback leaves no partial evidence or event
- Service-role-only execution and existing RLS boundaries

### Domain and API

- Strict source payload still rejects incoming coordinates
- Exact NJ Place Details result enters the fast path
- Imprecise, non-NJ, malformed, timeout, and provider-error results use fallback
- Continuation result and safe public response remain unchanged
- Duplicate submission does not repeat Place Details or paid discovery after canonical acceptance
- Structured logs contain timing fields and no prohibited property or contact data

### UI

- Analysis never advances before eight seconds
- Ready aerial advances at eight seconds
- Aerial arriving between eight and twelve seconds advances immediately
- Retryable early failures remain in analysis until the ceiling
- Twelve-second ceiling opens confirmation with the in-box loader
- Late aerial replaces the loader without remounting or losing assessment state
- Reduced motion, screen-reader status, keyboard flow, and supported mobile viewport sizing remain correct

### End to end

- Google-selected homepage, contact, drawer, root estimate, and three campaign submissions
- Manual-address fallback
- Transient Place Details failure with successful async recovery
- Same-browser replay and cross-device resume do not duplicate provider work
- Google Solar ready, pending, no-coverage, and failure result states
- CRM record, attribution, consent evidence, PIW context-dialer entry, delivery, and Slack alert remain intact

## Success Criteria

- Google-selected submissions persist trusted coordinates during the consent request, after consent commits and before the continuation response returns in the normal fast path.
- Aerial and Google Solar work begin only after consent and then run in parallel.
- At least 90% of Google-selected production journeys show the real aerial at the eight-second reveal after an initial measurement period establishes a baseline.
- No supported journey is trapped on the analysis screen beyond twelve seconds.
- Manual and transient-failure journeys remain usable through the existing asynchronous recovery path.
- No duplicate paid provider calls occur during retries, replays, or concurrent submissions.
- No unsupported dollar range is ever displayed.
- Existing source attribution, consent evidence, CRM records, assessment access controls, and downstream alerts remain unchanged.

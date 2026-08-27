# All Season assessment rollout

This runbook releases the canonical post-submit roof assessment without making
the rollout itself part of a code change. The release is additive: existing
lead, assessment, access-attempt, verification, consultation, event, and outbox
records remain intact during rollout or rollback.

## Release invariants

- Roll out in this order: database migrations, PIW, All Season website, smoke
  tests, then traffic enablement.
- Keep the production website alias and entry adapters on the previous release
  until the preview deployment passes smoke. Do not send live traffic to an
  unverified adapter.
- Never use a public estimate token as general mutation authority. Every result,
  result-view, and consultation operation remains bound to the exact company,
  assessment, estimate, property, and completed assessment.
- A dollar range is ready only when it is backed by the same-company,
  same-property `roof_insights` row with provider `google_solar`, lookup status
  `success`, a non-failed/non-partial/non-review pipeline, a positive measured
  roof area, and increasing real cent values. Pending and professional-review
  states must not emit sample or placeholder dollars.
- Every syntactically valid, attempt-dependent cross-device verification start
  or check outcome has a minimum 8.25-second response time. The floor covers
  sent, unknown, throttled, and provider-failed starts, plus pending,
  incorrect-six-digit-code, provider-failed, and approved checks. Wrong content
  type, malformed JSON, an invalid attempt UUID, or a malformed code returns an
  immediate state-independent `400` after strict syntax validation and does not
  enter the timing floor. Do not broaden or bypass this reviewed boundary.
- In production, client-IP throttles trust only one valid
  `x-vercel-forwarded-for` value when a nonempty `x-vercel-id` marker is also
  present. Vercel must overwrite both headers at the edge. Do not put PIW behind
  a proxy that forwards caller-supplied values under those names.

## Configuration

Use different secrets and tenant IDs for preview and production. Store all
secret values in the deployment platform; do not commit them.

### PIW

| Variable | Requirement |
| --- | --- |
| `ROOF_ASSESSMENT_ENABLED` | Master assessment and authenticated All Season adapter gate. Keep `false` until the target deployment is ready for smoke or traffic. |
| `ROOF_ASSESSMENT_SIGNING_SECRET` | Required when assessments are enabled. At least 32 UTF-8 bytes; signs one-time continuation capabilities and same-browser session cookies. Rotate only with an explicit session-invalidation plan. |
| `TWILIO_VERIFY_ENABLED` | Cross-device resume gate. Keep `false` unless all Twilio values are present and the assessment gate is enabled. |
| `TWILIO_API_KEY_SID` | Twilio API key SID used by Verify; secret server-side configuration. |
| `TWILIO_API_KEY_SECRET` | Secret paired with the API key SID. |
| `TWILIO_VERIFY_SERVICE_SID` | Verify service SID for the intended environment. Use a sandbox/test service during smoke. |
| `ALL_SEASON_INTAKE_SHARED_SECRET` | Server-to-server authentication secret. Must exactly match the website's `INTAKE_WEBHOOK_SHARED_SECRET`. |
| `ALL_SEASON_INTAKE_COMPANY_ID` | UUID of the All Season tenant. Intake writes are scoped to this company. |

PIW also needs its normal Supabase server credentials. A full Google-derived
ready range additionally requires the existing paid-provider/Google pipeline
configuration; leaving those providers disabled is valid and yields pending or
professional-review results, never invented dollars.

### All Season website

| Variable | Requirement |
| --- | --- |
| `CAMPAIGN_ESTIMATE_WEBHOOK_URL` | Absolute PIW URL ending in `/api/integrations/all-season/campaign-estimate` for the same environment as the website deployment. |
| `INTAKE_WEBHOOK_SHARED_SECRET` | Must exactly match PIW's `ALL_SEASON_INTAKE_SHARED_SECRET`. Sent server to server only. |
| `PIW_PUBLIC_APP_URL` | PIW public origin used to construct the returned continuation URL. It must be an origin only, with no credentials, path, query, or fragment. Production requires HTTPS; local development permits `http://localhost` or `http://127.0.0.1`. |

The website also uses `GOOGLE_PLACES_API_KEY` for normalized address suggestions.
Manual New Jersey address fields remain available and must retain street, city,
state, ZIP, both consent values, and campaign/entry framing.

## Bounded abuse controls

These limits are durable database reservations, not process-local counters.
Provider failures still consume a verification reservation.

- Verification: one send reservation per company and destination every 60
  seconds; at most five reservations per rolling hour for a company/destination
  and five per rolling hour for a company/trusted client IP. An event exactly
  60 seconds or one hour old is outside its respective bucket.
- Consultation: at most six submissions per assessment and twenty per trusted
  client IP in a rolling hour. An attempt exactly one hour old is outside the
  bucket. Identical retries keep one stable consultation request and do not
  duplicate the sparse event/outbox record.

The database uses row and transaction advisory locks so concurrent requests
cannot overrun these boundaries. Keep generic public error responses; do not
expose whether a phone number, attempt, assessment, or provider request exists.

## Preflight gates

Use Node 24 and the project-pinned Supabase CLI. Review the official Supabase
changelog and CLI release notes before production; upgrade and rerun the full
gate separately rather than changing tool versions during a rollout. From the
repository root, start/reset the local stack when needed, then run the canonical
database and application gates:

```bash
npx supabase --help
DOCKER_CONFIG=/tmp/piw-assessment-docker npx supabase db reset --local
DOCKER_CONFIG=/tmp/piw-assessment-docker npx supabase test db
npm run lint
npm run typecheck
npm run test:run
npm run test:integration
npm run build
npm --prefix apps/website run lint
npm --prefix apps/website run typecheck
npm --prefix apps/website test
npm --prefix apps/website run build
```

Generate local types after the reset and require no diff before release:

```bash
DOCKER_CONFIG=/tmp/piw-assessment-docker npx supabase gen types typescript --local
DOCKER_CONFIG=/tmp/piw-assessment-docker npx supabase migration list --local
```

Known baseline findings must not be mistaken for new release failures:

- Root ESLint currently reports four pre-existing unused-variable warnings and
  zero errors: `_context` in the assessment-route and public-assessment tests,
  plus `_companyId` and `_claimedBy` in the event outbox repository. The release
  may not add warnings.
- Database lint currently reports only pre-existing unused variables in
  `claim_property_address` and `escalate_property_identity_review`.
- Database advisors currently report only the pre-existing duplicate permissive
  authenticated `SELECT` policies on `public.leads`.

## Rollout

### 1. Apply migrations

1. Confirm the target project and migration list before any write.
2. Apply every committed migration through
   `20260826182910_canonical_roof_assessment_journey.sql`.
3. Run canonical pgTAP and the full database suite against the migrated target.
4. Confirm RLS is enabled and the assessment RPCs remain executable only by
   `service_role`.

Do not deploy either application against a partially migrated database.

### 2. Deploy PIW

1. Configure the PIW values above for the target environment.
2. Keep `TWILIO_VERIFY_ENABLED=false` unless the target uses approved Twilio
   sandbox/test credentials during preview smoke.
3. Deploy PIW to a non-production alias first. Enable
   `ROOF_ASSESSMENT_ENABLED=true` only in that isolated target so the full preview
   journey can be tested while production traffic remains on the old adapter.
4. Verify the production edge topology satisfies the trusted Vercel-header
   contract before enabling cross-device verification.

### 3. Deploy the All Season website

1. Set the website endpoint, shared secret, and PIW origin to the same preview
   environment and tenant.
2. Deploy without promoting the production alias.
3. Confirm literal mappings: homepage `main-home` / `all-season-main`, contact
   `main-contact` / `all-season-main`, drawer `main-drawer` /
   `all-season-main`, and each campaign `campaign:<slug>` / `<slug>` for
   `weather-report`, `seasonal-shield`, and `for-every-season`.
4. Confirm the retired `do-it-right-once` slug cannot enter canonical intake.

### 4. Smoke the preview pair

Use synthetic contact data, local/intercepted intake, the fake verification
provider, or an approved Twilio sandbox. Never call live Twilio or Google from a
release smoke.

For local visual verification, run PIW on port 3000 and the website on port 3001
in separate terminals:

Terminal 1:

```bash
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Terminal 2:

```bash
npm --prefix apps/website run dev -- --hostname 127.0.0.1 --port 3001
```

Terminal 3:

```bash
WEBSITE_BASE_URL=http://127.0.0.1:3001 \
ASSESSMENT_BASE_URL=http://127.0.0.1:3000 \
python3 apps/website/scripts/visual-test.py
```

Smoke homepage, contact, drawer, all three campaign routes, and PIW
`/roof-estimate`. For each website entry, inspect the intercepted
`/api/campaign-estimate` payload, return a same-origin API response containing a
PIW continuation URL, and verify the browser navigates only to that URL. Then
verify:

1. Structured address and both consent values are retained.
2. The branded analyzer stays up for five seconds and advances through the
   address, roof, aerial imagery, and assessment stages.
3. Presentation and result framing match the source while factual state remains
   shared.
4. Property confirmation and every progressive-save question work without
   scrolling to the next action at 320×568, 375×667, 390×844, 768×1024, and
   1440×900.
5. Ready, pending, and professional-review results obey the Google-only range
   rule. The project outlook stays visible in all three.
6. Consultation call/text/email choices save inline; call requires one of five
   ET windows, text/email reject a window, failures retain the selection, and an
   identical retry is idempotent.
7. Closing and reopening in the same browser resumes with the signed session,
   consumes the resume attempt, and rotates the public token without an OTP.
8. A different browser/device requires fake-provider or Twilio sandbox approval
   before it consumes the attempt and rotates the public token.

For a production candidate, substitute the two preview HTTPS origins and run
read-only reachability before the controlled synthetic browser smoke:

```bash
PIW_SMOKE_ORIGIN=https://piw-preview.example.com
WEBSITE_SMOKE_ORIGIN=https://www-preview.example.com
curl --fail --silent --show-error --head "$PIW_SMOKE_ORIGIN/roof-estimate"
curl --fail --silent --show-error --head "$WEBSITE_SMOKE_ORIGIN/"
curl --fail --silent --show-error --head "$WEBSITE_SMOKE_ORIGIN/contact.html"
```

Do not paste secrets into browser tools or shell history. Save screenshots and
request IDs, but redact phone, email, address, continuation capability, public
token, internal IDs, and verification codes from release evidence.

### 5. Enable traffic

1. Promote the verified PIW and website deployments together.
2. Set `ROOF_ASSESSMENT_ENABLED=true` in production and redeploy PIW if the
   production target was staged disabled.
3. Enable `TWILIO_VERIFY_ENABLED=true` only after trusted-header and sandbox
   verification have passed.
4. Watch 400/401/409/429/5xx counts, assessment starts/completions, result states,
   consultation events/outbox delivery, and verification latency during the
   initial traffic window.
5. Treat `409` duplicate responses as an explicit restart: create a new
   submission ID. Never replay a consumed continuation secret or reuse the old
   public token after either authorized resume path rotates it.

## Rollback

Rollback changes routing, not data:

1. Disable new website entry adapters by restoring the previous website
   deployment/alias so forms stop calling `/api/campaign-estimate`.
2. Set PIW `ROOF_ASSESSMENT_ENABLED=false` and redeploy. The public form action
   and authenticated All Season assessment adapter will reject new starts.
3. Set `TWILIO_VERIFY_ENABLED=false` to stop new cross-device Verify calls.
4. Leave additive assessment, consent, attribution, access-attempt,
   verification, consultation, event, and outbox records in place. Do not delete
   or rewrite them as part of rollback.
5. Preserve result URLs and operational evidence for incident review. Existing
   signed sessions may become unavailable while the gate is disabled; re-enable
   only after the fault is understood and smoke gates pass again.

Rollback does not restore a consumed continuation secret, undo a rotated public
token, or synthesize a quote for an assessment whose Google calculation was not
ready.

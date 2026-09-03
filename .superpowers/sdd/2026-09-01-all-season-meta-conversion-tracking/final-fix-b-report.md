# Final Fix B report — authoritative consent, GPC, and fail-closed tracking

## Result

Implemented the Final Fix B consent authority boundary without migrations,
deployment, environment changes, external calls, or secret handling.

- A stored website or PIW consent cookie now authenticates only a consent
  identity. It cannot enable Advertising until the appropriate canonical
  current-consent status request succeeds.
- Browser Global Privacy Control is authoritative at every boundary: browser
  providers, static runtime, website status/sync, PIW status, intake proxies,
  assessment result acknowledgement, and CAPI eligibility.
- Canonical status or synchronization failures suppress only nonessential
  tracking. Lead intake, assessment continuation, quote/result delivery, and
  privacy controls remain usable.

## Authority model

1. The website signs its opaque cookie server-side and synchronizes it to PIW
   through the authenticated `/api/privacy/consent/current` server boundary.
   The endpoint validates the exact allowed origin, shared credential,
   signature, policy, timestamp, and GPC signal. It returns only the minimal
   canonical consent snapshot.
2. Both same-origin React providers begin an existing Advertising grant in a
   fail-closed state. They enable it only after their status endpoint returns a
   valid, same-ID/policy canonical snapshot. A new save or revocation starts a
   fresh fail-closed authority epoch immediately.
3. PIW's status endpoint reads the unlinked canonical evidence rather than
   trusting its cookie. A GPC status read appends canonical GPC denial evidence
   when necessary, so queued CAPI deliveries observe the denial too.
4. Website intake/campaign proxies perform canonical resolution before reading
   `_fbp` or `_fbc`. If consent cannot be resolved, business payloads continue
   with those identifiers withheld and no tracking handoff.
5. PIW intake, campaign, and result-view flows re-evaluate signed consent plus
   canonical current state and request GPC at event time. The CAPI repository
   additionally suppresses a claimed delivery before contact/attribution is
   read if unlinked canonical history is missing, denied at event time, or
   revoked/GPC-marked after event time. A later grant cannot revive an older
   event.

## Regression coverage

Added or strengthened tests for:

- an existing grant held until canonical status resolves in both React apps;
- status fallback/revocation and a canonical GPC record on PIW;
- GPC defeating an equal-time canonical grant;
- cross-origin bad origin/credential/token rejection and minimal response;
- canonical status/sync failure and origin divergence;
- residual `_fbp`/`_fbc` suppression while business submissions still succeed;
- direct browser Pixel GPC defense; and
- pending CAPI delivery suppression after website revocation, including a
  later grant.

## Round 1 review closure

- PIW and website React Pixel providers now revalidate canonical consent on
  focus, visible-tab restoration, pathname changes, and immediately before
  every PageView or conversion. Async authority epochs prevent an in-flight
  grant from emitting after navigation, revocation, or a local consent change.
- The static public-page runtime follows the same rule. Its pre-navigation
  check is bounded so unavailable consent infrastructure never blocks a form
  redirect; uncertainty suppresses Meta only.
- Historical `gpcDetected` evidence remains a denial record but no longer
  masquerades as a live browser signal. PIW permits a later explicit grant
  after GPC is absent, while live navigator/Sec-GPC remains authoritative.
- Equal-time canonical conflicts are deny-wins for ordinary revocations as
  well as GPC. Queued CAPI eligibility has an exact-event-time revocation
  regression so a same-time denial prevents contact/attribution access.
- Both browser consent POST routes reject a missing, malformed, or mismatched
  `Origin` before parsing or persistence. Consent writes are durably limited
  against existing unlinked `privacy_consent_evidence` (12 writes per opaque
  consent ID per hour), with no process-local production state or new schema.
  Over-limit grants are rejected; a current grant can still be revoked once,
  and all unavailable/limited website sync paths remain tracking-denied.

## Round 2 app-layer closure

- Website-cookie `gpcDetected` is now treated strictly as historical evidence.
  With live request/browser GPC absent, website status, intake, campaign, and
  canonical synchronization clear the historical flag and never synthesize a
  `Sec-GPC` header. A later PIW grant can therefore become current; live
  navigator/Sec-GPC still forces denial.
- PIW and website React consent providers now assign monotonic authorization
  request epochs in addition to their choice epochs. A delayed boot/status
  grant cannot overwrite a newer denial, supersede a save, or authorize a
  Pixel callback after a newer request has resolved.
- The static runtime applies the same monotonic authority rule across boot,
  focus/visibility revalidation, pre-event checks, timeouts, and saves. A
  delayed boot grant after a focus denial remains stale and emits no PageView
  or conversion.
- Round 2 intentionally does not extend the interim count-based limiter or
  equal-time storage behavior. Those database-level concerns are reserved for
  the forward atomic RPC migration in Final Fix C.

## Verification

- `npm run test:run` — PASS: 135 files / 905 tests (6 files / 7 tests skipped)
- `npm --prefix apps/website test` — PASS: 21 files / 175 tests
- `npm run typecheck` — PASS
- `npm --prefix apps/website run typecheck` — PASS
- `npm run lint` — PASS with 11 pre-existing unrelated warnings and no errors
- `npm --prefix apps/website run lint` — PASS
- `npm run build` — PASS
- `npm --prefix apps/website run build` — PASS

The first sandboxed builds could not fetch configured Google Fonts or spawn
Turbopack's CSS worker; both local builds passed when rerun in the normal local
execution environment.

## Deliberate non-actions

- No database migration files changed.
- No deployment, Vercel, Supabase, Meta, Slack, or external service action was
  performed.
- No environment variables or secret values were changed or reported.

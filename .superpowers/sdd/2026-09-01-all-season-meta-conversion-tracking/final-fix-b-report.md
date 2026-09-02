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

## Verification

- `npm run test:run` — PASS: 135 files / 893 tests (6 files / 7 tests skipped)
- `npm --prefix apps/website test` — PASS: 20 files / 166 tests
- `npm run typecheck` — PASS
- `npm --prefix apps/website run typecheck` — PASS
- `npm run lint` — PASS with 11 pre-existing unrelated warnings and no errors
- `npm --prefix apps/website run lint` — PASS
- `npm run build` — PASS
- `npm --prefix apps/website run build` — PASS

The first sandboxed website build could not spawn Turbopack's CSS worker; the
same local build passed when rerun in the normal local execution environment.

## Deliberate non-actions

- No database migration files changed.
- No deployment, Vercel, Supabase, Meta, Slack, or external service action was
  performed.
- No environment variables or secret values were changed or reported.

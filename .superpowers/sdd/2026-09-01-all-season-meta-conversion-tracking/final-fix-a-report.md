# Final Fix A report — website runtime, forms, and consent presentation

Status: complete

## Implemented

- Added a dynamic static-page shell: `/` and every proxied `*.html` page now receive one `privacy-runtime.js` + stylesheet injection. App Router campaign routes remain on their existing single React consent/Pixel provider.
- Added a same-origin, no-store `GET /api/privacy/consent` status response that exposes only server-verified consent state to the static runtime.
- Added the static consent runtime: no Pixel/script/`fbq` use until verified Advertising consent, one consented PageView, server-envelope-only Lead tracking, deduplication, and no `_fbp`/`_fbc` access in browser code.
- Updated embedded static forms and the quote drawer to require the strict canonical `{accepted, estimateUrl, metaEvent}` response, emit the exact PIW-issued envelope before navigation, and remain nonblocking if browser tracking is absent or fails.
- Gated website proxy forwarding of `_fbp` and `_fbc` on verified Advertising consent.
- Polished React and static consent banner/dialog surfaces for fixed viewport placement, keyboard focus/escape behavior, accessible modal roles, mobile sizing, and equal action prominence.
- Expanded the public privacy policy with the Meta Pixel/CAPI events, hashed-contact and attribution boundary, exclusions, consent/revocation behavior, and support contact path.

## Regression coverage

- Static homepage/subpage runtime injection and proxy rewrite.
- Static form and quote-drawer event emission before the estimate transition, plus malformed envelope rejection.
- No static Meta activity with denied consent and residual Meta cookies; valid consented PageView and Lead deduplication.
- Consent modal roles, viewport CSS, Escape close, error recovery, and usable controls after saving.
- Proxy attribution withholding without verified Advertising consent and forwarding with it.
- Privacy policy disclosure coverage.

## Validation

- `npm test` in `apps/website`: 20 files, 147 tests passed.
- `npm run typecheck` in `apps/website`: passed.
- `npm run lint` in `apps/website`: passed.
- `npm run build` in `apps/website`: passed; confirms `/public-pages/[...path]` is a production route and Proxy is registered.

The JSDOM form tests log its normal unsupported cross-document-navigation notice after validating the pre-navigation browser event; this is not a product runtime failure.

## Integration note

The static status endpoint and proxy gate both use the existing signed-consent verifier. Any final current-consent/GPC hardening must apply the same rule to those two paths so the static and App Router runtimes remain aligned.

## Final-review round 1 corrections

- Static lead forms now await a bounded, consent-readiness-aware tracker before navigating. A current server-verified Advertising grant emits the exact PIW-issued `Lead` envelope; denied, failed, timed-out, disabled, and unavailable-tracker paths resolve without Meta and do not block the customer transition.
- Static dialog cancellation restores focus only to the still-connected trigger. A successful privacy save re-renders the consent surface first and then focuses its newly mounted `Privacy choices` control.
- The React consent provider applies the same focus rule: cancel restores a connected opener, while a first-time Customize → Save transition focuses the mounted Privacy choices control instead of the removed banner action.

### Round 1 regression coverage

- Pending verified-consent read with a valid server-issued Lead emits once after a granted result.
- Consent-read timeout and failure resolve the navigation-aware tracker with no Lead.
- Embedded form and quote drawer use the navigation-aware exact-envelope tracker.
- Static cancel/save focus and React first-time Customize → Save focus remain connected and deterministic.

### Round 1 validation

- `npm test` in `apps/website`: 20 files, 153 tests passed.
- `npm run typecheck` in `apps/website`: passed.
- `npm run lint` in `apps/website`: passed.
- `npm run build` in `apps/website`: passed.

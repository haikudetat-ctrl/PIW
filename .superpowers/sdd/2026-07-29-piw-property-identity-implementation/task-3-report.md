# Task 3 Report — Census Geocode Address-Validation Provider

## Status

Implemented the server-only Census one-line-address provider and its response
parser. Commit hash is recorded after the final verification and commit.

## Delivered

- `parseCensusGeocodeResponse(raw, submittedAddress)` validates untrusted
  Census JSON with Zod before using it, then returns the Task 1
  `AddressValidationResult` domain contract.
- Exactly one match produces canonical address, coordinates, municipality,
  ZIP, confidence `97`, and an NJ state code only for an explicit Census `NJ`
  result.
- Zero and multiple matches produce explicit `no_match` / `multiple_matches`
  outcomes at confidence `0` / `40`.
- `censusGeocodeAddressValidationProvider` calls the public Census
  one-line-address endpoint using `Public_AR_Current`, returns the provider
  contract, is server-only, free, and enabled at priority `10`.
- Network, non-OK HTTP, invalid JSON, and malformed response errors are clear
  and do not propagate underlying details.

## RED/GREEN Evidence

### Initial provider behavior

1. RED:

   ```bash
   npm run test:run -- src/modules/providers/adapters/census-geocode.test.ts
   ```

   Exit `1` as expected: Vitest could not resolve `./census-geocode` because
   the provider did not exist.

2. GREEN: the same command exited `0`, with 7 provider tests passing after
   adding the minimal parser and adapter.

### Safe request and JSON errors

1. RED: after adding the two error tests and temporarily removing their error
   translation, the focused command exited `1`. The failures showed the raw
   `network details` and `unexpected token` messages rather than the required
   safe Census errors.

2. GREEN: after restoring the minimal request and JSON error translation, the
   focused command exited `0`; 1 file / 9 tests passed.

## Live Verification

Ran the plan's prescribed Census curl command exactly once:

```bash
curl -s "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=1600%20Pennsylvania%20Ave%20NW%2C%20Washington%2C%20DC&benchmark=Public_AR_Current&format=json" | head -c 800
```

It returned live JSON containing one `addressMatches` entry for
`1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500`, with the fixture's
coordinates and `addressComponents` shape.

## Final Verification

```bash
npm run test:run -- src/modules/providers
npm run lint
npm run typecheck
git diff --check
```

Final results:

- Provider tests: exit `0`; 3 files / 18 tests passed.
- ESLint: exit `0`; no task-file warnings. Two pre-existing warnings remain in
  `src/modules/events/outbox-repository.ts` for unused parameters.
- TypeScript: exit `0`.
- Whitespace check: exit `0`.

## Files Changed

- `src/modules/providers/adapters/census-geocode.ts`
- `src/modules/providers/adapters/census-geocode.test.ts`
- `.superpowers/sdd/2026-07-29-piw-property-identity-implementation/task-3-report.md`

## Self-Review

- Confirmed the adapter imports `server-only` and remains isolated behind the
  `ProviderAdapter` contract.
- Confirmed upstream JSON remains `unknown` until the parser's Zod check.
- Confirmed the provider never claims non-NJ matches are NJ and leaves county
  null for the downstream NJGIN lookup.
- Confirmed fetch is mocked in automated tests and the live endpoint was used
  only for the single requested manual verification.
- Confirmed error messages omit input address, upstream body, and raw network
  error details.

## Concerns

- The public Census endpoint is an external dependency and has no configured
  retry policy; that remains appropriate for this provider adapter and can be
  handled at orchestration level if needed.

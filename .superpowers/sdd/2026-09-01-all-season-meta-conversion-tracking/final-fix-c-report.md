# Final Fix C report — database release boundaries

## Result

Implemented Final Fix C as one forward-only database correction:
`20260902005333_meta_tracking_release_boundaries.sql`.

No applied migration was edited. The change closes the remaining consent,
assessment-view, tracking-delivery, and optional-configuration release
boundaries while keeping lead intake, quote delivery, CRM, and Slack flows
available when nonessential tracking cannot run.

## Database authority boundaries

- `record_public_privacy_consent` is a service-role-only, security-definer
  atomic write. It rate-limits by opaque consent identity and trusted request
  IP under transaction-scoped locks, preserves append-only evidence, makes
  identical evidence idempotent, and resolves equal-time conflicts
  deny-wins. A single genuine current-grant-to-denial revocation remains
  available without creating an unlimited write path.
- `consume_roof_assessment_result_view_limit` applies a durable, atomic
  trusted-IP and token-scope rate limit before the public result route does
  expensive work. Its table stores only token hashes, IPs, and timestamps—no
  raw token, contact, property, or quote data.
- `acknowledge_roof_assessment_result_view` atomically records the first
  trusted view, captures eligible event-time consent evidence, and reserves
  `AssessmentCompleted` when appropriate. A reload returns the original
  envelope without creating a retroactive conversion after a denied or
  missing-consent first view.
- Meta list/claim current-consent semantics now retain original lead-scoped
  historical eligibility while evaluating a current unlinked preference by
  consent ID and policy version. A later unlinked revocation suppresses a
  pending delivery; a later grant cannot revive an event denied at event time;
  unrelated later linked evidence does not suppress the original lead.
- HTTP 408 is retryable. After the fifth claimed delivery attempt, a remaining
  transient failure is persisted as terminal `permanent_failed` with sanitized
  `retry_exhausted` diagnostics, so an unclaimable delivery is never left as
  misleadingly retryable.

## Application boundaries

- Public PIW and website consent endpoints call the atomic RPC rather than
  performing process-local count-then-insert logic. They use a production
  trusted-IP boundary and return a typed 429 when the durable limit is reached.
- Website-to-PIW canonical-consent synchronization carries only a validated
  server-derived request IP in its dedicated internal header; missing trusted
  IP is fail-closed for tracking.
- Result-view acknowledgement happens before best-effort Meta enqueueing.
  Tracking/configuration failures yield a no-tracking acknowledgement instead
  of breaking quote display.
- Meta and privacy configuration is optional at parsing time. Invalid,
  incomplete, or missing tracking configuration resolves to disabled, while
  core business configuration remains strict and canonical intake continues.

## Regression coverage

Added or strengthened coverage for:

- atomic public-consent idempotency, trusted-IP/consent quotas, equal-time
  deny-wins ordering, public-role privilege boundaries, and limited revocation;
- durable result-view limit behavior and its service-only interface;
- first-view acknowledgement, reload no-backfill behavior, and one-event
  result-view delivery semantics;
- current-consent evaluation across later unlinked revocation/later grant and
  an unrelated linked second lead;
- fifth-attempt terminal delivery state and HTTP 408 retryability;
- production trusted-IP parsing, canonical synchronization, and disabled
  tracking configuration without intake failures; and
- removal of only the three approved, unrelated scheduling documents while
  preserving the privacy-foundation plan.

## Verification

- `DOCKER_CONFIG=/tmp/task2-docker-config npx supabase db reset --local` — PASS
- `DOCKER_CONFIG=/tmp/task2-docker-config npx supabase migration list --local` — PASS; the new migration is present locally
- `DOCKER_CONFIG=/tmp/task2-docker-config npx supabase db diff --local` — PASS; no schema drift after reset
- `DOCKER_CONFIG=/tmp/task2-docker-config npx supabase gen types typescript --local` — PASS; regenerated `src/lib/database.types.ts`
- `DOCKER_CONFIG=/tmp/task2-docker-config npx supabase test db` — PASS: 25 files / 1,143 assertions
- focused privacy/Meta boundary pgTAP tests — PASS: 97 assertions
- `npm run test:integration` — PASS: 6 files / 7 tests
- `npm run test:run` — PASS: 135 files / 909 tests (6 files / 7 tests skipped)
- `npm --prefix apps/website test` — PASS: 23 files / 180 tests
- `npm run typecheck` and `npm --prefix apps/website run typecheck` — PASS
- `npm run lint` — PASS with 11 pre-existing unrelated warnings and no errors
- `npm --prefix apps/website run lint` — PASS with no warnings or errors
- `npm run build` and `npm --prefix apps/website run build` — PASS
- `git diff --check` — PASS

The Supabase advisor/linter show only existing unrelated `public.leads`
permissive-policy and unused-PL/pgSQL-variable warnings. No warning was added
by this migration. The initial sandboxed website build and integration test
were blocked by local host/telemetry filesystem restrictions; both completed
successfully in the approved local execution environment.

## Deliberate non-actions

- No remote database migration was applied.
- No deployment, push, Vercel, Supabase-hosted, Meta, Slack, or external
  service action was performed.
- No environment variables or secret values were changed, displayed, or
  reported.

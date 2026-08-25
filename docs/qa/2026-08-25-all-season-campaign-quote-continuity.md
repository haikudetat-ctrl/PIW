# All Season campaign quote continuity QA

Date: 2026-08-25
Status: **PASS — automated nuts-and-bolts scope only**

## Release decision

All eight required automated gates pass on current HEAD after reviewed fix `b83a2dd` isolated the nested website Vitest project from the root PIW suite. Focused campaign/result-state integrity tests also pass. Task 6 is accepted for the user-directed automated nuts-and-bolts scope.

Visual/browser QA was explicitly skipped by user direction. This document does not claim visual, responsive, or browser accessibility acceptance. No browser session was opened, no production form was submitted, and no production PIW record was created or mutated.

## Automated gate evidence

| Command | Exit | Evidence | Result |
| --- | ---: | --- | --- |
| `npm run lint` | 0 | ESLint completed with 0 errors and 3 existing unused-variable warnings. | PASS |
| `npm run typecheck` | 0 | `tsc --noEmit` completed. | PASS |
| `npm run test:run` | 0 | Current HEAD after `b83a2dd`: 80 files/334 tests passed; 5 files/6 tests skipped. | PASS |
| `npm run build` | 0 | Passed after loading the canonical `.env.development.local`; 18 routes generated. | PASS |
| `npm --prefix apps/website run lint` | 0 | ESLint completed with no findings. | PASS |
| `npm --prefix apps/website run typecheck` | 0 | `tsc --noEmit` completed. | PASS |
| `npm --prefix apps/website test` | 0 | 7 files, 41 tests passed. | PASS |
| `npm --prefix apps/website run build` | 0 | 11 pages generated; all four campaign routes emitted. | PASS |

Environment notes:

- This worktree does not contain a local env file. The first root build attempt failed while prerendering `/leads/new` because required public environment variables were absent. The final gate used the canonical validated development environment without copying or exposing secrets.
- The first website build attempt hit the managed sandbox's Turbopack worker-port restriction. The same command passed outside that sandbox restriction; this was not a source failure.
- Root lint warnings are in `leadconduit-shadow-receipt.test.ts` and `outbox-repository.ts`; there are no lint errors.

## Root test boundary resolution

Before reviewed fix `b83a2dd`, the root suite discovered `apps/website/app/route.test.ts`. Its handler reads `path.join(process.cwd(), "public", "index.html")`; under the root suite, it looked for a nonexistent repository-root `public/index.html` and failed with `ENOENT`.

Fix `b83a2dd` added `apps/website/**` to the root Vitest exclusions. The explicit website test gate continues to own those tests. Scoped review passed, and the exact root command was rerun on current HEAD with exit 0.

Diagnostic isolation:

| Command | Exit | Evidence |
| --- | ---: | --- |
| `npm run test:run -- --exclude 'apps/website/**'` | 0 | Pre-fix diagnostic: 80 files/334 tests passed; 5 files/6 tests skipped. The post-fix exact root gate now produces the same counts. |
| Focused estimate-state/API command covering six named files | 0 | 6 files/29 tests passed. |

The focused command covered:

- `estimate-result-model.test.ts`
- `estimate-wait-experience.test.tsx`
- `campaign-result-content.test.tsx`
- `not-found.test.tsx`
- All Season campaign-estimate integration route tests
- All Season campaign-estimate acceptance tests

This verifies processing, ready, manual-review, unavailable, invalid-link, campaign resolution, and provider-neutral homeowner copy at the component/function level.

## Route and function integrity

| Surface | Automated evidence | Result | Production URL |
| --- | --- | --- | --- |
| Homepage | Website route test passes in the website-owned suite. | PASS | |
| Four campaign pages | Website campaign tests pass; production build emits all four static campaign paths. | PASS | |
| Campaign estimate forwarding | Website and PIW route tests pass, including safe result URL construction and malformed/upstream failure handling. | PASS | |
| Ready estimate | Focused result model/content tests pass. | PASS | |
| Processing estimate | Focused wait experience/model tests pass; all three stages are asserted as homeowner text. | PASS | |
| Manual review | Focused model/content tests pass with reassuring, actionable, provider-neutral copy. | PASS | |
| Unavailable estimate | Focused model/content tests pass with actionable, provider-neutral copy. | PASS | |
| Invalid token | Focused not-found test passes with branded, helpful, implementation-neutral copy. | PASS | |

## Server cleanup and browser scope

- Port 3010 was free; PIW became ready on 3010 with no compile error.
- Port 3011 was already owned by PID 91746, a Next server whose cwd is the main workspace `apps/website`. It was identified and left untouched.
- The worktree website became ready on alternate free port 3012 with no compile error.
- Both Task 6 servers were stopped cleanly. Ports 3010 and 3012 are free.
- No `agent-browser` session was opened. There is nothing to close.

## Viewport/accessibility matrix

The visual scope was explicitly canceled for speed, so these checks are not claimed.

| Route/state | 390x844 | 1440x1000 | Theme/art | Satellite priority | CTA/clipping/overflow | Focus/overlay/console | Reduced motion | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | Not run | Not run | Not run | N/A | Not run | Not run | Not run | DEFERRED |
| `/campaigns/do-it-right-once` | Not run | Not run | Not run | N/A | Not run | Not run | Not run | DEFERRED |
| `/campaigns/weather-report` | Not run | Not run | Not run | N/A | Not run | Not run | Not run | DEFERRED |
| `/campaigns/seasonal-shield` | Not run | Not run | Not run | N/A | Not run | Not run | Not run | DEFERRED |
| `/campaigns/for-every-season` | Not run | Not run | Not run | N/A | Not run | Not run | Not run | DEFERRED |
| Ready token | Not run | Not run | Not run | Not run | Not run | Not run | Not run | DEFERRED |
| Neutral invalid UUID | Not run | Not run | N/A | N/A | Not run | Not run | Not run | DEFERRED |
| Processing/manual/unavailable | Component tests only | Component tests only | Not run | Not run | Not run | Automated terminology assertions only | Not run | PARTIAL |

Screenshot paths: none.

Console/framework-overlay evidence: not run.

Keyboard focus evidence: not run.

Horizontal-overflow evidence: not run.

Reduced-motion browser evidence: not run.

Rendered terminology search: not run; focused component tests cover provider-neutral homeowner status copy.

## Limitations and follow-up

- Visual, responsive, accessibility, console/overlay, focus, overflow, typography, satellite-priority, and reduced-motion claims remain unverified because the user explicitly skipped browser QA.
- Deterministic processing/manual-review browser tokens were unavailable without manufacturing production PIW records, which was prohibited. Task 7 is expected to capture real processing screens during controlled production submissions.
- The known ready token and neutral invalid UUID were not opened because all browser QA was canceled.
- Production URL cells remain blank for Task 7.

## Files and commit state

- Evidence: `docs/qa/2026-08-25-all-season-campaign-quote-continuity.md`
- Task report: `.superpowers/sdd/2026-08-25-all-season-campaign-quote-continuity/task-6-report.md`
- No production source/config file was changed.
- The QA evidence document is committed separately from the reviewed Vitest boundary fix.

## Self-review

- Did not manufacture or mutate PIW records.
- Did not submit forms or deploy.
- Did not kill the unrelated 3011 server.
- Waited for the reviewed ownership-boundary fix, then reran the exact required root gate successfully.
- Distinguished environment/sandbox setup failures from the reproducible cross-package test defect.
- Cleaned up all servers started by this task.

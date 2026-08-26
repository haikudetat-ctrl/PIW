# All Season campaign quote continuity QA

Date: 2026-08-26
Status: **PASS — production deployments and four controlled campaign journeys verified; visual QA waived**

## Release decision

All eight required automated gates pass on the release tree: PIW release commit `d53a528` and website release commit `d7f8dcc`. PIW production deployment `dpl_hdAtWjRrpc6Q1qHrjz5df13BqUgX` and website production deployment `dpl_SDmWNaoaq8KEzX4iY1bg19FLDTnx` are READY. The canonical aliases are `https://piw-sepia.vercel.app` for the backend/results application and `https://rake-website.vercel.app` for the public site and campaigns.

Production smoke checks pass: the previously verified PIW result route returns HTTP 200 with the campaign-themed result markers, while the public homepage, four campaign routes, policy pages, official Google Maps attribution asset, and live Google review feed return HTTP 200 from the current website deployment.

Visual/browser QA was explicitly waived by user direction. This document does not claim visual, responsive, or browser accessibility acceptance. All four controlled synthetic campaign submissions returned HTTP 202 and delivered terminal ready results with the expected stored-campaign theme, amount, and campaign-specific trust copy.

## Automated gate evidence

| Command | Exit | Evidence | Result |
| --- | ---: | --- | --- |
| `npm run lint` | 0 | ESLint completed with 0 errors and 3 existing unused-variable warnings. | PASS |
| `npm run typecheck` | 0 | `tsc --noEmit` completed. | PASS |
| `npm run test:run` | 0 | Current release tree (including fix `b83a2dd`): 80 files/334 tests passed; 5 files/6 tests skipped. | PASS |
| `npm run build` | 0 | Passed after loading the canonical `.env.development.local`; 18 routes generated. | PASS |
| `npm --prefix apps/website run lint` | 0 | ESLint completed with no findings. | PASS |
| `npm --prefix apps/website run typecheck` | 0 | `tsc --noEmit` completed. | PASS |
| `npm --prefix apps/website test` | 0 | 12 files, 60 tests passed. | PASS |
| `npm --prefix apps/website run build` | 0 | Production build passed; `/api/google-reviews` and all four campaign routes were emitted. | PASS |

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
| Focused estimate-state/API command shown below | 0 | 6 files/29 tests passed. |

Exact focused integrity command:

```bash
npm run test:run -- 'src/app/roof-estimate/[token]/estimate-result-model.test.ts' 'src/app/roof-estimate/[token]/estimate-wait-experience.test.tsx' 'src/app/roof-estimate/[token]/campaign-result-content.test.tsx' 'src/app/roof-estimate/[token]/not-found.test.tsx' 'src/app/api/integrations/all-season/campaign-estimate/route.test.ts' 'src/modules/leads/accept-all-season-campaign-estimate.test.ts'
```

The focused command covered:

- `estimate-result-model.test.ts`
- `estimate-wait-experience.test.tsx`
- `campaign-result-content.test.tsx`
- `not-found.test.tsx`
- All Season campaign-estimate integration route tests
- All Season campaign-estimate acceptance tests

This verifies processing, ready, manual-review, unavailable, invalid-link, campaign resolution, and homeowner-facing state copy at the component/function level.

## Production deployment evidence

| Application | Deployment ID | Release commit | State | Canonical production alias | Prior healthy rollback deployment |
| --- | --- | --- | --- | --- | --- |
| PIW backend/results | `dpl_hdAtWjRrpc6Q1qHrjz5df13BqUgX` | `d53a528` | READY | `https://piw-sepia.vercel.app` | `dpl_Crn9g3XHgvGUVkoyj793NcpHLpZr` (`https://piw-nborjek2n-chris-bolands-projects.vercel.app`) |
| All Season website/campaigns | `dpl_SDmWNaoaq8KEzX4iY1bg19FLDTnx` | `d7f8dcc` in `releaseCommit` metadata | READY | `https://rake-website.vercel.app` | `dpl_5JsuD8YZ9vuqQCC8Mexnd8scpBw7` (`https://rake-website-j4p0lw9tq-chris-bolands-projects.vercel.app`) |

The deploys reused the production environment already attached to each linked Vercel project. No Supabase project was created or relinked, and no secret value is recorded here.

## Route and function integrity

| Surface | Automated evidence | Result | Production URL |
| --- | --- | --- | --- |
| Homepage | Website route test passes; production route returns HTTP 200 with expected main-site copy. | PASS | `https://rake-website.vercel.app/` |
| Do It Right Once | Campaign tests pass; production route returns HTTP 200 with expected campaign copy. | PASS | `https://rake-website.vercel.app/campaigns/do-it-right-once` |
| Weather Report | Campaign tests pass; production route returns HTTP 200 with expected campaign copy. | PASS | `https://rake-website.vercel.app/campaigns/weather-report` |
| Seasonal Shield | Campaign tests pass; production route returns HTTP 200 with expected campaign copy. | PASS | `https://rake-website.vercel.app/campaigns/seasonal-shield` |
| For Every Season | Campaign tests pass; production route returns HTTP 200 with expected campaign copy. | PASS | `https://rake-website.vercel.app/campaigns/for-every-season` |
| Google review feed | Route and DOM tests cover no-store behavior, author/source links, Google Maps and provider attribution, filtering disclosure, reduced motion, and 429 handling. Production returned HTTP 200, `Cache-Control: no-store`, five reviews with complete author/source links, no credential-shaped fields, and the provider-supplied `attributions` array. | PASS | `https://rake-website.vercel.app/api/google-reviews` |
| Privacy and Terms | Static-page and campaign-footer tests pass. Both production pages returned HTTP 200 with Google Maps terms/privacy flow-down links. | PASS | `https://rake-website.vercel.app/privacy.html` and `https://rake-website.vercel.app/terms.html` |
| Address autocomplete | Controlled POST with public-landmark query `New Jersey State House` returned HTTP 200 with normalized `{placeId,address}` suggestions; no private address was used. | PASS | `https://rake-website.vercel.app/api/address-autocomplete` |
| Homepage intake bridge | Controlled synthetic POST returned HTTP 202 with `{accepted:true}` and submission `c36d3a16-67be-4c89-8ea6-cd46a913b15d`; no contact or address details are recorded. | PASS | `https://rake-website.vercel.app/api/intake` |
| Campaign estimate forwarding | Website and PIW route tests pass, including safe result URL construction and malformed/upstream failure handling. | PASS | |
| Existing ready estimate | Focused result model/content tests pass; production route returns HTTP 200 with campaign-themed result markers and the scheduling CTA. | PASS | `https://piw-sepia.vercel.app/roof-estimate/cc003894-076b-4bdd-a83c-e9073fb9bdfd` |
| Processing estimate | Focused wait experience/model tests pass; all three stages are asserted as homeowner text. | PASS | |
| Manual review | Focused model/content tests pass with reassuring, actionable status copy. | PASS | |
| Unavailable estimate | Focused model/content tests pass with actionable status copy. | PASS | |
| Invalid token | Focused not-found test passes with branded, helpful, implementation-neutral copy. | PASS | |

## Controlled production campaign journeys

Each journey used an `example.com` contact, a reserved 555 phone number, and a public New Jersey civic address. No homeowner data was used. The result theme is resolved server-side from the persisted `leads.campaign` value; the matching result theme therefore verifies stored campaign continuity without exposing lead details.

| Campaign | Landing page | API acceptance | Stored campaign continuity | Enrichment terminal state | Result delivery | Secure result link |
| --- | --- | --- | --- | --- | --- | --- |
| `do-it-right-once` | `https://rake-website.vercel.app/campaigns/do-it-right-once` | PASS — 202; submission `9a387262-9cb1-4d2b-863c-9c1ebcddab27` | PASS — `heritage` theme; “Accountability should outlast installation” | PASS — immediately `ready` | PASS — result 200, house image 200 JPEG, amount and matching trust copy | `https://piw-sepia.vercel.app/roof-estimate/01d29cf9-496a-4652-ae1f-8f1cf900d012` |
| `weather-report` | `https://rake-website.vercel.app/campaigns/weather-report` | PASS — 202; submission `a87531ee-8c45-4c73-9697-44a6f51723d8` | PASS — `forecast` theme; “Prepare before the next storm makes the decision” | PASS — immediately `ready` | PASS — result 200, house image 200 JPEG, amount and matching trust copy | `https://piw-sepia.vercel.app/roof-estimate/c8b49be9-8d63-4652-a7c5-35443866ed33` |
| `seasonal-shield` | `https://rake-website.vercel.app/campaigns/seasonal-shield` | PASS — 202; submission `e7e4be3a-851f-494e-807b-09124ea63947` | PASS — `shield` theme; “One roof. One team accountable for the outcome” | PASS — immediately `ready` | PASS — result 200, house image 200 JPEG, amount and matching trust copy | `https://piw-sepia.vercel.app/roof-estimate/c91323ae-f367-4521-a322-38a14e1b3b6d` |
| `for-every-season` | `https://rake-website.vercel.app/campaigns/for-every-season` | PASS — 202; submission `f4051d0d-96a3-402c-9831-1b2df962afe8` | PASS — `seasons` theme; “Choose the local team built for lasting trust” | PASS — immediately `ready` | PASS — result 200, house image 200 JPEG, amount and matching trust copy | `https://piw-sepia.vercel.app/roof-estimate/c78e9fb2-d6f9-4ff8-94fe-d923bb58f713` |

## Production runtime observation

- Independent Vercel inventory showed both latest deployments READY, their production aliases assigned, and `aliasError=null`.
- The promoted website deployment `dpl_SDmWNaoaq8KEzX4iY1bg19FLDTnx` served the homepage, all four campaign routes, policy pages, and official Google Maps SVG with HTTP 200. The deployed SVG checksum matched the reviewed source asset.
- The live Google review feed returned HTTP 200 with `Cache-Control: no-store`, five fully attributed reviews, zero additional provider attributions in this response, and no credential-shaped response keys.
- Vercel Firewall is enabled with three active per-IP deny rules and no pending draft: autocomplete POST 60/60s, campaign-estimate POST 10/3600s, and Google-reviews GET 10/60s.
- Website `/api/campaign-estimate` returned 202 four times, and merged homepage `/api/intake` returned 202 once. PIW campaign intake returned 202 four times with immediate event publication, and all four result routes returned 200.
- All four house-image endpoints returned HTTP 200 with `image/jpeg`.
- Inngest recorded 37 HTTP 206 responses and 3 HTTP 200 responses with no warning/error logs during the observation window.
- The final website deployment reported no runtime error cluster during the post-promotion observation window; its recorded homepage, campaign, policy, asset, and reviews requests were HTTP 200.

## Server cleanup and browser scope

- Port 3010 was free; PIW became ready on 3010 with no compile error.
- Port 3011 was already owned by PID 91746, a Next server whose cwd is the main workspace `apps/website`. It was identified and left untouched.
- The worktree website became ready on alternate free port 3012 with no compile error.
- Both Task 6 servers were stopped cleanly at the end of that gate. The release-worktree website was later restarted on port 3012 for the user's separate local review session; that session is outside this production QA record.
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

Rendered terminology search: not run; focused component tests cover homeowner-facing status copy.

## Limitations and follow-up

- Visual, responsive, accessibility, console/overlay, focus, overflow, typography, satellite-priority, and reduced-motion claims remain unverified because the user explicitly skipped browser QA.
- Direct production-database inspection was unavailable to the authenticated connector. Stored campaign continuity is verified by the result renderer's server-side campaign resolution; this does not claim a separate database-console inspection of every attribution field.
- Processing/manual-review browser states were not visually inspected. The user explicitly waived visual QA, including the planned mobile check.
- The existing ready result and five public routes have automated HTTP/content smoke evidence only; this is not a visual acceptance claim.
- Runtime/log and Inngest observations cover only the short post-deploy QA window; they are not evidence of long-duration production monitoring.

## Files and commit state

- Evidence: `docs/qa/2026-08-25-all-season-campaign-quote-continuity.md`
- Task 6 report: `.superpowers/sdd/2026-08-25-all-season-campaign-quote-continuity/task-6-report.md`
- Task 7 report: `.superpowers/sdd/2026-08-25-all-season-campaign-quote-continuity/task-7-report.md`
- PIW release source commit: `d53a528`
- Website release source commit: `d7f8dcc`
- No production source or environment configuration was changed by this evidence update.
- The controlled campaign results are recorded above; the release controller owns the final evidence commit and Slack handoff.

## Self-review

- Recorded only deployment IDs, public aliases, and public result/landing links; no secret value is present.
- Recorded the four synthetic submissions without including contact or address data.
- Distinguished the user's visual-QA waiver from the automated HTTP/content smoke evidence.
- Did not kill the unrelated 3011 server.
- Retained the exact automated gate evidence from the reviewed release commit.
- Distinguished environment/sandbox setup failures from the reproducible cross-package test defect.

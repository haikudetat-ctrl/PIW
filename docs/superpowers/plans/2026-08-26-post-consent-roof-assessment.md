# Post-consent Roof Assessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted, campaign-aware roof assessment between consented lead submission and the existing public estimate result.

**Architecture:** The existing `/roof-estimate/[token]` route resolves the estimate, lead, property, campaign, and assessment state server-side. A public token-scoped API saves validated partial answers and completes a deterministic recommendation; a client experience handles the five-second/image-ready property analysis, resumable questionnaire, and handoff to the existing estimate panel.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod 4, Supabase/Postgres, Vitest, Testing Library

**Spec:** `docs/superpowers/specs/2026-08-26-post-consent-roof-assessment-design.md`

## Global Constraints

- Preserve the current consent-first lead submission and enrichment kickoff.
- The loading buffer lasts at least five seconds and waits for aerial imagery, with a twelve-second ceiling.
- The Sims reference applies only to vertically transitioning loading stages; visuals remain restrained and premium.
- Campaign context changes presentation only, never question meaning, scoring, consent, or storage.
- Scores and recommendations are derived on the server and never accepted from the browser.
- Photo upload is outside this foundation.
- Anonymous clients receive no direct table access.
- The experience is feature-flagged and defaults off outside local development until preview validation.

---

### Task 1: Assessment contracts and deterministic recommendation

**Files:**
- Create: `src/domain/roof-assessment.ts`
- Create: `src/domain/roof-assessment.test.ts`

**Interfaces:**
- Produces: `roofAssessmentResponsesSchema`, `RoofAssessmentResponses`, `calculateRoofAssessment(responses)`, and `ROOF_ASSESSMENT_VERSION`.
- Recommendation values: `monitor_or_repair | professional_inspection | replacement_may_make_sense`.

- [ ] **Step 1: Write failing schema and scoring tests**

```ts
test("classifies low-signal planning answers as monitor or repair", () => {
  expect(calculateRoofAssessment(lowSignalResponses)).toMatchObject({
    recommendation: "monitor_or_repair",
    scores: { urgency: 0 },
  });
});

test("classifies an old actively leaking roof as replacement may make sense", () => {
  expect(calculateRoofAssessment({
    ...lowSignalResponses,
    reason: "active_leak",
    roofAge: "20_plus",
    conditionSignals: ["active_leak", "curling_or_cracking"],
    timeline: "asap",
  }).recommendation).toBe("replacement_may_make_sense");
});

test("rejects contradictory nothing-obvious condition selections", () => {
  expect(roofAssessmentResponsesSchema.safeParse({
    ...lowSignalResponses,
    conditionSignals: ["nothing_obvious", "active_leak"],
  }).success).toBe(false);
});
```

- [ ] **Step 2: Run the domain test and verify RED**

Run: `npm run test:run -- src/domain/roof-assessment.test.ts`

Expected: FAIL because `roof-assessment.ts` does not exist.

- [ ] **Step 3: Implement exact vocabularies and versioned scoring**

```ts
export const ROOF_ASSESSMENT_VERSION = "roof-check-v1" as const;

export const roofAssessmentResponsesSchema = z.object({
  reason: z.enum(["roof_age", "active_leak", "damaged_shingles", "storm_damage", "transaction", "planning", "known_replacement"]),
  roofAge: z.enum(["under_5", "5_10", "10_15", "15_20", "20_plus", "unknown"]),
  conditionSignals: z.array(z.enum(["missing_shingles", "curling_or_cracking", "granules", "water_stains", "active_leak", "sagging", "moss_or_algae", "nothing_obvious", "unsure"])).min(1),
  roofVisible: z.enum(["yes", "no"]),
  visibleCondition: z.enum(["healthy", "moderate_wear", "heavy_wear", "not_answered"]),
  stories: z.enum(["one", "two", "three_plus", "unknown"]),
  complexityFeatures: z.array(z.enum(["garage", "porch", "addition", "flat_section", "multiple_levels", "none_or_unsure"])).min(1),
  priority: z.enum(["reasonable_cost", "long_warranty", "appearance", "speed", "financing", "understand_options"]),
  timeline: z.enum(["asap", "within_month", "this_season", "this_year", "researching"]),
  ownership: z.enum(["owner", "buying", "manager", "not_owner"]),
}).superRefine(rejectContradictoryExclusiveAnswers);
```

Return separate integer scores for `need`, `intent`, `urgency`, `propertyFit`, and `engagement`, plus the recommendation. Keep thresholds and weights in named `roof-check-v1` constants.

- [ ] **Step 4: Run the domain tests and verify GREEN**

Run: `npm run test:run -- src/domain/roof-assessment.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the domain contract**

```bash
git add src/domain/roof-assessment.ts src/domain/roof-assessment.test.ts
git commit -m "feat: add roof assessment scoring contract"
```

### Task 2: Persist assessment progress with tenant isolation

**Files:**
- Create: `supabase/migrations/20260826150000_roof_assessments.sql`
- Create: `supabase/tests/roof-assessments.test.sql`
- Modify: `src/lib/database.types.ts`

**Interfaces:**
- Consumes: `roof-check-v1` response and score JSON shapes from Task 1.
- Produces: `public.roof_assessments` with a unique `estimate_id` and service-role-only writes.

- [ ] **Step 1: Write failing database assertions**

```sql
select has_table('public', 'roof_assessments', 'roof assessments table exists');
select col_is_unique('public', 'roof_assessments', 'estimate_id', 'one assessment per estimate');
select policies_are('public', 'roof_assessments', array['company admins read roof assessments']);
select throws_ok(
  $$ insert into public.roof_assessments (company_id, estimate_id, lead_id) values (...); $$,
  '42501', null, 'anonymous clients cannot insert assessments'
);
```

- [ ] **Step 2: Run the focused database test and verify RED**

Run: `DOCKER_CONFIG=/tmp/task2-docker-config npx supabase test db supabase/tests/roof-assessments.test.sql`

Expected: FAIL because the table does not exist.

- [ ] **Step 3: Add the migration**

Create the columns defined in the spec, foreign keys to `companies`, `roof_estimates`, and `leads`, JSON-object checks for `responses` and `scores`, status/recommendation checks, a unique estimate index, RLS, admin read policy, service-role grants, and revocations from `anon` and `authenticated` for mutations.

```sql
create table public.roof_assessments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  estimate_id uuid not null unique references public.roof_estimates(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  current_step integer not null default 0 check (current_step between 0 and 9),
  property_revealed_at timestamptz,
  responses jsonb not null default '{}'::jsonb check (jsonb_typeof(responses) = 'object'),
  scores jsonb not null default '{}'::jsonb check (jsonb_typeof(scores) = 'object'),
  recommendation text check (recommendation in ('monitor_or_repair', 'professional_inspection', 'replacement_may_make_sense')),
  assessment_version text not null default 'roof-check-v1',
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
```

- [ ] **Step 4: Regenerate database types and run database tests**

Run: `DOCKER_CONFIG=/tmp/task2-docker-config npx supabase db reset --local`

Run: `DOCKER_CONFIG=/tmp/task2-docker-config npx supabase test db supabase/tests/roof-assessments.test.sql`

Run: `DOCKER_CONFIG=/tmp/task2-docker-config npx supabase gen types typescript --local > /tmp/roof-assessment-database.types.ts`

Copy the generated `roof_assessments` block into `src/lib/database.types.ts` without replacing unrelated user changes.

- [ ] **Step 5: Commit persistence**

```bash
git add supabase/migrations/20260826150000_roof_assessments.sql supabase/tests/roof-assessments.test.sql src/lib/database.types.ts
git commit -m "feat: persist public roof assessments"
```

### Task 3: Token-scoped assessment service and API

**Files:**
- Create: `src/modules/roof-assessment/public-assessment.ts`
- Create: `src/modules/roof-assessment/public-assessment.test.ts`
- Create: `src/app/api/roof-estimate/[token]/assessment/route.ts`
- Create: `src/app/api/roof-estimate/[token]/assessment/route.test.ts`

**Interfaces:**
- Produces: `getPublicAssessment(token)`, `savePublicAssessmentProgress(token, input)`, `completePublicAssessment(token, responses)`.
- API responses never include internal scores.

- [ ] **Step 1: Write failing service tests**

Cover invalid/unknown tokens, first GET creating an in-progress assessment, idempotent PATCH merge, bounded `currentStep`, completion using server-derived scores, and completed assessment immutability.

```ts
test("completion ignores browser score fields and derives the recommendation", async () => {
  const result = await completePublicAssessment(token, highNeedResponses, repository);
  expect(result).toEqual({status: "completed", recommendation: "replacement_may_make_sense"});
  expect(repository.complete).toHaveBeenCalledWith(expect.objectContaining({
    scores: expect.objectContaining({need: expect.any(Number)}),
  }));
});
```

- [ ] **Step 2: Run focused service tests and verify RED**

Run: `npm run test:run -- src/modules/roof-assessment/public-assessment.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the service around a narrow repository interface**

```ts
export type PublicAssessmentRepository = {
  findEstimateByToken(token: string): Promise<PublicEstimateContext | null>;
  findOrCreateAssessment(context: PublicEstimateContext): Promise<PersistedAssessment>;
  saveProgress(assessmentId: string, patch: AssessmentProgressPatch): Promise<PersistedAssessment>;
  complete(assessmentId: string, completion: AssessmentCompletion): Promise<PersistedAssessment>;
};
```

Return campaign, address, `/api/roof-estimate/${token}/house-image`, status, current step, responses, recommendation, and `propertyRevealed`—not scores.

- [ ] **Step 4: Write failing route tests**

Test GET/PATCH/POST success, UUID validation, malformed JSON, invalid partial keys, unknown token 404, and service failure 503 using dependency-injected handlers.

- [ ] **Step 5: Implement route handlers and run all focused tests**

Run: `npm run test:run -- src/modules/roof-assessment/public-assessment.test.ts src/app/api/roof-estimate/'[token]'/assessment/route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the public assessment API**

```bash
git add src/modules/roof-assessment src/app/api/roof-estimate/'[token]'/assessment
git commit -m "feat: add public roof assessment API"
```

### Task 4: Campaign-aware assessment configuration

**Files:**
- Create: `src/config/roof-assessment.ts`
- Create: `src/config/roof-assessment.test.ts`
- Modify: `src/config/campaigns.ts`

**Interfaces:**
- Produces: `getRoofAssessmentContext(campaign: string | null): RoofAssessmentContext`.

- [ ] **Step 1: Write failing campaign mapping tests**

```ts
test.each([
  ["weather-report", "Reviewing weather exposure"],
  ["seasonal-shield", "Reviewing roof protection"],
  ["for-every-season", "Reviewing aerial imagery"],
  ["unknown", "Reviewing aerial imagery"],
])("maps %s without changing the assessment contract", (campaign, expectedStage) => {
  expect(getRoofAssessmentContext(campaign).loadingStages).toContain(expectedStage);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:run -- src/config/roof-assessment.test.ts`

- [ ] **Step 3: Implement presentation-only context**

Include `slug`, `kicker`, `headline`, `intro`, `accentClass`, `fallbackImage`, and exactly four loading stages. Keep question definitions in a single shared array independent of campaign.

- [ ] **Step 4: Run tests and commit**

Run: `npm run test:run -- src/config/roof-assessment.test.ts`

```bash
git add src/config/roof-assessment.ts src/config/roof-assessment.test.ts src/config/campaigns.ts
git commit -m "feat: add campaign-aware assessment presentation"
```

### Task 5: Five-second analysis buffer and property reveal

**Files:**
- Create: `src/app/roof-estimate/[token]/assessment-loading.tsx`
- Create: `src/app/roof-estimate/[token]/assessment-loading.test.tsx`
- Create: `src/app/roof-estimate/[token]/assessment-experience.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- `AssessmentLoading` accepts `stages`, `imageSrc`, `address`, `minimumDurationMs=5000`, `imageTimeoutMs=12000`, and `onReady({imageAvailable})`.

- [ ] **Step 1: Write failing fake-timer tests**

```tsx
test("waits for both five seconds and image readiness", async () => {
  const onReady = vi.fn();
  render(<AssessmentLoading {...props} onReady={onReady} />);
  vi.advanceTimersByTime(5000);
  expect(onReady).not.toHaveBeenCalled();
  fireEvent.load(screen.getByRole("img", {name: /aerial view/i}));
  expect(onReady).toHaveBeenCalledWith({imageAvailable: true});
});

test("advances with accurate fallback copy after twelve seconds", () => {
  render(<AssessmentLoading {...props} onReady={onReady} />);
  vi.advanceTimersByTime(12000);
  expect(onReady).toHaveBeenCalledWith({imageAvailable: false});
  expect(screen.queryByText("Reviewing aerial imagery")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:run -- src/app/roof-estimate/'[token]'/assessment-loading.test.tsx`

- [ ] **Step 3: Implement restrained stage scrolling**

Use one live region, a clipped vertical stage rail, opacity/translate transitions, and `prefers-reduced-motion` crossfades. Do not add illustrations, game motifs, or playful icons. Preload the actual image with a visually hidden `<img>` and reuse the URL for the reveal.

- [ ] **Step 4: Add the address-and-image reveal**

After readiness, show the address, aerial image or restrained placeholder, “Property confirmed,” and a single “Start my assessment” action. Persist `propertyRevealed` through PATCH before entering question one.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:run -- src/app/roof-estimate/'[token]'/assessment-loading.test.tsx`

```bash
git add src/app/roof-estimate/'[token]'/assessment-loading.tsx src/app/roof-estimate/'[token]'/assessment-loading.test.tsx src/app/roof-estimate/'[token]'/assessment-experience.tsx src/app/globals.css
git commit -m "feat: add premium property analysis reveal"
```

### Task 6: Resumable diagnostic questionnaire

**Files:**
- Create: `src/app/roof-estimate/[token]/assessment-questions.ts`
- Create: `src/app/roof-estimate/[token]/assessment-questionnaire.tsx`
- Create: `src/app/roof-estimate/[token]/assessment-questionnaire.test.tsx`
- Modify: `src/app/roof-estimate/[token]/assessment-experience.tsx`

**Interfaces:**
- Produces a nine-step questionnaire using Task 1 response keys and `onComplete(recommendation)`.

- [ ] **Step 1: Write failing interaction tests**

Test single- and multi-select answers, exclusive options, dynamic educational responses, conditional visual-condition step, back navigation, debounced partial save, failed-save retry without answer loss, resume at saved step, and final POST.

```tsx
test("treats no idea as a valid roof-age answer", async () => {
  render(<AssessmentQuestionnaire {...props} />);
  await user.click(screen.getByRole("button", {name: "No idea"}));
  expect(screen.getByText(/Most homeowners don't know/)).toBeVisible();
  expect(screen.getByRole("button", {name: /continue/i})).toBeEnabled();
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:run -- src/app/roof-estimate/'[token]'/assessment-questionnaire.test.tsx`

- [ ] **Step 3: Implement question definitions and accessible controls**

Use semantic fieldsets, real buttons/checkboxes, visible focus, a text progress label, and no auto-advance for multi-select questions. Provide the approved educational microcopy without remote diagnosis.

- [ ] **Step 4: Implement save/resume/completion**

PATCH after each Continue action; store local state until the server confirms; POST the full validated response object after ownership; call `router.refresh()` after completion.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:run -- src/app/roof-estimate/'[token]'/assessment-questionnaire.test.tsx`

```bash
git add src/app/roof-estimate/'[token]'/assessment-questions.ts src/app/roof-estimate/'[token]'/assessment-questionnaire.tsx src/app/roof-estimate/'[token]'/assessment-questionnaire.test.tsx src/app/roof-estimate/'[token]'/assessment-experience.tsx
git commit -m "feat: add resumable roof assessment questions"
```

### Task 7: Gate and enrich the existing estimate result

**Files:**
- Modify: `src/app/roof-estimate/[token]/page.tsx`
- Create: `src/app/roof-estimate/[token]/page.test.tsx`
- Create: `src/app/roof-estimate/[token]/assessment-result-copy.ts`
- Create: `src/app/roof-estimate/[token]/assessment-result-copy.test.ts`
- Modify: `src/lib/env/server.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `getAssessmentResultCopy(recommendation)` returning `headline`, `body`, and `ctaLabel`.
- Feature flag: `ROOF_ASSESSMENT_ENABLED` parsed through the existing `booleanString` schema.

- [ ] **Step 1: Write failing copy and route-selection tests**

```ts
test.each([
  ["monitor_or_repair", "Have us take a look before you spend money"],
  ["professional_inspection", "Get a professional roof assessment"],
  ["replacement_may_make_sense", "Turn this range into an exact quote"],
])("uses the recommendation-specific CTA", (recommendation, ctaLabel) => {
  expect(getAssessmentResultCopy(recommendation).ctaLabel).toBe(ctaLabel);
});
```

Page tests cover flag off → existing result, flag on plus incomplete → assessment, completed plus estimate pending → recommendation with progress, and completed plus ready → recommendation plus range.

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:run -- src/app/roof-estimate/'[token]'/assessment-result-copy.test.ts src/app/roof-estimate/'[token]'/page.test.tsx`

- [ ] **Step 3: Implement flag and server-side route selection**

Query `leads.campaign` and the unique assessment row alongside existing estimate context. When enabled and incomplete, render `AssessmentExperience`. When completed, prepend recommendation copy to the existing manual-review/ready/unavailable branches without changing pricing calculations.

- [ ] **Step 4: Run focused and full app tests**

Run: `npm run test:run -- src/app/roof-estimate/'[token]'/assessment-result-copy.test.ts src/app/roof-estimate/'[token]'/page.test.tsx`

Run: `npm run test:run`

- [ ] **Step 5: Commit result integration**

```bash
git add src/app/roof-estimate/'[token]'/page.tsx src/app/roof-estimate/'[token]'/page.test.tsx src/app/roof-estimate/'[token]'/assessment-result-copy.ts src/app/roof-estimate/'[token]'/assessment-result-copy.test.ts src/lib/env/server.ts .env.example
git commit -m "feat: gate roof estimate behind assessment"
```

### Task 8: End-to-end verification and live dev handoff

**Files:**
- Modify: `docs/runbooks/local-development.md`

**Interfaces:**
- Consumes the complete consent → assessment → result path.

- [ ] **Step 1: Reset and verify the local database**

Run: `DOCKER_CONFIG=/tmp/task2-docker-config npx supabase db reset --local`

Run: `DOCKER_CONFIG=/tmp/task2-docker-config npx supabase test db`

- [ ] **Step 2: Run static verification**

Run: `npm run lint`

Run: `npm run typecheck`

Run: `npm run test:run`

Run: `npm run build`

Expected: every command exits zero.

- [ ] **Step 3: Start the feature-enabled dev server**

Run: `ROOF_ASSESSMENT_ENABLED=true npm run dev`

Report the actual bound local URL to the user; do not assume port 3000.

- [ ] **Step 4: Verify in a real browser**

Create a local consented campaign estimate and verify:

- the four loading stages scroll vertically over at least five seconds;
- the property reveal uses the confirmed address and aerial endpoint;
- refresh resumes without replaying the buffer after reveal;
- every question is keyboard usable;
- campaign styling follows the persisted campaign;
- completion reveals the correct recommendation and existing estimate state;
- no console error or Next.js error overlay appears.

- [ ] **Step 5: Document the feature flag and commit**

```bash
git add docs/runbooks/local-development.md
git commit -m "docs: add roof assessment local workflow"
```

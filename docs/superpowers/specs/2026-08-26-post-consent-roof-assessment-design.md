# Post-consent roof assessment design

## Objective

Turn the existing consented lead submission into the beginning of a personalized roof assessment. The homeowner should see credible work happening immediately, confirm that the correct property was found, answer a concise diagnostic sequence, and then receive the existing preliminary estimate with a more trustworthy recommendation.

This flow begins after the current address, contact, and consent form succeeds. It does not move or weaken the existing consent gate.

## Experience sequence

1. The existing website or campaign form submits through `/api/campaign-estimate`.
2. PIW creates the lead, property, pipeline run, and roof estimate, then returns the existing public estimate URL.
3. The public estimate route opens a post-consent assessment experience when that estimate has no completed assessment.
4. A premium analysis buffer runs for at least five seconds while the property image loads.
5. The loading stages transition vertically in a restrained scrolling pattern:
   - Confirming the address
   - Locating the roof
   - Reviewing aerial imagery
   - Preparing the assessment
6. The property reveal shows the confirmed address and aerial image.
7. The homeowner completes the diagnostic questions.
8. Responses and derived scores are saved against the estimate.
9. The existing estimate result is revealed with a condition recommendation and context-aware CTA.

The visual treatment remains editorial and premium. The Sims reference applies only to sequential scrolling status messages. There are no cartoon elements, game visuals, playful icons, or exaggerated motion.

## Loading and property reveal

The analysis buffer advances only when both conditions are true:

- five seconds have elapsed; and
- the aerial image has loaded successfully.

To prevent an indefinite wait, image loading receives a twelve-second ceiling. If imagery cannot load by then, the flow advances with the confirmed address and a restrained property-image placeholder. The copy must not imply that imagery was reviewed when it was unavailable.

The loading screen uses the same property-image endpoint as the estimate result. It preloads the image rather than fetching a second asset. Reduced-motion users see the same stages with crossfades instead of vertical movement.

## Assessment questions

The first implementation includes the high-value structured questions from the proposed flow:

1. Reason for checking the roof
2. Estimated roof age, including a positive “No idea” choice
3. Observed condition signals as a multi-select
4. Roof visibility from the ground and optional visual-condition choice
5. Home story count
6. Roof complexity features such as garage, porch, addition, flat section, or multiple levels
7. Homeowner priority
8. Desired timeline
9. Ownership relationship

Each step provides a short educational response where it improves trust, without diagnosing damage or claiming that replacement is required.

Photo upload is excluded from this foundation slice. It requires a separate storage, retention, moderation, and access-control design. The assessment structure will allow that step to be added later without changing existing response keys.

## Campaign and form context

The assessment reads the campaign already persisted on the lead:

- Campaign landing pages retain their individual campaign slug.
- Homepage, contact page, and quote drawer submissions use `for-every-season`.

Campaign context may change the supporting image, accent treatment, and short introductory copy. It does not change question meaning, scoring rules, consent, or data storage.

## Persistence model

Add a tenant-scoped `roof_assessments` table with one record per roof estimate:

- `id`
- `company_id`
- `estimate_id`
- `lead_id`
- `status`: `in_progress` or `completed`
- `current_step`
- `responses` JSON object with validated, versioned keys
- `scores` JSON object containing internal need, intent, urgency, property-fit, and engagement scores
- `recommendation`: `monitor_or_repair`, `professional_inspection`, or `replacement_may_make_sense`
- `assessment_version`
- `started_at`, `updated_at`, and `completed_at`

The estimate ID is unique. The public token remains on `roof_estimates`; it is not copied into the assessment table.

Public reads and writes pass through server routes that resolve the estimate token using the service client. Anonymous clients receive no direct table access. Every payload is validated, bounded, and restricted to the approved answer vocabulary.

## Public API

Add `/api/roof-estimate/[token]/assessment`:

- `GET` returns the public assessment state, campaign context, confirmed address, image URL, and whether the estimate result is ready.
- `PATCH` saves a validated partial response and current step. It is idempotent.
- `POST` validates all required answers, calculates internal scores and the homeowner-facing recommendation, and marks the assessment complete.

The server derives all scores and recommendations. The browser never submits or controls score values.

## Scoring and recommendation

The foundation uses deterministic, versioned scoring rather than an opaque model. Roof age, active leaks, severe condition signals, timeline, ownership, and property fit contribute to separate internal scores.

The homeowner sees only one recommendation:

- `monitor_or_repair`: replacement probably is not the first move;
- `professional_inspection`: the reported signals justify a professional assessment; or
- `replacement_may_make_sense`: age and condition suggest that major repair spending may not be economical.

The recommendation is explicitly preliminary and cannot claim a verified roof condition. A severe signal such as sagging or an active leak adds safety-oriented inspection copy but does not create a remote diagnosis.

## Result integration

Incomplete assessments render the assessment experience instead of the current estimate panel. Completed assessments render the existing result with:

- the recommendation headline and explanation;
- the preliminary price range when enrichment produced one;
- the existing range caveats;
- a recommendation-specific CTA;
- the same manual-review and unavailable-estimate fallbacks already supported.

The enrichment pipeline continues while the homeowner answers questions. Assessment completion never blocks backend enrichment. If the range is still pending after the questions, the completed recommendation is shown with the existing progress experience until pricing is ready.

## Recovery and accessibility

- Refreshing resumes at the last saved step and never repeats the five-second buffer after the property reveal has been completed.
- Failed partial saves display a retryable inline error and retain the current browser state.
- The questionnaire supports keyboard navigation, visible focus, semantic fieldsets, screen-reader status announcements, and reduced motion.
- Back navigation preserves prior answers.
- A homeowner can leave and return using the same public estimate URL.

## Testing

Implementation follows test-driven development and covers:

- five-second minimum plus image-ready loading gate;
- image timeout fallback and accurate status copy;
- campaign-context selection for every form source;
- partial-save validation and resume behavior;
- deterministic scoring boundaries;
- assessment completion gating the result;
- recommendation-specific result copy and CTAs;
- tenant isolation and absence of anonymous table access;
- reduced-motion behavior;
- browser verification of submit → analysis → property reveal → assessment → result.

## Rollout

The assessment is protected by a server-side feature flag. When disabled, the public token continues directly to the existing estimate experience. This allows preview validation and immediate rollback without changing form submissions or losing leads.

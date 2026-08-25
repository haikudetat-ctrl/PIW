# All Season Campaign-to-Quote Continuity Design

**Date:** 2026-08-25  
**Status:** Approved for implementation planning

## Objective

Create a visually continuous homeowner journey from each All Season campaign landing page through estimate processing and quote delivery, while merging the already-approved main All Season website content into the canonical public website deployment.

The experience must feel appropriate for a large roofing purchase: trustworthy, specific to the homeowner's property, easy to understand, and visually connected to the ad that brought the homeowner into the funnel.

## Approved Architecture

Use a seamless two-deployment architecture:

- `rake-website.vercel.app` remains the canonical public All Season website and hosts the main site plus all campaign landing pages.
- PIW remains the secure backend, enrichment system, and estimate-result renderer.
- Existing secure `/roof-estimate/[token]` result URLs remain valid.
- PIW determines the result theme from the campaign stored on the lead. It does not trust a campaign name supplied in a result URL or browser query parameter.
- A neutral All Season fallback theme supports non-campaign leads and unknown campaign values.

This preserves marketing-site SEO and deployment independence while keeping operational software and privileged PIW surfaces isolated.

## Public Website Scope

The website deployment will contain:

- The existing approved main All Season site content and appearance.
- The four campaign routes:
  - `/campaigns/do-it-right-once`
  - `/campaigns/weather-report`
  - `/campaigns/seasonal-shield`
  - `/campaigns/for-every-season`
- Working shared navigation and footer routes.
- The existing server-to-server PIW estimate submission flow.

The main-site content is to be merged as-is. This project does not include a consistency, copy, or visual redesign pass for those existing sections. Changes are limited to what is required for correct routing, rendering, assets, and production deployment.

## Campaign Theme Contract

Define one typed campaign-theme contract that both applications can consume or mirror from a single authoritative source. It must include:

- Campaign slug and display name.
- Theme identifier.
- Background, surface, text, muted text, primary accent, and secondary accent colors.
- Hero artwork reference and image treatment.
- Major loading statement.
- Result-page supporting headline and trust narrative.
- Primary CTA label.
- Optional campaign-specific decorative treatment.

The four approved visual families are:

| Campaign | Theme | Primary emotional promise |
|---|---|---|
| Do It Right Once | Heritage | Correct scope, lasting workmanship, and accountability |
| Weather Report | Forecast | Weather readiness and protection before the next storm |
| Seasonal Shield | Shield | Year-round defense with one accountable team |
| For Every Season | Seasons | Local experience and lasting confidence in every season |

The implementation should avoid theme drift. The landing page, loading experience, and quote result should resolve their colors and content from the same contract rather than maintaining unrelated hand-tuned values.

## Visual System

The property remains the hero of the estimate experience.

- The homeowner's satellite image is the primary visual on processing and completed-result screens.
- Campaign artwork acts as an atmospheric frame, background texture, gradient source, or edge treatment. It must not obscure the property or make the result look like another advertisement.
- Campaign colors, typography, accent treatment, and message carry through the complete journey.
- Montserrat Bold is used for major campaign statements.
- Bebas Neue is used for supporting section headlines.
- Body copy uses the existing readable supporting typeface.
- Major result content must maintain accessible contrast regardless of campaign palette.
- Mobile composition is intentional, not a collapsed desktop layout.

Motion should reinforce progress and precision without becoming theatrical:

- Restrained satellite-image reveal.
- Subtle roof-measurement or scan-line treatment where appropriate.
- Clear status transitions.
- No fake percentage progress.
- Respect `prefers-reduced-motion` and preserve full comprehension without animation.

## Processing Experience

The loading screen begins as a direct continuation of the submitted campaign form. It must immediately confirm that the homeowner's request was accepted and that the property is being evaluated.

Campaign-specific loading statements:

| Campaign | Loading statement |
|---|---|
| Do It Right Once | Building your roof estimate around the facts. |
| Weather Report | Checking what New Jersey weather asks of your roof. |
| Seasonal Shield | Measuring the protection above your home. |
| For Every Season | Preparing a roof estimate built for every season. |

The interface should communicate real workflow stages without exposing internal provider or API terminology. Suggested homeowner-facing stages are:

1. Confirming the property.
2. Measuring the roof.
3. Preparing the estimate.

The screen may rotate concise trust evidence while processing, including New Jersey experience since 2009, licensed local professionals, no installation subcontractors, and long-term workmanship/system coverage. Rotation must not cause layout shift.

## Completed Quote Experience

The completed screen is result-first. Campaign storytelling supports the answer instead of delaying it.

Content hierarchy:

1. Confirm the property address and show its satellite image.
2. Reveal the estimated investment range prominently.
3. Explain what the estimate includes and what requires an on-site inspection.
4. Present one dominant action: schedule the roof inspection.
5. Provide a visible phone alternative.
6. Reinforce trust with licensed New Jersey experience, owned installation crews, and coverage details.
7. Continue the campaign-specific narrative beneath the decision content.

The page must clearly state that the generated range is an estimate, not a final contract price. It must avoid false precision and set the expectation that roof condition, decking, flashing, access, ventilation, and selected materials may affect final scope.

Campaign-specific result continuation:

- **Do It Right Once:** Clear scope, correct installation, and accountability after the work.
- **Weather Report:** Protection appropriate for New Jersey exposure and readiness before severe weather.
- **Seasonal Shield:** Year-round defense, workmanship, and one team responsible for the outcome.
- **For Every Season:** Local experience, lasting protection, and confidence over the life of the roof.

## Non-Ready States

Every result state must retain the resolved campaign theme:

- Processing.
- Manual review required.
- Estimate ready.
- Enrichment or estimate failure.
- Expired or invalid token.
- Unknown campaign.

Manual-review and failure states must remain reassuring and actionable. They should explain that the property needs human review, offer a call option, and avoid exposing provider names, stack traces, or internal workflow terms.

Unknown campaign values use the neutral All Season fallback and must never break result rendering.

## Data and Security

- Resolve the campaign from the lead associated with the secure estimate token.
- Do not accept presentation-critical campaign identity from untrusted browser input.
- Preserve the current production Supabase project and existing campaign intake transaction.
- Do not alter estimate calculations as part of this visual-continuity project.
- Do not expose administrative or privileged PIW data to the public result page.
- Continue treating the secure result token as the public access boundary.

## Accessibility and Responsive Requirements

- Meet WCAG AA contrast for text and primary controls.
- Preserve semantic heading order and meaningful button/link labels.
- Ensure all status information is available as text, not motion or color alone.
- Announce meaningful processing-state changes without repeatedly interrupting screen-reader users.
- Provide visible focus states and a logical keyboard order.
- Support narrow mobile screens without clipped prices, addresses, CTAs, or campaign headlines.
- Respect reduced-motion preferences.

## Testing and Acceptance

Automated coverage should verify:

- Every campaign slug maps to the intended theme.
- Unknown or missing campaigns map to the neutral fallback.
- Campaign identity comes from stored lead data.
- Processing, ready, manual-review, failure, and invalid-token states render safely.
- Estimate values, property data, and CTA behavior remain unchanged by theming.
- Main-site and campaign routes resolve in the website production build.
- Mobile layouts preserve content hierarchy.

Production QA requires one real test submission from each landing page. For each submission, verify:

1. Website form acceptance.
2. Correct production lead and campaign attribution.
3. Enrichment and estimate completion.
4. Correct secure result link.
5. Satellite image and address match.
6. Correct campaign theme and copy.
7. Estimate range readability.
8. Scheduling CTA and phone fallback.
9. Mobile rendering.

## Release Strategy

- Website and PIW remain independently deployable.
- Deploy the PIW theme-aware result experience with the neutral fallback first.
- Deploy the website merge and campaign pages after PIW is compatible.
- Run one submission per campaign against production.
- Retain the ability to roll either deployment back without breaking secure result links or existing lead records.

## Explicit Non-Goals

- Redesigning or reconciling inconsistencies in the approved main-site content.
- Changing campaign form fields or consent language.
- Changing roof-estimate calculations.
- Moving privileged PIW operations into the public website.
- Replacing the current production Supabase project.
- Introducing a reverse proxy or consolidating both applications into one deployment.

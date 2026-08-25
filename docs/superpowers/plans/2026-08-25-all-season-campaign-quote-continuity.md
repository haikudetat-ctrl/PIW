# All Season Campaign-to-Quote Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a campaign-matched estimate loading and quote experience in PIW, and publish the approved roofing-first All Season main-site content beside the four campaign landing pages on the canonical website deployment.

**Architecture:** `rake-website.vercel.app` remains the canonical marketing deployment; PIW remains the secure backend and renders `/roof-estimate/[token]`. A repository-level typed campaign theme registry is consumed by both Next.js applications. PIW resolves the theme only from `leads.campaign`, keeps the satellite property image primary, and uses a neutral All Season fallback for non-campaign traffic.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind CSS 4, native CSS custom properties, Vitest, Testing Library, Supabase, Vercel

**Spec:** `docs/superpowers/specs/2026-08-25-all-season-campaign-quote-continuity-design.md`

## Global Constraints

- `rake-website.vercel.app` remains the canonical public website; do not proxy result routes or consolidate the deployments.
- PIW campaign identity comes from the lead associated with the secure estimate token, never a browser query parameter.
- Preserve the current production Supabase project and campaign intake transaction; do not change estimate calculations.
- Keep the satellite image as the primary visual and campaign artwork as a restrained atmospheric frame.
- Use Montserrat Bold for major campaign statements and Bebas Neue for supporting section headlines.
- Completed pages reveal the estimate first, then the campaign-specific trust story.
- Theme processing, ready, manual-review, failure, invalid-token, and unknown-campaign states.
- Unknown and non-campaign leads use a polished neutral All Season fallback.
- Preserve the approved main-site content and appearance; do not perform an inconsistency or copy cleanup pass.
- Meet WCAG AA contrast, preserve keyboard focus, expose state as text, support narrow mobile screens, and respect `prefers-reduced-motion`.
- Do not expose provider names, internal workflow terms, stack traces, or privileged PIW data.
- Do not use em dashes in new homeowner-facing copy.

## File Structure

### Shared campaign contract

- Create `shared/all-season-campaign-themes.ts`: campaign slug union, visual tokens, result copy, fallback theme, resolver, and CSS-variable adapter.
- Create `shared/all-season-campaign-themes.test.ts`: registry completeness, fallback, required copy, and CSS token tests.
- Modify `apps/website/app/campaigns/campaigns.ts`: consume the shared campaign slug and theme definitions.
- Modify `apps/website/app/campaigns/campaign-landing-page.tsx`: apply shared CSS variables while retaining theme-specific layout selectors.
- Modify `apps/website/app/campaigns/campaigns.test.ts`: prove every public campaign consumes the shared contract.

### PIW public estimate experience

- Create `src/app/roof-estimate/[token]/estimate-result-model.ts`: pure state derivation and campaign-aware result view model.
- Create `src/app/roof-estimate/[token]/estimate-result-model.test.ts`: state, fallback, price, and campaign tests.
- Create `src/app/roof-estimate/[token]/campaign-estimate-shell.tsx`: semantic branded shell, property-art frame, header, and shared CTA treatment.
- Create `src/app/roof-estimate/[token]/campaign-result-content.tsx`: ready/manual/failure content and campaign continuation.
- Create `src/app/roof-estimate/[token]/campaign-result-content.test.tsx`: result-first hierarchy and homeowner-safe state copy.
- Create `src/app/roof-estimate/[token]/not-found.tsx`: neutral branded invalid/expired-result state.
- Create `src/app/roof-estimate/[token]/not-found.test.tsx`: invalid-token copy, call fallback, and internal-detail exclusion.
- Modify `src/app/roof-estimate/[token]/page.tsx`: fetch `leads.campaign`, build the model, and compose the new shell.
- Modify `src/app/roof-estimate/[token]/estimate-wait-experience.tsx`: accept resolved theme content and render three honest processing stages.
- Create `src/app/roof-estimate/[token]/estimate-wait-experience.test.tsx`: stage, campaign, rotation, and reduced-motion-safe content tests.
- Modify `src/app/roof-estimate/[token]/property-satellite-image.tsx`: theme the loading/unavailable treatment without weakening the property-image priority.
- Modify `src/app/globals.css`: local font faces, campaign estimate tokens, responsive layout, focus treatment, and reduced-motion behavior.
- Copy `apps/website/public/fonts/{montserrat-700,bebas-neue-400}.ttf` to `public/fonts/`.
- Copy the four approved campaign `hero.webp` files to matching `public/campaigns/<slug>/hero.webp` paths.

### Canonical public website

- Restore only the approved public-site content files from commit `5116515`; do not cherry-pick that commit.
- Create `apps/website/app/route.test.ts`: prove `/` serves the approved roofing-first homepage and required asset/navigation references.
- Modify `apps/website/public/lead-forms.test.ts` only if the exact restored production script requires its matching approved test version.

### Release evidence

- Modify `docs/runbooks/deployment.md`: document the two-deployment ownership and four campaign QA matrix without changing environment values.
- Create `docs/qa/2026-08-25-all-season-campaign-quote-continuity.md`: record build/test results and the four production submission/result links.

---

### Task 1: Establish the shared campaign theme contract

**Files:**
- Create: `shared/all-season-campaign-themes.ts`
- Create: `shared/all-season-campaign-themes.test.ts`
- Modify: `apps/website/app/campaigns/campaigns.ts`
- Modify: `apps/website/app/campaigns/campaign-landing-page.tsx`
- Modify: `apps/website/app/campaigns/campaigns.test.ts`

**Interfaces:**
- Produces: `CampaignSlug`, `CampaignTheme`, `campaignSlugs`, `campaignThemes`, `neutralCampaignTheme`, `resolveCampaignTheme(campaign: string | null | undefined): CampaignTheme`, and `campaignThemeCssVariables(theme: CampaignTheme): Record<string, string>`.
- Consumes: Existing campaign marketing definitions and the approved CSS variable names in `apps/website/app/styles.css`.

- [ ] **Step 1: Write the failing shared-contract tests**

```ts
import { describe, expect, test } from "vitest";
import {
  campaignSlugs,
  campaignThemeCssVariables,
  campaignThemes,
  neutralCampaignTheme,
  resolveCampaignTheme,
} from "./all-season-campaign-themes";

describe("All Season campaign themes", () => {
  test("defines all four approved campaign journeys", () => {
    expect(Object.keys(campaignThemes)).toEqual(campaignSlugs);
    expect(campaignThemes["do-it-right-once"].loadingStatement).toBe(
      "Building your roof estimate around the facts.",
    );
    expect(campaignThemes["for-every-season"].accent).toBe("#7bcb28");
  });

  test("falls back safely for unknown and non-campaign leads", () => {
    expect(resolveCampaignTheme(null)).toBe(neutralCampaignTheme);
    expect(resolveCampaignTheme("organic")).toBe(neutralCampaignTheme);
  });

  test("exposes the complete CSS variable surface", () => {
    expect(campaignThemeCssVariables(campaignThemes["weather-report"])).toEqual({
      "--estimate-bg": "#082e49",
      "--estimate-surface": "#0c405f",
      "--estimate-text": "#f7fbff",
      "--estimate-muted": "#c9dce8",
      "--estimate-accent": "#ff9a45",
      "--estimate-accent-contrast": "#102a3d",
    });
  });
});
```

- [ ] **Step 2: Run the shared-contract test and verify RED**

Run: `npm run test:run -- shared/all-season-campaign-themes.test.ts`

Expected: FAIL because `shared/all-season-campaign-themes.ts` does not exist.

- [ ] **Step 3: Implement the typed registry and fallback**

```ts
export const campaignSlugs = [
  "do-it-right-once",
  "weather-report",
  "seasonal-shield",
  "for-every-season",
] as const;

export type CampaignSlug = (typeof campaignSlugs)[number];

export type CampaignTheme = {
  slug: CampaignSlug | "all-season";
  theme: "heritage" | "forecast" | "shield" | "seasons" | "neutral";
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accentContrast: string;
  artworkPath: string | null;
  loadingStatement: string;
  resultHeadline: string;
  trustHeadline: string;
  trustCopy: string;
};

export const campaignThemes: Record<CampaignSlug, CampaignTheme> = {
  "do-it-right-once": {
    slug: "do-it-right-once",
    theme: "heritage",
    background: "#061f34",
    surface: "#0b3554",
    text: "#f7fbff",
    muted: "#c9dce8",
    accent: "#63b7dc",
    accentContrast: "#061f34",
    artworkPath: "/campaigns/do-it-right-once/hero.webp",
    loadingStatement: "Building your roof estimate around the facts.",
    resultHeadline: "Your roof deserves a plan built to last.",
    trustHeadline: "Accountability should outlast installation.",
    trustCopy: "Start with a clear scope, the right materials, and one local team prepared to stand behind the work for the long haul.",
  },
  "weather-report": {
    slug: "weather-report",
    theme: "forecast",
    background: "#082e49",
    surface: "#0c405f",
    text: "#f7fbff",
    muted: "#c9dce8",
    accent: "#ff9a45",
    accentContrast: "#102a3d",
    artworkPath: "/campaigns/weather-report/hero.webp",
    loadingStatement: "Checking what New Jersey weather asks of your roof.",
    resultHeadline: "A clearer forecast starts above your home.",
    trustHeadline: "Prepare before the next storm makes the decision.",
    trustCopy: "Understand the condition, exposure, and recommended scope now, with a New Jersey roofing team that gives you a straight answer.",
  },
  "seasonal-shield": {
    slug: "seasonal-shield",
    theme: "shield",
    background: "#07351f",
    surface: "#0b4b2d",
    text: "#f7fbff",
    muted: "#cce6d6",
    accent: "#90d76f",
    accentContrast: "#07351f",
    artworkPath: "/campaigns/seasonal-shield/hero.webp",
    loadingStatement: "Measuring the protection above your home.",
    resultHeadline: "Protection begins with knowing the full scope.",
    trustHeadline: "One roof. One team accountable for the outcome.",
    trustCopy: "A dependable roof protects the life inside it through every season. We make the plan clear and remain responsible after cleanup.",
  },
  "for-every-season": {
    slug: "for-every-season",
    theme: "seasons",
    background: "#073754",
    surface: "#0d4b6a",
    text: "#f7fbff",
    muted: "#c9e1eb",
    accent: "#7bcb28",
    accentContrast: "#073754",
    artworkPath: "/campaigns/for-every-season/hero.webp",
    loadingStatement: "Preparing a roof estimate built for every season.",
    resultHeadline: "Confidence for every New Jersey season.",
    trustHeadline: "Choose the local team built for lasting trust.",
    trustCopy: "Get a clear plan from one New Jersey company that installs the work and stands behind it for the years ahead.",
  },
};

export const neutralCampaignTheme: CampaignTheme = {
  slug: "all-season",
  theme: "neutral",
  background: "#0f2a4a",
  surface: "#173a60",
  text: "#fffdf7",
  muted: "#d6dee8",
  accent: "#ffda00",
  accentContrast: "#0f2a4a",
  artworkPath: null,
  loadingStatement: "Preparing a clear first look at your roof.",
  resultHeadline: "Your roof estimate is ready.",
  trustHeadline: "Local roofing experience. One accountable team.",
  trustCopy: "All Season gives New Jersey homeowners a clear scope, careful installation, and one company to call after the work is complete.",
};

export function resolveCampaignTheme(campaign: string | null | undefined): CampaignTheme {
  return campaignSlugs.includes(campaign as CampaignSlug)
    ? campaignThemes[campaign as CampaignSlug]
    : neutralCampaignTheme;
}

export function campaignThemeCssVariables(theme: CampaignTheme) {
  return {
    "--estimate-bg": theme.background,
    "--estimate-surface": theme.surface,
    "--estimate-text": theme.text,
    "--estimate-muted": theme.muted,
    "--estimate-accent": theme.accent,
    "--estimate-accent-contrast": theme.accentContrast,
  };
}
```

- [ ] **Step 4: Refactor the website to consume the contract**

Replace the local `CampaignSlug`/`campaignSlugs` declarations with imports from `../../../../shared/all-season-campaign-themes`. Add `visual: campaignThemes[slug]` to each `CampaignDefinition`, and apply variables on `<main>`:

```tsx
<main
  className="campaign-page"
  data-theme={campaign.visual.theme}
  style={campaignThemeCssVariables(campaign.visual) as React.CSSProperties}
>
```

Retain `data-theme` for artwork/layout selectors, but update color declarations in `apps/website/app/styles.css` to consume the shared variable names instead of redefining campaign colors.

- [ ] **Step 5: Run shared and website tests**

Run: `npm run test:run -- shared/all-season-campaign-themes.test.ts`

Run: `npm --prefix apps/website test -- app/campaigns/campaigns.test.ts`

Expected: both suites PASS; four slugs, palette values, copy, and fallback are covered.

- [ ] **Step 6: Run both typechecks and commit**

Run: `npm run typecheck`

Run: `npm --prefix apps/website run typecheck`

```bash
git add shared/all-season-campaign-themes.ts shared/all-season-campaign-themes.test.ts apps/website/app/campaigns/campaigns.ts apps/website/app/campaigns/campaign-landing-page.tsx apps/website/app/campaigns/campaigns.test.ts apps/website/app/styles.css
git commit -m "feat: share All Season campaign themes"
```

### Task 2: Derive a secure campaign-aware estimate view model

**Files:**
- Create: `src/app/roof-estimate/[token]/estimate-result-model.ts`
- Create: `src/app/roof-estimate/[token]/estimate-result-model.test.ts`
- Modify: `src/app/roof-estimate/[token]/page.tsx`

**Interfaces:**
- Consumes: `resolveCampaignTheme(lead.campaign)` from Task 1 plus estimate, pipeline, property, and lead rows.
- Produces: `EstimateResultModel` with `state: "processing" | "manual-review" | "ready" | "unavailable"`, `theme`, `address`, formatted range inputs, roof squares, and safe homeowner-facing state copy.

- [ ] **Step 1: Write failing state and campaign tests**

```ts
import { describe, expect, test } from "vitest";
import { buildEstimateResultModel } from "./estimate-result-model";

const base = {
  estimate: { status: "pending", range_low_cents: null, range_high_cents: null, roof_squares: null },
  pipelineStatus: "running",
  canonicalAddress: "12 Birch Street, Newark, NJ",
  submittedAddress: "12 Birch St",
  campaign: "weather-report",
};

describe("buildEstimateResultModel", () => {
  test("resolves processing copy from the stored lead campaign", () => {
    const model = buildEstimateResultModel(base);
    expect(model.state).toBe("processing");
    expect(model.theme.slug).toBe("weather-report");
    expect(model.theme.loadingStatement).toContain("New Jersey weather");
  });

  test("uses the neutral theme for an unknown campaign", () => {
    expect(buildEstimateResultModel({ ...base, campaign: "organic" }).theme.slug).toBe("all-season");
  });

  test("makes a complete estimate result ready", () => {
    const model = buildEstimateResultModel({
      ...base,
      estimate: { status: "ready", range_low_cents: 1800000, range_high_cents: 2400000, roof_squares: 31.4 },
      pipelineStatus: "complete",
    });
    expect(model).toMatchObject({ state: "ready", rangeLowCents: 1800000, rangeHighCents: 2400000, roofSquares: 31.4 });
  });
});
```

- [ ] **Step 2: Run the model test and verify RED**

Run: `npm run test:run -- 'src/app/roof-estimate/[token]/estimate-result-model.test.ts'`

Expected: FAIL because the model module does not exist.

- [ ] **Step 3: Implement pure state derivation**

```ts
export type EstimateResultState = "processing" | "manual-review" | "ready" | "unavailable";

export function buildEstimateResultModel(input: EstimateResultInput): EstimateResultModel {
  const terminal = ["complete", "partial", "review_required", "failed"].includes(input.pipelineStatus ?? "");
  const ready = input.estimate.status === "ready"
    && input.estimate.range_low_cents !== null
    && input.estimate.range_high_cents !== null;
  const manualReview = input.estimate.status === "review_required"
    || (input.estimate.status === "pending" && input.pipelineStatus === "review_required");
  const state = ready ? "ready" : manualReview ? "manual-review"
    : input.estimate.status === "pending" && !terminal ? "processing" : "unavailable";

  return {
    state,
    theme: resolveCampaignTheme(input.campaign),
    address: input.canonicalAddress ?? input.submittedAddress ?? "your property",
    rangeLowCents: input.estimate.range_low_cents,
    rangeHighCents: input.estimate.range_high_cents,
    roofSquares: input.estimate.roof_squares === null ? null : Number(input.estimate.roof_squares),
  };
}
```

- [ ] **Step 4: Fetch and pass the stored campaign in the server page**

Change the lead query to:

```ts
service
  .from("leads")
  .select("submitted_address, campaign")
  .eq("id", estimate.lead_id)
  .maybeSingle()
```

Build the model from the fetched rows. Do not read `searchParams` and do not add campaign to the public URL.

- [ ] **Step 5: Run tests, typecheck, and commit**

Run: `npm run test:run -- 'src/app/roof-estimate/[token]/estimate-result-model.test.ts'`

Run: `npm run typecheck`

Expected: PASS.

```bash
git add 'src/app/roof-estimate/[token]/estimate-result-model.ts' 'src/app/roof-estimate/[token]/estimate-result-model.test.ts' 'src/app/roof-estimate/[token]/page.tsx'
git commit -m "feat: resolve estimate campaign from lead data"
```

### Task 3: Build the campaign-matched processing and non-ready experience

**Files:**
- Create: `src/app/roof-estimate/[token]/campaign-estimate-shell.tsx`
- Modify: `src/app/roof-estimate/[token]/estimate-wait-experience.tsx`
- Create: `src/app/roof-estimate/[token]/estimate-wait-experience.test.tsx`
- Modify: `src/app/roof-estimate/[token]/property-satellite-image.tsx`
- Modify: `src/app/roof-estimate/[token]/page.tsx`
- Modify: `src/app/globals.css`
- Create: `public/fonts/montserrat-700.ttf`
- Create: `public/fonts/bebas-neue-400.ttf`
- Create: `public/campaigns/do-it-right-once/hero.webp`
- Create: `public/campaigns/weather-report/hero.webp`
- Create: `public/campaigns/seasonal-shield/hero.webp`
- Create: `public/campaigns/for-every-season/hero.webp`

**Interfaces:**
- Consumes: `EstimateResultModel.theme` and `EstimateResultModel.state` from Task 2.
- Produces: `CampaignEstimateShell({ theme, propertyMedia?, children })` and `EstimateWaitExperience({ theme, manualReview })`, used by the final-result task.

- [ ] **Step 1: Write failing processing-experience tests**

```tsx
import { render, screen } from "@testing-library/react";
import { campaignThemes } from "../../../../shared/all-season-campaign-themes";
import { EstimateWaitExperience } from "./estimate-wait-experience";

test("shows honest homeowner-facing processing stages", () => {
  render(<EstimateWaitExperience theme={campaignThemes["seasonal-shield"]} />);
  expect(screen.getByText("Confirming the property")).toBeInTheDocument();
  expect(screen.getByText("Measuring the roof")).toBeInTheDocument();
  expect(screen.getByText("Preparing the estimate")).toBeInTheDocument();
  expect(screen.queryByText(/API|provider|pipeline/i)).not.toBeInTheDocument();
});

test("keeps manual review branded and actionable", () => {
  render(<EstimateWaitExperience theme={campaignThemes["weather-report"]} manualReview />);
  expect(screen.getByText(/roofing professional is checking/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /call/i })).toHaveAttribute("href", "tel:+18888325050");
});
```

- [ ] **Step 2: Run the component test and verify RED**

Run: `npm run test:run -- 'src/app/roof-estimate/[token]/estimate-wait-experience.test.tsx'`

Expected: FAIL because the existing component accepts `brand`, not `theme`, and uses provider-specific copy.

- [ ] **Step 3: Copy the approved local fonts and campaign art**

```bash
mkdir -p public/fonts public/campaigns/do-it-right-once public/campaigns/weather-report public/campaigns/seasonal-shield public/campaigns/for-every-season
cp apps/website/public/fonts/montserrat-700.ttf public/fonts/montserrat-700.ttf
cp apps/website/public/fonts/bebas-neue-400.ttf public/fonts/bebas-neue-400.ttf
cp apps/website/public/campaigns/do-it-right-once/hero.webp public/campaigns/do-it-right-once/hero.webp
cp apps/website/public/campaigns/weather-report/hero.webp public/campaigns/weather-report/hero.webp
cp apps/website/public/campaigns/seasonal-shield/hero.webp public/campaigns/seasonal-shield/hero.webp
cp apps/website/public/campaigns/for-every-season/hero.webp public/campaigns/for-every-season/hero.webp
```

- [ ] **Step 4: Implement the semantic campaign shell**

`CampaignEstimateShell` must apply `campaignThemeCssVariables(theme)` to the outer `<main>`, render campaign artwork with `aria-hidden="true"`, keep the address and satellite image in the primary media region, and expose one persistent phone link. Use a semantic `<header>`, `<section aria-labelledby="estimate-heading">`, and visible focus styling.

```tsx
type CampaignEstimateShellProps = {
  theme: CampaignTheme;
  propertyMedia?: React.ReactNode;
  children: React.ReactNode;
};

<main
  className="campaign-estimate-page"
  data-estimate-theme={theme.theme}
  style={campaignThemeCssVariables(theme) as React.CSSProperties}
>
  {theme.artworkPath ? <div className="campaign-estimate-art" style={{ backgroundImage: `url(${theme.artworkPath})` }} aria-hidden="true" /> : null}
  <div className="campaign-estimate-inner">
    <EstimateHeader />
    <section className="campaign-estimate-grid" aria-labelledby="estimate-heading">
      {propertyMedia ? <div className="campaign-estimate-property">{propertyMedia}</div> : null}
      <div className="campaign-estimate-content">{children}</div>
    </section>
  </div>
</main>
```

- [ ] **Step 5: Replace provider copy with the three approved stages**

Render these exact stage labels: `Confirming the property`, `Measuring the roof`, and `Preparing the estimate`. For manual review, say that a roofing professional is checking the property match and provide the brand phone link. Keep the existing review proof, but use the theme accent through CSS variables and prevent panel rotation from changing container height.

- [ ] **Step 6: Add responsive, font, focus, and reduced-motion CSS**

```css
@font-face { font-family: "Montserrat Local"; src: url("/fonts/montserrat-700.ttf") format("truetype"); font-weight: 700; font-display: swap; }
@font-face { font-family: "Bebas Neue Local"; src: url("/fonts/bebas-neue-400.ttf") format("truetype"); font-weight: 400; font-display: swap; }

.campaign-estimate-page { min-height: 100dvh; background: var(--estimate-bg); color: var(--estimate-text); position: relative; overflow: clip; }
.campaign-estimate-title { font-family: "Montserrat Local", sans-serif; font-weight: 700; }
.campaign-estimate-kicker { font-family: "Bebas Neue Local", sans-serif; letter-spacing: .08em; }
.campaign-estimate-page :focus-visible { outline: 3px solid var(--estimate-accent); outline-offset: 4px; }

@media (prefers-reduced-motion: reduce) {
  .estimate-scan, .estimate-status-pulse, .estimate-reveal { animation: none !important; }
}
```

Complete the mobile layout at `max-width: 767px` so the satellite region appears before the status/result card, the address wraps, and no CTA or amount clips at 320 CSS pixels.

- [ ] **Step 7: Run tests, typecheck, and commit**

Run: `npm run test:run -- 'src/app/roof-estimate/[token]/estimate-wait-experience.test.tsx' 'src/app/roof-estimate/[token]/estimate-result-model.test.ts'`

Run: `npm run typecheck`

Expected: PASS.

```bash
git add public/fonts public/campaigns 'src/app/roof-estimate/[token]' src/app/globals.css
git commit -m "feat: theme campaign estimate processing"
```

### Task 4: Deliver the result-first campaign quote experience

**Files:**
- Create: `src/app/roof-estimate/[token]/campaign-result-content.tsx`
- Create: `src/app/roof-estimate/[token]/campaign-result-content.test.tsx`
- Create: `src/app/roof-estimate/[token]/not-found.tsx`
- Create: `src/app/roof-estimate/[token]/not-found.test.tsx`
- Modify: `src/app/roof-estimate/[token]/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `EstimateResultModel` and `CampaignEstimateShell` from Tasks 2 and 3.
- Produces: `CampaignResultContent({ model })`, the complete ready/manual/unavailable result panel and campaign trust continuation.

- [ ] **Step 1: Write failing result hierarchy and safety tests**

```tsx
import { render, screen } from "@testing-library/react";
import { buildEstimateResultModel } from "./estimate-result-model";
import { CampaignResultContent } from "./campaign-result-content";

test("puts the ready estimate before the supporting story", () => {
  const model = buildEstimateResultModel({
    estimate: { status: "ready", range_low_cents: 1800000, range_high_cents: 2400000, roof_squares: 31.4 },
    pipelineStatus: "complete",
    canonicalAddress: "12 Birch Street, Newark, NJ",
    submittedAddress: null,
    campaign: "do-it-right-once",
  });
  render(<CampaignResultContent model={model} />);
  const range = screen.getByText("$18,000 to $24,000");
  const trust = screen.getByRole("heading", { name: /accountability/i });
  expect(range.compareDocumentPosition(trust) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole("link", { name: /schedule the roof inspection/i })).toBeVisible();
  expect(screen.getByText(/preliminary estimate/i)).toBeVisible();
});

test("keeps an unavailable estimate actionable and provider-neutral", () => {
  const model = buildEstimateResultModel({
    estimate: { status: "failed", range_low_cents: null, range_high_cents: null, roof_squares: null },
    pipelineStatus: "failed",
    canonicalAddress: null,
    submittedAddress: "8 Shore Road, Toms River, NJ",
    campaign: "seasonal-shield",
  });
  render(<CampaignResultContent model={model} />);
  expect(screen.getByRole("link", { name: /call/i })).toHaveAttribute("href", "tel:+18888325050");
  expect(screen.queryByText(/Google Solar|API|pipeline|provider/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the result test and verify RED**

Run: `npm run test:run -- 'src/app/roof-estimate/[token]/campaign-result-content.test.tsx'`

Expected: FAIL because `CampaignResultContent` does not exist.

- [ ] **Step 3: Implement ready, manual-review, and unavailable panels**

For ready results, render this order in the DOM:

1. `Preliminary roof estimate` kicker.
2. `Your range is ready.` heading.
3. One accessible range string, formatted with the existing whole-dollar formatter.
4. Roof squares and New Jersey pricing context.
5. Explanation that roof condition, decking, flashing, access, ventilation, and selected materials may affect final scope.
6. Primary `Schedule the roof inspection` CTA.
7. Phone fallback.
8. Theme `trustHeadline` and `trustCopy`.
9. Proof row: `Serving New Jersey since 2009`, `No installation subcontractors`, and `Long-term workmanship and system coverage`.

Use `roofEstimateBrand.phoneHref` for the primary action and label it `Schedule the roof inspection`. Keep the visible secondary phone text `(888) 832-5050` so the interaction is honest about opening a call.

- [ ] **Step 4: Compose the page and keep the satellite image primary**

Replace the generic slate/cyan result card in `page.tsx` with:

```tsx
<CampaignEstimateShell
  theme={model.theme}
  propertyMedia={model.state === "processing"
    ? <PropertyMediaSkeleton theme={model.theme} />
    : <PropertyMedia token={token} address={model.address} theme={model.theme} />}
>
  {model.state === "processing" ? (
    <ProcessingContent model={model} />
  ) : (
    <CampaignResultContent model={model} />
  )}
</CampaignEstimateShell>
```

The media column stays first in DOM order. The campaign art remains behind or around it and must not replace the property image.

- [ ] **Step 5: Add the neutral branded invalid-token state**

Create a route-segment `not-found.tsx` using `neutralCampaignTheme`, the All Season header, this exact headline, and the phone fallback:

```tsx
export default function RoofEstimateNotFound() {
  return (
    <CampaignEstimateShell theme={neutralCampaignTheme}>
      <p className="campaign-estimate-kicker">Estimate link unavailable</p>
      <h1 id="estimate-heading" className="campaign-estimate-title">Let us help you find the next step.</h1>
      <p>This estimate link is invalid or no longer available. Your request may still be saved with our roofing team.</p>
      <a href={roofEstimateBrand.phoneHref}>Call {roofEstimateBrand.phoneDisplay}</a>
    </CampaignEstimateShell>
  );
}
```

The test must assert the headline and phone link and reject `token`, `database`, `Supabase`, `API`, and stack-trace language.

- [ ] **Step 6: Run focused and regression tests**

Run: `npm run test:run -- 'src/app/roof-estimate/[token]/*.test.ts*' src/app/roof-estimate/form-data.test.ts`

Run: `npm run lint -- 'src/app/roof-estimate/[token]' shared/all-season-campaign-themes.ts`

Run: `npm run typecheck`

Expected: PASS with no accessibility query failures or type errors.

- [ ] **Step 7: Commit**

```bash
git add 'src/app/roof-estimate/[token]' src/app/globals.css
git commit -m "feat: deliver campaign-matched roof estimates"
```

### Task 5: Merge the approved roofing-first main website content

**Files:**
- Restore from `5116515`: `apps/website/public/index.html`, `about.html`, `contact.html`, `reviews.html`, `styles.css`, `script.js`, `llms.txt`, `quote-drawer.css`, `quote-drawer.js`, `resources/**/*.html`, `services/**/*.html`, `service-areas/**/*.html`
- Restore from `5116515`: `apps/website/data/service-areas.json`, `apps/website/scripts/generate-service-areas.mjs`
- Create: `apps/website/app/route.test.ts`
- Test: `apps/website/public/lead-forms.test.ts`

**Interfaces:**
- Consumes: The exact approved public-site content from commit `5116515` and the existing raw-HTML root route.
- Produces: A canonical website build where `/`, content pages, assets, and `/campaigns/*` coexist.

- [ ] **Step 1: Write a failing homepage route test before restoring content**

```ts
import { describe, expect, test } from "vitest";
import { GET } from "./route";

describe("canonical All Season homepage", () => {
  test("serves the approved roofing-first homepage", async () => {
    const response = await GET();
    const html = await response.text();
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("All Season Roofing | New Jersey Roof Replacement and Solar");
    expect(html).toContain("The All Season roofing process");
    expect(html).toContain("/services/roofing.html");
    expect(html).toContain("/resources/nj-roof-solar-readiness-checklist.html");
  });
});
```

- [ ] **Step 2: Run the route test and verify RED**

Run: `npm --prefix apps/website test -- app/route.test.ts`

Expected: FAIL because the narrow release branch still contains the older solar-first homepage title/process copy.

- [ ] **Step 3: Restore only approved public-site content from the source commit**

Do not cherry-pick `5116515`. Restore the explicit content paths only:

```bash
git restore --source=5116515 -- apps/website/public/index.html apps/website/public/about.html apps/website/public/contact.html apps/website/public/reviews.html apps/website/public/styles.css apps/website/public/script.js apps/website/public/llms.txt apps/website/public/quote-drawer.css apps/website/public/quote-drawer.js apps/website/public/resources apps/website/public/services apps/website/public/service-areas apps/website/data/service-areas.json apps/website/scripts/generate-service-areas.mjs
```

Inspect `git diff --name-only` and confirm no API route, campaign runtime, environment, proxy, or unrelated PIW file was restored.

- [ ] **Step 4: Verify static form and content behavior**

Run: `npm --prefix apps/website test -- app/route.test.ts public/lead-forms.test.ts app/campaigns/campaigns.test.ts app/api/campaign-estimate/route.test.ts`

If the restored script and existing test are from different approved versions, restore only `apps/website/public/lead-forms.test.ts` from `5116515`, rerun the command, and confirm all assertions describe the restored production behavior.

- [ ] **Step 5: Build the complete canonical website**

Run: `npm --prefix apps/website run lint`

Run: `npm --prefix apps/website run typecheck`

Run: `npm --prefix apps/website run build`

Expected: homepage, content pages, four campaign pages, autocomplete API, and campaign-estimate API build successfully.

- [ ] **Step 6: Commit the content merge without importing the broad commit history**

```bash
git add apps/website/public apps/website/data/service-areas.json apps/website/scripts/generate-service-areas.mjs apps/website/app/route.test.ts
git commit -m "feat: merge approved All Season website content"
```

### Task 6: Run integrated accessibility and responsive verification

**Files:**
- Create: `docs/qa/2026-08-25-all-season-campaign-quote-continuity.md`

**Interfaces:**
- Consumes: Complete website and PIW experiences from Tasks 1 through 5.
- Produces: Local evidence for all campaign/state/layout acceptance criteria.

- [ ] **Step 1: Run all automated gates**

Run: `npm run lint`

Run: `npm run typecheck`

Run: `npm run test:run`

Run: `npm run build`

Run: `npm --prefix apps/website run lint`

Run: `npm --prefix apps/website run typecheck`

Run: `npm --prefix apps/website test`

Run: `npm --prefix apps/website run build`

Expected: every command exits 0.

- [ ] **Step 2: Start both local applications**

Run PIW on port 3010: `npm run dev -- --port 3010`

Run website on port 3011: `npm --prefix apps/website run dev -- --port 3011`

Expected: both development servers become ready with no compile errors.

- [ ] **Step 3: Verify the homeowner journey at mobile and desktop widths**

Use browser verification at 390x844 and 1440x1000 for:

- `/`
- `/campaigns/do-it-right-once`
- `/campaigns/weather-report`
- `/campaigns/seasonal-shield`
- `/campaigns/for-every-season`
- A processing estimate token.
- A ready estimate token.
- A manual-review or unavailable fixture/token.

For each view, confirm no horizontal overflow, no clipped address/price/CTA, visible keyboard focus, satellite image priority, campaign-matched art/palette, and correct Montserrat/Bebas typography.

- [ ] **Step 4: Verify reduced motion and safe state language**

Emulate `prefers-reduced-motion: reduce`. Confirm scan/pulse/reveal animations stop, content remains visible, and processing still exposes all three stages as text. Search rendered PIW output for `Google Solar`, `API`, `provider`, `pipeline`, and stack-trace text; none may appear in homeowner-facing status content.

- [ ] **Step 5: Record local QA evidence and commit fixes**

Create the QA document with a table containing route/state, viewport, theme, satellite, CTA, accessibility, and result. Record exact automated commands and exit status. Leave production URL cells blank until Task 7. Any failure blocks this task and returns execution to the owning task's failing test, implementation, and commit cycle; do not record a failed check as accepted.

```bash
git add docs/qa/2026-08-25-all-season-campaign-quote-continuity.md
git commit -m "test: verify campaign quote continuity"
```

### Task 7: Deploy safely and complete four-campaign production QA

**Files:**
- Modify: `docs/runbooks/deployment.md`
- Modify: `docs/qa/2026-08-25-all-season-campaign-quote-continuity.md`

**Interfaces:**
- Consumes: Green builds and local QA from Task 6, existing Vercel project links, existing production Supabase configuration, and the existing campaign submission API.
- Produces: Live website/result deployments, four verified production journeys, rollback references, and a Slack DM containing live QA links.

- [ ] **Step 1: Document deployment ownership before release**

Add a concise runbook section stating:

```md
## All Season public campaign ownership

- `rake-website.vercel.app`: canonical homepage, content pages, and `/campaigns/*`.
- `piw-sepia.vercel.app`: secure campaign intake backend and `/roof-estimate/[token]` result rendering.
- Campaign result themes resolve from the stored `leads.campaign` value.
- The neutral All Season theme is the rollback-compatible fallback.
```

Do not change or infer Supabase/Vercel environment values in documentation.

- [ ] **Step 2: Re-run release gates from a clean tree**

Run: `git status --short`

Expected: only the two intended documentation files are modified.

Run both applications' lint, typecheck, tests, and builds again. Expected: all exit 0.

- [ ] **Step 3: Deploy PIW first and retain its rollback URL**

Deploy the current branch to the linked PIW production project. Confirm the deployment uses the already-configured production environment; do not create or connect another Supabase project. Record the immutable deployment URL and the prior healthy deployment URL in the QA document.

- [ ] **Step 4: Smoke-test the neutral fallback and one existing result URL**

Open the previously verified result path and confirm it still loads, retains its data, and resolves either its stored campaign theme or the neutral fallback. Confirm the page does not require a campaign query parameter.

- [ ] **Step 5: Deploy the canonical website and retain its rollback URL**

Deploy `apps/website` to the linked `rake-website` production project. Verify `/`, the four campaign routes, `/api/address-autocomplete`, and the campaign form shell respond successfully.

- [ ] **Step 6: Submit and verify one real production form per campaign**

For each campaign, use a unique valid New Jersey test address/contact record and verify:

1. The website passes the form gate and redirects to a secure PIW result URL.
2. Production Supabase contains one lead with the correct `campaign` and attribution.
3. The enrichment run reaches its terminal state.
4. The estimate and satellite image correspond to the submitted property.
5. Loading and completed result use the correct campaign palette, art, and copy.
6. The amount is readable and precedes the trust story.
7. The scheduling CTA and `(888) 832-5050` fallback work.
8. Mobile rendering passes at 390 CSS pixels.

Record all four landing-page links and all four secure result links in the QA document. Do not include customer data or secret values.

- [ ] **Step 7: Commit final release evidence**

```bash
git add docs/runbooks/deployment.md docs/qa/2026-08-25-all-season-campaign-quote-continuity.md
git commit -m "docs: record All Season campaign production QA"
```

- [ ] **Step 8: Send the requested Slack DM**

Send a direct message to the user with:

- Confirmation that the main site and campaign-matched result experience are live.
- The canonical homepage link.
- All four live landing-page links.
- All four production result links created during QA.
- A one-line status for enrichment, estimate delivery, mobile QA, and rollback readiness.

Do not include Supabase credentials, shared secrets, private lead data, or internal tokens other than the intentionally public secure result URLs.

## Final Acceptance

The work is complete only when both deployments are live, all automated gates pass, one production journey per campaign is verified end to end, the approved main website is present on the canonical deployment, the QA record is committed, and the requested Slack DM has been delivered.

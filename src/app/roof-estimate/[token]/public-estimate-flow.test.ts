import {describe, expect, test} from "vitest";
import {
  getAssessmentCalculationState,
  getAssessmentResultCta,
  getAssessmentResultRange,
  justConverted,
  quietEstimateState,
  selectPublicEstimateView,
} from "./public-estimate-flow";

const insight = {
  id: "99999999-9999-4999-8999-999999999999",
  companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  propertyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  provider: "google_solar",
  lookupStatus: "success",
};

describe("trustworthy public assessment result states", () => {
  test("admits a complete sanitized Good Better Best snapshot", () => {
    const packages=[
      {tierKey:"good",displayOrder:1,customerName:"Complete System",customerDescription:"Complete.",warrantySummary:"Enhanced.",differentiators:["Finish"],lowCentsPerSquare:80000,highCentsPerSquare:97500,recommended:false,measuredRoofSquares:25,rangeLowCents:2000000,rangeHighCents:2437500,pricingVersion:"v1",generatedAt:"2026-08-31T12:00:00.000Z"},
      {tierKey:"better",displayOrder:2,customerName:"Recommended",customerDescription:"Upgraded.",warrantySummary:"Extended.",differentiators:["Weight"],lowCentsPerSquare:95000,highCentsPerSquare:120000,recommended:true,measuredRoofSquares:25,rangeLowCents:2375000,rangeHighCents:3000000,pricingVersion:"v1",generatedAt:"2026-08-31T12:00:00.000Z"},
      {tierKey:"best",displayOrder:3,customerName:"Signature System",customerDescription:"Premium.",warrantySummary:"Extended.",differentiators:["Impact"],lowCentsPerSquare:125000,highCentsPerSquare:165000,recommended:false,measuredRoofSquares:25,rangeLowCents:3125000,rangeHighCents:4125000,pricingVersion:"v1",generatedAt:"2026-08-31T12:00:00.000Z"},
    ];
    const state=getAssessmentCalculationState({
      estimateStatus:"ready",pipelineStatus:"complete",expectedCompanyId:insight.companyId,
      expectedPropertyId:insight.propertyId,insight,lowCents:2375000,highCents:3000000,
      roofSquares:25,generatedAt:"2026-08-31T12:00:00.000Z",pricingVersion:"v1",packages,adjustments:[],
    });
    expect(state).toMatchObject({status:"ready",pricingVersion:"v1",packages:[{tierKey:"good"},{tierKey:"better"},{tierKey:"best"}]});
  });

  test("admits a range only from a complete trustworthy Google calculation", () => {
    const state = getAssessmentCalculationState({
      estimateStatus: "ready", pipelineStatus: "complete",
      expectedCompanyId: insight.companyId, expectedPropertyId: insight.propertyId, insight,
      lowCents: 1_850_000, highCents: 2_475_000, roofSquares: 24.5,
      generatedAt: "2026-08-26T12:00:00.000Z",
    });
    expect(getAssessmentResultRange(state)).toMatchObject({
      status: "ready", source: "google", lowCents: 1_850_000,
      highCents: 2_475_000, roofSquares: 24.5,
    });
  });

  test("admits Supabase timestamptz offsets for a trustworthy Google calculation", () => {
    const state = getAssessmentCalculationState({
      estimateStatus: "ready", pipelineStatus: "complete",
      expectedCompanyId: insight.companyId, expectedPropertyId: insight.propertyId, insight,
      lowCents: 846_348, highCents: 1_269_522, roofSquares: 16.9,
      generatedAt: "2026-08-27T16:47:44.123456+00:00",
    });
    expect(state).toEqual({
      status: "ready", source: "google", lowCents: 846_348,
      highCents: 1_269_522, roofSquares: 16.9,
      generatedAt: "2026-08-27T16:47:44.123Z",
    });
  });

  test.each([
    [{status: "pending"} as const],
    [{status: "review_required", reason: "low_confidence"} as const],
  ])("never derives a range from %o", (state) => {
    expect(getAssessmentResultRange(state)).toBeNull();
  });

  test.each([
    {insight: null, lowCents: 1_850_000, highCents: 2_475_000, roofSquares: 24.5},
    {insight: {...insight, companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"}, lowCents: 1_850_000, highCents: 2_475_000, roofSquares: 24.5},
    {insight: {...insight, propertyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"}, lowCents: 1_850_000, highCents: 2_475_000, roofSquares: 24.5},
    {insight: {...insight, provider: "manual"}, lowCents: 1_850_000, highCents: 2_475_000, roofSquares: 24.5},
    {insight: {...insight, lookupStatus: "error"}, lowCents: 1_850_000, highCents: 2_475_000, roofSquares: 24.5},
    {insight, lowCents: 0, highCents: 2_475_000, roofSquares: 24.5},
    {insight, lowCents: 2_475_000, highCents: 1_850_000, roofSquares: 24.5},
    {insight, lowCents: 1_850_000, highCents: 2_475_000, roofSquares: 0},
  ])("downgrades invalid ready data without retaining numeric props: %o", (metrics) => {
    const state = getAssessmentCalculationState({
      estimateStatus: "ready", pipelineStatus: "complete",
      generatedAt: "2026-08-26T12:00:00.000Z",
      expectedCompanyId: insight.companyId, expectedPropertyId: insight.propertyId, ...metrics,
    });
    expect(state).toEqual({status: "review_required", reason: "low_confidence"});
    expect(JSON.stringify(state)).not.toMatch(/1850000|2475000|24\.5/);
  });

  test.each(["failed", "partial", "review_required"])("rejects a ready estimate from a %s pipeline", (pipelineStatus) => {
    const state=getAssessmentCalculationState({estimateStatus:"ready",pipelineStatus,expectedCompanyId:insight.companyId,expectedPropertyId:insight.propertyId,insight,lowCents:1_850_000,highCents:2_475_000,roofSquares:24.5,generatedAt:"2026-08-26T12:00:00.000Z"});
    expect(state).toEqual({status:"review_required",reason:"low_confidence"});
  });

  test.each([
    [{status:"ready",source:"google",lowCents:1,highCents:2,roofSquares:1,generatedAt:"2026-08-26T12:00:00.000Z"} as const,"Turn this range into an exact quote"],
    [{status:"pending"} as const,"Review my roof with a specialist"],
    [{status:"review_required",reason:"low_confidence"} as const,"Review my roof with a specialist"],
  ])("uses state-aware replacement CTA copy for %o",(state,expected)=>{
    expect(getAssessmentResultCta("replacement_may_make_sense",state)).toBe(expected);
  });
});

describe("public estimate view selection", () => {
  test("shows preview-origin leads their price before the remaining questions", () => {
    expect(selectPublicEstimateView({assessmentEnabled: true, assessmentStatus: "in_progress", priceFirst: true}))
      .toBe("price_first");
  });

  test("opens the questionnaire when a preview-origin lead asks to refine", () => {
    expect(selectPublicEstimateView({
      assessmentEnabled: true, assessmentStatus: "in_progress", priceFirst: true, refineRequested: true,
    })).toBe("assessment");
  });

  test("keeps the existing journey for other leads", () => {
    expect(selectPublicEstimateView({assessmentEnabled: true, assessmentStatus: "in_progress"})).toBe("assessment");
    expect(selectPublicEstimateView({assessmentEnabled: true, assessmentStatus: "completed", priceFirst: true})).toBe("result");
    expect(selectPublicEstimateView({assessmentEnabled: true, assessmentStatus: "abandoned", priceFirst: true})).toBe("resume_required");
  });

  test("with fast booking, value-first leads always land on their price", () => {
    for (const assessmentStatus of ["in_progress", "completed", "abandoned", null] as const) {
      expect(selectPublicEstimateView({assessmentEnabled: true, assessmentStatus, priceFirst: true, fastQuote: true}))
        .toBe("fast_quote");
    }
    expect(selectPublicEstimateView({
      assessmentEnabled: true, assessmentStatus: "in_progress", priceFirst: true, refineRequested: true, fastQuote: true,
    })).toBe("fast_quote");
  });

  test("fast booking leaves other leads and the rollback path alone", () => {
    expect(selectPublicEstimateView({assessmentEnabled: true, assessmentStatus: "in_progress", fastQuote: true})).toBe("assessment");
    expect(selectPublicEstimateView({assessmentEnabled: true, assessmentStatus: "abandoned", fastQuote: true})).toBe("resume_required");
    expect(selectPublicEstimateView({assessmentEnabled: false, assessmentStatus: null, priceFirst: true, fastQuote: true})).toBe("legacy");
  });
});

describe("quietEstimateState", () => {
  const ready = {
    status: "ready" as const,
    source: "google" as const,
    lowCents: 1_400_000,
    highCents: 2_100_000,
    roofSquares: 28,
    generatedAt: "2026-10-19T12:00:00.000Z",
  };

  test("keeps pricing while the pipeline is still running", () => {
    expect(quietEstimateState({estimateStatus: "pending", pipelineStatus: "running", calculation: {status: "pending"}}))
      .toEqual({pending: true, state: {kind: "received"}});
  });

  test("shows the range once it is trusted", () => {
    expect(quietEstimateState({estimateStatus: "ready", pipelineStatus: "complete", calculation: ready}))
      .toEqual({pending: false, state: {kind: "ready", lowCents: 1_400_000, highCents: 2_100_000, roofSquares: 28}});
  });

  test("carries the three tiers when the estimate has them", () => {
    const tier = (tierKey: string, low: number, high: number, recommended = false) => ({
      tierKey, displayOrder: 1, customerName: `${tierKey} system`, customerDescription: "", warrantySummary: `${tierKey} warranty`,
      differentiators: [], lowCentsPerSquare: 1, highCentsPerSquare: 2, recommended, measuredRoofSquares: 28,
      rangeLowCents: low, rangeHighCents: high, pricingVersion: "v1", generatedAt: "2026-10-19T12:00:00.000Z",
    });
    const packaged = {
      ...ready,
      pricingVersion: "v1",
      packages: [tier("good", 1_200_000, 1_600_000), tier("better", 1_400_000, 2_100_000, true), tier("best", 1_900_000, 2_600_000)],
      adjustments: [],
    };
    expect(quietEstimateState({estimateStatus: "ready", pipelineStatus: "complete", calculation: packaged}).state).toEqual({
      kind: "ready", lowCents: 1_400_000, highCents: 2_100_000, roofSquares: 28,
      packages: [
        {tierKey: "good", customerName: "good system", warrantySummary: "good warranty", rangeLowCents: 1_200_000, rangeHighCents: 1_600_000, recommended: false},
        {tierKey: "better", customerName: "better system", warrantySummary: "better warranty", rangeLowCents: 1_400_000, rangeHighCents: 2_100_000, recommended: true},
        {tierKey: "best", customerName: "best system", warrantySummary: "best warranty", rangeLowCents: 1_900_000, rangeHighCents: 2_600_000, recommended: false},
      ],
    });
  });

  test("sends a doubtful measurement to a specialist", () => {
    expect(quietEstimateState({estimateStatus: "review_required", pipelineStatus: "complete", calculation: ready}).state)
      .toEqual({kind: "review"});
    expect(quietEstimateState({estimateStatus: "pending", pipelineStatus: "review_required", calculation: {status: "review_required", reason: "low_confidence"}}))
      .toEqual({pending: false, state: {kind: "review"}});
  });

  test("falls back to a received request when no range is trusted", () => {
    expect(quietEstimateState({estimateStatus: "ready", pipelineStatus: "failed", calculation: {status: "review_required", reason: "low_confidence"}}))
      .toEqual({pending: false, state: {kind: "received"}});
  });
});

describe("justConverted", () => {
  const now = Date.parse("2026-10-23T15:00:00.000Z");
  test("is true for 15 minutes after contact details went in", () => {
    expect(justConverted("2026-10-23T14:59:00.000Z", now)).toBe(true);
    expect(justConverted("2026-10-23T14:45:01.000Z", now)).toBe(true);
    expect(justConverted("2026-10-23T14:44:59.000Z", now)).toBe(false);
  });
  test("is false without a usable timestamp", () => {
    expect(justConverted(null, now)).toBe(false);
    expect(justConverted("not a date", now)).toBe(false);
    expect(justConverted("2026-10-23T15:05:00.000Z", now)).toBe(false);
  });
});

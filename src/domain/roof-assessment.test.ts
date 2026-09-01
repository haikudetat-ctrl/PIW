import { describe, expect, test } from "vitest";
import {
  calculateProgressSignals,
  calculateRoofAssessment,
  calculationStateSchema,
  isRoofAssessmentStepAnswered,
  roofAssessmentQuestionSteps,
  roofAssessmentResponsesBaseSchema,
  roofAssessmentResponsesSchema,
  type RoofAssessmentResponses,
} from "./roof-assessment";
import {calculateRoofPricingPackages, type RoofPricingTierRate} from "./roof-pricing";

const lowSignalResponses: RoofAssessmentResponses = {
  reason: "planning",
  roofAge: "under_5",
  conditionSignals: ["nothing_obvious"],
  roofVisible: "no",
  visibleCondition: "not_answered",
  stories: "one",
  complexityFeatures: ["none_or_unsure"],
  priority: "understand_options",
  timeline: "researching",
  ownership: "owner",
};

describe("roof assessment responses", () => {
  test("assigns every response-schema key to exactly one of nine ordered steps", () => {
    const responseKeys = roofAssessmentQuestionSteps.flatMap((step) => [...step.responseKeys]);

    expect(roofAssessmentQuestionSteps).toHaveLength(9);
    expect(responseKeys).toEqual(Object.keys(roofAssessmentResponsesBaseSchema.shape));
    expect(new Set(responseKeys).size).toBe(responseKeys.length);
    expect(roofAssessmentQuestionSteps[3]).toEqual({
      id: "roofVisibility",
      responseKeys: ["roofVisible", "visibleCondition"],
    });
  });

  test("answers the composite visibility step only when its conditional fields are coherent", () => {
    expect(isRoofAssessmentStepAnswered(3, {roofVisible: "no", visibleCondition: "not_answered"})).toBe(true);
    expect(isRoofAssessmentStepAnswered(3, {roofVisible: "yes"})).toBe(false);
    expect(isRoofAssessmentStepAnswered(3, {roofVisible: "yes", visibleCondition: "healthy"})).toBe(true);
  });

  test("accepts uncertainty as a complete homeowner answer", () => {
    expect(roofAssessmentResponsesSchema.safeParse({
      ...lowSignalResponses,
      roofAge: "unknown",
      conditionSignals: ["unsure"],
      stories: "unknown",
    }).success).toBe(true);
  });

  test.each([
    ["nothing obvious plus damage", ["nothing_obvious", "active_leak"]],
    ["unsure plus damage", ["unsure", "missing_shingles"]],
  ])("rejects contradictory condition answers: %s", (_label, conditionSignals) => {
    expect(roofAssessmentResponsesSchema.safeParse({
      ...lowSignalResponses,
      conditionSignals,
    }).success).toBe(false);
  });

  test("rejects a visible-condition opinion when the roof is not visible", () => {
    expect(roofAssessmentResponsesSchema.safeParse({
      ...lowSignalResponses,
      roofVisible: "no",
      visibleCondition: "heavy_wear",
    }).success).toBe(false);
  });
});

describe("roof assessment recommendation", () => {
  test("classifies low-signal planning answers as monitor or repair", () => {
    expect(calculateRoofAssessment(lowSignalResponses)).toEqual({
      recommendation: "monitor_or_repair",
      scores: {
        need: 0,
        intent: 0,
        urgency: 0,
        propertyFit: 3,
        engagement: 2,
      },
    });
  });

  test("classifies moderate age and damage signals as professional inspection", () => {
    expect(calculateRoofAssessment({
      ...lowSignalResponses,
      reason: "damaged_shingles",
      roofAge: "10_15",
      conditionSignals: ["missing_shingles", "granules"],
      roofVisible: "yes",
      visibleCondition: "moderate_wear",
      timeline: "this_season",
    }).recommendation).toBe("professional_inspection");
  });

  test("classifies an old actively leaking roof as replacement may make sense", () => {
    expect(calculateRoofAssessment({
      ...lowSignalResponses,
      reason: "active_leak",
      roofAge: "20_plus",
      conditionSignals: ["active_leak", "curling_or_cracking"],
      roofVisible: "yes",
      visibleCondition: "heavy_wear",
      timeline: "asap",
    })).toMatchObject({
      recommendation: "replacement_may_make_sense",
      scores: { urgency: 6 },
    });
  });

  test("routes a reported sag to professional review even on a newer roof", () => {
    expect(calculateRoofAssessment({
      ...lowSignalResponses,
      conditionSignals: ["sagging"],
    }).recommendation).toBe("professional_inspection");
  });
});

describe("progress signals", () => {
  test("reports incomplete scores without pretending the assessment is complete", () => {
    expect(calculateProgressSignals({reason: "known_replacement"})).toEqual({
      complete: false,
      highIntent: true,
      scores: {need: 4, intent: 3, urgency: 0, propertyFit: 0, engagement: 0},
    });
  });

  test("uses the canonical complete calculation when every answer is present", () => {
    expect(calculateProgressSignals(lowSignalResponses)).toEqual({
      complete: true,
      highIntent: false,
      scores: {need: 0, intent: 0, urgency: 0, propertyFit: 3, engagement: 2},
    });
  });
});

describe("property calculation state", () => {
  test("accepts exactly three ordered package snapshots with Better as the compatibility range", () => {
    const tierRates: RoofPricingTierRate[] = [
      {tierKey:"good",displayOrder:1,customerName:"Complete System",customerDescription:"Complete.",warrantySummary:"Enhanced protection.",differentiators:["Architectural finish"],lowCentsPerSquare:80000,highCentsPerSquare:97500},
      {tierKey:"better",displayOrder:2,customerName:"Recommended",customerDescription:"Upgraded.",warrantySummary:"Extended protection.",differentiators:["Upgraded weight"],lowCentsPerSquare:95000,highCentsPerSquare:120000},
      {tierKey:"best",displayOrder:3,customerName:"Signature System",customerDescription:"Premium.",warrantySummary:"Extended protection.",differentiators:["Impact protection"],lowCentsPerSquare:125000,highCentsPerSquare:165000},
    ];
    const calculated=calculateRoofPricingPackages(25,tierRates,"v1","2026-08-31T13:00:00.000Z");
    expect(calculationStateSchema.parse({
      status:"ready",source:"google",lowCents:2_375_000,highCents:3_000_000,
      roofSquares:25,generatedAt:"2026-08-31T13:00:00.000Z",pricingVersion:"v1",
      packages:calculated.packages,adjustments:[],
    })).toMatchObject({status:"ready",packages:[{tierKey:"good"},{tierKey:"better"},{tierKey:"best"}]});
  });

  test("rejects package snapshots whose Better range disagrees with legacy fields", () => {
    const tierRates: RoofPricingTierRate[] = [
      {tierKey:"good",displayOrder:1,customerName:"Complete System",customerDescription:"Complete.",warrantySummary:"Enhanced.",differentiators:["Finish"],lowCentsPerSquare:80000,highCentsPerSquare:97500},
      {tierKey:"better",displayOrder:2,customerName:"Recommended",customerDescription:"Upgraded.",warrantySummary:"Extended.",differentiators:["Weight"],lowCentsPerSquare:95000,highCentsPerSquare:120000},
      {tierKey:"best",displayOrder:3,customerName:"Signature System",customerDescription:"Premium.",warrantySummary:"Extended.",differentiators:["Impact"],lowCentsPerSquare:125000,highCentsPerSquare:165000},
    ];
    const calculated=calculateRoofPricingPackages(25,tierRates,"v1","2026-08-31T13:00:00.000Z");
    expect(calculationStateSchema.safeParse({
      status:"ready",source:"google",lowCents:1,highCents:2,roofSquares:25,
      generatedAt:"2026-08-31T13:00:00.000Z",pricingVersion:"v1",
      packages:calculated.packages,adjustments:[],
    }).success).toBe(false);
  });

  test("accepts only a trustworthy Google-derived numeric range", () => {
    expect(calculationStateSchema.parse({
      status: "ready",
      source: "google",
      lowCents: 1_800_000,
      highCents: 2_600_000,
      roofSquares: 23,
      generatedAt: "2026-08-26T13:00:00.000Z",
    })).toMatchObject({status: "ready", source: "google"});
  });

  test.each([
    {status: "pending", lowCents: 1, highCents: 2},
    {status: "review_required", lowCents: 1, highCents: 2},
    {status: "ready", source: "sample", lowCents: 1, highCents: 2, roofSquares: 1, generatedAt: "2026-08-26T13:00:00.000Z"},
    {status: "ready", source: "google", lowCents: 200, highCents: 100, roofSquares: 1, generatedAt: "2026-08-26T13:00:00.000Z"},
  ])("rejects an invented or invalid numeric range %#", (state) => {
    expect(calculationStateSchema.safeParse(state).success).toBe(false);
  });
});

import { describe, expect, test } from "vitest";
import {
  calculateProgressSignals,
  calculateRoofAssessment,
  calculationStateSchema,
  roofAssessmentResponsesSchema,
  type RoofAssessmentResponses,
} from "./roof-assessment";

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

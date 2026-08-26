import { describe, expect, test } from "vitest";
import {
  calculateRoofAssessment,
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

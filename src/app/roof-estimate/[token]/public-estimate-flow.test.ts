import {describe, expect, test} from "vitest";
import {getAssessmentResultCopy, selectPublicEstimateView} from "./public-estimate-flow";

describe("public estimate assessment flow", () => {
  test("preserves the legacy estimate when the feature is disabled", () => {
    expect(selectPublicEstimateView({assessmentEnabled: false, assessmentStatus: null})).toBe("legacy");
    expect(selectPublicEstimateView({assessmentEnabled: false, assessmentStatus: "completed"})).toBe("legacy");
  });

  test("shows the assessment until it is complete", () => {
    expect(selectPublicEstimateView({assessmentEnabled: true, assessmentStatus: null})).toBe("assessment");
    expect(selectPublicEstimateView({assessmentEnabled: true, assessmentStatus: "in_progress"})).toBe("assessment");
  });

  test("reveals the result after completion", () => {
    expect(selectPublicEstimateView({assessmentEnabled: true, assessmentStatus: "completed"})).toBe("result");
  });

  test.each([
    ["monitor_or_repair", "Replacement probably isn't your first move.", "Have us take a look before you spend money"],
    ["professional_inspection", "Worth having inspected.", "Get a professional roof assessment"],
    ["replacement_may_make_sense", "Replacement may make economic sense.", "Turn this range into an exact quote"],
  ] as const)("uses cautious copy for %s", (recommendation, headline, cta) => {
    expect(getAssessmentResultCopy(recommendation)).toMatchObject({headline, cta});
  });
});

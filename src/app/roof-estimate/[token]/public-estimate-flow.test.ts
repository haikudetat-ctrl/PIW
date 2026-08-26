import {describe, expect, test} from "vitest";
import {
  getAssessmentResultCopy,
  getAssessmentResultRange,
  selectPublicEstimateView,
} from "./public-estimate-flow";

describe("public estimate assessment flow", () => {
  test.each([
    [false, null, "legacy"],
    [false, "in_progress", "legacy"],
    [false, "completed", "legacy"],
    [false, "abandoned", "resume_required"],
    [true, null, "assessment"],
    [true, "in_progress", "assessment"],
    [true, "completed", "result"],
    [true, "abandoned", "resume_required"],
  ] as const)(
    "selects %s-enabled %s assessments as %s",
    (assessmentEnabled, assessmentStatus, expectedView) => {
      expect(selectPublicEstimateView({assessmentEnabled, assessmentStatus})).toBe(expectedView);
    },
  );

  test.each([
    ["monitor_or_repair", "Replacement probably isn't your first move.", "Have us take a look before you spend money"],
    ["professional_inspection", "Worth having inspected.", "Get a professional roof assessment"],
    ["replacement_may_make_sense", "Replacement may make economic sense.", "Turn this range into an exact quote"],
  ] as const)("uses cautious copy for %s", (recommendation, headline, cta) => {
    expect(getAssessmentResultCopy(recommendation)).toMatchObject({headline, cta});
  });

  test("maps a ready Google estimate into the assessment payoff", () => {
    expect(getAssessmentResultRange({
      ready: true,
      lowCents: 1_850_000,
      highCents: 2_475_000,
      roofSquares: 24.5,
    })).toEqual({
      lowCents: 1_850_000,
      highCents: 2_475_000,
      roofSquares: 24.5,
      source: "google",
    });
  });

  test("keeps the payoff visible without a range while Google is still running", () => {
    expect(getAssessmentResultRange({
      ready: false,
      lowCents: null,
      highCents: null,
      roofSquares: null,
    })).toBeNull();
  });
});

import {describe, expect, test} from "vitest";
import {getAssessmentCalculationState, getAssessmentResultRange} from "./public-estimate-flow";

describe("trustworthy public assessment result states", () => {
  test("admits a range only from a complete trustworthy Google calculation", () => {
    const state = getAssessmentCalculationState({
      estimateStatus: "ready", pipelineStatus: "complete",
      sourceId: "99999999-9999-4999-8999-999999999999",
      lowCents: 1_850_000, highCents: 2_475_000, roofSquares: 24.5,
      generatedAt: "2026-08-26T12:00:00.000Z",
    });
    expect(getAssessmentResultRange(state)).toMatchObject({
      status: "ready", source: "google", lowCents: 1_850_000,
      highCents: 2_475_000, roofSquares: 24.5,
    });
  });

  test.each([
    [{status: "pending"} as const],
    [{status: "review_required", reason: "low_confidence"} as const],
  ])("never derives a range from %o", (state) => {
    expect(getAssessmentResultRange(state)).toBeNull();
  });

  test.each([
    {sourceId: null, lowCents: 1_850_000, highCents: 2_475_000, roofSquares: 24.5},
    {sourceId: "99999999-9999-4999-8999-999999999999", lowCents: 0, highCents: 2_475_000, roofSquares: 24.5},
    {sourceId: "99999999-9999-4999-8999-999999999999", lowCents: 2_475_000, highCents: 1_850_000, roofSquares: 24.5},
    {sourceId: "99999999-9999-4999-8999-999999999999", lowCents: 1_850_000, highCents: 2_475_000, roofSquares: 0},
  ])("downgrades invalid ready data without retaining numeric props: %o", (metrics) => {
    const state = getAssessmentCalculationState({
      estimateStatus: "ready", pipelineStatus: "complete",
      generatedAt: "2026-08-26T12:00:00.000Z", ...metrics,
    });
    expect(state).toEqual({status: "review_required", reason: "low_confidence"});
    expect(JSON.stringify(state)).not.toMatch(/1850000|2475000|24\.5/);
  });
});

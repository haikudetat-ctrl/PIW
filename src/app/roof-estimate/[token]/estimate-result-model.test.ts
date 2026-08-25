import { describe, expect, test } from "vitest";
import { buildEstimateResultModel } from "./estimate-result-model";

const base = {
  estimate: {
    status: "pending",
    range_low_cents: null,
    range_high_cents: null,
    roof_squares: null,
  },
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
      estimate: {
        status: "ready",
        range_low_cents: 1800000,
        range_high_cents: 2400000,
        roof_squares: 31.4,
      },
      pipelineStatus: "complete",
    });

    expect(model).toMatchObject({
      state: "ready",
      rangeLowCents: 1800000,
      rangeHighCents: 2400000,
      roofSquares: 31.4,
    });
  });

  test("requires manual review when the pipeline flags a pending estimate", () => {
    expect(
      buildEstimateResultModel({ ...base, pipelineStatus: "review_required" }).state,
    ).toBe("manual-review");
  });

  test("makes a terminal estimate without a range unavailable", () => {
    expect(
      buildEstimateResultModel({ ...base, pipelineStatus: "failed" }).state,
    ).toBe("unavailable");
  });
});

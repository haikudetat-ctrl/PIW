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
    expect(model.copy).toEqual({
      eyebrow: "Measurement in progress",
      headline: "Your roof is being measured.",
      description: "Keep your phone close. Our team may call while Google prepares the measurement.",
    });
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

  test("uses manual-review copy when the estimate is directly flagged for review", () => {
    const model = buildEstimateResultModel({
      ...base,
      estimate: { ...base.estimate, status: "review_required" },
    });

    expect(model).toMatchObject({
      state: "manual-review",
      copy: {
        eyebrow: "Professional review",
        headline: "We are checking the property match.",
      },
    });
  });

  test("keeps a complete estimate ready when the pipeline also requests review", () => {
    const model = buildEstimateResultModel({
      ...base,
      estimate: {
        status: "ready",
        range_low_cents: 1800000,
        range_high_cents: 2400000,
        roof_squares: 31.4,
      },
      pipelineStatus: "review_required",
    });

    expect(model).toMatchObject({
      state: "ready",
      copy: { headline: "Your range is ready." },
    });
  });

  test("makes a terminal estimate without a range unavailable", () => {
    expect(
      buildEstimateResultModel({ ...base, pipelineStatus: "failed" }).state,
    ).toBe("unavailable");
  });
});

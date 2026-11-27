import {describe, expect, test} from "vitest";
import {calculationStateSchema} from "@/domain/roof-assessment";
import {
  calculationFromHandoff,
  MEASUREMENT_HANDOFF_KEY,
  priceSquares,
  readMeasurementHandoff,
  saveMeasurementHandoff,
  triggeredAdjustments,
  withPercentAdjustments,
} from "./measure-pricing";

describe("sandbox pricing", () => {
  test("prices rounded squares at the seeded All Season rates", () => {
    const priced = priceSquares(24.27, "2026-11-27T00:00:00.000Z");
    expect(priced.roofSquares).toBe(24.3);
    expect(priced.primary.rangeLowCents).toBe(Math.round(24.3 * 95_000));
    expect(priced.primary.rangeHighCents).toBe(Math.round(24.3 * 120_000));
  });

  test("flags the pitch and steep-or-third-story surcharges", () => {
    expect(triggeredAdjustments({predominantPitchRise: 6, maxPitchRise: 7, stories: "two"})).toEqual([]);
    expect(triggeredAdjustments({predominantPitchRise: 9, maxPitchRise: 9, stories: "two"}).map((item) => item.code)).toEqual(["pitch_8_10"]);
    expect(triggeredAdjustments({predominantPitchRise: 6, maxPitchRise: 12, stories: "one"}).map((item) => item.code)).toEqual(["steep_or_third_story"]);
    expect(triggeredAdjustments({predominantPitchRise: 4, maxPitchRise: 4, stories: "three_plus"}).map((item) => item.code)).toEqual(["steep_or_third_story"]);
  });

  test("applies percentage surcharges to show what an adjusted range would be", () => {
    const steep = triggeredAdjustments({predominantPitchRise: 12, maxPitchRise: 12, stories: "one"});
    expect(withPercentAdjustments(100_000, steep, "low")).toBe(125_000);
    expect(withPercentAdjustments(100_000, steep, "high")).toBe(135_000);
  });

  test("hands a measurement to the assessment sandbox as a valid ready calculation", () => {
    const handoff = {address: "1 Main St", squares: 22.04, tier: "drawn" as const, stories: "two" as const, predominantPitchRise: 6, maxPitchRise: 6, savedAt: "2026-11-27T15:00:00.000Z"};
    saveMeasurementHandoff(handoff, window.sessionStorage);
    expect(readMeasurementHandoff(window.sessionStorage)).toEqual(handoff);
    const calculation = calculationFromHandoff(handoff);
    expect(calculation.status).toBe("ready");
    expect(calculationStateSchema.safeParse(calculation).success).toBe(true);
    if (calculation.status === "ready") expect(calculation.roofSquares).toBe(22);
    window.sessionStorage.setItem(MEASUREMENT_HANDOFF_KEY, "{not json");
    expect(readMeasurementHandoff(window.sessionStorage)).toBeNull();
    window.sessionStorage.clear();
  });
});

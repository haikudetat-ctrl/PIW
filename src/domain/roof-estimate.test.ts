import { describe, expect, test } from "vitest";
import { calculatePreliminaryRoofEstimate } from "./roof-estimate";

describe("calculatePreliminaryRoofEstimate", () => {
  test("prices a New Jersey architectural-shingle range by roofing square", () => {
    expect(calculatePreliminaryRoofEstimate(2_500)).toEqual({
      roofSquares: 25,
      rangeLowCents: 1_250_000,
      rangeHighCents: 1_875_000,
      pricePerSquareLowCents: 50_000,
      pricePerSquareHighCents: 75_000,
      pricingVersion: "nj-asphalt-v1",
    });
  });

  test("rejects missing or invalid roof area", () => {
    expect(() => calculatePreliminaryRoofEstimate(0)).toThrow(
      "Roof area must be a positive number",
    );
  });
});

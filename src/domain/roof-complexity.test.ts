import { describe, expect, test } from "vitest";
import { summarizeRoofForPreview } from "./roof-complexity";

const segment = (pitchDegrees: number, areaSqft = 400) => ({pitchDegrees, azimuthDegrees: 180, areaSqft});

describe("summarizeRoofForPreview", () => {
  test("converts measured square feet to whole roofing squares like the pricing function", () => {
    expect(summarizeRoofForPreview({totalRoofSqft: 2_449, roofSegments: [segment(22), segment(22)]}).squares).toBe(24);
    expect(summarizeRoofForPreview({totalRoofSqft: 2_451, roofSegments: [segment(22), segment(22)]}).squares).toBe(25);
  });

  test("classifies a few similar planes as simple", () => {
    expect(summarizeRoofForPreview({totalRoofSqft: 1_800, roofSegments: [segment(20), segment(22), segment(24), segment(26)]}).complexity)
      .toBe("simple");
  });

  test("classifies many planes or wide pitch variation as complex", () => {
    expect(summarizeRoofForPreview({totalRoofSqft: 3_000, roofSegments: Array.from({length: 10}, () => segment(25))}).complexity)
      .toBe("complex");
    expect(summarizeRoofForPreview({totalRoofSqft: 3_000, roofSegments: [segment(5), segment(35), segment(20)]}).complexity)
      .toBe("complex");
  });

  test("classifies everything in between as moderate", () => {
    expect(summarizeRoofForPreview({totalRoofSqft: 2_400, roofSegments: Array.from({length: 6}, (_, index) => segment(18 + index * 2))}).complexity)
      .toBe("moderate");
  });

  test("never reports less than one square", () => {
    expect(summarizeRoofForPreview({totalRoofSqft: 20, roofSegments: [segment(20)]}).squares).toBe(1);
  });
});

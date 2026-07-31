import { afterEach, describe, expect, test, vi } from "vitest";
import { createGoogleSolarProvider, parseGoogleSolarResponse } from "./google-solar";

const FIXTURE = {
  name: "buildings/ChIJ-roof",
  center: { latitude: 40.22, longitude: -74.77 },
  imageryDate: { year: 2024, month: 6, day: 3 },
  imageryQuality: "HIGH",
  solarPotential: {
    roofSegmentStats: [
      { pitchDegrees: 25, azimuthDegrees: 180, stats: { areaMeters2: 100 } },
      { pitchDegrees: 25, azimuthDegrees: 0, stats: { areaMeters2: 80 } },
    ],
  },
};

describe("Google Solar adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("converts roof segments from square meters to square feet", () => {
    const parsed = parseGoogleSolarResponse(FIXTURE);
    expect(parsed.status).toBe("success");
    if (parsed.status === "success") {
      expect(parsed.roofSegments).toHaveLength(2);
      expect(parsed.totalRoofSqft).toBeCloseTo(1_937.502, 2);
      expect(parsed.imageryDate).toBe("2024-06-03");
    }
  });

  test("treats NOT_FOUND as a usable no-coverage result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 404 } }),
    }));
    const provider = createGoogleSolarProvider({ apiKey: "secret", enabled: true });
    const result = await provider.execute(
      { latitude: 40.22, longitude: -74.77 },
      {
        companyId: "company",
        pipelineRunId: "run",
        correlationId: "correlation",
        requestKey: "request",
        deploymentEnvironment: "test",
      },
    );
    expect(result.value.status).toBe("no_coverage");
  });
});

import { describe, expect, test } from "vitest";
import { googleSolarInsightSchema } from "./roof-estimate";

describe("Google roof measurement contract", () => {
  test("accepts positive measured geometry from Google Solar", () => {
    expect(googleSolarInsightSchema.parse({
      status:"success",buildingName:"buildings/1",latitude:40,longitude:-74,
      imageryDate:"2026-01-01",imageryQuality:"HIGH",
      roofSegments:[{pitchDegrees:25,azimuthDegrees:180,areaSqft:2500}],
      totalRoofSqft:2500,rawResponse:{},
    })).toMatchObject({status:"success",totalRoofSqft:2500});
  });

  test("rejects zero-area geometry so pricing cannot be invented", () => {
    expect(googleSolarInsightSchema.safeParse({
      status:"success",buildingName:"buildings/1",latitude:40,longitude:-74,
      imageryDate:null,imageryQuality:null,
      roofSegments:[{pitchDegrees:25,azimuthDegrees:180,areaSqft:0}],
      totalRoofSqft:0,rawResponse:{},
    }).success).toBe(false);
  });
});

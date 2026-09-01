import {describe, expect, test} from "vitest";
import {
  calculateRoofPricingPackages,
  composeEstimateEmail,
  composeEstimateSms,
  roofPricingPackagesSchema,
  type RoofPricingTierRate,
} from "./roof-pricing";

const tiers: RoofPricingTierRate[] = [
  {tierKey:"good",displayOrder:1,customerName:"Complete System",customerDescription:"Dependable complete roofing system.",warrantySummary:"Enhanced manufacturer protection.",differentiators:["Architectural finish"],lowCentsPerSquare:80_000,highCentsPerSquare:97_500},
  {tierKey:"better",displayOrder:2,customerName:"Recommended",customerDescription:"Upgraded protection and appearance.",warrantySummary:"Extended material and workmanship coverage.",differentiators:["Upgraded material weight"],lowCentsPerSquare:95_000,highCentsPerSquare:120_000},
  {tierKey:"best",displayOrder:3,customerName:"Signature System",customerDescription:"Premium finish and protection.",warrantySummary:"Extended workmanship coverage.",differentiators:["Impact protection"],lowCentsPerSquare:125_000,highCentsPerSquare:165_000},
];

describe("roof pricing packages", () => {
  test.each([
    [18, [[1_440_000,1_755_000],[1_710_000,2_160_000],[2_250_000,2_970_000]]],
    [25, [[2_000_000,2_437_500],[2_375_000,3_000_000],[3_125_000,4_125_000]]],
    [35, [[2_800_000,3_412_500],[3_325_000,4_200_000],[4_375_000,5_775_000]]],
  ])("calculates %s measured squares with the approved literal bands", (roofSquares, expected) => {
    const result = calculateRoofPricingPackages(roofSquares, tiers, "all-season-nj-2026-v1", "2026-08-31T12:00:00.000Z");
    expect(result.packages.map((item) => [item.rangeLowCents,item.rangeHighCents])).toEqual(expected);
    expect(result.primary.tierKey).toBe("better");
    expect(result.primary.rangeLowCents).toBe(expected[1]?.[0]);
  });

  test("uses deterministic integer rounding for fractional measured squares", () => {
    const result = calculateRoofPricingPackages(24.5678, tiers, "v1", "2026-08-31T12:00:00.000Z");
    expect(result.packages[0].rangeLowCents).toBe(1_965_424);
    expect(result.packages[1].rangeHighCents).toBe(2_948_136);
  });

  test("accepts Supabase timestamptz offsets in persisted package snapshots", () => {
    const result = calculateRoofPricingPackages(
      25,
      tiers,
      "v1",
      "2026-08-31T18:31:47.123456+00:00",
    );

    expect(result.packages).toHaveLength(3);
    expect(result.packages[1].generatedAt).toBe("2026-08-31T18:31:47.123456+00:00");
  });

  test.each([0,-1,Number.NaN,Number.POSITIVE_INFINITY])("rejects untrusted roof-square input %s", (roofSquares) => {
    expect(() => calculateRoofPricingPackages(roofSquares, tiers, "v1", "2026-08-31T12:00:00.000Z")).toThrow();
  });

  test("rejects duplicate or misordered tier configuration", () => {
    expect(() => calculateRoofPricingPackages(25, [tiers[0]!,tiers[0]!,tiers[2]!], "v1", "2026-08-31T12:00:00.000Z")).toThrow();
    expect(() => calculateRoofPricingPackages(25, [tiers[1]!,tiers[0]!,tiers[2]!], "v1", "2026-08-31T12:00:00.000Z")).toThrow();
  });

  test("requires exactly one recommended Better snapshot", () => {
    const calculated = calculateRoofPricingPackages(25, tiers, "v1", "2026-08-31T12:00:00.000Z");
    expect(roofPricingPackagesSchema.parse(calculated.packages).filter((item) => item.recommended)).toHaveLength(1);
    expect(() => roofPricingPackagesSchema.parse(calculated.packages.map((item) => ({...item,recommended:false})))).toThrow();
  });

  test("composes product-neutral three-option customer delivery", () => {
    const result = calculateRoofPricingPackages(25, tiers, "all-season-nj-2026-v1", "2026-08-31T12:00:00.000Z");
    const estimate = {...result, roofSquares:25, adjustments:[],pricingVersion:"all-season-nj-2026-v1",generatedAt:"2026-08-31T12:00:00.000Z"};
    const email = composeEstimateEmail({name:"Alex",resultUrl:"https://piw.example/roof-estimate/token",estimate});
    const sms = composeEstimateSms({name:"Alex",resultUrl:"https://piw.example/roof-estimate/token",estimate});
    for (const content of [email.body,sms]) {
      expect(content).toContain("$20,000–$24,375");
      expect(content).toContain("$23,750–$30,000");
      expect(content).toContain("$31,250–$41,250");
      expect(content).toContain("https://piw.example/roof-estimate/token");
      expect(content).not.toMatch(/CertainTeed|Landmark|NorthGate|Presidential|Grand Manor|ShingleMaster/i);
    }
  });
});

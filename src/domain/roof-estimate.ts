import { z } from "zod";

export const roofSegmentSchema = z.object({
  pitchDegrees: z.number().min(0).max(90),
  azimuthDegrees: z.number().min(0).max(360),
  areaSqft: z.number().nonnegative(),
});

export const googleSolarInsightSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("success"),
    buildingName: z.string().min(1),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    imageryDate: z.string().nullable(),
    imageryQuality: z.string().nullable(),
    roofSegments: z.array(roofSegmentSchema).min(1),
    totalRoofSqft: z.number().positive(),
    rawResponse: z.record(z.string(), z.unknown()),
  }),
  z.object({
    status: z.literal("no_coverage"),
    rawResponse: z.record(z.string(), z.unknown()).nullable(),
  }),
]);

export type GoogleSolarInsight = z.infer<typeof googleSolarInsightSchema>;

export const NJ_ASPHALT_PRICE_PER_SQUARE_LOW_CENTS = 50_000;
export const NJ_ASPHALT_PRICE_PER_SQUARE_HIGH_CENTS = 75_000;
export const NJ_ASPHALT_PRICING_VERSION = "nj-asphalt-v1";

export function calculatePreliminaryRoofEstimate(totalRoofSqft: number) {
  if (!Number.isFinite(totalRoofSqft) || totalRoofSqft <= 0) {
    throw new Error("Roof area must be a positive number");
  }

  const roofSquares = totalRoofSqft / 100;
  return {
    roofSquares,
    rangeLowCents: Math.round(
      roofSquares * NJ_ASPHALT_PRICE_PER_SQUARE_LOW_CENTS,
    ),
    rangeHighCents: Math.round(
      roofSquares * NJ_ASPHALT_PRICE_PER_SQUARE_HIGH_CENTS,
    ),
    pricePerSquareLowCents: NJ_ASPHALT_PRICE_PER_SQUARE_LOW_CENTS,
    pricePerSquareHighCents: NJ_ASPHALT_PRICE_PER_SQUARE_HIGH_CENTS,
    pricingVersion: NJ_ASPHALT_PRICING_VERSION,
  };
}

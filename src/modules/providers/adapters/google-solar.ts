import "server-only";
import { z } from "zod";
import {
  googleSolarInsightSchema,
  type GoogleSolarInsight,
} from "@/domain/roof-estimate";
import type { ProviderAdapter, ProviderResult } from "../contracts";

const solarResponseSchema = z.object({
  name: z.string().min(1),
  center: z.object({ latitude: z.number(), longitude: z.number() }),
  imageryDate: z
    .object({ year: z.number().int(), month: z.number().int(), day: z.number().int() })
    .optional(),
  imageryQuality: z.string().optional(),
  solarPotential: z.object({
    roofSegmentStats: z.array(
      z.object({
        pitchDegrees: z.number(),
        azimuthDegrees: z.number(),
        stats: z.object({ areaMeters2: z.number().nonnegative() }),
      }),
    ),
  }),
});

export function parseGoogleSolarResponse(raw: unknown): GoogleSolarInsight {
  const parsed = solarResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Google Solar returned an invalid response");
  const roofSegments = parsed.data.solarPotential.roofSegmentStats.map((segment) => ({
    pitchDegrees: segment.pitchDegrees,
    azimuthDegrees: segment.azimuthDegrees,
    areaSqft: segment.stats.areaMeters2 * 10.7639,
  }));
  const totalRoofSqft = roofSegments.reduce((sum, segment) => sum + segment.areaSqft, 0);
  const date = parsed.data.imageryDate;
  return googleSolarInsightSchema.parse({
    status: "success",
    buildingName: parsed.data.name,
    latitude: parsed.data.center.latitude,
    longitude: parsed.data.center.longitude,
    imageryDate: date
      ? `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`
      : null,
    imageryQuality: parsed.data.imageryQuality ?? null,
    roofSegments,
    totalRoofSqft,
    rawResponse: raw,
  });
}

export function createGoogleSolarProvider(input?: {
  apiKey?: string;
  enabled?: boolean;
}): ProviderAdapter<{ latitude: number; longitude: number }, GoogleSolarInsight> {
  const apiKey = input?.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
  return {
    id: "google-solar-building-insights",
    capability: "roof.measurement",
    priority: 10,
    paid: true,
    enabled: input?.enabled ?? Boolean(apiKey),
    async execute(request, context): Promise<ProviderResult<GoogleSolarInsight>> {
      if (!apiKey) throw new Error("Google Maps API key is not configured");
      if (["preview", "test"].includes(context.deploymentEnvironment) && input === undefined) {
        throw new Error("Google Solar is disabled outside live environments");
      }
      const url = new URL("https://solar.googleapis.com/v1/buildingInsights:findClosest");
      url.searchParams.set("location.latitude", String(request.latitude));
      url.searchParams.set("location.longitude", String(request.longitude));
      url.searchParams.set("requiredQuality", "HIGH");
      url.searchParams.set("key", apiKey);
      let response: Response;
      try {
        response = await fetch(url.toString());
      } catch {
        throw new Error("Google Solar request failed");
      }
      let raw: unknown = null;
      try {
        raw = await response.json();
      } catch {
        if (response.ok) throw new Error("Google Solar returned invalid JSON");
      }
      if (response.status === 404) {
        return {
          value: { status: "no_coverage", rawResponse: raw && typeof raw === "object" ? raw as Record<string, unknown> : null },
          provider: "google_solar",
          sourceIdentifier: `${request.latitude},${request.longitude}:no_coverage`,
          retrievedAt: new Date().toISOString(),
          estimatedCostMicros: 0,
        };
      }
      if (!response.ok) throw new Error(`Google Solar responded with ${response.status}`);
      const value = parseGoogleSolarResponse(raw);
      return {
        value,
        provider: "google_solar",
        sourceIdentifier: value.status === "success" ? value.buildingName : `${request.latitude},${request.longitude}`,
        retrievedAt: new Date().toISOString(),
        estimatedCostMicros: 10_000,
      };
    },
  };
}

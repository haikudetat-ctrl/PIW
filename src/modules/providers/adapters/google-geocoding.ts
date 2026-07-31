import "server-only";
import { z } from "zod";
import {
  addressValidationResultSchema,
  type AddressValidationResult,
} from "@/domain/property-identity";
import type { ProviderAdapter, ProviderResult } from "../contracts";

const addressComponentSchema = z.object({
  long_name: z.string(),
  short_name: z.string(),
  types: z.array(z.string()),
});

const googleGeocodingResponseSchema = z.object({
  status: z.string(),
  results: z.array(
    z.object({
      place_id: z.string().min(1),
      formatted_address: z.string().min(1),
      partial_match: z.boolean().optional(),
      address_components: z.array(addressComponentSchema),
      geometry: z.object({
        location: z.object({ lat: z.number(), lng: z.number() }),
        location_type: z.string(),
      }),
    }),
  ),
});

function component(
  components: z.infer<typeof addressComponentSchema>[],
  type: string,
  format: "long_name" | "short_name" = "long_name",
) {
  return components.find((item) => item.types.includes(type))?.[format] ?? null;
}

export function parseGoogleGeocodingResponse(
  raw: unknown,
  submittedAddress: string,
): AddressValidationResult {
  const parsed = googleGeocodingResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Google Geocoding returned an invalid response");
  }
  if (parsed.data.status === "ZERO_RESULTS" || parsed.data.results.length === 0) {
    return addressValidationResultSchema.parse({
      submittedAddress,
      googlePlaceId: null,
      canonicalAddress: null,
      latitude: null,
      longitude: null,
      municipality: null,
      county: null,
      stateCode: null,
      zip: null,
      matchMethod: "no_match",
      confidence: 0,
    });
  }
  if (parsed.data.status !== "OK") {
    throw new Error(`Google Geocoding returned status ${parsed.data.status}`);
  }
  if (parsed.data.results.length > 1) {
    return addressValidationResultSchema.parse({
      submittedAddress,
      googlePlaceId: null,
      canonicalAddress: null,
      latitude: null,
      longitude: null,
      municipality: null,
      county: null,
      stateCode: null,
      zip: null,
      matchMethod: "multiple_matches",
      confidence: 40,
    });
  }

  const [match] = parsed.data.results;
  const state = component(match.address_components, "administrative_area_level_1", "short_name");
  const exact = !match.partial_match && match.geometry.location_type === "ROOFTOP";
  return addressValidationResultSchema.parse({
    submittedAddress,
    googlePlaceId: match.place_id,
    canonicalAddress: match.formatted_address,
    latitude: match.geometry.location.lat,
    longitude: match.geometry.location.lng,
    municipality:
      component(match.address_components, "locality") ??
      component(match.address_components, "postal_town"),
    county: component(match.address_components, "administrative_area_level_2"),
    stateCode: state === "NJ" ? "NJ" : null,
    zip: component(match.address_components, "postal_code", "short_name"),
    matchMethod: exact ? "exact_single_match" : "multiple_matches",
    confidence: exact ? 98 : 80,
  });
}

export function createGoogleGeocodingProvider(input?: {
  apiKey?: string;
  enabled?: boolean;
}): ProviderAdapter<{ submittedAddress: string; googlePlaceId?: string }, AddressValidationResult> {
  const apiKey = input?.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
  return {
    id: "google-geocoding",
    capability: "address.validate",
    priority: 10,
    paid: true,
    enabled: input?.enabled ?? Boolean(apiKey),
    async execute(
      request,
      context,
    ): Promise<ProviderResult<AddressValidationResult>> {
      if (!apiKey) throw new Error("Google Maps API key is not configured");
      if (["preview", "test"].includes(context.deploymentEnvironment) && input === undefined) {
        throw new Error("Google Geocoding is disabled outside live environments");
      }

      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      if (request.googlePlaceId) {
        url.searchParams.set("place_id", request.googlePlaceId);
      } else {
        url.searchParams.set("address", request.submittedAddress);
        url.searchParams.set("region", "us");
      }
      url.searchParams.set("key", apiKey);

      let response: Response;
      try {
        response = await fetch(url.toString());
      } catch {
        throw new Error("Google Geocoding request failed");
      }
      if (!response.ok) {
        throw new Error(`Google Geocoding responded with ${response.status}`);
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new Error("Google Geocoding returned invalid JSON");
      }
      const value = parseGoogleGeocodingResponse(raw, request.submittedAddress);
      const parsed = googleGeocodingResponseSchema.parse(raw);
      return {
        value,
        provider: "google_geocoding",
        sourceIdentifier:
          parsed.results[0]?.place_id ?? request.submittedAddress,
        retrievedAt: new Date().toISOString(),
        estimatedCostMicros: 5_000,
      };
    },
  };
}

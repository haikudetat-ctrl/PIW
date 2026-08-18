import "server-only";
import { z } from "zod";
import {
  addressValidationResultSchema,
  type AddressValidationResult,
} from "@/domain/property-identity";
import type { ProviderAdapter, ProviderResult } from "../contracts";

const placeAddressComponentSchema = z.object({
  longText: z.string(),
  shortText: z.string(),
  types: z.array(z.string()),
});

const googlePlaceSchema = z.object({
  id: z.string().min(1),
  formattedAddress: z.string().min(1),
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  addressComponents: z.array(placeAddressComponentSchema),
  types: z.array(z.string()).optional().default([]),
});

const googleTextSearchResponseSchema = z.object({
  places: z.array(googlePlaceSchema).optional().default([]),
});

const googleAutocompleteResponseSchema = z.object({
  suggestions: z.array(z.object({
    placePrediction: z.object({
      placeId: z.string().min(1),
      text: z.object({ text: z.string().min(1) }),
    }).optional(),
  })).optional().default([]),
});

export type GoogleAddressSuggestion = {
  placeId: string;
  address: string;
};

function placeComponent(
  components: z.infer<typeof placeAddressComponentSchema>[],
  type: string,
  format: "longText" | "shortText" = "longText",
) {
  return components.find((item) => item.types.includes(type))?.[format] ?? null;
}

export function parseGooglePlaceResponse(
  raw: unknown,
  submittedAddress: string,
): AddressValidationResult {
  const place = googlePlaceSchema.parse(raw);
  const state = placeComponent(
    place.addressComponents,
    "administrative_area_level_1",
    "shortText",
  );
  const precise =
    state === "NJ" &&
    Boolean(placeComponent(place.addressComponents, "street_number")) &&
    Boolean(placeComponent(place.addressComponents, "route"));
  return addressValidationResultSchema.parse({
    submittedAddress,
    googlePlaceId: place.id,
    canonicalAddress: place.formattedAddress,
    latitude: place.location.latitude,
    longitude: place.location.longitude,
    municipality:
      placeComponent(place.addressComponents, "locality") ??
      placeComponent(place.addressComponents, "postal_town") ??
      placeComponent(place.addressComponents, "sublocality_level_1"),
    county: placeComponent(place.addressComponents, "administrative_area_level_2"),
    stateCode: state === "NJ" ? "NJ" : null,
    zip: placeComponent(place.addressComponents, "postal_code", "shortText"),
    matchMethod: precise ? "exact_single_match" : "multiple_matches",
    confidence: precise ? 98 : 80,
  });
}

export function parseGoogleTextSearchResponse(
  raw: unknown,
  submittedAddress: string,
): AddressValidationResult {
  const parsed = googleTextSearchResponseSchema.parse(raw);
  if (parsed.places.length === 0) return noMatch(submittedAddress);
  return parseGooglePlaceResponse(parsed.places[0], submittedAddress);
}

function noMatch(submittedAddress: string) {
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

async function readJson(response: Response, provider: string) {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new Error(`${provider} returned invalid JSON`);
  }
  if (!response.ok) {
    const message = z
      .object({ error: z.object({ message: z.string() }) })
      .safeParse(raw);
    throw new Error(
      `${provider} responded with ${response.status}${message.success ? `: ${message.data.error.message}` : ""}`,
    );
  }
  return raw;
}

const PLACE_FIELDS =
  "id,formattedAddress,location,addressComponents,types";

export async function fetchGoogleAddressSuggestions(input: {
  input: string;
  sessionToken: string;
  apiKey?: string;
}): Promise<GoogleAddressSuggestion[]> {
  const apiKey = input.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("Google Maps API key is not configured");
  const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
    },
    body: JSON.stringify({
      input: input.input,
      sessionToken: input.sessionToken,
      languageCode: "en-US",
      regionCode: "us",
      includedRegionCodes: ["us"],
      includedPrimaryTypes: ["street_address", "premise", "subpremise"],
      locationBias: {
        rectangle: {
          low: { latitude: 38.9, longitude: -75.6 },
          high: { latitude: 41.4, longitude: -73.8 },
        },
      },
    }),
  });
  const raw = await readJson(response, "Google Places Autocomplete");
  return googleAutocompleteResponseSchema.parse(raw).suggestions.flatMap((suggestion) =>
    suggestion.placePrediction
      ? [{
          placeId: suggestion.placePrediction.placeId,
          address: suggestion.placePrediction.text.text,
        }]
      : []
  );
}

export async function fetchGooglePlaceDetails(input: {
  submittedAddress: string;
  googlePlaceId: string;
  apiKey?: string;
}): Promise<AddressValidationResult> {
  const apiKey = input.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("Google Maps API key is not configured");
  const response = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(input.googlePlaceId)}`,
    {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": PLACE_FIELDS,
      },
    },
  );
  const raw = await readJson(response, "Google Place Details");
  return parseGooglePlaceResponse(raw, input.submittedAddress);
}

export function createGooglePlacesProvider(input?: {
  apiKey?: string;
  enabled?: boolean;
}): ProviderAdapter<{ submittedAddress: string; googlePlaceId?: string }, AddressValidationResult> {
  const apiKey = input?.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
  return {
    id: "google-places",
    capability: "address.validate",
    priority: 10,
    paid: true,
    enabled: input?.enabled ?? Boolean(apiKey),
    async execute(request, context): Promise<ProviderResult<AddressValidationResult>> {
      if (!apiKey) throw new Error("Google Maps API key is not configured");
      if (["preview", "test"].includes(context.deploymentEnvironment) && input === undefined) {
        throw new Error("Google Places is disabled outside live environments");
      }

      let raw: unknown;
      if (request.googlePlaceId) {
        const value = await fetchGooglePlaceDetails({
          submittedAddress: request.submittedAddress,
          googlePlaceId: request.googlePlaceId,
          apiKey,
        });
        return {
          value,
          provider: "google_places",
          sourceIdentifier: value.googlePlaceId ?? request.submittedAddress,
          retrievedAt: new Date().toISOString(),
          estimatedCostMicros: 5_000,
        };
      } else {
        const response = await fetch(
          "https://places.googleapis.com/v1/places:searchText",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": apiKey,
              "X-Goog-FieldMask": PLACE_FIELDS
                .split(",")
                .map((field) => `places.${field}`)
                .join(","),
            },
            body: JSON.stringify({
              textQuery: request.submittedAddress,
              languageCode: "en-US",
              regionCode: "us",
              maxResultCount: 5,
              locationBias: {
                rectangle: {
                  low: { latitude: 38.9, longitude: -75.6 },
                  high: { latitude: 41.4, longitude: -73.8 },
                },
              },
            }),
          },
        );
        raw = await readJson(response, "Google Places Text Search");
      }

      const value = parseGoogleTextSearchResponse(raw, request.submittedAddress);
      return {
        value,
        provider: "google_places",
        sourceIdentifier: value.googlePlaceId ?? request.submittedAddress,
        retrievedAt: new Date().toISOString(),
        estimatedCostMicros: 5_000,
      };
    },
  };
}

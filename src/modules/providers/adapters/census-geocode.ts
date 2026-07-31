import "server-only";
import { z } from "zod";
import {
  addressValidationResultSchema,
  type AddressValidationResult,
} from "@/domain/property-identity";
import type {
  ProviderAdapter,
  ProviderResult,
} from "../contracts";

const censusAddressMatchSchema = z.object({
  coordinates: z.object({
    x: z.number().min(-180).max(180),
    y: z.number().min(-90).max(90),
  }),
  matchedAddress: z.string().min(1),
  addressComponents: z.object({
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
  }),
});

const censusGeocodeResponseSchema = z.object({
  result: z.object({
    addressMatches: z.array(censusAddressMatchSchema),
  }),
});

export function parseCensusGeocodeResponse(
  raw: unknown,
  submittedAddress: string,
): AddressValidationResult {
  const parsedResponse = censusGeocodeResponseSchema.safeParse(raw);
  if (!parsedResponse.success) {
    throw new Error("Census geocoder returned an invalid response");
  }

  const matches = parsedResponse.data.result.addressMatches;

  if (matches.length === 0) {
    return addressValidationResultSchema.parse({
      submittedAddress,
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

  if (matches.length > 1) {
    return addressValidationResultSchema.parse({
      submittedAddress,
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

  const [match] = matches;
  return addressValidationResultSchema.parse({
    submittedAddress,
    canonicalAddress: match.matchedAddress,
    latitude: match.coordinates.y,
    longitude: match.coordinates.x,
    municipality: match.addressComponents.city ?? null,
    // The Census one-line-address geocoder does not return county; the
    // Property Discovery Worker's NJGIN lookup fills it in from COUNTY.
    county: null,
    // Census can return an address in any state. PIW is NJ-only, so only
    // Census's explicit NJ code is allowed into the NJ state-code field.
    stateCode: match.addressComponents.state === "NJ" ? "NJ" : null,
    zip: match.addressComponents.zip ?? null,
    matchMethod: "exact_single_match",
    confidence: 97,
  });
}

async function fetchCensusGeocode(submittedAddress: string): Promise<unknown> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", submittedAddress);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch {
    throw new Error("Census geocoder request failed");
  }

  if (!response.ok) {
    throw new Error(`Census geocoder responded with ${response.status}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error("Census geocoder returned invalid JSON");
  }
}

export const censusGeocodeAddressValidationProvider: ProviderAdapter<
  { submittedAddress: string },
  AddressValidationResult
> = {
  id: "census-geocoder",
  capability: "address.validate",
  priority: 10,
  paid: false,
  enabled: true,
  async execute(input: { submittedAddress: string }): Promise<ProviderResult<AddressValidationResult>> {
    const raw = await fetchCensusGeocode(input.submittedAddress);
    const value = parseCensusGeocodeResponse(raw, input.submittedAddress);

    return {
      value,
      provider: "census_geocoder",
      sourceIdentifier: value.canonicalAddress ?? input.submittedAddress,
      retrievedAt: new Date().toISOString(),
      estimatedCostMicros: 0,
    };
  },
};

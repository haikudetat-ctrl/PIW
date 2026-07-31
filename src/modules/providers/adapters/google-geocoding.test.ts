import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createGoogleGeocodingProvider,
  parseGoogleGeocodingResponse,
} from "./google-geocoding";

const FIXTURE = {
  status: "OK",
  results: [
    {
      place_id: "ChIJ-test",
      formatted_address: "12 Birch St, Trenton, NJ 08608, USA",
      address_components: [
        { long_name: "Trenton", short_name: "Trenton", types: ["locality"] },
        { long_name: "Mercer County", short_name: "Mercer County", types: ["administrative_area_level_2"] },
        { long_name: "New Jersey", short_name: "NJ", types: ["administrative_area_level_1"] },
        { long_name: "08608", short_name: "08608", types: ["postal_code"] },
      ],
      geometry: {
        location: { lat: 40.22, lng: -74.77 },
        location_type: "ROOFTOP",
      },
    },
  ],
};

describe("Google Geocoding adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("maps a rooftop New Jersey result to exact address evidence", () => {
    expect(parseGoogleGeocodingResponse(FIXTURE, "12 Birch St")).toMatchObject({
      canonicalAddress: "12 Birch St, Trenton, NJ 08608, USA",
      municipality: "Trenton",
      county: "Mercer County",
      stateCode: "NJ",
      matchMethod: "exact_single_match",
      confidence: 98,
    });
  });

  test("returns no-match evidence for ZERO_RESULTS", () => {
    expect(
      parseGoogleGeocodingResponse({ status: "ZERO_RESULTS", results: [] }, "Missing"),
    ).toMatchObject({ matchMethod: "no_match", confidence: 0 });
  });

  test("keeps the API key server-side while calling Google", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => FIXTURE });
    vi.stubGlobal("fetch", fetchMock);
    const provider = createGoogleGeocodingProvider({ apiKey: "secret", enabled: true });
    const result = await provider.execute(
      { submittedAddress: "12 Birch St, Trenton, NJ" },
      {
        companyId: "company",
        pipelineRunId: "run",
        correlationId: "correlation",
        requestKey: "request",
        deploymentEnvironment: "test",
      },
    );
    const requestedUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestedUrl.searchParams.get("key")).toBe("secret");
    expect(result.provider).toBe("google_geocoding");
    expect(result.sourceIdentifier).toBe("ChIJ-test");
  });
});

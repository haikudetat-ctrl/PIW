import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createGooglePlacesProvider,
  fetchGoogleAddressSuggestions,
  parseGooglePlaceResponse,
} from "./google-places";

const PLACE_FIXTURE = {
  id: "ChIJ-place",
  formattedAddress: "354 Stockton St, Princeton, NJ 08540, USA",
  location: { latitude: 40.3402, longitude: -74.6701 },
  addressComponents: [
    { longText: "354", shortText: "354", types: ["street_number"] },
    { longText: "Stockton Street", shortText: "Stockton St", types: ["route"] },
    { longText: "Princeton", shortText: "Princeton", types: ["locality"] },
    { longText: "Mercer County", shortText: "Mercer County", types: ["administrative_area_level_2"] },
    { longText: "New Jersey", shortText: "NJ", types: ["administrative_area_level_1"] },
    { longText: "08540", shortText: "08540", types: ["postal_code"] },
  ],
  types: ["street_address"],
};

describe("Google Places adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("maps a precise New Jersey Place to exact address evidence", () => {
    expect(parseGooglePlaceResponse(PLACE_FIXTURE, "354 Stockton St")).toMatchObject({
      googlePlaceId: "ChIJ-place",
      canonicalAddress: "354 Stockton St, Princeton, NJ 08540, USA",
      municipality: "Princeton",
      county: "Mercer County",
      stateCode: "NJ",
      matchMethod: "exact_single_match",
      confidence: 98,
    });
  });

  test("uses Places Text Search for a manually entered address", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ places: [PLACE_FIXTURE] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = createGooglePlacesProvider({ apiKey: "secret", enabled: true });
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
    const [requestedUrl, options] = fetchMock.mock.calls[0];
    expect(requestedUrl).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(options.headers["X-Goog-Api-Key"]).toBe("secret");
    expect(requestedUrl).not.toContain("secret");
    expect(JSON.parse(options.body)).toMatchObject({
      textQuery: "12 Birch St, Trenton, NJ",
      regionCode: "us",
    });
    expect(result.provider).toBe("google_places");
    expect(result.sourceIdentifier).toBe("ChIJ-place");
  });

  test("resolves a selected Google Place ID with Place Details", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => PLACE_FIXTURE,
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = createGooglePlacesProvider({ apiKey: "secret", enabled: true });
    await provider.execute(
      { submittedAddress: "12 Birch St", googlePlaceId: "ChIJ-selected" },
      {
        companyId: "company",
        pipelineRunId: "run",
        correlationId: "correlation",
        requestKey: "request",
        deploymentEnvironment: "test",
      },
    );
    const [requestedUrl, options] = fetchMock.mock.calls[0];
    expect(requestedUrl).toBe(
      "https://places.googleapis.com/v1/places/ChIJ-selected",
    );
    expect(options.headers["X-Goog-Api-Key"]).toBe("secret");
    expect(requestedUrl).not.toContain("secret");
  });

  test("returns address-only New Jersey autocomplete predictions without exposing the API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        suggestions: [
          {
            placePrediction: {
              placeId: "ChIJ-selected",
              text: { text: "354 Stockton St, Princeton, NJ 08540, USA" },
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchGoogleAddressSuggestions({
      input: "354 Stock",
      sessionToken: "11111111-1111-4111-8111-111111111111",
      apiKey: "secret",
    })).resolves.toEqual([
      {
        placeId: "ChIJ-selected",
        address: "354 Stockton St, Princeton, NJ 08540, USA",
      },
    ]);

    const [requestedUrl, options] = fetchMock.mock.calls[0];
    expect(requestedUrl).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(requestedUrl).not.toContain("secret");
    expect(options.headers["X-Goog-Api-Key"]).toBe("secret");
    expect(options.headers["X-Goog-FieldMask"]).toBe(
      "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
    );
    expect(JSON.parse(options.body)).toMatchObject({
      input: "354 Stock",
      sessionToken: "11111111-1111-4111-8111-111111111111",
      includedPrimaryTypes: ["street_address", "premise", "subpremise"],
      includedRegionCodes: ["us"],
    });
  });
});

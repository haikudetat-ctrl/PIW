import { afterEach, describe, expect, test, vi } from "vitest";
import {
  censusGeocodeAddressValidationProvider,
  parseCensusGeocodeResponse,
} from "./census-geocode";

const SINGLE_MATCH_FIXTURE = {
  result: {
    addressMatches: [
      {
        coordinates: { x: -77.03518753691, y: 38.89869893252 },
        matchedAddress: "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500",
        addressComponents: {
          fromAddress: "1600",
          streetName: "PENNSYLVANIA",
          suffixType: "AVE",
          suffixDirection: "NW",
          city: "WASHINGTON",
          state: "DC",
          zip: "20500",
        },
        tigerLine: { tigerLineId: "76225813", side: "L" },
      },
    ],
  },
};

const NO_MATCH_FIXTURE = { result: { addressMatches: [] } };

const MULTIPLE_MATCH_FIXTURE = {
  result: {
    addressMatches: [
      { ...SINGLE_MATCH_FIXTURE.result.addressMatches[0] },
      {
        ...SINGLE_MATCH_FIXTURE.result.addressMatches[0],
        matchedAddress: "1600 PENNSYLVANIA AVE SE, WASHINGTON, DC, 20003",
      },
    ],
  },
};

describe("parseCensusGeocodeResponse", () => {
  test("maps one Census match to a high-confidence address validation", () => {
    const result = parseCensusGeocodeResponse(SINGLE_MATCH_FIXTURE, "1600 Pennsylvania Ave");

    expect(result).toMatchObject({
      canonicalAddress: "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500",
      latitude: 38.89869893252,
      longitude: -77.03518753691,
      municipality: "WASHINGTON",
      zip: "20500",
      matchMethod: "exact_single_match",
      confidence: 97,
    });
  });

  test("returns a zero-confidence validation when Census finds no match", () => {
    const result = parseCensusGeocodeResponse(NO_MATCH_FIXTURE, "12 Nowhere Ave");

    expect(result).toMatchObject({
      canonicalAddress: null,
      matchMethod: "no_match",
      confidence: 0,
    });
  });

  test("returns an ambiguous validation below the review threshold for multiple matches", () => {
    const result = parseCensusGeocodeResponse(MULTIPLE_MATCH_FIXTURE, "1600 Pennsylvania Ave");

    expect(result).toMatchObject({ matchMethod: "multiple_matches", confidence: 40 });
    expect(result.confidence).toBeLessThan(95);
  });

  test("does not label a non-NJ Census match as New Jersey", () => {
    const result = parseCensusGeocodeResponse(SINGLE_MATCH_FIXTURE, "1600 Pennsylvania Ave");

    expect(result.stateCode).toBeNull();
  });

  test("rejects a malformed Census payload before using it as a domain result", () => {
    expect(() => parseCensusGeocodeResponse({ result: { addressMatches: [{}] } }, "12 Main St")).toThrow(
      "Census geocoder returned an invalid response",
    );
  });
});

describe("censusGeocodeAddressValidationProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("calls the Census one-line-address endpoint and returns a provider result", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SINGLE_MATCH_FIXTURE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await censusGeocodeAddressValidationProvider.execute(
      { submittedAddress: "1600 Pennsylvania Ave, Washington DC" },
      {
        companyId: "company-1",
        pipelineRunId: "run-1",
        correlationId: "corr-1",
        requestKey: "address.validate:run-1",
        deploymentEnvironment: "test",
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"),
    );
    expect(result.value.matchMethod).toBe("exact_single_match");
    expect(result.provider).toBe("census_geocoder");
    expect(result.estimatedCostMicros).toBe(0);
  });

  test("reports a clear status when Census rejects the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );

    await expect(
      censusGeocodeAddressValidationProvider.execute(
        { submittedAddress: "12 Main St" },
        {
          companyId: "company-1",
          pipelineRunId: "run-1",
          correlationId: "corr-1",
          requestKey: "address.validate:run-1",
          deploymentEnvironment: "test",
        },
      ),
    ).rejects.toThrow("Census geocoder responded with 503");
  });

  test("hides an underlying network error behind a clear Census request error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network details")));

    await expect(
      censusGeocodeAddressValidationProvider.execute(
        { submittedAddress: "12 Main St" },
        {
          companyId: "company-1",
          pipelineRunId: "run-1",
          correlationId: "corr-1",
          requestKey: "address.validate:run-1",
          deploymentEnvironment: "test",
        },
      ),
    ).rejects.toThrow("Census geocoder request failed");
  });

  test("reports a clear parse error when Census sends invalid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => Promise.reject(new SyntaxError("unexpected token")),
      }),
    );

    await expect(
      censusGeocodeAddressValidationProvider.execute(
        { submittedAddress: "12 Main St" },
        {
          companyId: "company-1",
          pipelineRunId: "run-1",
          correlationId: "corr-1",
          requestKey: "address.validate:run-1",
          deploymentEnvironment: "test",
        },
      ),
    ).rejects.toThrow("Census geocoder returned invalid JSON");
  });
});

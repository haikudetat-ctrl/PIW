import {NextRequest} from "next/server";
import {afterEach, describe, expect, test, vi} from "vitest";
import {handleAddressAutocompleteRequest, POST} from "./route";

afterEach(() => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  vi.unstubAllGlobals();
});

function request(body: unknown) {
  return new NextRequest("https://allseason.example/api/address-autocomplete", {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(body),
  });
}

describe("campaign address autocomplete", () => {
  test("normalizes Google place predictions for the browser", async () => {
    const response = await handleAddressAutocompleteRequest(
      request({input: "  12 Main Street  "}),
      async () => Response.json({
        suggestions: [
          {placePrediction: {placeId: "place-1", text: {text: "12 Main St, Newark, NJ, USA"}}},
          {queryPrediction: {text: {text: "12 Main Street restaurants"}}},
          {placePrediction: {placeId: "place-2", text: {text: "12 Main St, Clifton, NJ, USA"}}},
        ],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      suggestions: [
        {placeId: "place-1", address: "12 Main St, Newark, NJ, USA"},
        {placeId: "place-2", address: "12 Main St, Clifton, NJ, USA"},
      ],
    });
  });

  test.each(["", "ab", "  a  "])("rejects an input shorter than three characters: %j", async (input) => {
    const autocomplete = vi.fn(async () => Response.json({suggestions: []}));
    const response = await handleAddressAutocompleteRequest(request({input}), autocomplete);

    expect(response.status).toBe(400);
    expect(autocomplete).not.toHaveBeenCalled();
  });

  test("returns an empty suggestion list when Google finds no places", async () => {
    const response = await handleAddressAutocompleteRequest(
      request({input: "unlikely address"}),
      async () => Response.json({suggestions: []}),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({suggestions: []});
  });

  test.each([
    ["provider rejection", async () => Response.json({error: {message: "quota"}}, {status: 429})],
    ["network failure", async () => { throw new Error("network down"); }],
    ["malformed provider response", async () => Response.json({suggestions: "not-an-array"})],
  ])("returns 502 for %s", async (_label, autocomplete) => {
    const response = await handleAddressAutocompleteRequest(request({input: "12 Main"}), autocomplete);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({error: "Address search is temporarily unavailable"});
  });

  test("POST keeps the key server-side and sends a US request biased to New Jersey", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "server-only-key";
    const fetch = vi.fn(async () => Response.json({suggestions: []}));
    vi.stubGlobal("fetch", fetch);

    const response = await POST(request({input: "12 Main"}));

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      "https://places.googleapis.com/v1/places:autocomplete",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": "server-only-key",
          "x-goog-fieldmask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
        },
        body: JSON.stringify({
          input: "12 Main",
          includedRegionCodes: ["us"],
          regionCode: "us",
          languageCode: "en",
          locationBias: {
            rectangle: {
              low: {latitude: 38.8, longitude: -75.6},
              high: {latitude: 41.4, longitude: -73.8},
            },
          },
        }),
        cache: "no-store",
      }),
    );
    expect(JSON.stringify(await response.json())).not.toContain("server-only-key");
  });

  test("POST returns 503 when the Google Places key is missing", async () => {
    const response = await POST(request({input: "12 Main"}));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({error: "Address search is not configured"});
  });
});

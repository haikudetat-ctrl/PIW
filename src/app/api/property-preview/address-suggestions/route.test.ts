import { NextRequest } from "next/server";
import { describe, expect, test, vi } from "vitest";
import { handlePreviewAddressSuggestionsRequest } from "./route";

const sessionToken = "11111111-1111-4111-8111-111111111111";

function request(query: string, headers: Record<string, string> = {}) {
  return new NextRequest(
    `https://estimate.example.com/api/property-preview/address-suggestions?q=${encodeURIComponent(query)}&session_token=${sessionToken}`,
    {headers: {host: "estimate.example.com", "sec-fetch-site": "same-origin", ...headers}},
  );
}

function dependencies(overrides: Partial<Parameters<typeof handlePreviewAddressSuggestionsRequest>[1]> = {}) {
  return {
    enabled: true,
    resolveCompany: vi.fn(async (host: string | null) => host === "estimate.example.com" ? "company-1" : null),
    suggest: vi.fn(async () => [{placeId: "ChIJ-one", address: "1 Main St, Newark, NJ 07102, USA"}]),
    reportError: vi.fn(),
    ...overrides,
  };
}

describe("preview address suggestions", () => {
  test("returns Google suggestions for a verified tenant host", async () => {
    const deps = dependencies();
    const response = await handlePreviewAddressSuggestionsRequest(request("1 Main"), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({suggestions: [{placeId: "ChIJ-one", address: "1 Main St, Newark, NJ 07102, USA"}]});
    expect(deps.suggest).toHaveBeenCalledWith({input: "1 Main", sessionToken});
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("is unavailable when previews, paid providers or the key are off", async () => {
    const deps = dependencies({enabled: false});
    expect((await handlePreviewAddressSuggestionsRequest(request("1 Main"), deps)).status).toBe(503);
    expect(deps.suggest).not.toHaveBeenCalled();
  });

  test("refuses unknown hosts and cross-site requests without calling Google", async () => {
    const deps = dependencies();
    const unknownHost = request("1 Main", {host: "other.example.com"});
    expect((await handlePreviewAddressSuggestionsRequest(unknownHost, deps)).status).toBe(404);
    expect((await handlePreviewAddressSuggestionsRequest(request("1 Main", {"sec-fetch-site": "cross-site"}), deps)).status).toBe(404);
    expect(deps.suggest).not.toHaveBeenCalled();
  });

  test("rejects short queries", async () => {
    const deps = dependencies();
    expect((await handlePreviewAddressSuggestionsRequest(request("1"), deps)).status).toBe(400);
    expect(deps.suggest).not.toHaveBeenCalled();
  });

  test("reports Google failures as unavailable so the form falls back to manual entry", async () => {
    const deps = dependencies({suggest: vi.fn(async () => { throw new Error("quota"); })});
    expect((await handlePreviewAddressSuggestionsRequest(request("1 Main"), deps)).status).toBe(503);
    expect(deps.reportError).toHaveBeenCalled();
  });
});

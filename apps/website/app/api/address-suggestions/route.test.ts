import { NextRequest } from "next/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GET, handleAddressSuggestionsRequest } from "./route";

afterEach(() => {
  delete process.env.INTAKE_ADDRESS_SUGGESTIONS_URL;
  delete process.env.INTAKE_WEBHOOK_SHARED_SECRET;
  vi.unstubAllGlobals();
});

function request(query = "354 Stock", headers: Record<string, string> = {}) {
  return new NextRequest(
    `https://rake.example/api/address-suggestions?q=${encodeURIComponent(query)}&session_token=11111111-1111-4111-8111-111111111111`,
    {headers},
  );
}

describe("address suggestions proxy", () => {
  test("forwards only valid queries to PIW", async () => {
    const forward = vi.fn(async () => Response.json({ suggestions: [{
      placeId: "ChIJ-selected",
      address: "354 Stockton St, Princeton, NJ 08540, USA",
    }] }));
    const response = await handleAddressSuggestionsRequest(request(), forward);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ suggestions: [{
      placeId: "ChIJ-selected",
      address: "354 Stockton St, Princeton, NJ 08540, USA",
    }] });
    expect(forward).toHaveBeenCalledWith({
      query: "354 Stock",
      sessionToken: "11111111-1111-4111-8111-111111111111",
    });
  });

  test("authenticates the request to the configured PIW endpoint", async () => {
    process.env.INTAKE_ADDRESS_SUGGESTIONS_URL = "https://piw.example/api/integrations/all-season/address-suggestions";
    process.env.INTAKE_WEBHOOK_SHARED_SECRET = "shared-secret";
    const fetch = vi.fn(async () => Response.json({ suggestions: [] }));
    vi.stubGlobal("fetch", fetch);

    const response = await GET(request("354 Stock", {
      "x-vercel-oidc-token": "signed-preview-token",
    }));

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      "https://piw.example/api/integrations/all-season/address-suggestions?q=354+Stock&session_token=11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        headers: {
          "x-all-season-intake-secret": "shared-secret",
          "x-vercel-trusted-oidc-idp-token": "signed-preview-token",
        },
      }),
    );
  });
});

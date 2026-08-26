import { NextRequest } from "next/server";
import { describe, expect, test, vi } from "vitest";
import { handleAllSeasonAddressSuggestionsRequest } from "./route";

function request(query: string, secret = "shared-secret") {
  return new NextRequest(
    `https://piw.example/api/integrations/all-season/address-suggestions?q=${encodeURIComponent(query)}&session_token=11111111-1111-4111-8111-111111111111`,
    { headers: { "x-all-season-intake-secret": secret } },
  );
}

describe("All Season address suggestions", () => {
  test("rejects requests without the server-to-server secret", async () => {
    const suggest = vi.fn();
    const response = await handleAllSeasonAddressSuggestionsRequest(request("354 Stock", "wrong"), {
      expectedSecret: "shared-secret",
      suggest,
    });

    expect(response.status).toBe(401);
    expect(suggest).not.toHaveBeenCalled();
  });

  test("returns Google address predictions for a valid query", async () => {
    const suggest = vi.fn(async () => [{
      placeId: "ChIJ-selected",
      address: "354 Stockton St, Princeton, NJ 08540, USA",
    }]);
    const response = await handleAllSeasonAddressSuggestionsRequest(request("354 Stock"), {
      expectedSecret: "shared-secret",
      suggest,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ suggestions: [{
      placeId: "ChIJ-selected",
      address: "354 Stockton St, Princeton, NJ 08540, USA",
    }] });
    expect(suggest).toHaveBeenCalledWith({
      input: "354 Stock",
      sessionToken: "11111111-1111-4111-8111-111111111111",
    });
  });

  test("does not call Google for queries shorter than three characters", async () => {
    const suggest = vi.fn();
    const response = await handleAllSeasonAddressSuggestionsRequest(request("35"), {
      expectedSecret: "shared-secret",
      suggest,
    });

    expect(response.status).toBe(400);
    expect(suggest).not.toHaveBeenCalled();
  });
});

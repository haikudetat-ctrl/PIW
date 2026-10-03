import { NextRequest } from "next/server";
import { describe, expect, test, vi } from "vitest";
import { handlePreviewViewRequest } from "./route";

const token = "t".repeat(43);
const view = {
  status: "active" as const,
  address: {display: "1 Main St, Newark, NJ 07102, USA", googleConfirmed: true},
  image: {state: "ready" as const},
  roof: {state: "pending" as const},
  answered: [],
  savedEmail: false,
  campaign: null,
  presentationKey: "all-season-main",
};

function request(host = "estimate.allseasonroofingquote.com") {
  return new NextRequest(`https://${host}/api/property-preview/${token}`, {headers: {host}});
}

describe("GET /api/property-preview/[token]", () => {
  test("returns the view for the tenant resolved from the host", async () => {
    const resolveCompany = vi.fn(async () => "11111111-1111-4111-8111-111111111111");
    const loadView = vi.fn(async () => view);
    const response = await handlePreviewViewRequest(request(), token, {resolveCompany, loadView});
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(view);
    expect(resolveCompany).toHaveBeenCalledWith("estimate.allseasonroofingquote.com");
    expect(loadView).toHaveBeenCalledWith({
      companyId: "11111111-1111-4111-8111-111111111111",
      tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  test("returns the same 404 for malformed tokens, unknown hosts, and unknown previews", async () => {
    const loadView = vi.fn(async () => null);
    const responses = await Promise.all([
      handlePreviewViewRequest(request(), "bad", {resolveCompany: vi.fn(async () => "c"), loadView}),
      handlePreviewViewRequest(request("evil.example.com"), token, {resolveCompany: vi.fn(async () => null), loadView}),
      handlePreviewViewRequest(request(), token, {resolveCompany: vi.fn(async () => "c"), loadView}),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({error: "Preview not found"});
    }
  });
});

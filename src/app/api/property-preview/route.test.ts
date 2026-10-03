import { NextRequest } from "next/server";
import { describe, expect, test, vi } from "vitest";
import { handleDirectPreviewRequest } from "./route";

function request(body: unknown, referer = "https://estimate.allseasonroofingquote.com/roof-estimate?utm_source=google") {
  return new NextRequest("https://estimate.allseasonroofingquote.com/api/property-preview", {
    method: "POST",
    headers: {
      host: "estimate.allseasonroofingquote.com",
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.5",
      "user-agent": "Mozilla/5.0",
      referer,
    },
    body: JSON.stringify(body),
  });
}

const valid = {address: "1 Main St, Newark, NJ 07102, USA", google_place_id: "ChIJ-one", turnstile_token: "t"};

describe("POST /api/property-preview (tenant host)", () => {
  test("creates a preview for the host's tenant with the PIW form's entry context", async () => {
    const create = vi.fn(async () => ({kind: "created" as const, previewUrl: "https://estimate.allseasonroofingquote.com/roof-estimate/p/x"}));
    const response = await handleDirectPreviewRequest(request(valid), {resolveCompany: vi.fn(async () => "c"), create});
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({previewUrl: "https://estimate.allseasonroofingquote.com/roof-estimate/p/x"});
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "c",
      address: valid.address,
      googlePlaceId: "ChIJ-one",
      campaign: null,
      entryPoint: "roof-estimate",
      presentationKey: "all-season-main",
      clientIp: "203.0.113.5",
      userAgent: "Mozilla/5.0",
      turnstileToken: "t",
      attribution: expect.objectContaining({utm_source: "google"}),
    }));
  });

  test("returns 404 off a tenant host and 400 for invalid input", async () => {
    expect((await handleDirectPreviewRequest(request(valid), {resolveCompany: vi.fn(async () => null), create: vi.fn()})).status).toBe(404);
    expect((await handleDirectPreviewRequest(request({...valid, latitude: 1}), {resolveCompany: vi.fn(async () => "c"), create: vi.fn()})).status).toBe(400);
  });
});

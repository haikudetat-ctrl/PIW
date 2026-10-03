import { NextRequest } from "next/server";
import { describe, expect, test, vi } from "vitest";
import { handlePreviewImageRequest } from "./route";

const token = "t".repeat(43);
const request = () => new NextRequest(`https://estimate.allseasonroofingquote.com/api/property-preview/${token}/house-image`, {
  headers: {host: "estimate.allseasonroofingquote.com"},
});

function deps(overrides = {}) {
  return {
    resolveCompany: vi.fn(async () => "11111111-1111-4111-8111-111111111111"),
    loadCoordinates: vi.fn(async () => ({latitude: 40.7357, longitude: -74.1724})),
    fetchSatellite: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {headers: {"content-type": "image/png"}})),
    ...overrides,
  };
}

describe("GET /api/property-preview/[token]/house-image", () => {
  test("serves the aerial for the preview's resolved coordinates with private caching", async () => {
    const d = deps();
    const response = await handlePreviewImageRequest(request(), token, d);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(d.fetchSatellite).toHaveBeenCalledWith({latitude: 40.7357, longitude: -74.1724});
  });

  test("returns 404 without calling Google when the preview has no resolved place", async () => {
    const d = deps({loadCoordinates: vi.fn(async () => null)});
    const response = await handlePreviewImageRequest(request(), token, d);
    expect(response.status).toBe(404);
    expect(d.fetchSatellite).not.toHaveBeenCalled();
  });

  test("returns 404 for an unknown host or malformed token", async () => {
    expect((await handlePreviewImageRequest(request(), "bad", deps())).status).toBe(404);
    expect((await handlePreviewImageRequest(request(), token, deps({resolveCompany: vi.fn(async () => null)}))).status).toBe(404);
  });

  test("returns a retryable 502 when Google fails", async () => {
    const response = await handlePreviewImageRequest(request(), token, deps({fetchSatellite: vi.fn(async () => null)}));
    expect(response.status).toBe(502);
    expect(response.headers.get("retry-after")).toBe("3");
  });
});

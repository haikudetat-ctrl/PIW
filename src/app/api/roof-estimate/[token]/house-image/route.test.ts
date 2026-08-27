import {afterEach, describe, expect, test, vi} from "vitest";

const {createServiceClient} = vi.hoisted(() => ({createServiceClient: vi.fn()}));

vi.mock("@/lib/env/server", () => ({
  parseServerEnv: () => ({GOOGLE_MAPS_API_KEY: "maps-key"}),
}));
vi.mock("@/lib/supabase/service", () => ({createServiceClient}));
vi.mock("@/modules/context-dialer/static-map", () => ({
  buildGoogleSatelliteUrl: () => "https://maps.example.test/static-map",
}));

import {GET} from "./route";

const token = "11111111-1111-4111-8111-111111111111";
const params = {params: Promise.resolve({token})};

function queryReturning(data: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => ({data, error: null})),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

function serviceWithLocation(location: {latitude: number | null; longitude: number | null} | null) {
  const estimate = queryReturning({
    company_id: "22222222-2222-4222-8222-222222222222",
    property_id: "33333333-3333-4333-8333-333333333333",
    roof_insight_id: null,
  });
  const address = queryReturning(location);
  createServiceClient.mockReturnValue({
    from: vi.fn((table: string) => table === "roof_estimates" ? estimate : address),
  });
}

describe("token-scoped house image route", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("marks a not-yet-geocoded image as transient and uncacheable", async () => {
    serviceWithLocation(null);

    const response = await GET(new Request("https://example.test") as never, params);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("3");
  });

  test("does not turn null coordinates into a misleading zero-zero satellite image", async () => {
    serviceWithLocation({latitude: null, longitude: null});
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await GET(new Request("https://example.test") as never, params);

    expect(response.status).toBe(404);
    expect(response.headers.get("retry-after")).toBe("3");
    expect(providerFetch).not.toHaveBeenCalled();
  });

  test("keeps capability-scoped imagery out of the shared Vercel cache", async () => {
    serviceWithLocation({latitude: 39.48, longitude: -75.02});
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {"content-type": "image/jpeg"},
    })));

    const response = await GET(new Request("https://example.test") as never, params);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });
});

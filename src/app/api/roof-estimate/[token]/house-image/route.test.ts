import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

const {buildGoogleSatelliteUrl, createServiceClient, parseServerEnv, resolveAssessmentJourneyScope} = vi.hoisted(() => ({
  buildGoogleSatelliteUrl: vi.fn(({latitude, longitude}: {
    latitude: number;
    longitude: number;
  }) => `https://maps.example.test/static-map/${latitude},${longitude}`),
  createServiceClient: vi.fn(),
  parseServerEnv: vi.fn((): {
    GOOGLE_MAPS_API_KEY: string;
    ROOF_ASSESSMENT_SIGNING_SECRET?: string;
  } => ({GOOGLE_MAPS_API_KEY: "maps-key"})),
  resolveAssessmentJourneyScope: vi.fn(),
}));

vi.mock("@/lib/env/server", () => ({
  parseServerEnv,
}));
vi.mock("@/lib/supabase/service", () => ({createServiceClient}));
vi.mock("@/modules/context-dialer/static-map", () => ({buildGoogleSatelliteUrl}));
vi.mock("@/modules/roof-assessment/analysis-telemetry", () => ({
  resolveAssessmentJourneyScope,
  SupabaseAssessmentJourneyScopeRepository: class {},
}));

import {GET} from "./route";

const token = "11111111-1111-4111-8111-111111111111";
const params = {params: Promise.resolve({token})};

function queryReturning(data: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => ({data, error: null})),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.not.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

function serviceWithLocations(input: {
  address: {latitude: number | null; longitude: number | null} | null;
  insight?: {latitude: number | null; longitude: number | null} | null;
  roofInsightId?: string | null;
}) {
  const estimate = queryReturning({
    company_id: "22222222-2222-4222-8222-222222222222",
    property_id: "33333333-3333-4333-8333-333333333333",
    roof_insight_id: input.roofInsightId ?? null,
  });
  const insight = queryReturning(input.insight ?? null);
  const address = queryReturning(input.address);
  createServiceClient.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === "roof_estimates") return estimate;
      if (table === "roof_insights") return insight;
      if (table === "property_addresses") return address;
      throw new Error(`Unexpected table: ${table}`);
    }),
  });
  return {address, estimate, insight};
}

describe("token-scoped house image route", () => {
  beforeEach(() => {
    parseServerEnv.mockReturnValue({GOOGLE_MAPS_API_KEY: "maps-key"});
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test("adds only the server-derived opaque journey correlation to the completion log", async () => {
    serviceWithLocations({address: {latitude: 39.48, longitude: -75.02}});
    parseServerEnv.mockReturnValue({
      GOOGLE_MAPS_API_KEY: "maps-key",
      ROOF_ASSESSMENT_SIGNING_SECRET: "server-only-secret",
    });
    resolveAssessmentJourneyScope.mockResolvedValue({
      correlation: "raj_0123456789abcdef0123456789abcdef",
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), {status: 200})));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await GET(new Request("https://example.test") as never, params);

    expect(response.status).toBe(200);
    const record = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(record).toMatchObject({
      correlation: "raj_0123456789abcdef0123456789abcdef",
      message: "roof estimate image request completed",
      outcome: "ready",
      status: 200,
    });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain("99999999-9999-4999-8999-999999999999");
    expect(serialized).not.toMatch(/latitude|longitude|address|place/i);
  });

  test("marks a not-yet-geocoded image as transient and uncacheable", async () => {
    serviceWithLocations({address: null});

    const response = await GET(new Request("https://example.test") as never, params);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("3");
  });

  test("does not turn null coordinates into a misleading zero-zero satellite image", async () => {
    serviceWithLocations({address: {latitude: null, longitude: null}});
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await GET(new Request("https://example.test") as never, params);

    expect(response.status).toBe(404);
    expect(response.headers.get("retry-after")).toBe("3");
    expect(providerFetch).not.toHaveBeenCalled();
  });

  test("keeps capability-scoped imagery out of the shared Vercel cache", async () => {
    serviceWithLocations({address: {latitude: 39.48, longitude: -75.02}});
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {"content-type": "image/jpeg"},
    })));

    const response = await GET(new Request("https://example.test") as never, params);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });

  test("prefers a complete ready roof insight bound to the estimate company and property", async () => {
    const {insight} = serviceWithLocations({
      roofInsightId: "44444444-4444-4444-8444-444444444444",
      insight: {latitude: 40.3501, longitude: -74.0642},
      address: {latitude: 39.48, longitude: -75.02},
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), {
      status: 200,
      headers: {"content-type": "image/jpeg"},
    })));

    const response = await GET(new Request("https://example.test") as never, params);

    expect(response.status).toBe(200);
    expect(buildGoogleSatelliteUrl).toHaveBeenCalledWith({
      latitude: 40.3501,
      longitude: -74.0642,
      apiKey: "maps-key",
    });
    expect(insight.eq).toHaveBeenCalledWith("id", "44444444-4444-4444-8444-444444444444");
    expect(insight.eq).toHaveBeenCalledWith("company_id", "22222222-2222-4222-8222-222222222222");
    expect(insight.eq).toHaveBeenCalledWith("property_id", "33333333-3333-4333-8333-333333333333");
    expect(insight.eq).toHaveBeenCalledWith("lookup_status", "success");
  });

  test("falls back as a complete coordinate pair instead of mixing partial insight and address rows", async () => {
    serviceWithLocations({
      roofInsightId: "44444444-4444-4444-8444-444444444444",
      insight: {latitude: 40.3501, longitude: null},
      address: {latitude: 39.48, longitude: -75.02},
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), {status: 200})));

    await GET(new Request("https://example.test") as never, params);

    expect(buildGoogleSatelliteUrl).toHaveBeenCalledWith({
      latitude: 39.48,
      longitude: -75.02,
      apiKey: "maps-key",
    });
  });

  test("selects the latest complete address only inside the estimate tenant and property scope", async () => {
    const {address} = serviceWithLocations({
      // The database returns this older complete row because the newer null row
      // is excluded before created_at ordering and limit(1).
      address: {latitude: 40.3501, longitude: -74.0642},
    });
    const providerFetch = vi.fn(async () => new Response(new Uint8Array([1]), {status: 200}));
    vi.stubGlobal("fetch", providerFetch);

    const response = await GET(new Request("https://example.test") as never, params);

    expect(response.status).toBe(200);
    expect(address.eq).toHaveBeenCalledWith("company_id", "22222222-2222-4222-8222-222222222222");
    expect(address.eq).toHaveBeenCalledWith("property_id", "33333333-3333-4333-8333-333333333333");
    expect(address.not).toHaveBeenCalledWith("latitude", "is", null);
    expect(address.not).toHaveBeenCalledWith("longitude", "is", null);
    expect(address.order).toHaveBeenCalledWith("created_at", {ascending: false});
    expect(address.limit).toHaveBeenCalledWith(1);
    expect(buildGoogleSatelliteUrl).toHaveBeenCalledWith({
      latitude: 40.3501,
      longitude: -74.0642,
      apiKey: "maps-key",
    });
    expect(providerFetch).toHaveBeenCalledWith(
      "https://maps.example.test/static-map/40.3501,-74.0642",
      {signal: expect.any(AbortSignal)},
    );
  });
});

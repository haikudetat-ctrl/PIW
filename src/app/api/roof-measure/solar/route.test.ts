import {mkdtemp, readdir, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, test, vi} from "vitest";
import {LiveCallLimitError, runDevRoofLookup, trimSolarResponse} from "./lookup";

const auth = vi.hoisted(() => ({user: null as {id: string} | null, role: "manager" as string | null}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {getUser: async () => ({data: {user: auth.user}})},
    rpc: async () => ({
      data: auth.role ? [{user_id: "u1", company_id: "c1", display_name: "Chris", role: auth.role, is_platform_admin: false}] : [],
    }),
  }),
}));

const solarBody = {
  name: "buildings/abc",
  center: {latitude: 40.1, longitude: -74.2},
  solarPotential: {roofSegmentStats: [], solarPanels: [{}], financialAnalyses: [{}], buildingStats: {areaMeters2: 1}},
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}});
}

function fakeFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const match = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!match) throw new Error(`unexpected ${url}`);
    return routes[match]();
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const dirs: string[] = [];
async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "roof-measure-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, {recursive: true, force: true})));
});

describe("dev roof lookup", () => {
  test("geocodes, calls Solar once, trims panels, and reuses the disk cache", async () => {
    const cacheDir = await tempDir();
    const fetchMock = fakeFetch({
      "https://places.googleapis.com/v1/places:searchText": () => json({places: [{formattedAddress: "1 Main St", location: {latitude: 40.1, longitude: -74.2}}]}),
      "https://solar.googleapis.com/v1/buildingInsights:findClosest": () => json(solarBody),
      "https://maps.googleapis.com/maps/api/elevation/json": () => json({status: "OK", results: [{elevation: 12.5}]}),
    });
    const deps = {apiKey: "k", fetch: fetchMock, cacheDir};
    const first = await runDevRoofLookup(deps, {address: "1 Main St, Red Bank NJ", quality: "HIGH"});
    expect(first.formattedAddress).toBe("1 Main St");
    expect(first.solar.status).toBe("success");
    expect(first.solar.cached).toBe(false);
    expect(first.groundElevationMeters).toBe(12.5);
    if (first.solar.status === "success") {
      expect(first.solar.raw.solarPotential).toEqual({roofSegmentStats: [], buildingStats: {areaMeters2: 1}});
    }
    const second = await runDevRoofLookup(deps, {address: "1 Main St, Red Bank NJ", quality: "HIGH"});
    expect(second.solar.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((await readdir(cacheDir)).length).toBe(3);
  });

  test("reports no coverage without asking for elevation", async () => {
    const fetchMock = fakeFetch({
      "https://solar.googleapis.com/v1/buildingInsights:findClosest": () => json({error: {code: 404}}, 404),
    });
    const result = await runDevRoofLookup({apiKey: "k", fetch: fetchMock, cacheDir: null}, {lat: 40, lng: -74, quality: "HIGH"});
    expect(result.solar.status).toBe("no_coverage");
    expect(result.groundElevationMeters).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("keeps going without a story estimate when the Elevation API is off", async () => {
    const fetchMock = fakeFetch({
      "https://solar.googleapis.com/v1/buildingInsights:findClosest": () => json(solarBody),
      "https://maps.googleapis.com/maps/api/elevation/json": () => json({status: "REQUEST_DENIED"}, 200),
    });
    const result = await runDevRoofLookup({apiKey: "k", fetch: fetchMock, cacheDir: null}, {lat: 40, lng: -74, quality: "MEDIUM"});
    expect(result.groundElevationMeters).toBeNull();
    expect(result.elevationNote).toContain("REQUEST_DENIED");
    const solarUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(solarUrl.searchParams.get("requiredQuality")).toBe("MEDIUM");
  });

  test("refuses an uncached Solar call past the limit but still serves cached ones", async () => {
    const cacheDir = await tempDir();
    const fetchMock = fakeFetch({
      "https://solar.googleapis.com/v1/buildingInsights:findClosest": () => json(solarBody),
      "https://maps.googleapis.com/maps/api/elevation/json": () => json({status: "OK", results: [{elevation: 1}]}),
    });
    let allowed = 1;
    const deps = {apiKey: "k", fetch: fetchMock, cacheDir, allowLiveSolarCall: () => allowed-- > 0};
    await runDevRoofLookup(deps, {lat: 40, lng: -74, quality: "HIGH"});
    await expect(runDevRoofLookup(deps, {lat: 41, lng: -74, quality: "HIGH"})).rejects.toBeInstanceOf(LiveCallLimitError);
    const again = await runDevRoofLookup(deps, {lat: 40, lng: -74, quality: "HIGH"});
    expect(again.solar.cached).toBe(true);
  });

  test("leaves non-Solar fields alone when trimming", () => {
    expect(trimSolarResponse({name: "x"})).toEqual({name: "x"});
  });
});

describe("roof lookup route", () => {
  const request = () => new Request("http://localhost/api/roof-measure/solar?lat=40&lng=-74");

  test("refuses a signed-out caller", async () => {
    auth.user = null;
    vi.stubEnv("ROOF_MEASURE_GOOGLE_API_KEY", "k");
    const {GET} = await import("./route");
    expect((await GET(request())).status).toBe(401);
  });

  test("refuses a signed-in user without CRM access", async () => {
    auth.user = {id: "u1"};
    auth.role = "employee";
    vi.stubEnv("ROOF_MEASURE_GOOGLE_API_KEY", "k");
    const {GET} = await import("./route");
    expect((await GET(request())).status).toBe(403);
  });

  test("uses only its own key and says when it is missing", async () => {
    auth.user = {id: "u1"};
    auth.role = "manager";
    vi.stubEnv("ROOF_MEASURE_GOOGLE_API_KEY", "");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "shared-key");
    const {GET} = await import("./route");
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("ROOF_MEASURE_GOOGLE_API_KEY");
  });

  test("looks up for a signed-in manager with the dedicated key", async () => {
    auth.user = {id: "u1"};
    auth.role = "manager";
    vi.stubEnv("ROOF_MEASURE_GOOGLE_API_KEY", "roof-key");
    // The route caches under os.tmpdir(); keep that inside a throwaway folder.
    vi.stubEnv("TMPDIR", await tempDir());
    const fetchMock = fakeFetch({
      "https://solar.googleapis.com/v1/buildingInsights:findClosest": () => json({error: {code: 404}}, 404),
    });
    vi.stubGlobal("fetch", fetchMock);
    const {GET} = await import("./route");
    const response = await GET(new Request("http://localhost/api/roof-measure/solar?lat=40.0001&lng=-74.0001"));
    expect(response.status).toBe(200);
    expect((await response.json()).solar.status).toBe("no_coverage");
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("key")).toBe("roof-key");
    vi.unstubAllGlobals();
  });
});

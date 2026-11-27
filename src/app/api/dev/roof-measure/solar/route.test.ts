import {mkdtemp, readdir, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, test, vi} from "vitest";
import {runDevRoofLookup, trimSolarResponse} from "./lookup";

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
      "https://maps.googleapis.com/maps/api/geocode/json": () => json({status: "OK", results: [{formatted_address: "1 Main St", geometry: {location: {lat: 40.1, lng: -74.2}}}]}),
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

  test("leaves non-Solar fields alone when trimming", () => {
    expect(trimSolarResponse({name: "x"})).toEqual({name: "x"});
  });
});

describe("dev roof lookup route", () => {
  test("is a 404 outside local development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "k");
    const {GET} = await import("./route");
    const response = await GET(new Request("http://localhost/api/dev/roof-measure/solar?lat=40&lng=-74"));
    expect(response.status).toBe(404);
  });

  test("asks for the key when it is missing", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    const {GET} = await import("./route");
    const response = await GET(new Request("http://localhost/api/dev/roof-measure/solar?lat=40&lng=-74"));
    expect(response.status).toBe(503);
  });
});

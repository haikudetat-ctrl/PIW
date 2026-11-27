import "server-only";
import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";

// Dev-only Google lookups for the roof measuring sandbox. Building Insights is
// billed per call ($10 per 1,000 after 10,000 free a month at the Nov 2026
// list price), so every response is cached on disk under .cache/ and reused.
// Data Layers is never called here.

export type SolarQuality = "HIGH" | "MEDIUM" | "LOW";

export type DevRoofLookupResult = {
  location: {lat: number; lng: number};
  formattedAddress: string | null;
  solar: {status: "success"; raw: Record<string, unknown>; cached: boolean} | {status: "no_coverage"; cached: boolean};
  groundElevationMeters: number | null;
  elevationNote: string | null;
};

export type LookupDeps = {
  apiKey: string;
  fetch: typeof fetch;
  cacheDir: string | null;
};

export function defaultCacheDir() {
  return path.join(process.cwd(), ".cache", "dev-roof-measure");
}

async function cached<T>(deps: LookupDeps, key: string, load: () => Promise<T>): Promise<{value: T; cached: boolean}> {
  if (!deps.cacheDir) return {value: await load(), cached: false};
  const file = path.join(deps.cacheDir, `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
  try {
    return {value: JSON.parse(await readFile(file, "utf8")) as T, cached: true};
  } catch {
    const value = await load();
    await mkdir(deps.cacheDir, {recursive: true});
    await writeFile(file, JSON.stringify(value));
    return {value, cached: false};
  }
}

// The drawing needs segment geometry only; panel layouts and financials make
// the response ~50x larger.
const DROPPED_SOLAR_KEYS = ["solarPanels", "solarPanelConfigs", "financialAnalyses"];

export function trimSolarResponse(raw: Record<string, unknown>) {
  const potential = raw.solarPotential;
  if (!potential || typeof potential !== "object") return raw;
  const kept = Object.fromEntries(
    Object.entries(potential as Record<string, unknown>).filter(([key]) => !DROPPED_SOLAR_KEYS.includes(key)),
  );
  return {...raw, solarPotential: kept};
}

async function getJson(deps: LookupDeps, url: URL, label: string) {
  let response: Response;
  try {
    response = await deps.fetch(url.toString(), {cache: "no-store"});
  } catch {
    throw new Error(`${label} request failed`);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Handled by the status checks below.
  }
  return {status: response.status, ok: response.ok, body};
}

export async function geocodeAddress(deps: LookupDeps, address: string) {
  const {value} = await cached(deps, `geocode:${address.trim().toLowerCase()}`, async () => {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", address);
    url.searchParams.set("components", "country:US");
    url.searchParams.set("key", deps.apiKey);
    const result = await getJson(deps, url, "Geocoding");
    const body = result.body as {status?: string; results?: Array<{formatted_address?: string; geometry?: {location?: {lat: number; lng: number}}}>} | null;
    const first = body?.results?.[0];
    if (!result.ok || body?.status !== "OK" || !first?.geometry?.location) {
      throw new Error(`Google could not find that address (${body?.status ?? result.status})`);
    }
    return {location: first.geometry.location, formattedAddress: first.formatted_address ?? null};
  });
  return value;
}

export async function lookupSolar(deps: LookupDeps, location: {lat: number; lng: number}, quality: SolarQuality) {
  const key = `solar:${location.lat.toFixed(6)},${location.lng.toFixed(6)}:${quality}`;
  return cached(deps, key, async () => {
    const url = new URL("https://solar.googleapis.com/v1/buildingInsights:findClosest");
    url.searchParams.set("location.latitude", String(location.lat));
    url.searchParams.set("location.longitude", String(location.lng));
    url.searchParams.set("requiredQuality", quality);
    url.searchParams.set("key", deps.apiKey);
    const result = await getJson(deps, url, "Google Solar");
    if (result.status === 404) return {status: "no_coverage" as const};
    if (!result.ok || !result.body || typeof result.body !== "object") {
      throw new Error(`Google Solar responded with ${result.status}`);
    }
    return {status: "success" as const, raw: trimSolarResponse(result.body as Record<string, unknown>)};
  });
}

export async function lookupGroundElevation(deps: LookupDeps, location: {lat: number; lng: number}) {
  try {
    const {value} = await cached(deps, `elevation:${location.lat.toFixed(6)},${location.lng.toFixed(6)}`, async () => {
      const url = new URL("https://maps.googleapis.com/maps/api/elevation/json");
      url.searchParams.set("locations", `${location.lat},${location.lng}`);
      url.searchParams.set("key", deps.apiKey);
      const result = await getJson(deps, url, "Elevation");
      const body = result.body as {status?: string; results?: Array<{elevation?: number}>} | null;
      const elevation = body?.results?.[0]?.elevation;
      if (!result.ok || body?.status !== "OK" || typeof elevation !== "number") {
        throw new Error(`Elevation API unavailable (${body?.status ?? result.status})`);
      }
      return elevation;
    });
    return {elevation: value, note: null};
  } catch (error) {
    return {elevation: null, note: error instanceof Error ? error.message : "Elevation API unavailable"};
  }
}

export async function runDevRoofLookup(
  deps: LookupDeps,
  input: {address?: string | null; lat?: number | null; lng?: number | null; quality: SolarQuality},
): Promise<DevRoofLookupResult> {
  let location: {lat: number; lng: number};
  let formattedAddress: string | null = null;
  if (typeof input.lat === "number" && typeof input.lng === "number") {
    location = {lat: input.lat, lng: input.lng};
  } else if (input.address && input.address.trim().length > 3) {
    const geocoded = await geocodeAddress(deps, input.address);
    location = geocoded.location;
    formattedAddress = geocoded.formattedAddress;
  } else {
    throw new Error("Enter an address or a latitude and longitude");
  }
  const solar = await lookupSolar(deps, location, input.quality);
  const solarCenter = solar.value.status === "success"
    ? (solar.value.raw.center as {latitude?: number; longitude?: number} | undefined)
    : undefined;
  const elevationAt = solarCenter && typeof solarCenter.latitude === "number" && typeof solarCenter.longitude === "number"
    ? {lat: solarCenter.latitude, lng: solarCenter.longitude}
    : location;
  const elevation = solar.value.status === "success"
    ? await lookupGroundElevation(deps, elevationAt)
    : {elevation: null, note: null};
  return {
    location,
    formattedAddress,
    solar: solar.value.status === "success"
      ? {status: "success", raw: solar.value.raw, cached: solar.cached}
      : {status: "no_coverage", cached: solar.cached},
    groundElevationMeters: elevation.elevation,
    elevationNote: elevation.note,
  };
}

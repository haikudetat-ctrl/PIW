import {NextResponse} from "next/server";
import {defaultCacheDir, runDevRoofLookup, type SolarQuality} from "./lookup";

// Local development only: the measuring sandbox at
// /roof-estimate/dev-assessment/measure. Production builds run with
// NODE_ENV=production, so this route is a 404 on every deployment.

function notFound() {
  return NextResponse.json({error: "Not found"}, {status: 404});
}

const qualities: SolarQuality[] = ["HIGH", "MEDIUM", "LOW"];

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") return notFound();
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({error: "GOOGLE_MAPS_API_KEY is not set in .env.local"}, {status: 503});
  }
  const params = new URL(request.url).searchParams;
  const coordinate = (name: string) => {
    const value = params.get(name)?.trim();
    return value && Number.isFinite(Number(value)) ? Number(value) : null;
  };
  const quality = qualities.find((value) => value === params.get("quality")) ?? "HIGH";
  try {
    const result = await runDevRoofLookup(
      {apiKey, fetch, cacheDir: defaultCacheDir()},
      {
        address: params.get("address"),
        lat: coordinate("lat"),
        lng: coordinate("lng"),
        quality,
      },
    );
    return NextResponse.json(result, {headers: {"cache-control": "no-store"}});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lookup failed";
    return NextResponse.json({error: message.replace(apiKey, "[key]")}, {status: 502});
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildGoogleSatelliteUrl } from "@/modules/context-dialer/static-map";
import { resolvePreviewScope } from "@/modules/property-preview/request-scope";
import { resolvePublicHost } from "@/modules/tenancy/public-host";
import { createSupabasePublicHostLookup } from "@/modules/tenancy/supabase-public-host-lookup";

export const runtime = "nodejs";

const error = (message: string, status: number, headers: Record<string, string> = {}) =>
  NextResponse.json({error: message}, {status, headers: {"cache-control": "no-store", ...headers}});

export async function handlePreviewImageRequest(
  request: NextRequest,
  token: string,
  dependencies: {
    resolveCompany(host: string | null): Promise<string | null>;
    loadCoordinates(scope: {companyId: string; tokenHash: string}): Promise<{latitude: number; longitude: number} | null>;
    fetchSatellite(coordinates: {latitude: number; longitude: number}): Promise<Response | null>;
  },
) {
  const scope = await resolvePreviewScope(request.headers.get("host"), token, dependencies.resolveCompany);
  if (!scope) return error("Preview not found", 404);
  const coordinates = await dependencies.loadCoordinates(scope);
  if (!coordinates) return error("Property image unavailable", 404);

  const response = await dependencies.fetchSatellite(coordinates);
  if (!response?.ok) return error("Satellite image unavailable", 502, {"retry-after": "3"});
  return new NextResponse(await response.arrayBuffer(), {
    status: 200,
    headers: {
      "content-type": response.headers.get("content-type") ?? "image/jpeg",
      "cache-control": "private, max-age=3600",
    },
  });
}

export async function GET(request: NextRequest, {params}: {params: Promise<{token: string}>}) {
  const {token} = await params;
  const service = createServiceClient();
  const lookup = createSupabasePublicHostLookup(service);
  const apiKey = parseServerEnv(process.env).GOOGLE_MAPS_API_KEY;
  if (!apiKey) return error("Google Maps is not configured", 503);

  return handlePreviewImageRequest(request, token, {
    resolveCompany: async (host) => (await resolvePublicHost(host, lookup))?.companyId ?? null,
    async loadCoordinates({companyId, tokenHash}) {
      const {data} = await service
        .from("property_previews")
        .select("latitude, longitude, expires_at, status")
        .eq("company_id", companyId)
        .eq("token_hash", tokenHash)
        .in("status", ["active", "converted"])
        .maybeSingle();
      if (!data || data.latitude === null || data.longitude === null) return null;
      if (data.status === "active" && new Date(data.expires_at) <= new Date()) return null;
      return {latitude: data.latitude, longitude: data.longitude};
    },
    fetchSatellite: (coordinates) => fetch(
      buildGoogleSatelliteUrl({...coordinates, apiKey}),
      {signal: AbortSignal.timeout(10_000)},
    ).catch(() => null),
  });
}

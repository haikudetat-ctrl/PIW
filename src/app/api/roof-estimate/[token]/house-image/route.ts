import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildGoogleSatelliteUrl } from "@/modules/context-dialer/static-map";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!z.uuid().safeParse(token).success) {
    return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
  }

  const service = createServiceClient();
  const { data: estimate } = await service
    .from("roof_estimates")
    .select("company_id, property_id, roof_insight_id")
    .eq("public_token", token)
    .maybeSingle();
  if (!estimate) {
    return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
  }

  const [{ data: insight }, { data: address }] = await Promise.all([
    estimate.roof_insight_id
      ? service
          .from("roof_insights")
          .select("latitude, longitude")
          .eq("id", estimate.roof_insight_id)
          .eq("company_id", estimate.company_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    service
      .from("property_addresses")
      .select("latitude, longitude")
      .eq("company_id", estimate.company_id)
      .eq("property_id", estimate.property_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const latitude = Number(insight?.latitude ?? address?.latitude);
  const longitude = Number(insight?.longitude ?? address?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ error: "Property image unavailable" }, { status: 404 });
  }

  const environment = parseServerEnv(process.env);
  if (!environment.GOOGLE_MAPS_API_KEY) {
    return NextResponse.json({ error: "Google Maps is not configured" }, { status: 503 });
  }

  const response = await fetch(
    buildGoogleSatelliteUrl({
      latitude,
      longitude,
      apiKey: environment.GOOGLE_MAPS_API_KEY,
    }),
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) {
    return NextResponse.json({ error: "Satellite image unavailable" }, { status: 502 });
  }

  return new NextResponse(await response.arrayBuffer(), {
    status: 200,
    headers: {
      "content-type": response.headers.get("content-type") ?? "image/jpeg",
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}

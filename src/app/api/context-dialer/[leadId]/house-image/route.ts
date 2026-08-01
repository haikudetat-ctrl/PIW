import { NextResponse, type NextRequest } from "next/server";
import { parseServerEnv } from "@/lib/env/server";
import { createServerClient } from "@/lib/supabase/server";
import { buildGoogleSatelliteUrl } from "@/modules/context-dialer/static-map";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const { leadId } = await params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: lead } = await supabase
    .from("leads")
    .select("id, company_id, property_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead?.property_id) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const [{ data: insight }, { data: address }] = await Promise.all([
    supabase
      .from("roof_insights")
      .select("latitude, longitude")
      .eq("company_id", lead.company_id)
      .eq("property_id", lead.property_id)
      .order("source_retrieved_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("property_addresses")
      .select("latitude, longitude")
      .eq("company_id", lead.company_id)
      .eq("property_id", lead.property_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const latitude = Number(insight?.latitude ?? address?.latitude);
  const longitude = Number(insight?.longitude ?? address?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ error: "Validated coordinates unavailable" }, { status: 404 });
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
      "cache-control": "private, max-age=3600, stale-while-revalidate=86400",
    },
  });
}

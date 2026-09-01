import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildGoogleSatelliteUrl } from "@/modules/context-dialer/static-map";
import {
  resolveAssessmentJourneyScope,
  SupabaseAssessmentJourneyScopeRepository,
} from "@/modules/roof-assessment/analysis-telemetry";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const startedAt = Date.now();
  const requestId = request.headers.get("x-vercel-id");
  let correlation: string | undefined;
  const finish = (response: NextResponse, outcome: string) => {
    console.log(JSON.stringify({
      level: "info",
      message: "roof estimate image request completed",
      route: "/api/roof-estimate/[token]/house-image",
      requestId,
      ...(correlation ? {correlation} : {}),
      outcome,
      status: response.status,
      durationMs: Date.now() - startedAt,
    }));
    return response;
  };
  const errorResponse = (
    error: string,
    status: number,
    outcome: string,
    headers?: HeadersInit,
  ) => finish(NextResponse.json({error}, {
    status,
    headers: {"cache-control": "no-store", ...headers},
  }), outcome);

  const { token } = await params;
  if (!z.uuid().safeParse(token).success) {
    return errorResponse("Estimate not found", 404, "invalid_token");
  }

  const service = createServiceClient();
  const { data: estimate } = await service
    .from("roof_estimates")
    .select("company_id, property_id, roof_insight_id")
    .eq("public_token", token)
    .maybeSingle();
  if (!estimate) {
    return errorResponse("Estimate not found", 404, "estimate_not_found");
  }

  const signingSecret = process.env.ROOF_ASSESSMENT_SIGNING_SECRET;
  if (signingSecret) {
    const scope = await resolveAssessmentJourneyScope(
      token,
      new SupabaseAssessmentJourneyScopeRepository(service),
      signingSecret,
    );
    correlation = scope?.correlation;
  }

  const [{ data: insight }, { data: address }] = await Promise.all([
    estimate.roof_insight_id
      ? service
          .from("roof_insights")
          .select("latitude, longitude")
          .eq("id", estimate.roof_insight_id)
          .eq("company_id", estimate.company_id)
          .eq("property_id", estimate.property_id)
          .eq("lookup_status", "success")
          .not("latitude", "is", null)
          .not("longitude", "is", null)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    service
      .from("property_addresses")
      .select("latitude, longitude")
      .eq("company_id", estimate.company_id)
      .eq("property_id", estimate.property_id)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const insightHasCoordinates =
    insight?.latitude !== null && insight?.latitude !== undefined &&
    insight?.longitude !== null && insight?.longitude !== undefined;
  const coordinates = insightHasCoordinates ? insight : address;
  const latitudeValue = coordinates?.latitude;
  const longitudeValue = coordinates?.longitude;
  const latitude = latitudeValue === null || latitudeValue === undefined
    ? Number.NaN
    : Number(latitudeValue);
  const longitude = longitudeValue === null || longitudeValue === undefined
    ? Number.NaN
    : Number(longitudeValue);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return errorResponse("Property image unavailable", 404, "coordinates_pending", {
      "retry-after": "3",
    });
  }

  const environment = parseServerEnv(process.env);
  if (!environment.GOOGLE_MAPS_API_KEY) {
    return errorResponse("Google Maps is not configured", 503, "provider_not_configured");
  }

  const response = await fetch(buildGoogleSatelliteUrl({
    latitude,
    longitude,
    apiKey: environment.GOOGLE_MAPS_API_KEY,
  }), {signal: AbortSignal.timeout(10_000)}).catch(() => null);
  if (!response?.ok) {
    return errorResponse("Satellite image unavailable", 502, "provider_failed", {
      "retry-after": "3",
    });
  }

  return finish(new NextResponse(await response.arrayBuffer(), {
    status: 200,
    headers: {
      "content-type": response.headers.get("content-type") ?? "image/jpeg",
      "cache-control": "private, max-age=3600",
    },
  }), "ready");
}

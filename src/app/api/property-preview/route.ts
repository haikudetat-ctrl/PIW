import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { inngest } from "@/inngest/client";
import { fetchGooglePlaceDetails } from "@/modules/providers/adapters/google-places";
import {
  createPropertyPreview,
  type CreatePreviewInput,
  type CreatePreviewResult,
} from "@/modules/property-preview/create-preview";
import { PROPERTY_PREVIEW_DISCLOSURE_VERSION } from "@/modules/property-preview/disclosure";
import { issuePreviewToken } from "@/modules/property-preview/preview-token";
import {
  SupabasePropertyPreviewRepository,
  findVerifiedPublicHost,
} from "@/modules/property-preview/supabase-preview-repository";
import { verifyTurnstile } from "@/modules/property-preview/turnstile";
import { resolvePublicHost } from "@/modules/tenancy/public-host";
import { createSupabasePublicHostLookup } from "@/modules/tenancy/supabase-public-host-lookup";
import { readRoofEstimateAttribution, resolveRoofEstimateEntryContext } from "@/app/roof-estimate/form-data";

export const runtime = "nodejs";

// Address step for the PIW-hosted /roof-estimate form on a tenant host. The
// tenant comes from the host; the browser sends only the address and the
// Turnstile token.
const bodySchema = z.strictObject({
  address: z.string().trim().min(5).max(500),
  google_place_id: z.string().trim().min(1).max(300).nullable(),
  turnstile_token: z.string().min(1).max(2048),
});

const noStore = {"cache-control": "no-store"};
const json = (body: unknown, status: number) => NextResponse.json(body, {status, headers: noStore});

export async function handleDirectPreviewRequest(
  request: NextRequest,
  dependencies: {
    resolveCompany(host: string | null): Promise<string | null>;
    create(input: CreatePreviewInput): Promise<CreatePreviewResult>;
  },
) {
  const companyId = await dependencies.resolveCompany(request.headers.get("host"));
  if (!companyId) return json({error: "Not found"}, 404);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({error: "Invalid property preview request"}, 400);
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  if (!z.union([z.ipv4(), z.ipv6()]).safeParse(clientIp).success) return json({error: "Invalid request"}, 400);

  const referrer = request.headers.get("referer");
  const context = resolveRoofEstimateEntryContext(referrer, "for-every-season");
  // Advertising identifiers are attached only at conversion, with consent.
  const fromReferrer = readRoofEstimateAttribution(referrer);
  const attribution = {
    utm_source: fromReferrer.utm_source,
    utm_medium: fromReferrer.utm_medium,
    utm_campaign: fromReferrer.utm_campaign,
    utm_term: fromReferrer.utm_term,
    utm_content: fromReferrer.utm_content,
    fbclid: fromReferrer.fbclid,
  };

  let result: CreatePreviewResult;
  try {
    result = await dependencies.create({
      companyId,
      address: parsed.data.address,
      googlePlaceId: parsed.data.google_place_id,
      campaign: context.campaign,
      entryPoint: context.entryPoint,
      presentationKey: context.presentationKey,
      attribution,
      referrer,
      clientIp,
      userAgent: request.headers.get("user-agent")?.trim().slice(0, 1000) || "unknown",
      turnstileToken: parsed.data.turnstile_token,
    });
  } catch {
    return json({error: "unavailable"}, 503);
  }
  if (result.kind === "created") return json({previewUrl: result.previewUrl}, 201);
  if (result.kind === "challenge_failed") return json({error: "challenge_failed"}, 403);
  if (result.kind === "rate_limited") return json({error: "rate_limited"}, 429);
  return json({error: "unavailable"}, 503);
}

export async function POST(request: NextRequest) {
  let environment: ReturnType<typeof parseServerEnv>;
  try {
    environment = parseServerEnv(process.env);
  } catch {
    return json({error: "unavailable"}, 503);
  }
  const service = createServiceClient();
  const lookup = createSupabasePublicHostLookup(service);
  const {TURNSTILE_SECRET_KEY: turnstileSecret, GOOGLE_MAPS_API_KEY: mapsKey} = environment;
  return handleDirectPreviewRequest(request, {
    resolveCompany: async (host) => (await resolvePublicHost(host, lookup))?.companyId ?? null,
    create: (input) => createPropertyPreview(input, {
      enabled: environment.PROPERTY_PREVIEW_ENABLED && Boolean(turnstileSecret && mapsKey),
      disclosureVersion: PROPERTY_PREVIEW_DISCLOSURE_VERSION,
      verifyTurnstile: ({token, remoteIp}) => verifyTurnstile({
        token,
        remoteIp,
        secretKey: turnstileSecret ?? "",
        expectedHostnames: environment.TURNSTILE_ALLOWED_HOSTNAMES,
        expectedAction: "property_preview",
      }),
      issueToken: issuePreviewToken,
      resolveHost: (id) => findVerifiedPublicHost(service, id),
      repository: new SupabasePropertyPreviewRepository(service),
      fetchPlaceDetails: (place) => fetchGooglePlaceDetails({...place, apiKey: mapsKey ?? ""}),
      requestMeasurement: async (scope) => {
        await inngest.send({name: "property/preview_measurement_requested", data: scope});
      },
    }),
  });
}

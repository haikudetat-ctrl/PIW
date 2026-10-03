import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
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
import { allSeasonPropertyPreviewSchema } from "./schema";

export const runtime = "nodejs";

type PropertyPreviewRouteDependencies = {
  expectedSecret: string;
  companyId: string;
  create(input: CreatePreviewInput): Promise<CreatePreviewResult>;
};

function secretsMatch(actual: string, expected: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return actual.length > 0 && expected.length > 0 && timingSafeEqual(digest(actual), digest(expected));
}

function noStoreJson(body: unknown, status: number) {
  return NextResponse.json(body, {status, headers: {"cache-control": "no-store"}});
}

export async function handleAllSeasonPropertyPreviewRequest(
  request: NextRequest,
  dependencies: PropertyPreviewRouteDependencies,
) {
  if (!secretsMatch(request.headers.get("x-all-season-intake-secret") ?? "", dependencies.expectedSecret)) {
    return noStoreJson({error: "Unauthorized"}, 401);
  }

  const parsed = allSeasonPropertyPreviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({error: "Invalid property preview request"}, 400);
  const input = parsed.data;

  let result: CreatePreviewResult;
  try {
    result = await dependencies.create({
      companyId: dependencies.companyId,
      address: input.address,
      googlePlaceId: input.google_place_id,
      campaign: input.campaign,
      entryPoint: input.entry_point,
      presentationKey: input.presentation_key,
      attribution: input.attribution,
      referrer: input.referrer,
      clientIp: input.client_ip_address,
      userAgent: input.client_user_agent,
      turnstileToken: input.turnstile_token,
    });
  } catch {
    return noStoreJson({error: "unavailable"}, 503);
  }

  switch (result.kind) {
    case "created":
      return noStoreJson({previewUrl: result.previewUrl}, 201);
    case "challenge_failed":
      return noStoreJson({error: "challenge_failed"}, 403);
    case "rate_limited":
      return noStoreJson({error: "rate_limited"}, 429);
    case "disabled":
      return noStoreJson({error: "unavailable"}, 503);
  }
}

export async function POST(request: NextRequest) {
  let environment: ReturnType<typeof parseServerEnv>;
  try {
    environment = parseServerEnv(process.env);
  } catch {
    return noStoreJson({error: "unavailable"}, 503);
  }
  const {
    ALL_SEASON_INTAKE_SHARED_SECRET: expectedSecret,
    ALL_SEASON_INTAKE_COMPANY_ID: companyId,
    TURNSTILE_SECRET_KEY: turnstileSecret,
    GOOGLE_MAPS_API_KEY: mapsKey,
  } = environment;
  if (!expectedSecret || !companyId) return noStoreJson({error: "unavailable"}, 503);

  const service = createServiceClient();
  return handleAllSeasonPropertyPreviewRequest(request, {
    expectedSecret,
    companyId,
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

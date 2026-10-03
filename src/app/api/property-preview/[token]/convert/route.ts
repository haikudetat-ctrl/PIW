import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  createCampaignEstimateDependencies,
  processCampaignEstimate,
} from "@/app/api/integrations/all-season/campaign-estimate/route";
import type { AllSeasonCampaignEstimateInput } from "@/app/api/integrations/all-season/campaign-estimate/schema";
import { PRIVACY_COOKIE_NAME } from "@/modules/privacy/consent";
import {
  buildPreviewConversionInput,
  previewContactSchema,
  type ConvertiblePreview,
} from "@/modules/property-preview/convert-preview";
import { resolvePreviewScope } from "@/modules/property-preview/request-scope";
import { resolvePublicHost } from "@/modules/tenancy/public-host";
import { createSupabasePublicHostLookup } from "@/modules/tenancy/supabase-public-host-lookup";

export const runtime = "nodejs";

const noStore = {"cache-control": "no-store"};
const json = (body: unknown, status: number) => NextResponse.json(body, {status, headers: noStore});

type LoadedPreview = ConvertiblePreview & {status: string; expires_at: string};

export async function handlePreviewConversionRequest(
  request: NextRequest,
  token: string,
  dependencies: {
    companyId: string;
    resolveCompany(host: string | null): Promise<string | null>;
    loadPreview(scope: {companyId: string; tokenHash: string}): Promise<LoadedPreview | null>;
    advertisingAllowed(request: NextRequest): Promise<boolean>;
    process(input: AllSeasonCampaignEstimateInput): Promise<NextResponse>;
    finalize(input: {companyId: string; tokenHash: string; submissionId: string}): Promise<void>;
    now?: () => Date;
  },
) {
  const scope = await resolvePreviewScope(request.headers.get("host"), token, dependencies.resolveCompany);
  // The canonical intake is configured for one tenant; another tenant's host
  // must not reach it.
  if (!scope || scope.companyId !== dependencies.companyId) return json({error: "Preview not found"}, 404);

  const contact = previewContactSchema.safeParse(await request.json().catch(() => null));
  if (!contact.success) return json({error: "Invalid contact details"}, 400);

  const now = (dependencies.now ?? (() => new Date()))();
  const preview = await dependencies.loadPreview(scope);
  if (!preview || preview.status !== "active" || new Date(preview.expires_at) <= now) {
    return json({error: "Preview not found"}, 404);
  }

  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  if (!z.union([z.ipv4(), z.ipv6()]).safeParse(clientIp).success) return json({error: "Invalid request"}, 400);
  const userAgent = request.headers.get("user-agent")?.trim().slice(0, 1000) || "unknown";
  const advertising = await dependencies.advertisingAllowed(request).catch(() => false);

  const input = buildPreviewConversionInput({
    preview,
    contact: contact.data,
    clientIp,
    userAgent,
    advertisingCookies: advertising
      ? {fbp: request.cookies.get("_fbp")?.value ?? null, fbc: request.cookies.get("_fbc")?.value ?? null}
      : {fbp: null, fbc: null},
    now,
  });

  const response = await dependencies.process(input);
  if (response.status === 202) {
    try {
      await dependencies.finalize({...scope, submissionId: contact.data.submission_id});
    } catch (error) {
      // The lead is already accepted and delivered; only the preview's
      // bookkeeping failed, so the homeowner still continues to the price.
      console.error("property_preview_finalize_failed", {message: error instanceof Error ? error.message : "unknown"});
    }
  }
  return response;
}

export async function POST(request: NextRequest, {params}: {params: Promise<{token: string}>}) {
  const {token} = await params;
  let environment: ReturnType<typeof parseServerEnv>;
  try {
    environment = parseServerEnv(process.env);
  } catch {
    return json({error: "unavailable"}, 503);
  }
  // The tenant host rarely has the website's consent cookie; the token the
  // website forwarded when the preview was created is the fallback.
  let previewConsentToken: string | undefined;
  const intake = createCampaignEstimateDependencies(request, environment, {
    consentToken: (incoming) => incoming.cookies.get(PRIVACY_COOKIE_NAME)?.value ?? previewConsentToken,
  });
  if (!environment.PROPERTY_PREVIEW_ENABLED || !intake || !environment.ALL_SEASON_INTAKE_COMPANY_ID) {
    return json({error: "unavailable"}, 503);
  }

  const service = createServiceClient();
  const lookup = createSupabasePublicHostLookup(service);
  return handlePreviewConversionRequest(request, token, {
    companyId: environment.ALL_SEASON_INTAKE_COMPANY_ID,
    resolveCompany: async (host) => (await resolvePublicHost(host, lookup))?.companyId ?? null,
    async loadPreview({companyId, tokenHash}) {
      const {data, error} = await service
        .from("property_previews")
        .select("submitted_address, canonical_address, google_place_id, campaign, entry_point, presentation_key, attribution, referrer, status, expires_at, privacy_consent_token")
        .eq("company_id", companyId)
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error) throw new Error("Failed to load property preview");
      previewConsentToken = data?.privacy_consent_token ?? undefined;
      return data;
    },
    advertisingAllowed: async (incoming) =>
      (await intake.verifyAdvertisingConsent?.(incoming))?.preferences.advertising === true,
    process: (input) => processCampaignEstimate(request, input, intake),
    async finalize({companyId, tokenHash, submissionId}) {
      const {error} = await service.rpc("finalize_property_preview_conversion", {
        p_company_id: companyId,
        p_token_hash: tokenHash,
        p_submission_id: submissionId,
      });
      if (error) throw new Error("Failed to finalize property preview conversion");
    },
  });
}

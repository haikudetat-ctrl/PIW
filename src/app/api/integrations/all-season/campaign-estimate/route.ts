import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { parseServerEnv, resolveMetaTrackingConfiguration } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { inngest } from "@/inngest/client";
import { SupabaseMetaRepository, type ReservedMetaEvent } from "@/modules/marketing/meta-repository";
import {type VerifiedConsent} from "@/modules/privacy/consent";
import {
  requestHasGlobalPrivacyControl,
  resolveCurrentVerifiedConsent,
} from "@/modules/privacy/current-consent";
import {SupabasePrivacyConsentRepository} from "@/modules/privacy/consent-repository";
import {
  acceptAllSeasonCampaignEstimate,
  type AllSeasonCampaignEstimateLeadInput,
} from "@/modules/leads/accept-all-season-campaign-estimate";
import { signContinuation } from "@/modules/roof-assessment/continuation-token";
import {createPostConsentPrefetchComposition} from "@/modules/roof-assessment/post-consent-prefetch-composition";
import { startOrResumeRoofAssessment } from "@/modules/roof-assessment/start-or-resume";
import { SupabaseAssessmentIntakeRepository } from "@/modules/roof-assessment/supabase-assessment-intake-repository";
import {
  allSeasonCampaignEstimateSchema,
  type AllSeasonCampaignEstimateInput,
} from "./schema";

export {allSeasonCampaignEstimateSchema} from "./schema";
export type {AllSeasonCampaignEstimateInput} from "./schema";

export function toCampaignEstimateLeadInput(
  input: AllSeasonCampaignEstimateInput,
): AllSeasonCampaignEstimateLeadInput {
  return {
    submissionId: input.submission_id,
    campaign: input.campaign,
    presentationKey: input.presentation_key,
    entryPoint: input.entry_point,
    name: input.name,
    email: input.email,
    phone: input.phone,
    submittedAddress: input.address,
    googlePlaceId: input.google_place_id ?? undefined,
    clientIpAddress: input.client_ip_address,
    clientUserAgent: input.client_user_agent,
    submittedAt: input.submittedAt,
    disclosureVersion: input.disclosure_version,
    referrer: input.referrer,
    attribution: input.attribution,
  };
}

type CampaignEstimateDependencies = {
  expectedSecret: string;
  companyId?: string;
  metaTrackingEnabled?: boolean;
  accept: (
    payload: AllSeasonCampaignEstimateInput,
  ) => Promise<CampaignEstimateAcceptance>;
  findLeadId?: (submissionId: string) => Promise<string | null>;
  verifyAdvertisingConsent?: (request: NextRequest) => Promise<VerifiedConsent | null>;
  recordConsent?: (input: {
    leadId: string;
    companyId: string;
    consent: VerifiedConsent;
    occurredAt: string;
  }) => Promise<void>;
  reserveLead?: (input: {
    leadId: string;
    companyId: string;
    consentId: string;
    occurredAt: string;
  }) => Promise<ReservedMetaEvent | null>;
  requestDelivery?: (deliveryId: string) => Promise<void>;
  reportError?: (error: unknown) => void;
};

type CampaignEstimateAcceptance = Awaited<ReturnType<typeof acceptAllSeasonCampaignEstimate>> & {
  leadId?: string;
};

function secretsMatch(actual: string, expected: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return actual.length > 0 && expected.length > 0 && timingSafeEqual(digest(actual), digest(expected));
}

function noStoreJson(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {"cache-control": "no-store"},
  });
}

async function reserveMetaLeadAfterAcceptance({
  request,
  result,
  submissionId,
  dependencies,
}: {
  request: NextRequest;
  result: CampaignEstimateAcceptance;
  submissionId: string;
  dependencies: CampaignEstimateDependencies;
}) {
  if (
    result.kind !== "continue"
    || !dependencies.metaTrackingEnabled
    || !dependencies.companyId
    || !dependencies.verifyAdvertisingConsent
    || !dependencies.recordConsent
    || !dependencies.reserveLead
  ) return null;

  try {
    const leadId = result.leadId ?? await dependencies.findLeadId?.(submissionId);
    if (!leadId) return null;

    const consent = await dependencies.verifyAdvertisingConsent(request);
    if (!consent) return null;

    const occurredAt = new Date().toISOString();
    await dependencies.recordConsent({
      leadId,
      companyId: dependencies.companyId,
      consent,
      occurredAt,
    });
    if (!consent.preferences.advertising) return null;

    const reserved = await dependencies.reserveLead({
      leadId,
      companyId: dependencies.companyId,
      consentId: consent.consentId,
      occurredAt,
    });
    if (!reserved) return null;

    try {
      await dependencies.requestDelivery?.(reserved.deliveryId);
    } catch (error) {
      (dependencies.reportError ?? console.error)(error);
    }
    return reserved.envelope;
  } catch (error) {
    (dependencies.reportError ?? console.error)(error);
    return null;
  }
}

export async function handleAllSeasonCampaignEstimateRequest(
  request: NextRequest,
  dependencies: CampaignEstimateDependencies,
) {
  const providedSecret = request.headers.get("x-all-season-intake-secret") ?? "";
  if (!secretsMatch(providedSecret, dependencies.expectedSecret)) {
    return noStoreJson({error: "Unauthorized"}, 401);
  }

  const parsed = allSeasonCampaignEstimateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return noStoreJson({error: "Invalid campaign estimate submission"}, 400);
  }

  try {
    const result = await dependencies.accept(parsed.data);
    if (result.kind === "duplicate_requires_restart") {
      return noStoreJson(
        {error: "Please restart this estimate request.", retryable: true},
        409,
      );
    }
    const metaEvent = await reserveMetaLeadAfterAcceptance({
      request,
      result,
      submissionId: parsed.data.submission_id,
      dependencies,
    });
    return noStoreJson(
      {accepted: true, continuationPath: result.continuationPath, metaEvent},
      202,
    );
  } catch {
    return noStoreJson(
      { error: "Campaign estimate intake is temporarily unavailable" },
      503,
    );
  }
}

export async function POST(request: NextRequest) {
  let environment: ReturnType<typeof parseServerEnv>;
  try {
    environment = parseServerEnv(process.env);
  } catch {
    return noStoreJson(
      { error: "All Season campaign estimate intake is not configured" },
      503,
    );
  }
  if (
    !environment.ROOF_ASSESSMENT_ENABLED
    || !environment.ROOF_ASSESSMENT_SIGNING_SECRET
    || !environment.ALL_SEASON_INTAKE_SHARED_SECRET
    || !environment.ALL_SEASON_INTAKE_COMPANY_ID
  ) {
    return noStoreJson(
      { error: "All Season campaign estimate intake is not configured" },
      503,
    );
  }

  const service = createServiceClient();
  const repository = new SupabaseAssessmentIntakeRepository(service);
  const signingKey = environment.ROOF_ASSESSMENT_SIGNING_SECRET;
  const companyId = environment.ALL_SEASON_INTAKE_COMPANY_ID;
  const tracking = resolveMetaTrackingConfiguration(environment);
  const metaRepository = new SupabaseMetaRepository(service as never);
  const privacyRepository = new SupabasePrivacyConsentRepository(service as never);

  return handleAllSeasonCampaignEstimateRequest(request, {
    expectedSecret: environment.ALL_SEASON_INTAKE_SHARED_SECRET,
    companyId,
    metaTrackingEnabled: Boolean(tracking),
    findLeadId: async (submissionId) => {
      const {data, error} = await service
        .from("roof_assessment_access_attempts")
        .select("lead_id")
        .eq("company_id", companyId)
        .eq("submission_id", submissionId)
        .maybeSingle();
      if (error || !data?.lead_id) return null;
      return data.lead_id;
    },
    verifyAdvertisingConsent: async (incoming) =>
      resolveCurrentVerifiedConsent({
        consentToken: incoming.headers.get("x-piw-privacy-consent") ?? undefined,
        signingSecret: environment.PRIVACY_CONSENT_SIGNING_SECRET ?? "",
        gpcDetected: requestHasGlobalPrivacyControl(incoming.headers),
        now: () => new Date(),
        repository: privacyRepository,
      }),
    recordConsent: async ({leadId, companyId: consentCompanyId, consent, occurredAt}) => {
      const {error} = await service.rpc("record_privacy_consent", {
        p_evidence_id: crypto.randomUUID(),
        p_consent_id: consent.consentId,
        p_company_id: consentCompanyId,
        p_lead_id: leadId,
        p_policy_version: consent.policyVersion,
        p_analytics_granted: consent.preferences.analytics,
        p_advertising_granted: consent.preferences.advertising,
        p_gpc_detected: consent.gpcDetected,
        p_source: consent.gpcDetected ? "gpc" : "preferences",
        p_request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "",
        p_user_agent: request.headers.get("user-agent") ?? "",
        p_occurred_at: occurredAt,
      });
      if (error) throw new Error("Failed to record privacy consent evidence");
    },
    reserveLead: (input) => metaRepository.reserveLead(input),
    requestDelivery: async (deliveryId) => {
      await inngest.send({
        name: "marketing/meta.delivery.requested",
        data: {deliveryId},
      });
    },
    accept: async (payload) => {
      const composition = createPostConsentPrefetchComposition({
        environment,
        client: service,
        companyId,
        submissionId: payload.submission_id,
        googlePlaceId: payload.google_place_id ?? undefined,
        signingSecret: signingKey,
        testEnvironment: process.env,
      });
      const result = await acceptAllSeasonCampaignEstimate(toCampaignEstimateLeadInput(payload), {
        companyId,
        startAssessment: (input) => startOrResumeRoofAssessment(input, {
          repository,
          tokenIssuer: {
            issue: (capability) => signContinuation(capability, signingKey),
          },
          postConsentPrefetch: composition.postConsentPrefetch,
        }),
      });
      if (result.kind === "continue") composition.markAccepted();
      return result;
    },
  });
}

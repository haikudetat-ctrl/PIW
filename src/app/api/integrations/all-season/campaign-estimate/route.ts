import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
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
  accept: (
    payload: AllSeasonCampaignEstimateInput,
  ) => ReturnType<typeof acceptAllSeasonCampaignEstimate>;
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
    return noStoreJson(
      {accepted: true, continuationPath: result.continuationPath},
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

  return handleAllSeasonCampaignEstimateRequest(request, {
    expectedSecret: environment.ALL_SEASON_INTAKE_SHARED_SECRET,
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

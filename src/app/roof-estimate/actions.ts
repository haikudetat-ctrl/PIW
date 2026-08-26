"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { signContinuation } from "@/modules/roof-assessment/continuation-token";
import { startOrResumeRoofAssessment } from "@/modules/roof-assessment/start-or-resume";
import { SupabaseAssessmentIntakeRepository } from "@/modules/roof-assessment/supabase-assessment-intake-repository";
import {
  formatSubmittedAddress,
  parsePublicRoofEstimateFormData,
  readRoofEstimateAttribution,
  resolveRoofEstimateEntryContext,
} from "./form-data";

export type PublicRoofEstimateState = { error?: string };

async function resolveEstimateCompanyId(
  environment: ReturnType<typeof parseServerEnv>,
  service: ReturnType<typeof createServiceClient>,
) {
  if (environment.ROOF_ESTIMATE_COMPANY_ID) {
    return environment.ROOF_ESTIMATE_COMPANY_ID;
  }
  const { data, error } = await service.from("companies").select("id").limit(2);
  if (error || data?.length !== 1) {
    throw new Error("Roof estimate company is not configured");
  }
  return data[0].id;
}

export async function submitPublicRoofEstimate(
  _previousState: PublicRoofEstimateState,
  formData: FormData,
): Promise<PublicRoofEstimateState> {
  let input;
  try {
    input = parsePublicRoofEstimateFormData(formData);
  } catch {
    return { error: "Check the highlighted information and accept each consent item." };
  }

  try {
    const environment = parseServerEnv(process.env);
    const signingKey = environment.ROOF_ASSESSMENT_SIGNING_SECRET;
    if (!environment.ROOF_ASSESSMENT_ENABLED || !signingKey) {
      throw new Error("Roof assessment is not configured");
    }
    const service = createServiceClient();
    const companyId = await resolveEstimateCompanyId(environment, service);
    const requestHeaders = await headers();
    const ipAddress = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim()
      || requestHeaders.get("x-real-ip")?.trim();
    const userAgent = requestHeaders.get("user-agent")?.trim();
    if (!ipAddress || !userAgent) throw new Error("Request evidence is unavailable");
    const referrer = requestHeaders.get("referer");
    const context = resolveRoofEstimateEntryContext(referrer, input.campaign);
    const result = await startOrResumeRoofAssessment({
      submissionId: crypto.randomUUID(),
      companyId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      submittedAddress: formatSubmittedAddress(input),
      googlePlaceId: input.googlePlaceId,
      ...context,
      attribution: readRoofEstimateAttribution(referrer),
      referrer,
      consent: {
        disclosureVersion: "roof-estimate-v1",
        ipAddress,
        userAgent,
        grantedAt: new Date().toISOString(),
      },
    }, {
      repository: new SupabaseAssessmentIntakeRepository(service),
      tokenIssuer: {
        issue: (capability) => signContinuation(
          capability,
          signingKey,
        ),
      },
    });

    if (result.kind === "duplicate_requires_restart") {
      return {error: "Please refresh the page and restart your estimate request."};
    }
    redirect(result.continuationPath);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error("Roof estimate submission failed", {
      errorType: error instanceof Error ? error.name : "UnknownSubmissionError",
    });
    return { error: "We could not start the estimate right now. Please try again." };
  }
}

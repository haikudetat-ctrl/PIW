"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { signContinuation } from "@/modules/roof-assessment/continuation-token";
import { startOrResumeRoofAssessment } from "@/modules/roof-assessment/start-or-resume";
import { SupabaseAssessmentIntakeRepository } from "@/modules/roof-assessment/supabase-assessment-intake-repository";
import {
  executePublicRoofEstimateAction,
  type PublicRoofEstimateActionDependencies,
  type PublicRoofEstimateState,
} from "./submission";

export type {PublicRoofEstimateState} from "./submission";

async function resolveEstimateCompanyId(
  environment: ReturnType<typeof parseServerEnv>,
  service: ReturnType<typeof createServiceClient>,
) {
  if (environment.ROOF_ESTIMATE_COMPANY_ID) return environment.ROOF_ESTIMATE_COMPANY_ID;
  const {data, error} = await service.from("companies").select("id").limit(2);
  if (error || data?.length !== 1) throw new Error("Roof estimate company is not configured");
  return data[0].id;
}

const productionDependencies: PublicRoofEstimateActionDependencies = {
  async prepare() {
    const environment = parseServerEnv(process.env);
    const signingKey = environment.ROOF_ASSESSMENT_SIGNING_SECRET;
    if (!environment.ROOF_ASSESSMENT_ENABLED || !signingKey) {
      throw new Error("Roof assessment is not configured");
    }
    const service = createServiceClient();
    const companyId = await resolveEstimateCompanyId(environment, service);
    const repository = new SupabaseAssessmentIntakeRepository(service);
    return {
      companyId,
      startAssessment: (input) => startOrResumeRoofAssessment(input, {
        repository,
        tokenIssuer: {
          issue: (capability) => signContinuation(capability, signingKey),
        },
      }),
    };
  },
  requestHeaders: () => headers(),
  createSubmissionId: () => crypto.randomUUID(),
  now: () => new Date(),
  logFailure(errorType) {
    console.error("Roof estimate submission failed", {errorType});
  },
};

export async function submitPublicRoofEstimate(
  _previousState: PublicRoofEstimateState,
  formData: FormData,
): Promise<PublicRoofEstimateState> {
  return executePublicRoofEstimateAction(formData, productionDependencies, redirect);
}

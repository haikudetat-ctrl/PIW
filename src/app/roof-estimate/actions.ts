"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  ASSESSMENT_SESSION_COOKIE,
  setAssessmentSessionCookie,
} from "@/modules/roof-assessment/assessment-session";
import {
  authorizeAssessmentContinuation,
  createSupabaseContinuationAuthorizationDependencies,
} from "@/modules/roof-assessment/assessment-continuation";
import { signContinuation } from "@/modules/roof-assessment/continuation-token";
import { startOrResumeRoofAssessment } from "@/modules/roof-assessment/start-or-resume";
import { SupabaseAssessmentIntakeRepository } from "@/modules/roof-assessment/supabase-assessment-intake-repository";
import {
  createFakePlaceDetailsPrefetch,
  recordFakeAssessmentContext,
} from "@/modules/roof-assessment/testing/fake-place-details";
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
    const cookieStore = await cookies();
    const continuationDependencies = createSupabaseContinuationAuthorizationDependencies(
      service,
      signingKey,
    );
    return {
      companyId,
      startAssessment: (input) => {
        recordFakeAssessmentContext(process.env, input);
        return startOrResumeRoofAssessment(input, {
          repository,
          tokenIssuer: {
            issue: (capability) => signContinuation(capability, signingKey),
          },
          postConsentPrefetch: createFakePlaceDetailsPrefetch(process.env, service),
        });
      },
      authorizeContinuation: (continuation) => authorizeAssessmentContinuation(
        continuation,
        cookieStore.get(ASSESSMENT_SESSION_COOKIE)?.value,
        continuationDependencies,
      ),
      bindAssessmentSession: (assessmentId) => setAssessmentSessionCookie(
        cookieStore,
        assessmentId,
        signingKey,
        {nodeEnv: environment.NODE_ENV},
      ),
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

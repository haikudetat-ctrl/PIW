import type { StartAssessmentInput, StartAssessmentResult } from "@/modules/roof-assessment/start-or-resume";
import { StartAssessmentInternalError } from "@/modules/roof-assessment/start-or-resume";
import {
  formatSubmittedAddress,
  parsePublicRoofEstimateFormData,
  readRoofEstimateAttribution,
  resolveRoofEstimateEntryContext,
} from "./form-data";

export type PublicRoofEstimateState = {error?: string};

type HeaderSource = {
  get(name: string): string | null;
};

export type PublicRoofEstimateActionDependencies = {
  prepare: () => Promise<{
    companyId: string;
    startAssessment: (input: StartAssessmentInput) => Promise<StartAssessmentResult>;
  }>;
  requestHeaders: () => Promise<HeaderSource>;
  createSubmissionId: () => string;
  now: () => Date;
  logFailure: (errorType: string) => void;
};

type PublicRoofEstimateSubmissionOutcome =
  | {
      kind: "redirect";
      continuationPath: `/roof-estimate/continue/${string}`;
    }
  | {
      kind: "state";
      state: PublicRoofEstimateState;
    };

const CONTINUATION_PATH = /^\/roof-estimate\/continue\/[A-Za-z0-9_-]+$/;

export async function handlePublicRoofEstimateSubmission(
  formData: FormData,
  dependencies: PublicRoofEstimateActionDependencies,
): Promise<PublicRoofEstimateSubmissionOutcome> {
  let input;
  try {
    input = parsePublicRoofEstimateFormData(formData);
  } catch {
    return {
      kind: "state",
      state: {error: "Check the highlighted information and accept each consent item."},
    };
  }

  try {
    const runtime = await dependencies.prepare();
    const requestHeaders = await dependencies.requestHeaders();
    const ipAddress = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim()
      || requestHeaders.get("x-real-ip")?.trim();
    const userAgent = requestHeaders.get("user-agent")?.trim();
    if (!ipAddress || !userAgent) throw new StartAssessmentInternalError();

    const referrer = requestHeaders.get("referer");
    const context = resolveRoofEstimateEntryContext(referrer, input.campaign);
    const result = await runtime.startAssessment({
      submissionId: dependencies.createSubmissionId(),
      companyId: runtime.companyId,
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
        grantedAt: dependencies.now().toISOString(),
      },
    });

    if (result.kind === "duplicate_requires_restart") {
      return {
        kind: "state",
        state: {error: "Please refresh the page and restart your estimate request."},
      };
    }
    if (!CONTINUATION_PATH.test(result.continuationPath)) {
      throw new StartAssessmentInternalError();
    }
    return {kind: "redirect", continuationPath: result.continuationPath};
  } catch (error) {
    dependencies.logFailure(error instanceof Error ? error.name : "UnknownSubmissionError");
    return {
      kind: "state",
      state: {error: "We could not start the estimate right now. Please try again."},
    };
  }
}

export async function executePublicRoofEstimateAction(
  formData: FormData,
  dependencies: PublicRoofEstimateActionDependencies,
  navigate: (path: string) => never,
): Promise<PublicRoofEstimateState> {
  const outcome = await handlePublicRoofEstimateSubmission(formData, dependencies);
  if (outcome.kind === "state") return outcome.state;
  return navigate(outcome.continuationPath);
}

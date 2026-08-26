import { z } from "zod";
import {
  calculateProgressSignals,
  calculateRoofAssessment,
  ROOF_ASSESSMENT_VERSION,
  roofAssessmentProgressSchema,
  roofAssessmentQuestionSteps,
  roofAssessmentResponsesSchema,
  type RoofAssessmentRecommendation,
  type RoofAssessmentResponses,
  type RoofAssessmentScores,
  type RoofAssessmentProgressSignals,
} from "@/domain/roof-assessment";

export type PublicEstimateContext = {
  estimateId: string;
  companyId: string;
  leadId: string;
  campaign: string | null;
  address: string;
};

export type PersistedAssessment = {
  id: string;
  revision: number;
  status: "in_progress" | "abandoned" | "completed";
  currentStep: number;
  propertyRevealedAt: string | null;
  lastAnsweredAt: string | null;
  responses: Partial<RoofAssessmentResponses>;
  recommendation: RoofAssessmentRecommendation | null;
};

export type AssessmentProgressPatch = {
  companyId: string;
  expectedRevision: number;
  currentStep: number;
  propertyRevealedAt?: string;
  responsePatch: Partial<RoofAssessmentResponses>;
  expectedResponses: Partial<RoofAssessmentResponses>;
  signals: RoofAssessmentProgressSignals;
};

export type AssessmentCompletion = {
  companyId: string;
  expectedRevision: number;
  responsePatch: Partial<RoofAssessmentResponses>;
  responses: RoofAssessmentResponses;
  scores: RoofAssessmentScores;
  recommendation: RoofAssessmentRecommendation;
  assessmentVersion: typeof ROOF_ASSESSMENT_VERSION;
  completedAt: string;
  signals: RoofAssessmentProgressSignals;
};

export type PublicAssessmentRepository = {
  findEstimateByToken(token: string): Promise<PublicEstimateContext | null>;
  findOrCreateAssessment(context: PublicEstimateContext): Promise<PersistedAssessment>;
  saveProgress(
    assessmentId: string,
    patch: AssessmentProgressPatch,
  ): Promise<{assessment: PersistedAssessment; applied: boolean}>;
  complete(
    assessmentId: string,
    completion: AssessmentCompletion,
  ): Promise<{assessment: PersistedAssessment; applied: boolean}>;
};

export type PublicAssessmentState = {
  revision: number;
  status: "in_progress" | "abandoned" | "completed";
  currentStep: number;
  propertyRevealed: boolean;
  lastAnsweredAt: string | null;
  responses: Partial<RoofAssessmentResponses>;
  recommendation: RoofAssessmentRecommendation | null;
  campaign: string | null;
  address: string;
  imageUrl: string;
};

export class PublicAssessmentError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 503,
    readonly state?: PublicAssessmentState,
  ) {
    super(message);
  }
}

const progressInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  currentStep: z.number().int().min(0).max(9),
  propertyRevealed: z.boolean().optional(),
  responsePatch: roofAssessmentProgressSchema,
}).strict();

const completionInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  responsePatch: roofAssessmentProgressSchema,
}).strict();

function patchMatchesStep(
  currentStep: number,
  responsePatch: Partial<RoofAssessmentResponses>,
) {
  const expectedKeys = currentStep === 0
    ? []
    : [...(roofAssessmentQuestionSteps[currentStep - 1]?.responseKeys ?? [])];
  const actualKeys = Object.keys(responsePatch);
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key) => expectedKeys.includes(key as never));
}

async function resolveAssessment(
  token: string,
  repository: PublicAssessmentRepository,
) {
  const context = await repository.findEstimateByToken(token);
  if (!context) throw new PublicAssessmentError("Estimate not found", 404);
  const assessment = await repository.findOrCreateAssessment(context);
  return {context, assessment};
}

function publicState(
  token: string,
  context: PublicEstimateContext,
  assessment: PersistedAssessment,
): PublicAssessmentState {
  return {
    revision: assessment.revision,
    status: assessment.status,
    currentStep: assessment.currentStep,
    propertyRevealed: Boolean(assessment.propertyRevealedAt),
    lastAnsweredAt: assessment.lastAnsweredAt,
    responses: assessment.responses,
    recommendation: assessment.recommendation,
    campaign: context.campaign,
    address: context.address,
    imageUrl: `/api/roof-estimate/${token}/house-image`,
  };
}

export async function getPublicAssessment(
  token: string,
  repository: PublicAssessmentRepository,
) {
  const {context, assessment} = await resolveAssessment(token, repository);
  return publicState(token, context, assessment);
}

export async function savePublicAssessmentProgress(
  token: string,
  input: unknown,
  repository: PublicAssessmentRepository,
) {
  const parsed = progressInputSchema.safeParse(input);
  if (!parsed.success) throw new PublicAssessmentError("Invalid assessment progress", 400);
  if (!patchMatchesStep(parsed.data.currentStep, parsed.data.responsePatch)) {
    throw new PublicAssessmentError("Invalid assessment progress", 400);
  }
  const {context, assessment} = await resolveAssessment(token, repository);
  if (assessment.status !== "in_progress") {
    throw new PublicAssessmentError("Assessment is already complete", 409);
  }

  const responses = {...assessment.responses, ...parsed.data.responsePatch};

  const saved = await repository.saveProgress(assessment.id, {
    companyId: context.companyId,
    expectedRevision: parsed.data.expectedRevision,
    currentStep: parsed.data.currentStep,
    propertyRevealedAt: parsed.data.propertyRevealed
      ? assessment.propertyRevealedAt ?? new Date().toISOString()
      : undefined,
    responsePatch: parsed.data.responsePatch,
    expectedResponses: responses,
    signals: calculateProgressSignals(responses),
  });
  const state = publicState(token, context, saved.assessment);
  if (!saved.applied) {
    throw new PublicAssessmentError("Assessment was updated elsewhere", 409, state);
  }
  return state;
}

export async function completePublicAssessment(
  token: string,
  input: unknown,
  repository: PublicAssessmentRepository,
) {
  const parsed = completionInputSchema.safeParse(input);
  if (!parsed.success) throw new PublicAssessmentError("Invalid assessment responses", 400);
  if (!patchMatchesStep(roofAssessmentQuestionSteps.length, parsed.data.responsePatch)) {
    throw new PublicAssessmentError("Invalid assessment responses", 400);
  }
  const {context, assessment} = await resolveAssessment(token, repository);
  if (assessment.status === "completed") return publicState(token, context, assessment);

  const responses = roofAssessmentResponsesSchema.safeParse({
    ...assessment.responses,
    ...parsed.data.responsePatch,
  });
  if (!responses.success) throw new PublicAssessmentError("Invalid assessment responses", 400);

  const result = calculateRoofAssessment(responses.data);
  const signals = calculateProgressSignals(responses.data);
  const completed = await repository.complete(assessment.id, {
    companyId: context.companyId,
    expectedRevision: parsed.data.expectedRevision,
    responsePatch: parsed.data.responsePatch,
    responses: responses.data,
    scores: result.scores,
    recommendation: result.recommendation,
    assessmentVersion: ROOF_ASSESSMENT_VERSION,
    completedAt: new Date().toISOString(),
    signals,
  });
  const state = publicState(token, context, completed.assessment);
  if (!completed.applied) {
    throw new PublicAssessmentError("Assessment was updated elsewhere", 409, state);
  }
  return state;
}

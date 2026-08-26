import { z } from "zod";
import {
  calculateProgressSignals,
  calculateRoofAssessment,
  ROOF_ASSESSMENT_VERSION,
  roofAssessmentProgressSchema,
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
  status: "in_progress" | "abandoned" | "completed";
  currentStep: number;
  propertyRevealedAt: string | null;
  lastAnsweredAt: string | null;
  responses: Partial<RoofAssessmentResponses>;
  recommendation: RoofAssessmentRecommendation | null;
};

export type AssessmentProgressPatch = {
  companyId: string;
  currentStep: number;
  propertyRevealedAt?: string;
  responses: Partial<RoofAssessmentResponses>;
  signals: RoofAssessmentProgressSignals;
};

export type AssessmentCompletion = {
  companyId: string;
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
  ): Promise<PersistedAssessment>;
  complete(
    assessmentId: string,
    completion: AssessmentCompletion,
  ): Promise<PersistedAssessment>;
};

export type PublicAssessmentState = {
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
  ) {
    super(message);
  }
}

const progressInputSchema = z.object({
  currentStep: z.number().int().min(0).max(9),
  propertyRevealed: z.boolean().optional(),
  responses: roofAssessmentProgressSchema,
}).strict();

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
  const {context, assessment} = await resolveAssessment(token, repository);
  if (assessment.status !== "in_progress") {
    throw new PublicAssessmentError("Assessment is already complete", 409);
  }

  const responses = {...assessment.responses, ...parsed.data.responses};

  const saved = await repository.saveProgress(assessment.id, {
    companyId: context.companyId,
    currentStep: parsed.data.currentStep,
    propertyRevealedAt: parsed.data.propertyRevealed
      ? assessment.propertyRevealedAt ?? new Date().toISOString()
      : undefined,
    responses,
    signals: calculateProgressSignals(responses),
  });
  return publicState(token, context, saved);
}

export async function completePublicAssessment(
  token: string,
  input: unknown,
  repository: PublicAssessmentRepository,
) {
  const parsed = roofAssessmentResponsesSchema.safeParse(input);
  if (!parsed.success) throw new PublicAssessmentError("Invalid assessment responses", 400);
  const {context, assessment} = await resolveAssessment(token, repository);
  if (assessment.status === "completed") return publicState(token, context, assessment);

  const result = calculateRoofAssessment(parsed.data);
  const signals = calculateProgressSignals(parsed.data);
  const completed = await repository.complete(assessment.id, {
    companyId: context.companyId,
    responses: parsed.data,
    scores: result.scores,
    recommendation: result.recommendation,
    assessmentVersion: ROOF_ASSESSMENT_VERSION,
    completedAt: new Date().toISOString(),
    signals,
  });
  return publicState(token, context, completed);
}

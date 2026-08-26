import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import {
  roofAssessmentProgressSchema,
  type RoofAssessmentRecommendation,
} from "@/domain/roof-assessment";
import type {
  AssessmentCompletion,
  AssessmentProgressPatch,
  PersistedAssessment,
  PublicAssessmentRepository,
  PublicEstimateContext,
} from "./public-assessment";

type ServiceClient = ReturnType<typeof createServiceClient>;

const recommendationSchema = z.enum([
  "monitor_or_repair",
  "professional_inspection",
  "replacement_may_make_sense",
]);

function persistedAssessment(row: {
  id: string;
  status: string;
  revision: number;
  current_step: number;
  property_revealed_at: string | null;
  last_answered_at: string | null;
  responses: Json;
  recommendation: string | null;
}): PersistedAssessment {
  const responses = roofAssessmentProgressSchema.safeParse(row.responses);
  const recommendation = recommendationSchema.safeParse(row.recommendation);
  return {
    id: row.id,
    revision: row.revision,
    status: row.status === "completed"
      ? "completed"
      : row.status === "abandoned"
        ? "abandoned"
        : "in_progress",
    currentStep: row.current_step,
    propertyRevealedAt: row.property_revealed_at,
    lastAnsweredAt: row.last_answered_at,
    responses: responses.success ? responses.data : {},
    recommendation: recommendation.success
      ? recommendation.data as RoofAssessmentRecommendation
      : null,
  };
}

const assessmentSelection =
  "id, revision, status, current_step, property_revealed_at, last_answered_at, responses, recommendation";

export class SupabasePublicAssessmentRepository implements PublicAssessmentRepository {
  constructor(private readonly service: ServiceClient = createServiceClient()) {}

  async findEstimateByToken(token: string): Promise<PublicEstimateContext | null> {
    const {data: estimate, error} = await this.service
      .from("roof_estimates")
      .select("id, company_id, lead_id, property_id")
      .eq("public_token", token)
      .maybeSingle();
    if (error) throw error;
    if (!estimate) return null;

    const [{data: lead, error: leadError}, {data: property, error: propertyError}] =
      await Promise.all([
        this.service
          .from("leads")
          .select("campaign, submitted_address")
          .eq("id", estimate.lead_id)
          .eq("company_id", estimate.company_id)
          .maybeSingle(),
        this.service
          .from("properties")
          .select("canonical_address")
          .eq("id", estimate.property_id)
          .eq("company_id", estimate.company_id)
          .maybeSingle(),
      ]);
    if (leadError) throw leadError;
    if (propertyError) throw propertyError;

    return {
      estimateId: estimate.id,
      companyId: estimate.company_id,
      leadId: estimate.lead_id,
      campaign: lead?.campaign ?? null,
      address: property?.canonical_address ?? lead?.submitted_address ?? "your property",
    };
  }

  async findOrCreateAssessment(context: PublicEstimateContext) {
    const existing = await this.readAssessment(context.estimateId);
    if (existing) return existing;

    const {data, error} = await this.service
      .from("roof_assessments")
      .upsert({
        company_id: context.companyId,
        estimate_id: context.estimateId,
        lead_id: context.leadId,
      }, {onConflict: "estimate_id", ignoreDuplicates: true})
      .select(assessmentSelection)
      .maybeSingle();
    if (error) throw error;
    if (data) return persistedAssessment(data);

    const raced = await this.readAssessment(context.estimateId);
    if (!raced) throw new Error("Failed to create roof assessment");
    return raced;
  }

  async saveProgress(
    assessmentId: string,
    patch: AssessmentProgressPatch,
  ) {
    const {data, error} = await this.service.rpc("save_roof_assessment_progress", {
      p_company_id: patch.companyId,
      p_assessment_id: assessmentId,
      p_expected_revision: patch.expectedRevision,
      p_current_step: patch.currentStep,
      p_property_revealed_at: (patch.propertyRevealedAt ?? null) as never,
      p_response_patch: patch.responsePatch as Json,
      p_expected_responses: patch.expectedResponses as Json,
      p_scores: patch.signals.scores as unknown as Json,
      p_high_intent: patch.signals.highIntent,
    });
    if (error || !data || data.length !== 1) throw new Error("Assessment progress persistence failed");
    return {assessment: persistedAssessment(data[0]), applied: data[0].applied};
  }

  async complete(
    assessmentId: string,
    completion: AssessmentCompletion,
  ) {
    const {data, error} = await this.service.rpc("complete_roof_assessment", {
      p_company_id: completion.companyId,
      p_assessment_id: assessmentId,
      p_expected_revision: completion.expectedRevision,
      p_response_patch: completion.responsePatch as Json,
      p_expected_responses: completion.responses as Json,
      p_scores: completion.scores as unknown as Json,
      p_recommendation: completion.recommendation,
      p_high_intent: completion.signals.highIntent,
    });
    if (error || !data || data.length !== 1) throw new Error("Assessment completion persistence failed");
    return {assessment: persistedAssessment(data[0]), applied: data[0].applied};
  }

  private async readAssessment(estimateId: string) {
    const {data, error} = await this.service
      .from("roof_assessments")
      .select(assessmentSelection)
      .eq("estimate_id", estimateId)
      .maybeSingle();
    if (error) throw error;
    return data ? persistedAssessment(data) : null;
  }
}

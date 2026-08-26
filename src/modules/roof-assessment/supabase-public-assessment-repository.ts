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
  current_step: number;
  property_revealed_at: string | null;
  responses: Json;
  recommendation: string | null;
}): PersistedAssessment {
  const responses = roofAssessmentProgressSchema.safeParse(row.responses);
  const recommendation = recommendationSchema.safeParse(row.recommendation);
  return {
    id: row.id,
    status: row.status === "completed" ? "completed" : "in_progress",
    currentStep: row.current_step,
    propertyRevealedAt: row.property_revealed_at,
    responses: responses.success ? responses.data : {},
    recommendation: recommendation.success
      ? recommendation.data as RoofAssessmentRecommendation
      : null,
  };
}

const assessmentSelection =
  "id, status, current_step, property_revealed_at, responses, recommendation";

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

  async saveProgress(assessmentId: string, patch: AssessmentProgressPatch) {
    const update: {
      current_step: number;
      responses: Json;
      updated_at: string;
      property_revealed_at?: string;
    } = {
      current_step: patch.currentStep,
      responses: patch.responses as Json,
      updated_at: new Date().toISOString(),
    };
    if (patch.propertyRevealedAt) update.property_revealed_at = patch.propertyRevealedAt;

    const {data, error} = await this.service
      .from("roof_assessments")
      .update(update)
      .eq("id", assessmentId)
      .eq("status", "in_progress")
      .select(assessmentSelection)
      .single();
    if (error) throw error;
    return persistedAssessment(data);
  }

  async complete(assessmentId: string, completion: AssessmentCompletion) {
    const {data, error} = await this.service
      .from("roof_assessments")
      .update({
        status: "completed",
        current_step: 9,
        responses: completion.responses as Json,
        scores: completion.scores as Json,
        recommendation: completion.recommendation,
        assessment_version: completion.assessmentVersion,
        completed_at: completion.completedAt,
        updated_at: completion.completedAt,
      })
      .eq("id", assessmentId)
      .eq("status", "in_progress")
      .select(assessmentSelection)
      .single();
    if (error) throw error;
    return persistedAssessment(data);
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

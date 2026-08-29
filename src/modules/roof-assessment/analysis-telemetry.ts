import "server-only";
import {createHmac} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/lib/database.types";

export const assessmentAnalysisOutcomes = [
  "ready_at_8s",
  "ready_between_8s_12s",
  "pending_at_12s",
] as const;

export type AssessmentAnalysisOutcome = typeof assessmentAnalysisOutcomes[number];

type TokenScope = {
  assessmentId: string;
  companyId: string;
  estimateId: string;
};

export interface AssessmentJourneyScopeRepository {
  findTokenScope(token: string): Promise<TokenScope | null>;
  findOriginatingAttempt(scope: TokenScope): Promise<{submissionId: string} | null>;
}

export function createAssessmentJourneyCorrelation(submissionId: string, signingSecret: string) {
  return `raj_${createHmac("sha256", signingSecret).update(submissionId).digest("hex").slice(0, 32)}`;
}

export async function resolveAssessmentJourneyScope(
  token: string,
  repository: AssessmentJourneyScopeRepository,
  signingSecret: string,
) {
  const tokenScope = await repository.findTokenScope(token);
  if (!tokenScope) return null;
  const attempt = await repository.findOriginatingAttempt(tokenScope);
  if (!attempt) return null;
  return {
    correlation: createAssessmentJourneyCorrelation(attempt.submissionId, signingSecret),
  };
}

export class SupabaseAssessmentJourneyScopeRepository implements AssessmentJourneyScopeRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async findTokenScope(token: string): Promise<TokenScope | null> {
    const {data: estimate, error: estimateError} = await this.client
      .from("roof_estimates")
      .select("id, company_id")
      .eq("public_token", token)
      .maybeSingle();
    if (estimateError || !estimate) return null;
    const {data: assessment, error: assessmentError} = await this.client
      .from("roof_assessments")
      .select("id")
      .eq("company_id", estimate.company_id)
      .eq("estimate_id", estimate.id)
      .maybeSingle();
    if (assessmentError || !assessment) return null;
    return {
      assessmentId: assessment.id,
      companyId: estimate.company_id,
      estimateId: estimate.id,
    };
  }

  async findOriginatingAttempt(scope: TokenScope) {
    const {data, error} = await this.client
      .from("roof_assessment_access_attempts")
      .select("submission_id")
      .eq("company_id", scope.companyId)
      .eq("assessment_id", scope.assessmentId)
      .eq("estimate_id", scope.estimateId)
      .eq("attempt_kind", "new")
      .not("consumed_at", "is", null)
      .limit(2);
    if (error || data?.length !== 1) return null;
    return {submissionId: data[0].submission_id};
  }
}

export function buildAssessmentAnalysisLog(input: {
  correlation: string;
  durationMs: number;
  outcome: AssessmentAnalysisOutcome;
}) {
  return {
    level: "info" as const,
    event: "assessment_analysis_revealed" as const,
    correlation: input.correlation,
    outcome: input.outcome,
    durationMs: input.durationMs,
  };
}

export function buildAssessmentPrefetchPathLog(input: {
  correlation: string;
  outcome: "prefetch_candidate" | "async_manual" | "async_google_flag_off";
}) {
  return {
    level: "info" as const,
    event: "assessment_prefetch_path_selected" as const,
    correlation: input.correlation,
    outcome: input.outcome,
  };
}

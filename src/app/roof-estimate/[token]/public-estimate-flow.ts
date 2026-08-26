import {
  calculationStateSchema,
  type CalculationState,
  type RoofAssessmentRecommendation,
} from "@/domain/roof-assessment";

export function selectPublicEstimateView({
  assessmentEnabled,
  assessmentStatus,
}: {
  assessmentEnabled: boolean;
  assessmentStatus: "in_progress" | "abandoned" | "completed" | null;
}) {
  if (assessmentStatus === "abandoned") return "resume_required" as const;
  if (!assessmentEnabled) return "legacy" as const;
  return assessmentStatus === "completed" ? "result" as const : "assessment" as const;
}

const resultCopy: Record<RoofAssessmentRecommendation, {
  eyebrow: string;
  headline: string;
  body: string;
  cta: string;
}> = {
  monitor_or_repair: {
    eyebrow: "Your personalized RoofCheck",
    headline: "Replacement probably isn't your first move.",
    body: "Based on what you shared, a targeted repair or professional look may be the more sensible next step. This is guidance, not a remote diagnosis.",
    cta: "Have us take a look before you spend money",
  },
  professional_inspection: {
    eyebrow: "Your personalized RoofCheck",
    headline: "Worth having inspected.",
    body: "Your answers suggest enough uncertainty or wear to justify an on-site assessment before deciding between repair and replacement.",
    cta: "Get a professional roof assessment",
  },
  replacement_may_make_sense: {
    eyebrow: "Your personalized RoofCheck",
    headline: "Replacement may make economic sense.",
    body: "The age, condition, and priorities you shared make replacement worth pricing against continued repair. A field inspection is still needed to confirm the right scope.",
    cta: "Turn this range into an exact quote",
  },
};

export function getAssessmentResultCopy(recommendation: RoofAssessmentRecommendation) {
  return resultCopy[recommendation];
}

export function getAssessmentResultCta(
  recommendation: RoofAssessmentRecommendation,
  calculation: CalculationState,
) {
  if (recommendation === "replacement_may_make_sense" && calculation.status !== "ready") {
    return "Review my roof with a specialist";
  }
  return resultCopy[recommendation].cta;
}

export function getAssessmentCalculationState({
  estimateStatus,
  pipelineStatus,
  expectedCompanyId,
  expectedPropertyId,
  insight,
  lowCents,
  highCents,
  roofSquares,
  generatedAt,
}: {
  estimateStatus: string;
  pipelineStatus: string | null;
  expectedCompanyId: string;
  expectedPropertyId: string;
  insight: {id:string;companyId:string;propertyId:string;provider:string;lookupStatus:string}|null;
  lowCents: number | null;
  highCents: number | null;
  roofSquares: number | null;
  generatedAt: string;
}): CalculationState {
  const pipelineTerminal = pipelineStatus !== null && ["complete", "partial", "review_required", "failed"].includes(pipelineStatus);
  if (estimateStatus === "pending" && !pipelineTerminal) return {status: "pending"};
  if (estimateStatus === "review_required" || ["failed","partial","review_required"].includes(pipelineStatus ?? "")) {
    return {status: "review_required", reason: "low_confidence"};
  }

  const candidate = calculationStateSchema.safeParse({
    status: "ready",
    source: "google",
    lowCents,
    highCents,
    roofSquares,
    generatedAt,
  });
  const trustedInsight=insight!==null&&insight.companyId===expectedCompanyId&&insight.propertyId===expectedPropertyId&&insight.provider==="google_solar"&&insight.lookupStatus==="success";
  if (estimateStatus !== "ready" || pipelineStatus!=="complete" || !trustedInsight || !candidate.success || lowCents === null || lowCents <= 0) {
    return {status: "review_required", reason: "low_confidence"};
  }
  return candidate.data;
}

export function getAssessmentResultRange(state: CalculationState) {
  return state.status === "ready" ? state : null;
}

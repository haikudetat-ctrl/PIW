import type {RoofAssessmentRecommendation} from "@/domain/roof-assessment";

export function selectPublicEstimateView({
  assessmentEnabled,
  assessmentStatus,
}: {
  assessmentEnabled: boolean;
  assessmentStatus: "in_progress" | "completed" | null;
}) {
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

export function getAssessmentResultRange({
  ready,
  lowCents,
  highCents,
  roofSquares,
}: {
  ready: boolean;
  lowCents: number | null;
  highCents: number | null;
  roofSquares: number | null;
}) {
  if (!ready || lowCents === null || highCents === null || roofSquares === null) return null;
  return {
    lowCents,
    highCents,
    roofSquares,
    source: "google" as const,
  };
}

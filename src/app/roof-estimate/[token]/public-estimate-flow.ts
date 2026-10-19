import { z } from "zod";
import {
  calculationStateSchema,
  type CalculationState,
  type RoofAssessmentRecommendation,
} from "@/domain/roof-assessment";

export function selectPublicEstimateView({
  assessmentEnabled,
  assessmentStatus,
  priceFirst = false,
  refineRequested = false,
}: {
  assessmentEnabled: boolean;
  assessmentStatus: "in_progress" | "abandoned" | "completed" | null;
  // Leads that came through a value-first preview already answered the
  // questions that matter before contact, so they see their price first and
  // the remaining questions only when they ask to refine it.
  priceFirst?: boolean;
  refineRequested?: boolean;
}) {
  if (assessmentStatus === "abandoned") return "resume_required" as const;
  if (!assessmentEnabled) return "legacy" as const;
  if (assessmentStatus === "completed") return "result" as const;
  return priceFirst && !refineRequested ? "price_first" as const : "assessment" as const;
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
  pricingVersion,
  packages,
  adjustments,
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
  pricingVersion?: string | null;
  packages?: unknown;
  adjustments?: unknown;
}): CalculationState {
  const pipelineTerminal = pipelineStatus !== null && ["complete", "partial", "review_required", "failed"].includes(pipelineStatus);
  if (estimateStatus === "pending" && !pipelineTerminal) return {status: "pending"};
  if (estimateStatus === "review_required" || ["failed","partial","review_required"].includes(pipelineStatus ?? "")) {
    return {status: "review_required", reason: "low_confidence"};
  }

  const databaseTimestamp = z.iso.datetime({offset: true}).safeParse(generatedAt);
  const normalizedGeneratedAt = databaseTimestamp.success
    ? new Date(databaseTimestamp.data).toISOString()
    : generatedAt;
  const packageFields=Array.isArray(packages) && packages.length > 0
    ? {pricingVersion,packages,adjustments:adjustments ?? []}
    : {};
  const candidate = calculationStateSchema.safeParse({
    status: "ready",
    source: "google",
    lowCents,
    highCents,
    roofSquares,
    generatedAt: normalizedGeneratedAt,
    ...packageFields,
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

/** Package rows as selected with an estimate (`roof_estimate_packages(...)`). */
export type EstimatePackageRow = {
  tier_key: string;
  display_order: number;
  measured_roof_squares: number | string;
  low_cents_per_square: number;
  high_cents_per_square: number;
  range_low_cents: number;
  range_high_cents: number;
  customer_name: string;
  customer_description: string;
  warranty_summary: string;
  differentiators: unknown;
  pricing_version: string;
  calculated_at: string;
  manufacturer_name: string | null;
  product_line_name: string | null;
};

export function toPublicPackages(rows: readonly EstimatePackageRow[] | null | undefined) {
  return (rows ?? []).map((item) => ({
    tierKey: item.tier_key,
    displayOrder: item.display_order,
    customerName: item.customer_name,
    customerDescription: item.customer_description,
    warrantySummary: item.warranty_summary,
    differentiators: item.differentiators,
    lowCentsPerSquare: item.low_cents_per_square,
    highCentsPerSquare: item.high_cents_per_square,
    manufacturerName: item.manufacturer_name,
    productLineName: item.product_line_name,
    recommended: item.tier_key === "better",
    measuredRoofSquares: Number(item.measured_roof_squares),
    rangeLowCents: item.range_low_cents,
    rangeHighCents: item.range_high_cents,
    pricingVersion: item.pricing_version,
    generatedAt: item.calculated_at,
  }));
}

export type QuietEstimateState =
  | {kind: "ready"; lowCents: number; highCents: number; roofSquares: number}
  | {kind: "review"}
  | {kind: "received"};

const TERMINAL_PIPELINE_STATUSES = ["complete", "partial", "review_required", "failed"];

/**
 * The price-first result: still pricing, a price, a specialist review, or a
 * request with no instant range. Shared by the estimate page and the quote chat.
 */
export function quietEstimateState({estimateStatus, pipelineStatus, calculation}: {
  estimateStatus: string;
  pipelineStatus: string | null;
  calculation: CalculationState;
}): {pending: boolean; state: QuietEstimateState} {
  const pipelineTerminal = pipelineStatus !== null && TERMINAL_PIPELINE_STATUSES.includes(pipelineStatus);
  const pending = estimateStatus === "pending" && !pipelineTerminal;
  const manualReview = estimateStatus === "review_required"
    || (estimateStatus === "pending" && pipelineStatus === "review_required");
  if (manualReview) return {pending, state: {kind: "review"}};
  if (calculation.status === "ready") {
    return {
      pending,
      state: {kind: "ready", lowCents: calculation.lowCents, highCents: calculation.highCents, roofSquares: calculation.roofSquares},
    };
  }
  return {pending, state: {kind: "received"}};
}

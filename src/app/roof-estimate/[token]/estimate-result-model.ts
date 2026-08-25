import {
  resolveCampaignTheme,
  type CampaignTheme,
} from "@/../shared/all-season-campaign-themes";

export type EstimateResultState =
  | "processing"
  | "manual-review"
  | "ready"
  | "unavailable";

export type EstimateResultInput = {
  estimate: {
    status: string;
    range_low_cents: number | null;
    range_high_cents: number | null;
    roof_squares: number | null;
  };
  pipelineStatus: string | null | undefined;
  canonicalAddress: string | null | undefined;
  submittedAddress: string | null | undefined;
  campaign: string | null | undefined;
};

export type EstimateResultCopy = {
  eyebrow: string;
  headline: string;
  description: string;
};

export type EstimateResultModel = {
  state: EstimateResultState;
  copy: EstimateResultCopy;
  theme: CampaignTheme;
  address: string;
  rangeLowCents: number | null;
  rangeHighCents: number | null;
  roofSquares: number | null;
};

const stateCopy: Record<EstimateResultState, EstimateResultCopy> = {
  processing: {
    eyebrow: "Measurement in progress",
    headline: "Your roof is being measured.",
    description: "Keep your phone close. Our team may call while Google prepares the measurement.",
  },
  "manual-review": {
    eyebrow: "Professional review",
    headline: "We are checking the property match.",
    description:
      "Google did not return a measurement we trust enough to price automatically. Your request is saved for a roofing professional.",
  },
  ready: {
    eyebrow: "Preliminary roof estimate",
    headline: "Your range is ready.",
    description:
      "Based on your roof measurement and current New Jersey architectural-shingle averages.",
  },
  unavailable: {
    eyebrow: "Request received",
    headline: "Your request is with our team.",
    description:
      "We could not create a reliable instant range. A roofing professional can review the property and follow up.",
  },
};

export function buildEstimateResultModel(input: EstimateResultInput): EstimateResultModel {
  const terminal = ["complete", "partial", "review_required", "failed"].includes(
    input.pipelineStatus ?? "",
  );
  const ready =
    input.estimate.status === "ready" &&
    input.estimate.range_low_cents !== null &&
    input.estimate.range_high_cents !== null;
  const manualReview =
    input.estimate.status === "review_required" ||
    (input.estimate.status === "pending" && input.pipelineStatus === "review_required");
  const state: EstimateResultState = ready
    ? "ready"
    : manualReview
      ? "manual-review"
      : input.estimate.status === "pending" && !terminal
        ? "processing"
        : "unavailable";

  return {
    state,
    copy: stateCopy[state],
    theme: resolveCampaignTheme(input.campaign),
    address: input.canonicalAddress ?? input.submittedAddress ?? "your property",
    rangeLowCents: input.estimate.range_low_cents,
    rangeHighCents: input.estimate.range_high_cents,
    roofSquares: input.estimate.roof_squares === null ? null : Number(input.estimate.roof_squares),
  };
}

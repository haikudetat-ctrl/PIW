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

export type EstimateResultModel = {
  state: EstimateResultState;
  theme: CampaignTheme;
  address: string;
  rangeLowCents: number | null;
  rangeHighCents: number | null;
  roofSquares: number | null;
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
  const state = ready
    ? "ready"
    : manualReview
      ? "manual-review"
      : input.estimate.status === "pending" && !terminal
        ? "processing"
        : "unavailable";

  return {
    state,
    theme: resolveCampaignTheme(input.campaign),
    address: input.canonicalAddress ?? input.submittedAddress ?? "your property",
    rangeLowCents: input.estimate.range_low_cents,
    rangeHighCents: input.estimate.range_high_cents,
    roofSquares: input.estimate.roof_squares === null ? null : Number(input.estimate.roof_squares),
  };
}

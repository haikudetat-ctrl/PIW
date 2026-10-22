import type {QuietEstimateState} from "@/app/roof-estimate/[token]/public-estimate-flow";

/** GET /api/roof-estimate/[token]/summary */
export type ChatEstimateSummary = {
  /** Still pricing; ask again shortly. */
  pending: boolean;
  state: QuietEstimateState;
  address: string;
};

/** When the homeowner would like a callback. */
export const callWindows = ["asap", "morning", "afternoon", "evening"] as const;
export type CallWindow = typeof callWindows[number];

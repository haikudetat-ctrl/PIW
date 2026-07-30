export type ReviewAction = "resolve" | "reject" | "retry" | "unsupported";

type ReviewResolution = {
  newStatus: "resolved" | "rejected" | "retried" | "unsupported";
  pipelineRunId: string;
  propertyId: string;
  nextAttempt: number | null;
};

type ReviewActionInput = {
  companyId: string;
  reviewTaskId: string;
  adminId: string;
  action: ReviewAction;
  selectedCandidateIndex: number | null;
  notes: string | null;
};

export type ReviewActionDependencies = {
  resolveTask(input: ReviewActionInput): Promise<ReviewResolution>;
};

// The database RPC owns the transition, audit, and retry outbox transaction.
// Keeping the application boundary to one call prevents a committed task state
// from depending on later best-effort server work.
export async function applyReviewActionCore(
  input: ReviewActionInput,
  dependencies: ReviewActionDependencies,
): Promise<ReviewResolution> {
  return dependencies.resolveTask(input);
}

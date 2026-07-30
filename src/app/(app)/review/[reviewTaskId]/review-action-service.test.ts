import { expect, test, vi } from "vitest";
import {
  applyReviewActionCore,
  type ReviewActionDependencies,
} from "./review-action-service";

const input = {
  companyId: "00000000-0000-4000-8000-000000000001",
  reviewTaskId: "10000000-0000-4000-8000-000000000001",
  adminId: "20000000-0000-4000-8000-000000000001",
  action: "retry" as const,
  selectedCandidateIndex: null,
  notes: "retry atomically",
};

test("delegates the complete durable review action to one atomic resolver", async () => {
  const resolution = {
    newStatus: "retried" as const,
    pipelineRunId: "30000000-0000-4000-8000-000000000001",
    propertyId: "40000000-0000-4000-8000-000000000001",
    nextAttempt: 2,
  };
  const dependencies: ReviewActionDependencies = {
    resolveTask: vi.fn(async () => resolution),
  };

  await expect(applyReviewActionCore(input, dependencies)).resolves.toEqual(
    resolution,
  );
  expect(dependencies.resolveTask).toHaveBeenCalledOnce();
  expect(dependencies.resolveTask).toHaveBeenCalledWith(input);
});

import { describe, expect, test, vi } from "vitest";
import {
  applyReviewActionCore,
  auditActionFor,
  type ReviewActionDependencies,
} from "./review-action-service";

const baseInput = {
  companyId: "00000000-0000-4000-8000-000000000001",
  reviewTaskId: "10000000-0000-4000-8000-000000000001",
  adminId: "20000000-0000-4000-8000-000000000001",
  selectedCandidateIndex: null,
  notes: null,
} as const;

function createDependencies(
  overrides: Partial<ReviewActionDependencies> = {},
): ReviewActionDependencies {
  return {
    resolveTask: vi.fn(async () => ({
      newStatus: "resolved" as const,
      pipelineRunId: "30000000-0000-4000-8000-000000000001",
      propertyId: "40000000-0000-4000-8000-000000000001",
      nextAttempt: null,
    })),
    writeAudit: vi.fn(async () => undefined),
    loadRetryContext: vi.fn(async () => {
      throw new Error("Retry context should not be loaded");
    }),
    enqueueRetry: vi.fn(async () => undefined),
    ...overrides,
  };
}

test.each([
  ["resolve", "review.task_resolved"],
  ["reject", "review.task_rejected"],
  ["retry", "review.task_retried"],
  ["unsupported", "review.task_unsupported"],
] as const)("maps %s to the exact review audit action", (action, expected) => {
  expect(auditActionFor(action)).toBe(expected);
});

test("non-retry actions resolve and audit without publishing an event", async () => {
  const dependencies = createDependencies();

  await applyReviewActionCore(
    { ...baseInput, action: "reject" },
    dependencies,
  );

  expect(dependencies.writeAudit).toHaveBeenCalledWith({
    companyId: baseInput.companyId,
    actorId: baseInput.adminId,
    action: "review.task_rejected",
    entityType: "review_task",
    entityId: baseInput.reviewTaskId,
    metadata: { action: "reject" },
  });
  expect(dependencies.loadRetryContext).not.toHaveBeenCalled();
  expect(dependencies.enqueueRetry).not.toHaveBeenCalled();
});

describe("retry event reconstruction", () => {
  test("address validation retry republishes the submitted address at the returned attempt", async () => {
    const dependencies = createDependencies({
      resolveTask: vi.fn(async () => ({
        newStatus: "retried" as const,
        pipelineRunId: "30000000-0000-4000-8000-000000000001",
        propertyId: "40000000-0000-4000-8000-000000000001",
        nextAttempt: 2,
      })),
      loadRetryContext: vi.fn(async () => ({
        triggeringEventName:
          "property/address.validation_requested" as const,
        pipelineRunId: "30000000-0000-4000-8000-000000000001",
        correlationId: "50000000-0000-4000-8000-000000000001",
        leadId: "60000000-0000-4000-8000-000000000001",
        propertyId: "40000000-0000-4000-8000-000000000001",
        submittedAddress: "12 Birch Street, Trenton, NJ",
        canonicalAddress: null,
        latitude: null,
        longitude: null,
      })),
    });

    await applyReviewActionCore(
      { ...baseInput, action: "retry" },
      dependencies,
    );

    expect(dependencies.enqueueRetry).toHaveBeenCalledWith(
      baseInput.companyId,
      expect.objectContaining({
        name: "property/address.validation_requested",
        idempotencyKey:
          "property/address.validation_requested:30000000-0000-4000-8000-000000000001:2",
        data: {
          leadId: "60000000-0000-4000-8000-000000000001",
          propertyId: "40000000-0000-4000-8000-000000000001",
          submittedAddress: "12 Birch Street, Trenton, NJ",
          attempt: 2,
        },
      }),
    );
  });

  test("property discovery retry republishes the latest canonical location", async () => {
    const dependencies = createDependencies({
      resolveTask: vi.fn(async () => ({
        newStatus: "retried" as const,
        pipelineRunId: "30000000-0000-4000-8000-000000000001",
        propertyId: "40000000-0000-4000-8000-000000000001",
        nextAttempt: 3,
      })),
      loadRetryContext: vi.fn(async () => ({
        triggeringEventName: "property/discovery_requested" as const,
        pipelineRunId: "30000000-0000-4000-8000-000000000001",
        correlationId: "50000000-0000-4000-8000-000000000001",
        leadId: "60000000-0000-4000-8000-000000000001",
        propertyId: "40000000-0000-4000-8000-000000000001",
        submittedAddress: "12 Birch Street, Trenton, NJ",
        canonicalAddress: "12 Birch St, Trenton, NJ 08608",
        latitude: 40.2206,
        longitude: -74.7699,
      })),
    });

    await applyReviewActionCore(
      { ...baseInput, action: "retry" },
      dependencies,
    );

    expect(dependencies.enqueueRetry).toHaveBeenCalledWith(
      baseInput.companyId,
      expect.objectContaining({
        name: "property/discovery_requested",
        idempotencyKey:
          "property/discovery_requested:30000000-0000-4000-8000-000000000001:3",
        data: {
          leadId: "60000000-0000-4000-8000-000000000001",
          propertyId: "40000000-0000-4000-8000-000000000001",
          canonicalAddress: "12 Birch St, Trenton, NJ 08608",
          latitude: 40.2206,
          longitude: -74.7699,
          attempt: 3,
        },
      }),
    );
  });
});

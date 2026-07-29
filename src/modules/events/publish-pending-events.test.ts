import { expect, test, vi } from "vitest";
import { publishPendingEvents } from "./publish-pending-events";

test("publishes claimed events and acknowledges only successes", async () => {
  const event = {
    id: "44444444-4444-4444-8444-444444444444",
    name: "system/diagnostic.requested" as const,
    schemaVersion: 1 as const,
    correlationId: "11111111-1111-4111-8111-111111111111",
    pipelineRunId: "22222222-2222-4222-8222-222222222222",
    occurredAt: "2026-07-29T12:00:00.000Z",
    idempotencyKey: "system/diagnostic.requested:22222222-2222-4222-8222-222222222222",
    data: { requestedBy: "33333333-3333-4333-8333-333333333333" },
  };
  const repository = {
    claimBatch: vi.fn().mockResolvedValue([{ event, attemptCount: 0 }]),
    markPublished: vi.fn(),
    markFailed: vi.fn(),
    enqueue: vi.fn(),
  };
  const send = vi.fn().mockResolvedValue(undefined);

  await publishPendingEvents({ repository, send, claimedBy: "test-worker" });

  expect(send).toHaveBeenCalledWith({ name: event.name, data: event });
  expect(repository.markPublished).toHaveBeenCalledWith(event.id);
  expect(repository.markFailed).not.toHaveBeenCalled();
});

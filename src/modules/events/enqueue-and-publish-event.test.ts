import { expect, test, vi } from "vitest";
import { createEventEnvelope, type DomainEvent } from "@/domain/events";
import type { OutboxRepository, PendingOutboxEvent } from "./outbox-repository";
import { enqueueAndPublishEvent } from "./enqueue-and-publish-event";

const companyId = "00000000-0000-4000-8000-000000000001";
const event = createEventEnvelope({
  name: "system/diagnostic.requested",
  correlationId: "11111111-1111-4111-8111-111111111111",
  pipelineRunId: "22222222-2222-4222-8222-222222222222",
  data: { requestedBy: "33333333-3333-4333-8333-333333333333" },
  id: "44444444-4444-4444-8444-444444444444",
});

function makeRepository() {
  const pending = new Map<string, DomainEvent>();
  const repository: OutboxRepository = {
    enqueue: vi.fn(async (queuedEvent) => {
      pending.set(queuedEvent.id, queuedEvent);
      return queuedEvent.id;
    }),
    claimBatch: vi.fn(async (): Promise<PendingOutboxEvent[]> => []),
    markPublished: vi.fn(async (eventId) => {
      pending.delete(eventId);
    }),
    markFailed: vi.fn(async () => undefined),
  };
  return { pending, repository };
}

test("persists before immediate publish and acknowledges successful delivery", async () => {
  const { pending, repository } = makeRepository();
  const order: string[] = [];
  vi.mocked(repository.enqueue).mockImplementation(async (queuedEvent) => {
    order.push("enqueue");
    pending.set(queuedEvent.id, queuedEvent);
    return queuedEvent.id;
  });
  const send = vi.fn(async () => {
    order.push("send");
    expect(pending.has(event.id)).toBe(true);
  });
  vi.mocked(repository.markPublished).mockImplementation(async (eventId) => {
    order.push("mark-published");
    pending.delete(eventId);
  });
  const info = vi.fn();

  const result = await enqueueAndPublishEvent({
    repository,
    event,
    companyId,
    send,
    info,
  });

  expect(result).toEqual({ publishedImmediately: true });
  expect(order).toEqual(["enqueue", "send", "mark-published"]);
  expect(send).toHaveBeenCalledWith({ name: event.name, data: event });
  expect(info).toHaveBeenCalledWith("Immediate event publish completed", {
    eventId: event.id,
    eventName: event.name,
  });
  expect(pending.has(event.id)).toBe(false);
});

test("publishes and acknowledges the original persisted ID on idempotent replay", async () => {
  const { repository } = makeRepository();
  const persistedId = "55555555-5555-4555-8555-555555555555";
  vi.mocked(repository.enqueue).mockResolvedValue(persistedId);
  const send = vi.fn(async () => undefined);

  const result = await enqueueAndPublishEvent({
    repository,
    event,
    companyId,
    send,
  });

  expect(result).toEqual({ publishedImmediately: true });
  expect(send).toHaveBeenCalledWith({
    name: event.name,
    data: { ...event, id: persistedId },
  });
  expect(repository.markPublished).toHaveBeenCalledWith(persistedId);
});

test("publishes an atomically persisted event without enqueueing it again", async () => {
  const { repository } = makeRepository();
  const send = vi.fn(async () => undefined);

  const result = await enqueueAndPublishEvent({
    repository,
    event,
    companyId,
    send,
    eventAlreadyPersisted: true,
  });

  expect(result).toEqual({ publishedImmediately: true });
  expect(repository.enqueue).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledWith({ name: event.name, data: event });
  expect(repository.markPublished).toHaveBeenCalledWith(event.id);
});

test("keeps the durable row pending when immediate delivery fails", async () => {
  const { pending, repository } = makeRepository();
  const warn = vi.fn();

  const result = await enqueueAndPublishEvent({
    repository,
    event,
    companyId,
    send: vi.fn().mockRejectedValue(new Error("Inngest unavailable")),
    warn,
  });

  expect(result).toEqual({ publishedImmediately: false });
  expect(repository.markPublished).not.toHaveBeenCalled();
  expect(repository.markFailed).not.toHaveBeenCalled();
  expect(pending.has(event.id)).toBe(true);
  expect(warn).toHaveBeenCalledWith(
    "Immediate event publish failed; durable outbox fallback retained",
    expect.objectContaining({ eventId: event.id, eventName: event.name }),
  );
});

test("keeps the durable row recoverable when acknowledgement fails after send", async () => {
  const { pending, repository } = makeRepository();
  vi.mocked(repository.markPublished).mockRejectedValue(new Error("database unavailable"));
  const send = vi.fn(async () => undefined);

  const result = await enqueueAndPublishEvent({
    repository,
    event,
    companyId,
    send,
    warn: vi.fn(),
  });

  expect(result).toEqual({ publishedImmediately: false });
  expect(send).toHaveBeenCalledTimes(1);
  expect(pending.has(event.id)).toBe(true);
});

test("falls back without blocking when immediate delivery exceeds its time budget", async () => {
  const { pending, repository } = makeRepository();
  const warn = vi.fn();

  const result = await enqueueAndPublishEvent({
    repository,
    event,
    companyId,
    send: () => new Promise(() => undefined),
    timeoutMs: 5,
    warn,
  });

  expect(result).toEqual({ publishedImmediately: false });
  expect(repository.markPublished).not.toHaveBeenCalled();
  expect(pending.has(event.id)).toBe(true);
  expect(warn).toHaveBeenCalledWith(
    "Immediate event publish failed; durable outbox fallback retained",
    expect.objectContaining({ error: "Immediate publish timed out after 5ms" }),
  );
});

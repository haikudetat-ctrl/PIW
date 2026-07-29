import type { DomainEvent } from "@/domain/events";
import type { OutboxRepository } from "./outbox-repository";

type Dependencies = {
  repository: OutboxRepository;
  send: (event: { name: DomainEvent["name"]; data: DomainEvent }) => Promise<void>;
  claimedBy: string;
};

export async function publishPendingEvents({
  repository,
  send,
  claimedBy,
}: Dependencies) {
  const pending = await repository.claimBatch(50, claimedBy);
  for (const { event } of pending) {
    try {
      await send({ name: event.name, data: event });
      await repository.markPublished(event.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown publish error";
      await repository.markFailed(event.id, message.slice(0, 500));
    }
  }
  return { claimed: pending.length };
}

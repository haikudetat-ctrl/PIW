import type { DomainEvent } from "@/domain/events";
import type { OutboxRepository } from "./outbox-repository";

type OutboundEvent = {
  name: DomainEvent["name"];
  data: DomainEvent;
};

type Dependencies = {
  repository: OutboxRepository;
  event: DomainEvent;
  companyId: string;
  send: (event: OutboundEvent) => Promise<unknown>;
  eventAlreadyPersisted?: boolean;
  timeoutMs?: number;
  info?: (message: string, context: Record<string, unknown>) => void;
  warn?: (message: string, context: Record<string, unknown>) => void;
};

export type ImmediatePublishResult = {
  publishedImmediately: boolean;
};

/**
 * Persist first, then attempt the low-latency delivery path.
 *
 * The durable outbox remains the source of truth. If either the network send
 * or the acknowledgement write fails, the row stays pending for the cron
 * relay. Re-delivery is safe because the same domain-event UUID is sent on
 * every attempt and consumers are idempotent.
 */
export async function enqueueAndPublishEvent({
  repository,
  event,
  companyId,
  send,
  eventAlreadyPersisted = false,
  timeoutMs = 2_500,
  info = (message, context) => console.info(message, context),
  warn = (message, context) => console.warn(message, context),
}: Dependencies): Promise<ImmediatePublishResult> {
  const persistedEventId = eventAlreadyPersisted
    ? event.id
    : await repository.enqueue(event, companyId);
  const persistedEvent =
    persistedEventId === event.id
      ? event
      : ({ ...event, id: persistedEventId } as DomainEvent);

  try {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        send({ name: persistedEvent.name, data: persistedEvent }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Immediate publish timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    await repository.markPublished(persistedEventId);
    info("Immediate event publish completed", {
      eventId: persistedEventId,
      eventName: persistedEvent.name,
    });
    return { publishedImmediately: true };
  } catch (error) {
    warn("Immediate event publish failed; durable outbox fallback retained", {
      eventId: persistedEventId,
      eventName: persistedEvent.name,
      error: error instanceof Error ? error.message : "Unknown publish error",
    });
    return { publishedImmediately: false };
  }
}

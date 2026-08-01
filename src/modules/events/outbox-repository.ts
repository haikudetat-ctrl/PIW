import type { DomainEvent } from "@/domain/events";

export type PendingOutboxEvent = {
  event: DomainEvent;
  attemptCount: number;
};

export interface OutboxRepository {
  enqueue(event: DomainEvent, companyId: string): Promise<string>;
  claimBatch(limit: number, claimedBy: string): Promise<PendingOutboxEvent[]>;
  markPublished(eventId: string): Promise<void>;
  markFailed(eventId: string, message: string): Promise<void>;
}

export class InMemoryOutboxRepository implements OutboxRepository {
  readonly events: DomainEvent[] = [];

  async enqueue(event: DomainEvent, _companyId: string) {
    const existing = this.events.find(
      (item) => item.idempotencyKey === event.idempotencyKey,
    );
    if (existing) return existing.id;
    this.events.push(event);
    return event.id;
  }
  async claimBatch(limit: number, _claimedBy: string) {
    return this.events.slice(0, limit).map((event) => ({ event, attemptCount: 0 }));
  }
  async markPublished() {}
  async markFailed() {}
}

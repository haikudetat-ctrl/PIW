import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eventEnvelopeSchema, type DomainEvent } from "@/domain/events";
import type { Database } from "@/lib/database.types";
import type { OutboxRepository, PendingOutboxEvent } from "./outbox-repository";

export class OutboxPersistenceError extends Error {
  constructor(operation: string) {
    super(`Outbox persistence failed during ${operation}`);
    this.name = "OutboxPersistenceError";
  }
}

export class SupabaseOutboxRepository implements OutboxRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async enqueue(event: DomainEvent, companyId: string): Promise<void> {
    const { error } = await this.client.rpc("enqueue_domain_event", {
      p_company_id: companyId,
      p_event: event,
    });
    if (error) throw new OutboxPersistenceError("enqueue");
  }

  async claimBatch(limit: number, claimedBy: string): Promise<PendingOutboxEvent[]> {
    const { data, error } = await this.client.rpc("claim_outbox_events", {
      p_limit: limit,
      p_claimed_by: claimedBy,
    });
    if (error) throw new OutboxPersistenceError("claimBatch");

    return (data ?? []).map((row) => ({
      event: eventEnvelopeSchema.parse(row.payload),
      attemptCount: row.attempt_count,
    }));
  }

  async markPublished(eventId: string): Promise<void> {
    const { error } = await this.client.rpc("complete_outbox_event", {
      p_event_id: eventId,
    });
    if (error) throw new OutboxPersistenceError("markPublished");
  }

  async markFailed(eventId: string, message: string): Promise<void> {
    const { error } = await this.client.rpc("fail_outbox_event", {
      p_event_id: eventId,
      p_error: message,
    });
    if (error) throw new OutboxPersistenceError("markFailed");
  }
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";

export type RecordIntegrationEventInput = {
  companyId: string;
  sourceSystem: string;
  eventType: string;
  idempotencyKey: string;
  rawPayload: Record<string, unknown>;
};

export type RecordIntegrationEventResult = {
  eventId: string;
  isDuplicate: boolean;
};

export async function recordIntegrationEvent(
  input: RecordIntegrationEventInput,
  client: SupabaseClient<Database>,
): Promise<RecordIntegrationEventResult> {
  const { data, error } = await client.rpc("record_integration_event", {
    p_company_id: input.companyId,
    p_source_system: input.sourceSystem,
    p_event_type: input.eventType,
    p_idempotency_key: input.idempotencyKey,
    p_raw_payload: input.rawPayload as Json,
  });

  if (error || !data || data.length === 0) {
    throw new Error("Failed to record integration event");
  }

  const [row] = data;
  return { eventId: row.event_id, isDuplicate: row.is_duplicate };
}

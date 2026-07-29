import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";

const REDACTED_KEY_PATTERN =
  /^(email|phone|name|password|token|authorization|secret|raw_payload)$/i;

export function sanitizeAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditMetadata(item));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      result[key] = REDACTED_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : sanitizeAuditMetadata(entryValue);
    }
    return result;
  }

  return value;
}

export type AuditEntryInput = {
  companyId: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
};

export async function writeAuditEntry(
  input: AuditEntryInput,
  client: SupabaseClient<Database>,
): Promise<void> {
  const { error } = await client.from("audit_log").insert({
    company_id: input.companyId,
    actor_id: input.actorId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    correlation_id: input.correlationId,
    metadata: sanitizeAuditMetadata(input.metadata ?? {}) as Json,
  });

  if (error) throw new Error("Failed to write audit entry");
}

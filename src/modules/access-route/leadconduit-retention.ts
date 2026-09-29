import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Owner-approved retention for LeadConduit intake contact details
// (docs/runbooks/leadconduit-journey-checkpoints.md, approved 2026-09-29).
export const LEADCONDUIT_CONTACT_RETENTION = {
  delivered: "30 days",
  filtered: "90 days",
} as const;

export async function redactExpiredLeadConduitContacts(
  database: SupabaseClient<Database>,
  companyId: string,
): Promise<number> {
  const { data, error } = await database.rpc("redact_leadconduit_checkpoint_contacts", {
    p_company_id: companyId,
    p_delivered_after: LEADCONDUIT_CONTACT_RETENTION.delivered,
    p_filtered_after: LEADCONDUIT_CONTACT_RETENTION.filtered,
  });
  if (error) throw new Error("LeadConduit contact redaction failed", { cause: error });
  return data ?? 0;
}

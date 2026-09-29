import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { redactExpiredLeadConduitContacts } from "./leadconduit-retention";

const COMPANY = "00000000-0000-4000-8000-000000000001";

function database(result: { data: number | null; error: unknown }) {
  const rpc = vi.fn(async () => result);
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe("redactExpiredLeadConduitContacts", () => {
  it("applies the approved 30-day delivered and 90-day filtered retention", async () => {
    const { client, rpc } = database({ data: 4, error: null });

    await expect(redactExpiredLeadConduitContacts(client, COMPANY)).resolves.toBe(4);
    expect(rpc).toHaveBeenCalledWith("redact_leadconduit_checkpoint_contacts", {
      p_company_id: COMPANY,
      p_delivered_after: "30 days",
      p_filtered_after: "90 days",
    });
  });

  it("surfaces database failures without their detail", async () => {
    const { client } = database({ data: null, error: { message: "permission denied" } });

    await expect(redactExpiredLeadConduitContacts(client, COMPANY))
      .rejects.toThrow("LeadConduit contact redaction failed");
  });
});

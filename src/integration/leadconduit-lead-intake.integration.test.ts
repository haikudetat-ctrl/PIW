import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";
import type { Database } from "@/lib/database.types";
import { intakeLeadConduitLead, type LeadConduitLeadIntake } from "@/modules/access-route/leadconduit-lead-intake";

const runIntegration = process.env.RUN_SUPABASE_INTEGRATION === "1";

describe.runIf(runIntegration)("LeadConduit lead intake", () => {
  test("creates a Rake lead with a call task once, with nullable fields left empty", async () => {
    const localStatus = JSON.parse(
      execFileSync("npx", ["supabase", "status", "-o", "json"], { cwd: process.cwd(), encoding: "utf8" }),
    ) as { API_URL: string; SERVICE_ROLE_KEY: string };
    const client = createClient<Database>(localStatus.API_URL, localStatus.SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const companyId = crypto.randomUUID();
    const input: LeadConduitLeadIntake = {
      companyId,
      flowId: "synthetic-roofing-flow",
      flowName: "Roofing",
      leadConduitLeadId: `synthetic-${crypto.randomUUID()}`,
      piwLeadId: null,
      name: "Synthetic Vendor Lead",
      phone: "(609) 555-0177",
      phoneE164: "+16095550177",
      email: "vendor-lead@example.invalid",
      emailNormalized: "vendor-lead@example.invalid",
      submittedAddress: "177 Synthetic Way",
      sourceName: null,
      trustedformUrl: null,
      isTest: true,
    };

    try {
      const { error } = await client.from("companies").insert({ id: companyId, name: "Lead intake integration" });
      if (error) throw new Error(error.message);

      await expect(intakeLeadConduitLead(client, input)).resolves.toBe("created");
      await expect(intakeLeadConduitLead(client, input)).resolves.toBe("existing_leadconduit_lead");

      const { data: leads } = await client
        .from("leads")
        .select("id, source_system, original_lead_source, trustedform_url, is_test, tasks(title, source_key)")
        .eq("company_id", companyId);
      expect(leads).toEqual([
        expect.objectContaining({
          source_system: "leadconduit",
          original_lead_source: null,
          trustedform_url: null,
          is_test: true,
          tasks: [{ title: "Call new lead now", source_key: `call:leadconduit:${input.leadConduitLeadId}` }],
        }),
      ]);
    } finally {
      for (const table of ["tasks", "notifications", "lead_stage_history", "pipeline_runs", "leads", "properties"] as const) {
        await client.from(table).delete().eq("company_id", companyId);
      }
      await client.from("companies").delete().eq("id", companyId);
    }
  }, 60_000);
});

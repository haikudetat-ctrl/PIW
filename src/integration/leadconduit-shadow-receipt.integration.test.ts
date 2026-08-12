import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";
import { handleLeadConduitShadowRequest } from "@/app/api/integrations/leadconduit/[flow]/route";
import type { Database } from "@/lib/database.types";
import type { LeadConduitFlowBinding } from "@/modules/access-route/leadconduit-config";
import { SupabaseAccessRouteRepository } from "@/modules/access-route/repository";

const runIntegration = process.env.RUN_SUPABASE_INTEGRATION === "1";
const password = "Synthetic-only-password-2026!";

type LocalStatus = {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
};

async function requireSuccess<T extends { error: { message: string } | null }>(operation: PromiseLike<T>): Promise<T> {
  const result = await operation;
  if (result.error) throw new Error(result.error.message);
  return result;
}

function localStatus(): LocalStatus {
  return JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], {
    cwd: process.cwd(), encoding: "utf8",
  })) as LocalStatus;
}

function serviceClient(status: LocalStatus, label: string): SupabaseClient<Database> {
  return createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: `shadow-receipt-${label}-${crypto.randomUUID()}` },
  });
}

function receiptRequest(token: string, payload: Record<string, unknown>): Request {
  return new Request("https://piw.example.invalid/api/integrations/leadconduit/roofing", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function receiptPayload(input: {
  flowId: string;
  leadId: string;
  buildingComments: string;
  siteLandUse?: string;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  trustedformUrl?: string;
}) {
  return {
    schema_version: 1,
    lead_id: input.leadId,
    flow_id: input.flowId,
    checkpoint: "after_corelogic",
    source: { id: "synthetic-source", name: "Synthetic Source" },
    submitted_at: "2026-08-12T16:00:00.000Z",
    is_test: true,
    lead: {
      name: input.name ?? "Synthetic Homeowner",
      phone: input.phone ?? "+1 609 555 0101",
      email: input.email ?? "synthetic@example.invalid",
      submitted_address: input.address ?? "101 Synthetic Way, Trenton, NJ",
      trustedform_url: input.trustedformUrl ?? "https://cert.example.invalid/synthetic",
    },
    corelogic: {
      outcome: "Success",
      reason: "Synthetic CoreLogic reason",
      building_comments: input.buildingComments,
      site_land_use: input.siteLandUse ?? "Single Family",
    },
  };
}

describe.runIf(runIntegration)("LeadConduit shadow receipt local persistence", () => {
  test("persists tenant-isolated sanitized shadow receipts without intake side effects", async () => {
    const status = localStatus();
    const admin = serviceClient(status, "admin");
    const repositoryA = new SupabaseAccessRouteRepository(serviceClient(status, "tenant-a"));
    const repositoryB = new SupabaseAccessRouteRepository(serviceClient(status, "tenant-b"));
    const companyA = crypto.randomUUID();
    const companyB = crypto.randomUUID();
    const flowA = `synthetic-roofing-${crypto.randomUUID()}`;
    const flowB = `synthetic-virtual-quote-${crypto.randomUUID()}`;
    const tokenA = `synthetic-token-a-${crypto.randomUUID()}`;
    const tokenB = `synthetic-token-b-${crypto.randomUUID()}`;
    const emailA = `shadow-a-${crypto.randomUUID()}@example.invalid`;
    const emailB = `shadow-b-${crypto.randomUUID()}@example.invalid`;
    let userAId: string | undefined;
    let userBId: string | undefined;

    const bindings: Record<string, LeadConduitFlowBinding> = {
      roofing: {
        slug: "roofing", companyId: companyA, flowId: flowA, flowName: "Roofing", receiptEnabled: true,
        tokens: [{ value: tokenA, validUntil: null }],
      },
      "roofing-virtual-quote": {
        slug: "roofing-virtual-quote", companyId: companyB, flowId: flowB, flowName: "Roofing Virtual Quote", receiptEnabled: true,
        tokens: [{ value: tokenB, validUntil: null }],
      },
    };

    try {
      await requireSuccess(admin.from("companies").insert([
        { id: companyA, name: "Synthetic Shadow Receipt Tenant A" },
        { id: companyB, name: "Synthetic Shadow Receipt Tenant B" },
      ]));
      await requireSuccess(admin.from("leadconduit_flows").insert([
        { company_id: companyA, flow_id: flowA, name: "Synthetic Roofing", enabled: true, raw_payload: {} },
        { company_id: companyB, flow_id: flowB, name: "Synthetic Virtual Quote", enabled: true, raw_payload: {} },
      ]));

      const createdA = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
      const createdB = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
      if (createdA.error || !createdA.data.user) throw new Error(createdA.error?.message ?? "Synthetic user A was not created");
      if (createdB.error || !createdB.data.user) throw new Error(createdB.error?.message ?? "Synthetic user B was not created");
      userAId = createdA.data.user.id;
      userBId = createdB.data.user.id;
      await requireSuccess(admin.from("admin_profiles").insert([
        { id: userAId, company_id: companyA, display_name: "Synthetic Shadow Admin A" },
        { id: userBId, company_id: companyB, display_name: "Synthetic Shadow Admin B" },
      ]));

      const dependencies = {
        getBinding: (flow: string) => bindings[flow] ?? null,
        persist: (input: Parameters<SupabaseAccessRouteRepository["upsertLeadConduitEvents"]>[0]) => (
          input.companyId === companyA ? repositoryA.upsertLeadConduitEvents(input) : repositoryB.upsertLeadConduitEvents(input)
        ),
        now: () => new Date("2026-08-12T16:01:00.000Z"),
      };
      const candidateA = receiptPayload({ flowId: flowA, leadId: "shared-synthetic-lead", buildingComments: "APARTMENT HOUSE" });
      const nonCandidateA = receiptPayload({
        flowId: flowA,
        leadId: "synthetic-non-candidate", buildingComments: "Single Family", name: "Synthetic Non Candidate",
        phone: "+1 609 555 0199", email: "non-candidate@example.invalid", address: "199 Synthetic Way, Trenton, NJ",
        trustedformUrl: "https://cert.example.invalid/non-candidate",
      });
      const candidateB = receiptPayload({ flowId: flowB, leadId: "shared-synthetic-lead", buildingComments: "APARTMENT" });

      const [firstA, replayA, nonCandidate, tenantB] = await Promise.all([
        handleLeadConduitShadowRequest(receiptRequest(tokenA, candidateA), "roofing", dependencies),
        handleLeadConduitShadowRequest(receiptRequest(tokenA, candidateA), "roofing", dependencies),
        handleLeadConduitShadowRequest(receiptRequest(tokenA, nonCandidateA), "roofing", dependencies),
        handleLeadConduitShadowRequest(receiptRequest(tokenB, candidateB), "roofing-virtual-quote", dependencies),
      ]);
      expect([firstA, replayA, nonCandidate, tenantB]).toEqual([
        { status: 200, body: { outcome: "success" } },
        { status: 200, body: { outcome: "success" } },
        { status: 200, body: { outcome: "success" } },
        { status: 200, body: { outcome: "success" } },
      ]);

      const persisted = await requireSuccess(admin.from("leadconduit_events")
        .select("company_id, event_id, lead_id, processing_status, lead_name, submitted_phone, submitted_email, submitted_address, trustedform_url, phone_normalized, email_normalized, attribution, raw_payload")
        .in("company_id", [companyA, companyB]));
      expect(persisted.data).toHaveLength(3);
      expect(persisted.data?.filter((row) => row.company_id === companyA && row.lead_id === "shared-synthetic-lead")).toHaveLength(1);
      expect(persisted.data?.filter((row) => row.company_id === companyB && row.lead_id === "shared-synthetic-lead")).toHaveLength(1);
      const storedNonCandidate = persisted.data?.find((row) => row.company_id === companyA && row.lead_id === "synthetic-non-candidate");
      expect(storedNonCandidate).toEqual({
        company_id: companyA,
        event_id: expect.any(String),
        lead_id: "synthetic-non-candidate",
        processing_status: "not_applicable",
        lead_name: null,
        submitted_phone: null,
        submitted_email: null,
        submitted_address: null,
        trustedform_url: null,
        phone_normalized: null,
        email_normalized: null,
        attribution: { shadow_categories: [] },
        raw_payload: { schema_version: 1, checkpoint: "after_corelogic", candidate_categories: [] },
      });
      expect(JSON.stringify(storedNonCandidate)).not.toContain("Synthetic Non Candidate");
      for (const customerOrCoreLogicValue of [
        "+1 609 555 0199",
        "non-candidate@example.invalid",
        "199 Synthetic Way, Trenton, NJ",
        "https://cert.example.invalid/non-candidate",
        "Single Family",
        "Synthetic CoreLogic reason",
      ]) {
        expect(JSON.stringify(storedNonCandidate)).not.toContain(customerOrCoreLogicValue);
      }

      const clientA = createClient<Database>(status.API_URL, status.ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: `shadow-auth-a-${crypto.randomUUID()}` },
      });
      const clientB = createClient<Database>(status.API_URL, status.ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: `shadow-auth-b-${crypto.randomUUID()}` },
      });
      await requireSuccess(clientA.auth.signInWithPassword({ email: emailA, password }));
      await requireSuccess(clientB.auth.signInWithPassword({ email: emailB, password }));
      const [readsA, readsB, writeA] = await Promise.all([
        requireSuccess(clientA.from("leadconduit_events").select("company_id")).then((result) => result.data),
        requireSuccess(clientB.from("leadconduit_events").select("company_id")).then((result) => result.data),
        clientA.rpc("upsert_leadconduit_event_batch", { p_company_id: companyA, p_events: [], p_channel: "webhook", p_observed_at: "2026-08-12T16:01:00Z" }),
      ]);
      expect(readsA).toHaveLength(2);
      expect(readsA?.every((row) => row.company_id === companyA)).toBe(true);
      expect(readsB).toHaveLength(1);
      expect(readsB?.every((row) => row.company_id === companyB)).toBe(true);
      expect(writeA.error).not.toBeNull();

      const sideEffects = await Promise.all([
        requireSuccess(admin.from("leads").select("id").in("company_id", [companyA, companyB])),
        requireSuccess(admin.from("properties").select("id").in("company_id", [companyA, companyB])),
        requireSuccess(admin.from("pipeline_runs").select("id").in("company_id", [companyA, companyB])),
        requireSuccess(admin.from("integration_events").select("id").in("company_id", [companyA, companyB])),
        requireSuccess(admin.from("event_outbox").select("event_id, domain_events!inner(company_id)")
          .in("domain_events.company_id", [companyA, companyB])),
      ]);
      for (const effect of sideEffects) expect(effect.data).toHaveLength(0);
    } finally {
      await admin.from("integration_events").delete().in("company_id", [companyA, companyB]);
      await admin.from("leadconduit_events").delete().in("company_id", [companyA, companyB]);
      await admin.from("pipeline_runs").delete().in("company_id", [companyA, companyB]);
      await admin.from("leads").delete().in("company_id", [companyA, companyB]);
      await admin.from("properties").delete().in("company_id", [companyA, companyB]);
      await admin.from("domain_events").delete().in("company_id", [companyA, companyB]);
      await admin.from("leadconduit_flows").delete().in("company_id", [companyA, companyB]);
      await admin.from("admin_profiles").delete().in("company_id", [companyA, companyB]);
      if (userAId) await admin.auth.admin.deleteUser(userAId);
      if (userBId) await admin.auth.admin.deleteUser(userBId);
      await admin.from("companies").delete().in("id", [companyA, companyB]);
    }
  }, 30_000);
});

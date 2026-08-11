import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";
import type { Database } from "@/lib/database.types";

const runIntegration = process.env.RUN_SUPABASE_INTEGRATION === "1";

type LocalStatus = {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
};

type OperationResult = {
  data: unknown;
  error: { message: string } | null;
};

async function requireSuccess<T extends OperationResult>(operation: PromiseLike<T>): Promise<T> {
  const result = await operation;
  if (result.error) throw new Error(result.error.message);
  return result;
}

function localStatus(): LocalStatus {
  return JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  })) as LocalStatus;
}

function serviceClient(status: LocalStatus): SupabaseClient<Database> {
  return createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: `leadconduit-service-${crypto.randomUUID()}`,
    },
  });
}

function intakeArgs(companyId: string, correlationId: string) {
  return {
    p_company_id: companyId,
    p_name: "Synthetic Concurrent Homeowner",
    p_phone: "555-010-5000",
    p_email: "concurrent@example.invalid",
    p_submitted_address: "50 Synthetic Way, Trenton, NJ",
    p_notes: null as unknown as string,
    p_correlation_id: correlationId,
    p_pipeline_version: 1,
    p_source_system: "leadconduit",
    p_external_lead_id: "canonical-lc-lead-concurrent",
    p_source_account_id: null as unknown as string,
    p_source_record_id: null as unknown as string,
    p_original_lead_source: "Synthetic Source",
    p_campaign: "Synthetic Campaign",
    p_consent_reference: "consent-synthetic",
    p_trustedform_url: "https://cert.example.invalid/synthetic",
    p_is_test: true,
    p_phone_e164: "+16095550100",
    p_email_normalized: "concurrent@example.invalid",
  };
}

describe.runIf(runIntegration)("LeadConduit tenant-safe persistence foundation", () => {
  test("two independent clients concurrently replay one vendor lead without orphan properties", async () => {
    const status = localStatus();
    const firstClient = serviceClient(status);
    const secondClient = serviceClient(status);
    const companyId = crypto.randomUUID();

    try {
      await requireSuccess(firstClient.from("companies").insert({
        id: companyId,
        name: "Synthetic Concurrent Tenant",
      }));

      const [first, second] = await Promise.all([
        firstClient.rpc("submit_lead_intake_from_source", intakeArgs(companyId, crypto.randomUUID())),
        secondClient.rpc("submit_lead_intake_from_source", intakeArgs(companyId, crypto.randomUUID())),
      ]);
      if (first.error) throw new Error(first.error.message);
      if (second.error) throw new Error(second.error.message);

      expect(first.data).toHaveLength(1);
      expect(second.data).toHaveLength(1);
      expect(first.data?.[0]?.lead_id).toBe(second.data?.[0]?.lead_id);
      expect(first.data?.[0]?.property_id).toBe(second.data?.[0]?.property_id);
      expect(first.data?.[0]?.pipeline_run_id).toBe(second.data?.[0]?.pipeline_run_id);
      expect([first.data?.[0]?.is_duplicate, second.data?.[0]?.is_duplicate].sort()).toEqual([false, true]);

      const [leads, properties, pipelines] = await Promise.all([
        requireSuccess(firstClient.from("leads").select("id, property_id").eq("company_id", companyId)),
        requireSuccess(firstClient.from("properties").select("id").eq("company_id", companyId)),
        requireSuccess(firstClient.from("pipeline_runs").select("id").eq("company_id", companyId)),
      ]);
      expect(leads.data).toHaveLength(1);
      expect(properties.data).toHaveLength(1);
      expect(pipelines.data).toHaveLength(1);
      expect(leads.data?.[0]?.property_id).toBe(properties.data?.[0]?.id);
    } finally {
      await firstClient.from("pipeline_runs").delete().eq("company_id", companyId);
      await firstClient.from("leads").delete().eq("company_id", companyId);
      await firstClient.from("properties").delete().eq("company_id", companyId);
      await firstClient.from("companies").delete().eq("id", companyId);
    }
  }, 30_000);

  test("two authenticated users can read only their tenant and cannot ingest", async () => {
    const status = localStatus();
    const admin = serviceClient(status);
    const companyA = crypto.randomUUID();
    const companyB = crypto.randomUUID();
    const emailA = `synthetic-a-${crypto.randomUUID()}@example.invalid`;
    const emailB = `synthetic-b-${crypto.randomUUID()}@example.invalid`;
    const password = "Synthetic-only-password-2026!";
    let userAId: string | undefined;
    let userBId: string | undefined;

    try {
      await requireSuccess(admin.from("companies").insert([
        { id: companyA, name: "Synthetic RLS Tenant A" },
        { id: companyB, name: "Synthetic RLS Tenant B" },
      ]));

      const createdA = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
      const createdB = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
      if (createdA.error || !createdA.data.user) throw new Error(createdA.error?.message ?? "Synthetic user A was not created");
      if (createdB.error || !createdB.data.user) throw new Error(createdB.error?.message ?? "Synthetic user B was not created");
      userAId = createdA.data.user.id;
      userBId = createdB.data.user.id;

      await requireSuccess(admin.from("admin_profiles").insert([
        { id: userAId, company_id: companyA, display_name: "Synthetic Admin A" },
        { id: userBId, company_id: companyB, display_name: "Synthetic Admin B" },
      ]));

      const intakeA = await requireSuccess(admin.rpc("submit_lead_intake_from_source", {
        ...intakeArgs(companyA, crypto.randomUUID()),
        p_external_lead_id: "canonical-lc-lead-shared-across-tenants",
      }));
      const intakeB = await requireSuccess(admin.rpc("submit_lead_intake_from_source", {
        ...intakeArgs(companyB, crypto.randomUUID()),
        p_external_lead_id: "canonical-lc-lead-shared-across-tenants",
      }));
      expect(intakeA.data?.[0]?.lead_id).not.toBe(intakeB.data?.[0]?.lead_id);

      await requireSuccess(admin.from("leadconduit_flows").insert([
        { company_id: companyA, flow_id: "roofing-flow-exact", name: "Roofing", enabled: true, raw_payload: {} },
        { company_id: companyB, flow_id: "roofing-flow-exact", name: "Roofing", enabled: true, raw_payload: {} },
      ]));
      await requireSuccess(admin.from("leadconduit_source_metadata").insert([
        {
          company_id: companyA,
          flow_id: "roofing-flow-exact",
          source_id: "source-exact",
          source_name: "Synthetic Source A",
          observed_at: "2026-08-11T16:00:00.000Z",
        },
        {
          company_id: companyB,
          flow_id: "roofing-flow-exact",
          source_id: "source-exact",
          source_name: "Synthetic Source B",
          observed_at: "2026-08-11T16:00:00.000Z",
        },
      ]));
      await requireSuccess(admin.rpc("upsert_leadconduit_event_batch", {
        p_company_id: companyA,
        p_events: [{
          event_id: "tenant-event",
          flow_id: "roofing-flow-exact",
          lead_id: "canonical-lc-event-lead-a",
          event_type: "source",
          occurred_at: "2026-08-11T15:59:00.000Z",
          raw_payload: { fixture: "tenant-a" },
        }],
        p_channel: "poll",
        p_observed_at: "2026-08-11T16:00:00.000Z",
      }));
      await requireSuccess(admin.rpc("upsert_leadconduit_event_batch", {
        p_company_id: companyB,
        p_events: [{
          event_id: "tenant-event",
          flow_id: "roofing-flow-exact",
          lead_id: "canonical-lc-event-lead-b",
          event_type: "source",
          occurred_at: "2026-08-11T15:59:00.000Z",
          raw_payload: { fixture: "tenant-b" },
        }],
        p_channel: "poll",
        p_observed_at: "2026-08-11T16:00:00.000Z",
      }));
      await requireSuccess(admin.from("integration_events").insert([
        {
          company_id: companyA,
          source_system: "leadconduit",
          event_type: "source",
          idempotency_key: "synthetic-tenant-a-event",
          raw_payload: {},
        },
        {
          company_id: companyB,
          source_system: "leadconduit",
          event_type: "source",
          idempotency_key: "synthetic-tenant-b-event",
          raw_payload: {},
        },
      ]));

      const clientA = createClient<Database>(status.API_URL, status.ANON_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          storageKey: `leadconduit-user-a-${crypto.randomUUID()}`,
        },
      });
      const clientB = createClient<Database>(status.API_URL, status.ANON_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          storageKey: `leadconduit-user-b-${crypto.randomUUID()}`,
        },
      });
      const [sessionA, sessionB] = await Promise.all([
        clientA.auth.signInWithPassword({ email: emailA, password }),
        clientB.auth.signInWithPassword({ email: emailB, password }),
      ]);
      if (sessionA.error) throw new Error(sessionA.error.message);
      if (sessionB.error) throw new Error(sessionB.error.message);

      const [aFlows, aSources, aEvents, aIntegrationEvents, aLeads, bFlows, bSources, bEvents, bIntegrationEvents, bLeads] = await Promise.all([
        requireSuccess(clientA.from("leadconduit_flows").select("company_id")),
        requireSuccess(clientA.from("leadconduit_source_metadata").select("company_id")),
        requireSuccess(clientA.from("leadconduit_events").select("company_id")),
        requireSuccess(clientA.from("integration_events").select("company_id").eq("source_system", "leadconduit")),
        requireSuccess(clientA.from("leads").select("id, company_id").eq("external_lead_id", "canonical-lc-lead-shared-across-tenants")),
        requireSuccess(clientB.from("leadconduit_flows").select("company_id")),
        requireSuccess(clientB.from("leadconduit_source_metadata").select("company_id")),
        requireSuccess(clientB.from("leadconduit_events").select("company_id")),
        requireSuccess(clientB.from("integration_events").select("company_id").eq("source_system", "leadconduit")),
        requireSuccess(clientB.from("leads").select("id, company_id").eq("external_lead_id", "canonical-lc-lead-shared-across-tenants")),
      ]);

      for (const result of [aFlows, aSources, aEvents, aIntegrationEvents, aLeads]) {
        expect(result.data).toHaveLength(1);
        expect(result.data?.[0]?.company_id).toBe(companyA);
      }
      for (const result of [bFlows, bSources, bEvents, bIntegrationEvents, bLeads]) {
        expect(result.data).toHaveLength(1);
        expect(result.data?.[0]?.company_id).toBe(companyB);
      }
      expect(aLeads.data?.[0]?.id).not.toBe(bLeads.data?.[0]?.id);

      const authenticatedSourceWrite = await clientA.from("leadconduit_source_metadata").insert({
        company_id: companyA,
        flow_id: "roofing-flow-exact",
        source_id: "forbidden-auth-write",
        source_name: "Forbidden",
        observed_at: "2026-08-11T16:00:00.000Z",
      });
      expect(authenticatedSourceWrite.error).not.toBeNull();
      const authenticatedEventWrite = await clientA.rpc("upsert_leadconduit_event_batch", {
        p_company_id: companyA,
        p_events: [],
        p_channel: "poll",
        p_observed_at: "2026-08-11T16:00:00.000Z",
      });
      expect(authenticatedEventWrite.error).not.toBeNull();

      const anonymous = createClient<Database>(status.API_URL, status.ANON_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          storageKey: `leadconduit-anon-${crypto.randomUUID()}`,
        },
      });
      const anonymousRead = await anonymous.from("leadconduit_source_metadata").select("company_id");
      expect(anonymousRead.error).not.toBeNull();
    } finally {
      await admin.from("leadconduit_events").delete().in("company_id", [companyA, companyB]);
      await admin.from("leadconduit_flow_rules").delete().in("company_id", [companyA, companyB]);
      await admin.from("leadconduit_flow_steps").delete().in("company_id", [companyA, companyB]);
      await admin.from("leadconduit_source_metadata").delete().in("company_id", [companyA, companyB]);
      await admin.from("leadconduit_flows").delete().in("company_id", [companyA, companyB]);
      await admin.from("integration_events").delete().in("company_id", [companyA, companyB]);
      await admin.from("pipeline_runs").delete().in("company_id", [companyA, companyB]);
      await admin.from("leads").delete().in("company_id", [companyA, companyB]);
      await admin.from("properties").delete().in("company_id", [companyA, companyB]);
      await admin.from("admin_profiles").delete().in("company_id", [companyA, companyB]);
      if (userAId) await admin.auth.admin.deleteUser(userAId);
      if (userBId) await admin.auth.admin.deleteUser(userBId);
      await admin.from("companies").delete().in("id", [companyA, companyB]);
    }
  }, 30_000);
});

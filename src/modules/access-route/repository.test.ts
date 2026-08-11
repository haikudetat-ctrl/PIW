import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import type {
  LeadConduitEventRow,
  LeadConduitFlowRuleRow,
  LeadConduitFlowStepRow,
  LeadConduitSourceMetadataRow,
} from "./contracts";
import { SupabaseAccessRouteRepository } from "./repository";

const COMPANY = "00000000-0000-4000-8000-000000000001";
const FLOW = "roofing-flow-exact";
const OBSERVED_AT = "2026-08-11T16:00:00.000Z";

type RecordedCall =
  | { operation: "rpc"; name: string; args: Record<string, unknown> }
  | { operation: "upsert"; table: string; rows: unknown; options: unknown };

function fakeClient() {
  const calls: RecordedCall[] = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ operation: "rpc", name, args });
      return { data: 1, error: null };
    },
    from(table: string) {
      return {
        async upsert(rows: unknown, options: unknown) {
          calls.push({ operation: "upsert", table, rows, options });
          return { data: null, error: null };
        },
      };
    },
  };
  return { calls, client: client as unknown as SupabaseClient<Database> };
}

function eventRow(overrides: Partial<LeadConduitEventRow> = {}): LeadConduitEventRow {
  return {
    company_id: COMPANY,
    event_id: "event-exact",
    flow_id: FLOW,
    source_id: "source-exact",
    source_name: "Synthetic Source",
    lead_id: "canonical-lead-id",
    event_type: "source",
    occurred_at: "2026-08-11T15:59:00.000Z",
    outcome: "success",
    external_lead_id: "attribution-only-id",
    phone_normalized: "+16095550100",
    email_normalized: "synthetic@example.invalid",
    raw_status: "accepted",
    step_id: "step-exact",
    step_name: "Synthetic Source Step",
    rule_id: "rule-exact",
    rule_name: "Synthetic Rule",
    rule_scope: "source_acceptance",
    rule_scope_id: "source-exact",
    reason_category: null,
    lead_name: "Synthetic Homeowner",
    submitted_phone: "(609) 555-0100",
    submitted_email: "synthetic@example.invalid",
    submitted_address: "10 Synthetic Way, Trenton, NJ",
    campaign: "Synthetic Campaign",
    consent_reference: "consent-synthetic",
    trustedform_url: "https://cert.example.invalid/synthetic",
    attribution: { lead_external_id: "attribution-only-id" },
    raw_payload: { evidence: "original" },
    is_test: false,
    ingestion_channels: ["poll"],
    first_observed_at: OBSERVED_AT,
    webhook_received_at: null,
    poll_observed_at: OBSERVED_AT,
    processing_status: "observed",
    piw_lead_id: null,
    processing_error_category: null,
    processing_attempts: 0,
    processing_claimed_at: null,
    processing_claimed_by: null,
    processing_next_attempt_at: null,
    ingested_at: OBSERVED_AT,
    ...overrides,
  };
}

describe("SupabaseAccessRouteRepository LeadConduit foundation", () => {
  it("routes event persistence through the tenant-bound provenance merge RPC", async () => {
    const { client, calls } = fakeClient();
    const repository = new SupabaseAccessRouteRepository(client);

    await expect(repository.upsertLeadConduitEvents({
      companyId: COMPANY,
      flowId: FLOW,
      channel: "poll",
      observedAt: OBSERVED_AT,
      rows: [eventRow()],
    })).resolves.toBe(1);

    expect(calls).toEqual([{
      operation: "rpc",
      name: "upsert_leadconduit_event_batch",
      args: {
        p_company_id: COMPANY,
        p_channel: "poll",
        p_observed_at: OBSERVED_AT,
        p_events: [{
          event_id: "event-exact",
          flow_id: FLOW,
          source_id: "source-exact",
          source_name: "Synthetic Source",
          lead_id: "canonical-lead-id",
          event_type: "source",
          occurred_at: "2026-08-11T15:59:00.000Z",
          outcome: "success",
          external_lead_id: "attribution-only-id",
          phone_normalized: "+16095550100",
          email_normalized: "synthetic@example.invalid",
          raw_status: "accepted",
          step_id: "step-exact",
          step_name: "Synthetic Source Step",
          rule_id: "rule-exact",
          rule_name: "Synthetic Rule",
          rule_scope: "source_acceptance",
          rule_scope_id: "source-exact",
          reason_category: null,
          lead_name: "Synthetic Homeowner",
          submitted_phone: "(609) 555-0100",
          submitted_email: "synthetic@example.invalid",
          submitted_address: "10 Synthetic Way, Trenton, NJ",
          campaign: "Synthetic Campaign",
          consent_reference: "consent-synthetic",
          trustedform_url: "https://cert.example.invalid/synthetic",
          attribution: { lead_external_id: "attribution-only-id" },
          raw_payload: { evidence: "original" },
          is_test: false,
        }],
      },
    }]);
  });

  it("rejects a mixed-tenant or untrusted-flow event batch before persistence", async () => {
    const { client, calls } = fakeClient();
    const repository = new SupabaseAccessRouteRepository(client);

    await expect(repository.upsertLeadConduitEvents({
      companyId: COMPANY,
      flowId: FLOW,
      channel: "webhook",
      observedAt: OBSERVED_AT,
      rows: [eventRow({ company_id: "00000000-0000-4000-8000-000000000002" })],
    })).rejects.toThrow("tenant or flow mismatch");
    await expect(repository.upsertLeadConduitEvents({
      companyId: COMPANY,
      flowId: FLOW,
      channel: "webhook",
      observedAt: OBSERVED_AT,
      rows: [eventRow({ flow_id: "payload-controlled-flow" })],
    })).rejects.toThrow("tenant or flow mismatch");

    expect(calls).toEqual([]);
  });

  it("upserts source, step, and rule snapshots on their exact tenant-scoped keys", async () => {
    const { client, calls } = fakeClient();
    const repository = new SupabaseAccessRouteRepository(client);
    const source: LeadConduitSourceMetadataRow = {
      company_id: COMPANY,
      flow_id: FLOW,
      source_id: "source-exact",
      source_name: "Synthetic Source",
      field_names: ["email", "phone"],
      acceptance_metadata: { rules: [] },
      raw_payload: { id: "source-exact" },
      observed_at: OBSERVED_AT,
    };
    const step: LeadConduitFlowStepRow = {
      company_id: COMPANY,
      flow_id: FLOW,
      step_id: "step-exact",
      step_type: "filter",
      step_name: "Synthetic Filter",
      step_order: 3,
      enabled: true,
      outcome: "continue",
      observed_at: OBSERVED_AT,
    };
    const rule: LeadConduitFlowRuleRow = {
      company_id: COMPANY,
      flow_id: FLOW,
      rule_scope: "filter_step",
      rule_scope_id: "step-exact",
      rule_id: "rule-exact",
      rule_name: "Synthetic Rule",
      lhv: "lead.state",
      operator: "is equal to",
      observed_at: OBSERVED_AT,
    };

    await expect(repository.upsertLeadConduitSourceMetadata({
      companyId: COMPANY, flowId: FLOW, rows: [source],
    })).resolves.toBe(1);
    await expect(repository.upsertLeadConduitFlowSteps({
      companyId: COMPANY, flowId: FLOW, rows: [step],
    })).resolves.toBe(1);
    await expect(repository.upsertLeadConduitFlowRules({
      companyId: COMPANY, flowId: FLOW, rows: [rule],
    })).resolves.toBe(1);

    expect(calls).toEqual([
      {
        operation: "upsert",
        table: "leadconduit_source_metadata",
        rows: [{ ...source, acceptance_metadata: { rules: [] }, raw_payload: { id: "source-exact" } }],
        options: { onConflict: "company_id,flow_id,source_id" },
      },
      {
        operation: "upsert",
        table: "leadconduit_flow_steps",
        rows: [step],
        options: { onConflict: "company_id,flow_id,step_id" },
      },
      {
        operation: "upsert",
        table: "leadconduit_flow_rules",
        rows: [rule],
        options: { onConflict: "company_id,flow_id,rule_scope,rule_scope_id,rule_id" },
      },
    ]);
  });
});

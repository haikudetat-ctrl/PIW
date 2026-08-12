import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type {
  AccessRouteRepository,
  JobNimbusContactRow,
  JobNimbusJobRow,
  LeadConduitEventBatch,
  LeadConduitEventRow,
  LeadConduitFlowRow,
  LeadConduitFlowRuleRow,
  LeadConduitFlowStepRow,
  LeadConduitSnapshotBatch,
  LeadConduitSourceMetadataRow,
  LeadMasterCustomFieldRow,
  LeadMasterRecordRow,
  VendorSystem,
} from "./contracts";

function json(value: Record<string, unknown>): Json {
  return value as Json;
}

function assertTrustedLeadConduitBatch<T extends { company_id: string; flow_id: string }>(
  input: LeadConduitSnapshotBatch<T>,
): void {
  if (input.rows.some((row) => row.company_id !== input.companyId || row.flow_id !== input.flowId)) {
    throw new Error("LeadConduit tenant or flow mismatch");
  }
}

function eventPayload(row: LeadConduitEventRow, trustedFlowId: string): Json {
  return json({
    event_id: row.event_id,
    flow_id: trustedFlowId,
    source_id: row.source_id,
    source_name: row.source_name,
    lead_id: row.lead_id,
    event_type: row.event_type,
    occurred_at: row.occurred_at,
    outcome: row.outcome,
    external_lead_id: row.external_lead_id,
    phone_normalized: row.phone_normalized,
    email_normalized: row.email_normalized,
    raw_status: row.raw_status,
    step_id: row.step_id,
    step_name: row.step_name,
    rule_id: row.rule_id,
    rule_name: row.rule_name,
    rule_scope: row.rule_scope,
    rule_scope_id: row.rule_scope_id,
    reason_category: row.reason_category,
    lead_name: row.lead_name,
    submitted_phone: row.submitted_phone,
    submitted_email: row.submitted_email,
    submitted_address: row.submitted_address,
    campaign: row.campaign,
    consent_reference: row.consent_reference,
    trustedform_url: row.trustedform_url,
    attribution: row.attribution,
    raw_payload: row.raw_payload,
    is_test: row.is_test,
    processing_status: row.processing_status,
  });
}

export class SupabaseAccessRouteRepository implements AccessRouteRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async getCompanyId(configuredCompanyId?: string): Promise<string> {
    if (configuredCompanyId) {
      const { data, error } = await this.client.from("companies").select("id").eq("id", configuredCompanyId).maybeSingle();
      if (error || !data) throw new Error("Configured access-route company was not found");
      return data.id;
    }
    const { data, error } = await this.client.from("companies").select("id").limit(2);
    if (error || !data || data.length !== 1) {
      throw new Error("ACCESS_ROUTE_COMPANY_ID is required unless exactly one company exists");
    }
    return data[0].id;
  }

  async getLastCursor(companyId: string, sourceSystem: VendorSystem): Promise<string | null> {
    const { data, error } = await this.client
      .from("integration_sync_runs")
      .select("next_cursor")
      .eq("company_id", companyId)
      .eq("source_system", sourceSystem)
      .in("outcome", ["succeeded", "partial"])
      .not("next_cursor", "is", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Failed to read ${sourceSystem} sync cursor`);
    return data?.next_cursor ?? null;
  }

  async beginRun(input: { companyId: string; sourceSystem: VendorSystem; syncKey: string }) {
    const { data, error } = await this.client
      .from("integration_sync_runs")
      .upsert({
        company_id: input.companyId,
        source_system: input.sourceSystem,
        sync_key: input.syncKey,
      }, { onConflict: "company_id,source_system,sync_key", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`Failed to begin ${input.sourceSystem} sync`);
    if (data) return { id: data.id, duplicate: false };

    const existing = await this.client
      .from("integration_sync_runs")
      .select("id")
      .eq("company_id", input.companyId)
      .eq("source_system", input.sourceSystem)
      .eq("sync_key", input.syncKey)
      .single();
    if (existing.error || !existing.data) throw new Error(`Failed to find existing ${input.sourceSystem} sync`);
    return { id: existing.data.id, duplicate: true };
  }

  async finishRun(input: {
    runId: string;
    outcome: "succeeded" | "partial" | "failed" | "skipped";
    recordsSeen: number;
    recordsWritten: number;
    nextCursor?: string | null;
    errorCategory?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const { error } = await this.client.from("integration_sync_runs").update({
      finished_at: new Date().toISOString(),
      outcome: input.outcome,
      records_seen: input.recordsSeen,
      records_written: input.recordsWritten,
      next_cursor: input.nextCursor ?? null,
      error_category: input.errorCategory ?? null,
      metadata: json(input.metadata ?? {}),
    }).eq("id", input.runId);
    if (error) throw new Error("Failed to finish access-route sync run");
  }

  async upsertLeadConduitFlows(input: LeadConduitSnapshotBatch<LeadConduitFlowRow>): Promise<number> {
    if (!input.rows.length) return 0;
    assertTrustedLeadConduitBatch(input);
    const { error } = await this.client.from("leadconduit_flows").upsert(
      input.rows.map((row) => ({ ...row, raw_payload: json(row.raw_payload) })),
      { onConflict: "company_id,flow_id" },
    );
    if (error) throw new Error("Failed to persist LeadConduit flows");
    return input.rows.length;
  }

  async upsertLeadConduitEvents(input: LeadConduitEventBatch): Promise<number> {
    if (!input.rows.length) return 0;
    assertTrustedLeadConduitBatch(input);
    const { data, error } = await this.client.rpc("upsert_leadconduit_event_batch", {
      p_company_id: input.companyId,
      p_events: input.rows.map((row) => eventPayload(row, input.flowId)),
      p_channel: input.channel,
      p_observed_at: input.observedAt,
    });
    if (error) throw new Error("Failed to persist LeadConduit events");
    return data;
  }

  async upsertLeadConduitSourceMetadata(
    input: LeadConduitSnapshotBatch<LeadConduitSourceMetadataRow>,
  ): Promise<number> {
    if (!input.rows.length) return 0;
    assertTrustedLeadConduitBatch(input);
    const { error } = await this.client.from("leadconduit_source_metadata").upsert(
      input.rows.map((row) => ({
        ...row,
        acceptance_metadata: json(row.acceptance_metadata),
        raw_payload: json(row.raw_payload),
      })),
      { onConflict: "company_id,flow_id,source_id" },
    );
    if (error) throw new Error("Failed to persist LeadConduit source metadata");
    return input.rows.length;
  }

  async upsertLeadConduitFlowSteps(
    input: LeadConduitSnapshotBatch<LeadConduitFlowStepRow>,
  ): Promise<number> {
    if (!input.rows.length) return 0;
    assertTrustedLeadConduitBatch(input);
    const { error } = await this.client.from("leadconduit_flow_steps").upsert(
      input.rows,
      { onConflict: "company_id,flow_id,step_id" },
    );
    if (error) throw new Error("Failed to persist LeadConduit flow steps");
    return input.rows.length;
  }

  async upsertLeadConduitFlowRules(
    input: LeadConduitSnapshotBatch<LeadConduitFlowRuleRow>,
  ): Promise<number> {
    if (!input.rows.length) return 0;
    assertTrustedLeadConduitBatch(input);
    const { error } = await this.client.from("leadconduit_flow_rules").upsert(
      input.rows,
      { onConflict: "company_id,flow_id,rule_scope,rule_scope_id,rule_id" },
    );
    if (error) throw new Error("Failed to persist LeadConduit flow rules");
    return input.rows.length;
  }

  async upsertLeadMasterRecords(rows: LeadMasterRecordRow[]): Promise<number> {
    if (!rows.length) return 0;
    const { error } = await this.client.from("leadmaster_records").upsert(
      rows.map((row) => ({ ...row, raw_payload: json(row.raw_payload) })),
      { onConflict: "company_id,record_kind,record_id" },
    );
    if (error) throw new Error("Failed to persist LeadMaster records");
    return rows.length;
  }

  async upsertLeadMasterCustomFields(rows: LeadMasterCustomFieldRow[]): Promise<number> {
    if (!rows.length) return 0;
    const { error } = await this.client.from("leadmaster_custom_fields").upsert(
      rows.map((row) => ({ ...row, raw_payload: json(row.raw_payload) })),
      { onConflict: "company_id,workgroup,field_id" },
    );
    if (error) throw new Error("Failed to persist LeadMaster custom fields");
    return rows.length;
  }

  async upsertJobNimbusContacts(rows: JobNimbusContactRow[]): Promise<number> {
    if (!rows.length) return 0;
    const { error } = await this.client.from("jobnimbus_contacts").upsert(
      rows.map((row) => ({ ...row, raw_payload: json(row.raw_payload) })),
      { onConflict: "company_id,contact_id" },
    );
    if (error) throw new Error("Failed to persist JobNimbus contacts");
    return rows.length;
  }

  async upsertJobNimbusJobs(rows: JobNimbusJobRow[]): Promise<number> {
    if (!rows.length) return 0;
    const { error } = await this.client.from("jobnimbus_jobs").upsert(
      rows.map((row) => ({ ...row, raw_payload: json(row.raw_payload) })),
      { onConflict: "company_id,job_id" },
    );
    if (error) throw new Error("Failed to persist JobNimbus jobs");
    return rows.length;
  }
}

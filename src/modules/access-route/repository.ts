import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type {
  AccessRouteRepository,
  JobNimbusContactRow,
  JobNimbusJobRow,
  LeadConduitEventRow,
  LeadConduitFlowRow,
  LeadMasterCustomFieldRow,
  LeadMasterRecordRow,
  VendorSystem,
} from "./contracts";

function json(value: Record<string, unknown>): Json {
  return value as Json;
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

  async upsertLeadConduitFlows(rows: LeadConduitFlowRow[]): Promise<number> {
    if (!rows.length) return 0;
    const { error } = await this.client.from("leadconduit_flows").upsert(
      rows.map((row) => ({ ...row, raw_payload: json(row.raw_payload) })),
      { onConflict: "company_id,flow_id" },
    );
    if (error) throw new Error("Failed to persist LeadConduit flows");
    return rows.length;
  }

  async upsertLeadConduitEvents(rows: LeadConduitEventRow[]): Promise<number> {
    if (!rows.length) return 0;
    const { error } = await this.client.from("leadconduit_events").upsert(
      rows.map((row) => ({ ...row, raw_payload: json(row.raw_payload) })),
      { onConflict: "company_id,event_id" },
    );
    if (error) throw new Error("Failed to persist LeadConduit events");
    return rows.length;
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

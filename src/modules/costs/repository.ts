import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { ApplicationUsageData } from "./application-usage";
import type { CollectorResult, CostLineItem } from "./contracts";

export interface CostRepository {
  beginRun(input: { slotKey: string; scheduledFor: string; periodStart: string }): Promise<{ id: string; duplicate: boolean }>;
  loadApplicationUsage(periodStart: string): Promise<ApplicationUsageData>;
  saveItems(runId: string, items: CostLineItem[]): Promise<void>;
  finishRun(runId: string, results: CollectorResult[]): Promise<void>;
  markSlack(runId: string, status: "sent" | "failed" | "not_configured", errorMessage?: string): Promise<void>;
}

export class CostIntelligenceRepository implements CostRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async beginRun(input: { slotKey: string; scheduledFor: string; periodStart: string }) {
    const { data, error } = await this.client.from("cost_collection_runs").insert({
      slot_key: input.slotKey,
      scheduled_for: input.scheduledFor,
      period_start: input.periodStart,
    }).select("id").single();
    if (!error && data) return { id: data.id, duplicate: false };
    if (error?.code !== "23505") throw new Error(`Failed to begin cost collection: ${error?.message ?? "unknown error"}`);
    const existing = await this.client.from("cost_collection_runs").select("id").eq("slot_key", input.slotKey).single();
    if (existing.error || !existing.data) throw new Error("Failed to load existing cost collection");
    return { id: existing.data.id, duplicate: true };
  }

  async loadApplicationUsage(periodStart: string): Promise<ApplicationUsageData> {
    const [usage, requests, costs] = await Promise.all([
      this.client.from("provider_usage_monthly").select("api_name, reserved_count, call_limit, updated_at").eq("period_start", periodStart),
      this.client.from("provider_requests").select("provider, status").gte("requested_at", `${periodStart}T00:00:00Z`),
      this.client.from("provider_cost_entries").select("estimated_cost_micros, actual_cost_micros, provider_requests!inner(requested_at)").gte("provider_requests.requested_at", `${periodStart}T00:00:00Z`),
    ]);
    if (usage.error || requests.error || costs.error) throw new Error("Failed to load application provider usage");
    return {
      monthlyUsage: usage.data ?? [],
      requests: requests.data ?? [],
      estimatedCostMicros: (costs.data ?? []).reduce((total, row) => total + row.estimated_cost_micros, 0),
      actualCostMicros: (costs.data ?? []).reduce((total, row) => total + (row.actual_cost_micros ?? 0), 0),
    };
  }

  async saveItems(runId: string, items: CostLineItem[]) {
    if (!items.length) return;
    const { error } = await this.client.from("cost_line_items").insert(items.map((item) => ({
      collection_run_id: runId,
      provider: item.provider,
      source_key: item.sourceKey,
      resource_key: item.resourceKey,
      service: item.service,
      environment: item.environment,
      allocation_bucket: item.allocationBucket,
      cost_kind: item.costKind,
      confidence: item.confidence,
      amount_micros: item.amountMicros,
      usage_quantity: item.usageQuantity,
      usage_unit: item.usageUnit,
      free_limit: item.freeLimit,
      source_timestamp: item.sourceTimestamp,
      source_url: item.sourceUrl,
      metadata: (item.metadata ?? {}) as Json,
    })));
    if (error) throw new Error(`Failed to store cost line items: ${error.message}`);
  }

  async finishRun(runId: string, results: CollectorResult[]) {
    const status = results.every((result) => result.status === "failed")
      ? "failed"
      : results.some((result) => result.status !== "completed") ? "partial" : "completed";
    const { error } = await this.client.from("cost_collection_runs").update({
      status,
      provider_status: Object.fromEntries(results.map((result) => [result.provider, result.status])),
      warnings: results.flatMap((result) => result.warnings),
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
    if (error) throw new Error(`Failed to complete cost collection: ${error.message}`);
  }

  async markSlack(runId: string, status: "sent" | "failed" | "not_configured", errorMessage?: string) {
    const { error } = await this.client.from("cost_collection_runs").update({
      slack_status: status,
      slack_error: errorMessage?.slice(0, 500) ?? null,
    }).eq("id", runId);
    if (error) throw new Error(`Failed to record Slack delivery: ${error.message}`);
  }
}

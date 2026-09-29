import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  JobNimbusProviderError,
  type FilterVerificationResult,
  type FullScanOptions,
  type JobNimbusRecord,
  type JobNimbusRecordType,
  type JobNimbusScanResult,
  type JobNimbusTelemetry,
} from "./client";

// Incremental scans re-read this much history so a record updated while the
// previous run was in flight is never skipped. Idempotent landing makes the
// overlap free.
const OVERLAP_MILLISECONDS = 48 * 60 * 60 * 1_000;
const CREDENTIAL_NAME = /^JOBNIMBUS_API_KEY(_[A-Z0-9]+)*$/;

export type JobNimbusSyncClient = {
  verifyFutureCutoff(recordType: JobNimbusRecordType): Promise<FilterVerificationResult>;
  incrementalScan(recordType: JobNimbusRecordType, cutoff: Date): Promise<JobNimbusScanResult>;
  fullScan(recordType: JobNimbusRecordType, options?: FullScanOptions): Promise<JobNimbusScanResult>;
};

export type JobNimbusRunStart = {
  companyId: string;
  recordType: JobNimbusRecordType;
  mode: "incremental" | "full";
  startedAt: string;
  watermarkFrom: string | null;
  watermarkTo: string;
};

export type JobNimbusRunFinish = {
  status: "ok" | "failed" | "reconcile_mismatch";
  finishedAt: string;
  recordsSeen: number;
  recordsChanged: number;
  apiCalls: number;
  transientErrorCount: number;
  rateLimitErrorCount: number;
  watermarkTo: string;
  error: string | null;
};

export type JobNimbusLandingRecord = {
  jnid: string;
  payload: JobNimbusRecord;
  content_hash: string;
  jn_updated_at: string | null;
};

export type JobNimbusIntegration = {
  envKeyName: string;
  historyStart: string;
};

export type JobNimbusSyncStore = {
  getEnabledIntegration(companyId: string): Promise<JobNimbusIntegration>;
  getSyncState(
    companyId: string,
    recordType: JobNimbusRecordType,
  ): Promise<{ watermark: string; lastFullAt: string | null } | null>;
  createRun(run: JobNimbusRunStart): Promise<string>;
  landBatch(input: {
    companyId: string;
    recordType: JobNimbusRecordType;
    records: JobNimbusLandingRecord[];
    watermark: string;
  }): Promise<number>;
  finishRun(runId: string, finish: JobNimbusRunFinish): Promise<void>;
  markLastFull(input: {
    companyId: string;
    recordType: JobNimbusRecordType;
    watermark: string;
  }): Promise<void>;
};

export type JobNimbusSyncDependencies = {
  store: JobNimbusSyncStore;
  createClient(apiKey: string): JobNimbusSyncClient;
  resolveCredential(envKeyName: string): string | undefined;
  now(): Date;
};

export type JobNimbusSyncInput = {
  companyId: string;
  recordType: JobNimbusRecordType;
  mode: "full" | "incremental";
  batchSize?: number;
};

export type JobNimbusSyncResult = {
  runId: string;
  mode: "incremental" | "full";
  recordsSeen: number;
  recordsChanged: number;
  apiCalls: number;
  transientErrorCount: number;
  rateLimitErrorCount: number;
  watermark: string;
};

export class JobNimbusSyncStoreError extends Error {
  constructor(operation: string, options?: { cause?: unknown }) {
    super(`JobNimbus sync store ${operation} failed`, options);
    this.name = "JobNimbusSyncStoreError";
  }
}

export class JobNimbusReconcileMismatchError extends Error {
  readonly terminal = true;

  constructor() {
    super("JobNimbus reconciliation count mismatch");
    this.name = "JobNimbusReconcileMismatchError";
  }
}

export function createSupabaseJobNimbusSyncStore(
  database: SupabaseClient<Database>,
): JobNimbusSyncStore {
  return {
    async getEnabledIntegration(companyId) {
      const { data, error } = await database
        .from("company_integrations")
        .select("env_key_name, history_start")
        .eq("company_id", companyId)
        .eq("provider", "jobnimbus")
        .eq("enabled", true)
        .maybeSingle();
      if (error) throw new JobNimbusSyncStoreError("integration lookup", { cause: error });
      if (!data) throw new JobNimbusSyncStoreError("enabled integration lookup");
      return { envKeyName: data.env_key_name, historyStart: data.history_start };
    },

    async getSyncState(companyId, recordType) {
      const { data, error } = await database
        .from("jobnimbus_sync_state")
        .select("watermark, last_full_at")
        .eq("company_id", companyId)
        .eq("record_type", recordType)
        .maybeSingle();
      if (error) throw new JobNimbusSyncStoreError("sync state lookup", { cause: error });
      return data ? { watermark: data.watermark, lastFullAt: data.last_full_at } : null;
    },

    async createRun(run) {
      const { data, error } = await database
        .from("jobnimbus_sync_runs")
        .insert({
          company_id: run.companyId,
          record_type: run.recordType,
          mode: run.mode,
          started_at: run.startedAt,
          watermark_from: run.watermarkFrom,
          watermark_to: run.watermarkTo,
          status: "running",
        })
        .select("id")
        .single();
      if (error || !data) throw new JobNimbusSyncStoreError("run creation", { cause: error });
      return data.id;
    },

    async landBatch(input) {
      const args = {
        p_company_id: input.companyId,
        p_record_type: input.recordType,
        // JSON permits NUL in strings but JSONB does not. Normalize the stored
        // copy only; the hash still reflects the source so upstream edits are
        // detected.
        p_records: input.records.map((record) => ({
          ...record,
          payload: JSON.parse(JSON.stringify(record.payload, (_key, value) =>
            typeof value === "string" ? value.replaceAll("\u0000", "�") : value,
          )),
        })) as Json,
        p_watermark: input.watermark,
      };
      let result = await database.rpc("land_jobnimbus_batch", args);
      // A response can be lost after commit. The RPC's hash-aware upsert and
      // monotonic watermark make a replay safe; SQL errors are not retried.
      for (let retry = 1; result.error && result.status === 0 && retry < 3; retry++) {
        await new Promise((resolve) => setTimeout(resolve, 250 * retry));
        result = await database.rpc("land_jobnimbus_batch", args);
      }
      if (result.error) throw new JobNimbusSyncStoreError("landing", { cause: result.error });
      if (typeof result.data !== "number") {
        throw new JobNimbusSyncStoreError("landing result validation");
      }
      return result.data;
    },

    async finishRun(runId, finish) {
      const { error } = await database
        .from("jobnimbus_sync_runs")
        .update({
          status: finish.status,
          finished_at: finish.finishedAt,
          records_seen: finish.recordsSeen,
          records_changed: finish.recordsChanged,
          api_calls: finish.apiCalls,
          transient_error_count: finish.transientErrorCount,
          rate_limit_error_count: finish.rateLimitErrorCount,
          watermark_to: finish.watermarkTo,
          error: finish.error,
        })
        .eq("id", runId);
      if (error) throw new JobNimbusSyncStoreError("run finalization", { cause: error });
    },

    async markLastFull({ companyId, recordType, watermark }) {
      const { error } = await database
        .from("jobnimbus_sync_state")
        .update({ last_full_at: watermark })
        .eq("company_id", companyId)
        .eq("record_type", recordType)
        // Concurrent reconciliations must not move this clock back.
        .or(`last_full_at.is.null,last_full_at.lt.${watermark}`);
      if (error) throw new JobNimbusSyncStoreError("last full update", { cause: error });
    },
  };
}

export function hashJobNimbusPayload(payload: JobNimbusRecord): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export function resolveJobNimbusCredential(
  envKeyName: string,
  environment: Record<string, string | undefined>,
): string | undefined {
  return CREDENTIAL_NAME.test(envKeyName) ? environment[envKeyName] : undefined;
}

export async function runJobNimbusSync(
  input: JobNimbusSyncInput,
  dependencies: JobNimbusSyncDependencies,
): Promise<JobNimbusSyncResult> {
  const runStartedAt = dependencies.now();
  const watermarkTo = runStartedAt.toISOString();
  const integration = await dependencies.store.getEnabledIntegration(input.companyId);
  const state = await dependencies.store.getSyncState(input.companyId, input.recordType);
  const watermarkFrom = state?.watermark ?? null;
  if (input.mode === "incremental" && watermarkFrom === null) {
    throw new Error("JobNimbus incremental sync requires an existing watermark");
  }
  const runId = await dependencies.store.createRun({
    companyId: input.companyId,
    recordType: input.recordType,
    mode: input.mode,
    startedAt: watermarkTo,
    watermarkFrom,
    watermarkTo,
  });
  const counters = { apiCalls: 0, transientErrorCount: 0, rateLimitErrorCount: 0 };
  let recordsSeen = 0;
  let recordsChanged = 0;
  try {
    const apiKey = dependencies.resolveCredential(integration.envKeyName);
    if (!apiKey) throw new Error("JobNimbus credential is not configured");
    const client = dependencies.createClient(apiKey);
    let scan: JobNimbusScanResult;
    if (input.mode === "incremental") {
      // JobNimbus answers 200 to filters it ignores. Prove the filter is
      // honoured before trusting an incremental page.
      addCounters(counters, await client.verifyFutureCutoff(input.recordType));
      scan = await client.incrementalScan(
        input.recordType,
        new Date(new Date(watermarkFrom!).getTime() - OVERLAP_MILLISECONDS),
      );
    } else {
      scan = await client.fullScan(input.recordType, {
        windowStart: new Date(integration.historyStart),
        windowEnd: runStartedAt,
      });
    }
    addCounters(counters, scan);
    recordsSeen = new Set(scan.records.map((record) => record.jnid)).size;
    if (input.mode === "full" && recordsSeen !== scan.unfilteredCount) {
      throw new JobNimbusReconcileMismatchError();
    }

    const batchSize = input.batchSize ?? 500;
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
      throw new Error("JobNimbus sync batchSize must be a positive integer");
    }
    const records = scan.records.map((record) => ({
      jnid: record.jnid,
      payload: record,
      content_hash: hashJobNimbusPayload(record),
      jn_updated_at: epochSecondsToIso(record.date_updated),
    }));
    if (records.length === 0) {
      recordsChanged += await dependencies.store.landBatch({
        companyId: input.companyId,
        recordType: input.recordType,
        records: [],
        watermark: watermarkTo,
      });
    }
    for (let index = 0; index < records.length; index += batchSize) {
      recordsChanged += await dependencies.store.landBatch({
        companyId: input.companyId,
        recordType: input.recordType,
        records: records.slice(index, index + batchSize),
        watermark: watermarkTo,
      });
    }

    await dependencies.store.finishRun(runId, {
      status: "ok",
      finishedAt: dependencies.now().toISOString(),
      recordsSeen,
      recordsChanged,
      ...counters,
      watermarkTo,
      error: null,
    });
    if (input.mode === "full") {
      await dependencies.store.markLastFull({
        companyId: input.companyId,
        recordType: input.recordType,
        watermark: watermarkTo,
      });
    }

    return { runId, mode: input.mode, recordsSeen, recordsChanged, ...counters, watermark: watermarkTo };
  } catch (error) {
    addErrorCounters(counters, error);
    try {
      await dependencies.store.finishRun(runId, {
        status: error instanceof JobNimbusReconcileMismatchError ? "reconcile_mismatch" : "failed",
        finishedAt: dependencies.now().toISOString(),
        recordsSeen,
        recordsChanged,
        ...counters,
        watermarkTo,
        error: formatSyncError(error),
      });
    } catch (finalizationError) {
      if (error instanceof Error && error.cause === undefined) error.cause = finalizationError;
    }
    throw error;
  }
}

// Stored run errors carry only a category and HTTP status: never a response
// body, credential name, or customer value.
export function formatSyncError(error: unknown): string {
  if (error instanceof JobNimbusReconcileMismatchError) return error.message;
  if (error instanceof JobNimbusProviderError) {
    const status = typeof error.status === "number" ? ` (HTTP ${error.status})` : "";
    return `JobNimbus ${error.code} error${status}`;
  }
  return error instanceof Error
    ? "JobNimbus sync failed (internal error)"
    : "JobNimbus sync failed (unknown error)";
}

type Counters = { apiCalls: number; transientErrorCount: number; rateLimitErrorCount: number };

function addCounters(target: Counters, source: JobNimbusTelemetry): void {
  target.apiCalls += source.apiCalls;
  target.transientErrorCount += source.transientErrorCount;
  target.rateLimitErrorCount += source.rateLimitResponses;
}

function addErrorCounters(target: Counters, error: unknown): void {
  if (!(error instanceof JobNimbusProviderError)) return;
  target.apiCalls += error.apiCalls;
  target.transientErrorCount += error.transientErrorCount;
  target.rateLimitErrorCount += error.rateLimitResponses;
}

function epochSecondsToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const date = new Date(value * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// date_updated is excluded so a touch with no content change does not count
// as a change.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => key !== "date_updated")
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

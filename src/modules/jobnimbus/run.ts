import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { JobNimbusClient } from "./client";
import {
  createSupabaseJobNimbusProjectionStore,
  runJobNimbusProjection,
  type JobNimbusProjectionStore,
  type ProjectableRecordType,
} from "./project";
import {
  createSupabaseJobNimbusSyncStore,
  resolveJobNimbusCredential,
  runJobNimbusSync,
  type JobNimbusSyncDependencies,
} from "./sync";

// Contacts first so a job's primary contact is already projected when the
// job lands. Files, tasks and work orders are not needed for the journey.
export const WAREHOUSE_RECORD_TYPES: readonly ProjectableRecordType[] = ["contact", "job", "estimate"];

// A full scan doubles as the reconciliation pass: it re-reads everything and
// fails the run when the count does not match JobNimbus's own total.
const FULL_RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export type WarehouseDependencies = {
  sync: JobNimbusSyncDependencies;
  projection: { store: JobNimbusProjectionStore; now(): Date };
  listEnabledCompanies(): Promise<string[]>;
};

export function chooseSyncMode(
  state: { watermark: string; lastFullAt: string | null } | null,
  now: Date,
): "full" | "incremental" {
  if (!state || !state.lastFullAt) return "full";
  return now.getTime() - Date.parse(state.lastFullAt) >= FULL_RECONCILE_INTERVAL_MS
    ? "full"
    : "incremental";
}

export async function syncCompanyRecordType(
  input: { companyId: string; recordType: ProjectableRecordType },
  dependencies: WarehouseDependencies,
) {
  const state = await dependencies.sync.store.getSyncState(input.companyId, input.recordType);
  const mode = chooseSyncMode(state, dependencies.sync.now());
  const sync = await runJobNimbusSync({ ...input, mode }, dependencies.sync);
  // Projection is a full rebuild from local raw rows, so it also repairs any
  // projection a previous failed run left behind.
  const projection = await runJobNimbusProjection(input, dependencies.projection);
  return {
    mode,
    runId: sync.runId,
    recordsSeen: sync.recordsSeen,
    recordsChanged: sync.recordsChanged,
    apiCalls: sync.apiCalls,
    recordsProjected: projection.recordsProjected,
  };
}

export function createWarehouseDependencies(
  database: SupabaseClient<Database>,
  environment: Record<string, string | undefined>,
): WarehouseDependencies {
  const now = () => new Date();
  return {
    sync: {
      store: createSupabaseJobNimbusSyncStore(database),
      // Two workers max was the observed safe ceiling; one serial, paced
      // client per run stays well inside it.
      createClient: (apiKey) => new JobNimbusClient({ apiKey }),
      resolveCredential: (envKeyName) => resolveJobNimbusCredential(envKeyName, environment),
      now,
    },
    projection: { store: createSupabaseJobNimbusProjectionStore(database), now },
    async listEnabledCompanies() {
      const { data, error } = await database
        .from("company_integrations")
        .select("company_id")
        .eq("provider", "jobnimbus")
        .eq("enabled", true)
        .order("company_id");
      if (error || !data) throw new Error("JobNimbus integration listing failed", { cause: error });
      return data.map((row) => row.company_id);
    },
  };
}

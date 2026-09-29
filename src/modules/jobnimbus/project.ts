import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { normalizeEmailForMatching, normalizePhoneToE164 } from "@/modules/leads/normalize-contact";
import type { JobNimbusRecordType } from "./client";

const DEFAULT_PAGE_SIZE = 500;
const NUMERIC_12_2_MAX_CENTS = BigInt("999999999999");
const NUMERIC_12_2_MAX = 9_999_999_999.99;
const MIN_PORTABLE_EPOCH_SECONDS = -62_135_596_800;
const MAX_PORTABLE_EPOCH_SECONDS = 253_402_300_799;

type JsonObject = Record<string, unknown>;

export type ProjectableRecordType = "job" | "contact" | "estimate";

export type JobNimbusJobRow = Database["public"]["Tables"]["jn_jobs"]["Insert"] & { company_id: string; jnid: string };
export type JobNimbusContactRow = Database["public"]["Tables"]["jn_contacts"]["Insert"] & { company_id: string; jnid: string };
export type JobNimbusEstimateRow = Database["public"]["Tables"]["jn_estimates"]["Insert"] & { company_id: string; jnid: string };
export type JobNimbusProjectionRow = JobNimbusJobRow | JobNimbusContactRow | JobNimbusEstimateRow;

export class JobNimbusProjectionDataError extends Error {
  constructor(message = "JobNimbus projection encountered invalid raw data") {
    super(message);
    this.name = "JobNimbusProjectionDataError";
  }
}

export class JobNimbusProjectionStoreError extends Error {
  constructor(operation: string, options?: { cause?: unknown }) {
    super(`JobNimbus projection store ${operation} failed`, options);
    this.name = "JobNimbusProjectionStoreError";
  }
}

export function projectJobNimbusJob(input: {
  companyId: string;
  payload: JsonObject;
  fieldMap: JsonObject;
  projectedAt: string;
}): JobNimbusJobRow {
  const { payload } = input;
  return {
    company_id: input.companyId,
    jnid: requiredJnid(payload.jnid),
    number: text(payload.number),
    status_name: text(payload.status_name),
    status_changed_at: epochSecondsToIso(payload.date_status_change),
    record_type_name: text(payload.record_type_name),
    primary_contact_jnid: primaryContactJnid(payload.primary),
    sales_rep_jnid: text(payload.sales_rep),
    sales_rep_name: text(payload.sales_rep_name),
    address_line1: text(payload.address_line1),
    city: text(payload.city),
    state_text: text(payload.state_text),
    zip: text(payload.zip),
    shingle_line: mappedText(payload, input.fieldMap, "shingle_line"),
    job_type: mappedText(payload, input.fieldMap, "job_type"),
    estimate_total: money(payload.last_estimate),
    approved_total: money(payload.approved_estimate_total),
    is_active: typeof payload.is_active === "boolean" ? payload.is_active : null,
    is_archived: typeof payload.is_archived === "boolean" ? payload.is_archived : null,
    jn_created_at: epochSecondsToIso(payload.date_created),
    jn_updated_at: epochSecondsToIso(payload.date_updated),
    projected_at: input.projectedAt,
  };
}

export function projectJobNimbusContact(input: {
  companyId: string;
  payload: JsonObject;
  projectedAt: string;
}): JobNimbusContactRow {
  const { payload } = input;
  const email = text(payload.email);
  const phone = [payload.mobile_phone, payload.home_phone, payload.work_phone]
    .map((value) => text(value))
    .map((value) => (value ? normalizePhoneToE164(value) : null))
    .find((value) => value !== null) ?? null;
  return {
    company_id: input.companyId,
    jnid: requiredJnid(payload.jnid),
    display_name: text(payload.display_name),
    first_name: text(payload.first_name),
    last_name: text(payload.last_name),
    email_normalized: email && email.includes("@") ? normalizeEmailForMatching(email) : null,
    phone_normalized: phone,
    status_name: text(payload.status_name),
    record_type_name: text(payload.record_type_name),
    source_name: text(payload.source_name),
    sales_rep_jnid: text(payload.sales_rep),
    sales_rep_name: text(payload.sales_rep_name),
    address_line1: text(payload.address_line1),
    city: text(payload.city),
    state_text: text(payload.state_text),
    zip: text(payload.zip),
    is_archived: typeof payload.is_archived === "boolean" ? payload.is_archived : null,
    jn_created_at: epochSecondsToIso(payload.date_created),
    jn_updated_at: epochSecondsToIso(payload.date_updated),
    projected_at: input.projectedAt,
  };
}

export function projectJobNimbusEstimate(input: {
  companyId: string;
  payload: JsonObject;
  projectedAt: string;
}): JobNimbusEstimateRow {
  const { payload } = input;
  return {
    company_id: input.companyId,
    jnid: requiredJnid(payload.jnid),
    related_job_jnid: relatedJobJnid(payload.related) ?? text(payload.job_jnid),
    number: text(payload.number),
    status_name: text(payload.status_name),
    source: text(payload.source),
    estimate_total: firstMoney(payload.total, payload.estimate_total, payload.amount),
    approved_total: firstMoney(payload.approved_total, payload.approved_estimate_total),
    jn_created_at: epochSecondsToIso(payload.date_created),
    jn_updated_at: epochSecondsToIso(payload.date_updated),
    projected_at: input.projectedAt,
  };
}

export type StoredRawRecord = {
  company_id: string;
  jnid: string;
  record_type: string;
  payload: unknown;
};

export type JobNimbusProjectionStore = {
  getFieldMap(companyId: string): Promise<JsonObject>;
  readRawPage(input: {
    companyId: string;
    recordType: ProjectableRecordType;
    afterJnid: string | null;
    limit: number;
  }): Promise<StoredRawRecord[]>;
  upsertRows(recordType: ProjectableRecordType, rows: JobNimbusProjectionRow[]): Promise<void>;
};

const PROJECTION_TABLES = {
  job: "jn_jobs",
  contact: "jn_contacts",
  estimate: "jn_estimates",
} as const;

export function createSupabaseJobNimbusProjectionStore(
  database: SupabaseClient<Database>,
): JobNimbusProjectionStore {
  return {
    async getFieldMap(companyId) {
      const { data, error } = await database
        .from("company_integrations")
        .select("field_map")
        .eq("company_id", companyId)
        .eq("provider", "jobnimbus")
        .maybeSingle();
      if (error || !data) throw new JobNimbusProjectionStoreError("field map read", { cause: error });
      if (!isJsonObject(data.field_map)) throw new JobNimbusProjectionStoreError("field map validation");
      return data.field_map;
    },

    async readRawPage(input) {
      let query = database
        .from("jobnimbus_records")
        .select("company_id, jnid, record_type, payload")
        .eq("company_id", input.companyId)
        .eq("record_type", input.recordType);
      if (input.afterJnid !== null) query = query.gt("jnid", input.afterJnid);
      const { data, error } = await query.order("jnid", { ascending: true }).limit(input.limit);
      if (error || !data) throw new JobNimbusProjectionStoreError("raw read", { cause: error });
      return data;
    },

    async upsertRows(recordType, rows) {
      const table = PROJECTION_TABLES[recordType];
      const { error } = await database
        .from(table)
        .upsert(rows as never, { onConflict: "company_id,jnid" });
      if (error) throw new JobNimbusProjectionStoreError("write", { cause: error });
    },
  };
}

export function isProjectableRecordType(value: JobNimbusRecordType): value is ProjectableRecordType {
  return value === "job" || value === "contact" || value === "estimate";
}

// Rebuilds a projection table from the raw landing zone. Re-running is safe
// and is how a corrected field mapping is applied to history.
export async function runJobNimbusProjection(
  input: { companyId: string; recordType: ProjectableRecordType; pageSize?: number },
  dependencies: { store: JobNimbusProjectionStore; now(): Date },
): Promise<{ recordsProjected: number }> {
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
  const projectedAt = dependencies.now().toISOString();
  const fieldMap = input.recordType === "job"
    ? await dependencies.store.getFieldMap(input.companyId)
    : {};
  let recordsProjected = 0;
  let afterJnid: string | null = null;

  while (true) {
    const page = await dependencies.store.readRawPage({
      companyId: input.companyId,
      recordType: input.recordType,
      afterJnid,
      limit: pageSize,
    });
    if (page.length === 0) break;
    const rows = page.map((record) => {
      if (
        record.company_id !== input.companyId
        || record.record_type !== input.recordType
        || !isJsonObject(record.payload)
        || record.payload.jnid !== record.jnid
      ) {
        throw new JobNimbusProjectionDataError("JobNimbus projection raw record scope mismatch");
      }
      const common = { companyId: input.companyId, payload: record.payload, projectedAt };
      if (input.recordType === "job") return projectJobNimbusJob({ ...common, fieldMap });
      if (input.recordType === "contact") return projectJobNimbusContact(common);
      return projectJobNimbusEstimate(common);
    });
    await dependencies.store.upsertRows(input.recordType, rows);
    recordsProjected += rows.length;
    afterJnid = page[page.length - 1].jnid;
    if (page.length < pageSize) break;
  }

  return { recordsProjected };
}

// Custom fields are read by their stable cf_* key, never the display alias:
// aliases are emitted inconsistently and renameable by any JobNimbus admin.
function mappedText(payload: JsonObject, fieldMap: JsonObject, semantic: string): string | null {
  const source = Object.keys(fieldMap)
    .filter((key) => key.startsWith("cf_") && fieldMap[key] === semantic)
    .sort()[0];
  return source === undefined ? null : text(payload[source]);
}

function primaryContactJnid(value: unknown): string | null {
  if (!isJsonObject(value)) return null;
  const type = text(value.type)?.toLowerCase();
  return type === "contact" ? text(value.id) ?? text(value.jnid) : null;
}

function relatedJobJnid(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const relation = value.find((candidate) => isJsonObject(candidate) && candidate.type === "job");
  return isJsonObject(relation) ? text(relation.id) ?? text(relation.jnid) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function requiredJnid(value: unknown): string {
  const jnid = text(value);
  if (!jnid) throw new JobNimbusProjectionDataError("JobNimbus projection requires a non-empty jnid");
  return jnid;
}

function money(value: unknown): number | null {
  if (typeof value === "string") return decimalTextToMoney(value);
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(Math.abs(value) * 100) / 100 <= NUMERIC_12_2_MAX ? value : null;
}

function decimalTextToMoney(value: string): number | null {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (match === null) return null;
  const [, sign, whole, fraction = ""] = match;
  let cents = BigInt(`${whole}${fraction.padEnd(2, "0").slice(0, 2)}`);
  if (fraction.length > 2 && fraction[2] >= "5") cents += BigInt(1);
  if (cents > NUMERIC_12_2_MAX_CENTS) return null;
  return Number(sign === "-" ? -cents : cents) / 100;
}

function firstMoney(...values: unknown[]): number | null {
  for (const value of values) {
    const amount = money(value);
    if (amount !== null) return amount;
  }
  return null;
}

function epochSecondsToIso(value: unknown): string | null {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value <= 0
    || value < MIN_PORTABLE_EPOCH_SECONDS
    || value > MAX_PORTABLE_EPOCH_SECONDS
  ) {
    return null;
  }
  return new Date(value * 1_000).toISOString();
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

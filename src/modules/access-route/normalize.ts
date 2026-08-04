import type {
  JobNimbusContactRow,
  JobNimbusJobRow,
  JsonRecord,
  LeadConduitEventRow,
  LeadConduitFlowRow,
  LeadMasterCustomFieldRow,
  LeadMasterRecordRow,
} from "./contracts";

export function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

export function asArray(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.map(asRecord).filter((row): row is JsonRecord => row !== null);
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["Result", "result", "results", "data", "items", "contacts", "jobs", "flows", "events"]) {
    if (Array.isArray(record[key])) return asArray(record[key]);
  }
  return [];
}

function lookup(record: JsonRecord, key: string): unknown {
  if (key in record) return record[key];
  const match = Object.keys(record).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  if (match) return record[match];
  const segments = key.split(".");
  let current: unknown = record;
  for (const segment of segments) {
    const currentRecord = asRecord(current);
    if (!currentRecord) return undefined;
    const segmentMatch = Object.keys(currentRecord).find(
      (candidate) => candidate.toLowerCase() === segment.toLowerCase(),
    );
    if (!segmentMatch) return undefined;
    current = currentRecord[segmentMatch];
  }
  return current;
}

export function readString(record: JsonRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = lookup(record, key);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function readBoolean(record: JsonRecord, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const value = lookup(record, key);
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && ["true", "false"].includes(value.toLowerCase())) {
      return value.toLowerCase() === "true";
    }
  }
  return null;
}

function readNumber(record: JsonRecord, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = lookup(record, key);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

export function normalizePhone(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits.length >= 7 ? `+${digits}` : null;
}

export function normalizeEmail(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.includes("@") ? normalized : null;
}

export function toIso(value: unknown, fallback?: string): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value < 10_000_000_000 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? fallback ?? null : date.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback ?? null : date.toISOString();
  }
  return fallback ?? null;
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, child]) => {
    const sensitive = /(api.?key|access.?token|authorization|password|secret)/i.test(key);
    return [key, sensitive ? "[REDACTED]" : redactSecrets(child)];
  }));
}

function redactedRecord(record: JsonRecord): JsonRecord {
  return redactSecrets(record) as JsonRecord;
}

function redactUnapprovedJobNimbusFinancials(value: unknown, includeSoldValue: boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => redactUnapprovedJobNimbusFinancials(item, includeSoldValue));
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, child]) => {
    const financial = /(cost|margin|profit|commission)/i.test(key)
      || (!includeSoldValue && /(sold.?value|contract.?amount)/i.test(key));
    return [key, financial ? "[REDACTED:NOT_APPROVED]" : redactUnapprovedJobNimbusFinancials(child, includeSoldValue)];
  }));
}

function stringIds(value: unknown): string[] {
  return asArray(value).map((item) => readString(item, "id", "source_id", "destination_id"))
    .filter((id): id is string => id !== null);
}

export function normalizeLeadConduitFlow(
  record: JsonRecord,
  companyId: string,
  ingestedAt: string,
): LeadConduitFlowRow | null {
  const flowId = readString(record, "id");
  if (!flowId) return null;
  const fields = Array.isArray(record.fields)
    ? record.fields.filter((field): field is string => typeof field === "string")
    : [];
  return {
    company_id: companyId,
    flow_id: flowId,
    name: readString(record, "name") ?? "Unnamed flow",
    enabled: readBoolean(record, "enabled") ?? false,
    source_ids: stringIds(record.sources),
    destination_ids: stringIds(record.destinations),
    field_ids: fields,
    raw_payload: redactedRecord(record),
    vendor_created_at: toIso(record.created_at),
    vendor_updated_at: toIso(record.updated_at),
    ingested_at: ingestedAt,
  };
}

export function normalizeLeadConduitEvent(
  record: JsonRecord,
  companyId: string,
  ingestedAt: string,
): LeadConduitEventRow | null {
  const eventId = readString(record, "id");
  if (!eventId) return null;
  const vars = asRecord(record.vars) ?? {};
  const startTimestamp = lookup(record, "start_timestamp");
  return {
    company_id: companyId,
    event_id: eventId,
    flow_id: readString(record, "flow_id") ?? readString(vars, "flow.id"),
    source_id: readString(record, "source_id") ?? readString(vars, "source.id"),
    source_name: readString(record, "source_name") ?? readString(vars, "source.name"),
    lead_id: readString(record, "lead_id") ?? readString(vars, "lead.id", "submission.id"),
    event_type: readString(record, "type") ?? "unknown",
    occurred_at: toIso(startTimestamp, ingestedAt) ?? ingestedAt,
    outcome: readString(record, "outcome"),
    external_lead_id: readString(vars, "lead.external_lead_id", "lead.lead_id", "lead.id"),
    phone_normalized: normalizePhone(readString(vars, "lead.phone_1", "lead.phone", "lead.phone_number")),
    email_normalized: normalizeEmail(readString(vars, "lead.email")),
    raw_status: readString(vars, "lead.status", "lead.disposition") ?? readString(record, "outcome"),
    raw_payload: redactedRecord(record),
    is_test: readBoolean(record, "is_test") ?? readBoolean(vars, "lead.is_test", "submission.test") ?? false,
    ingested_at: ingestedAt,
  };
}

export function normalizeLeadMasterRecord(
  record: JsonRecord,
  kind: "lead" | "opportunity",
  companyId: string,
  ingestedAt: string,
): LeadMasterRecordRow | null {
  const recordId = readString(record, "recordIDField", "RecordID", "record_id", "RECDNO", "recdno");
  if (!recordId) return null;
  const entered = toIso(
    lookup(record, kind === "lead" ? "enteredField" : "DateCreated"),
    toIso(lookup(record, "dateCreatedField"), ingestedAt) ?? ingestedAt,
  ) ?? ingestedAt;
  return {
    company_id: companyId,
    record_id: kind === "opportunity"
      ? readString(record, "OppId", "oppIDField", "opportunity_id") ?? recordId
      : recordId,
    record_kind: kind,
    recdno: readString(record, "RECDNO", "recdnoField", "otherRECDNO") ?? (kind === "lead" ? recordId : null),
    opportunity_id: kind === "opportunity" ? readString(record, "OppId", "oppIDField") : null,
    external_lead_id: readString(record, "ExternalLeadID", "external_lead_id", "ImportKey", "importKeyField"),
    workgroup: readString(record, "Workgroup", "workgroupField", "workgroup"),
    lead_source: readString(record, "lead_SourceField", "LeadSource", "OppSource", "oppSourceField"),
    disposition: readString(record, "lead_StatusField", "Disposition", "dispositionField"),
    opportunity_status: kind === "opportunity"
      ? readString(record, "salesStatusField", "SalesStatus")
      : null,
    opportunity_stage: kind === "opportunity"
      ? readString(record, "salesStageField", "SalesStage")
      : null,
    opportunity_value: kind === "opportunity"
      ? readNumber(record, "oppTotalField", "OppTotal")
      : null,
    entered_at: entered,
    vendor_updated_at: toIso(lookup(record, "lastUpdatedField")) ?? toIso(lookup(record, "LastUpdated")),
    phone_normalized: normalizePhone(readString(record, "phoneField", "Phone", "cell_PhoneField", "Cell_Phone")),
    email_normalized: normalizeEmail(readString(record, "emailField", "Email")),
    raw_payload: redactedRecord(record),
    ingested_at: ingestedAt,
  };
}

export function normalizeLeadMasterCustomField(
  record: JsonRecord,
  companyId: string,
  ingestedAt: string,
): LeadMasterCustomFieldRow | null {
  const fieldId = readString(record, "questionIDField", "QuestionID", "field_id", "id");
  if (!fieldId) return null;
  return {
    company_id: companyId,
    workgroup: readString(record, "workgroupField", "Workgroup") ?? "",
    field_id: fieldId,
    label: readString(record, "questionField", "Label", "name") ?? fieldId,
    field_type: readString(record, "dataTypeField", "qTypeField", "type"),
    raw_payload: redactedRecord(record),
    ingested_at: ingestedAt,
  };
}

export function normalizeJobNimbusContact(
  record: JsonRecord,
  companyId: string,
  ingestedAt: string,
): JobNimbusContactRow | null {
  const contactId = readString(record, "id", "contact_id", "contactId", "jnid");
  if (!contactId) return null;
  const first = readString(record, "first_name", "firstName") ?? "";
  const last = readString(record, "last_name", "lastName") ?? "";
  return {
    company_id: companyId,
    contact_id: contactId,
    external_lead_id: readString(record, "external_lead_id", "externalId", "lead_id"),
    display_name: readString(record, "display_name", "name") ?? (`${first} ${last}`.trim() || null),
    status: readString(record, "status", "status_name", "stage"),
    phone_normalized: normalizePhone(readString(record, "mobile_phone", "phone", "phone_number")),
    email_normalized: normalizeEmail(readString(record, "email", "email_address")),
    vendor_created_at: toIso(lookup(record, "created_at")) ?? toIso(lookup(record, "date_created")),
    vendor_updated_at: toIso(lookup(record, "updated_at")) ?? toIso(lookup(record, "date_updated")),
    raw_payload: redactedRecord(record),
    ingested_at: ingestedAt,
  };
}

export function normalizeJobNimbusJob(
  record: JsonRecord,
  companyId: string,
  ingestedAt: string,
  includeSoldValue = false,
): JobNimbusJobRow | null {
  const jobId = readString(record, "id", "job_id", "jobId", "jnid");
  if (!jobId) return null;
  return {
    company_id: companyId,
    job_id: jobId,
    contact_id: readString(record, "contact_id", "contactId", "primary_contact_id", "customer_id"),
    external_lead_id: readString(record, "external_lead_id", "externalId", "lead_id"),
    source_system: "jobnimbus",
    status: readString(record, "status", "status_name"),
    stage: readString(record, "stage", "stage_name", "board_stage"),
    appointment_status: readString(record, "appointment_status", "appointmentStatus", "appointment.status"),
    appointment_at: toIso(lookup(record, "appointment_at"))
      ?? toIso(lookup(record, "appointment_date"))
      ?? toIso(lookup(record, "appointment.start")),
    sold_value: includeSoldValue ? readNumber(record, "sold_value", "soldValue", "contract_amount") : null,
    reengagement_triggered: readBoolean(record, "reengagement_triggered", "reengagementTriggered") ?? false,
    vendor_created_at: toIso(lookup(record, "created_at")) ?? toIso(lookup(record, "date_created")),
    vendor_updated_at: toIso(lookup(record, "updated_at")) ?? toIso(lookup(record, "date_updated")),
    raw_payload: redactSecrets(
      redactUnapprovedJobNimbusFinancials(record, includeSoldValue),
    ) as JsonRecord,
    ingested_at: ingestedAt,
  };
}

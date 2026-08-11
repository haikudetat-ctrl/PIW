import type {
  JobNimbusContactRow,
  JobNimbusJobRow,
  JsonRecord,
  LeadConduitEventRow,
  LeadConduitFlowRow,
  LeadConduitFlowRuleRow,
  LeadConduitFlowStepRow,
  LeadConduitRuleScope,
  LeadConduitSourceMetadataRow,
  LeadMasterCustomFieldRow,
  LeadMasterRecordRow,
} from "./contracts";

type LeadConduitTrustedFlowContext = {
  companyId: string;
  flowId: string;
  observedAt: string;
};

type LeadConduitEventContext = LeadConduitTrustedFlowContext & {
  channel: "webhook" | "poll";
};

type LeadConduitSourceContext = LeadConduitTrustedFlowContext & {
  sourceId: string;
};

type LeadConduitRuleContext = LeadConduitTrustedFlowContext & {
  ruleScope: LeadConduitRuleScope;
  ruleScopeId: string;
};

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
    const sensitive = /(api.?key|token|authorization|password|secret|credential|private.?key)/i.test(key);
    return [key, sensitive ? "[REDACTED]" : redactSecrets(child)];
  }));
}

function redactedRecord(record: JsonRecord): JsonRecord {
  return redactSecrets(record) as JsonRecord;
}

function jobNimbusPrimaryContactId(record: JsonRecord): string | null {
  const primary = asRecord(lookup(record, "primary"));
  if (!primary || readString(primary, "type")?.toLowerCase() !== "contact") return null;
  return readString(primary, "id", "jnid", "recid");
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
  context: LeadConduitTrustedFlowContext,
): LeadConduitFlowRow | null {
  const flowId = readString(record, "id");
  if (!flowId || flowId !== context.flowId) return null;
  const fields = Array.isArray(record.fields)
    ? record.fields.filter((field): field is string => typeof field === "string")
    : [];
  return {
    company_id: context.companyId,
    flow_id: context.flowId,
    name: readString(record, "name") ?? "Unnamed flow",
    enabled: readBoolean(record, "enabled") ?? false,
    source_ids: stringIds(record.sources),
    destination_ids: stringIds(record.destinations),
    field_ids: fields,
    raw_payload: redactedRecord(record),
    vendor_created_at: toIso(record.created_at),
    vendor_updated_at: toIso(record.updated_at),
    ingested_at: context.observedAt,
  };
}

function leadConduitPayloadFlowId(record: JsonRecord, vars: JsonRecord): string | null {
  return readString(record, "flow_id", "flow.id") ?? readString(vars, "flow.id");
}

function leadConduitFieldNames(record: JsonRecord): string[] {
  if (!Array.isArray(record.fields)) return [];
  const names = record.fields.flatMap((field) => {
    if (typeof field === "string" && field.trim()) return [field.trim()];
    const fieldRecord = asRecord(field);
    const name = fieldRecord ? readString(fieldRecord, "name", "label", "id") : null;
    return name ? [name] : [];
  });
  return [...new Set(names)].sort();
}

function leadConduitLeadName(vars: JsonRecord): string | null {
  const fullName = readString(vars, "lead.name", "lead.full_name");
  if (fullName) return fullName;
  const firstName = readString(vars, "lead.first_name") ?? "";
  const lastName = readString(vars, "lead.last_name") ?? "";
  return `${firstName} ${lastName}`.trim() || null;
}

function leadConduitRuleScope(value: string | null): LeadConduitRuleScope | null {
  return value === "flow_acceptance" || value === "source_acceptance" || value === "filter_step"
    ? value
    : null;
}

function compactRecord(entries: Array<[string, unknown]>): JsonRecord {
  return Object.fromEntries(entries.filter(([, value]) => value !== null && value !== undefined));
}

export function normalizeLeadConduitEvent(
  record: JsonRecord,
  context: LeadConduitEventContext,
): LeadConduitEventRow | null {
  const eventId = readString(record, "id");
  if (!eventId) return null;
  const vars = asRecord(record.vars) ?? {};
  const payloadFlowId = leadConduitPayloadFlowId(record, vars);
  if (payloadFlowId && payloadFlowId !== context.flowId) return null;
  const startTimestamp = lookup(record, "start_timestamp");
  const externalLeadId = readString(vars, "lead.external_id");
  const submittedPhone = readString(vars, "lead.phone_1", "lead.phone", "lead.phone_number");
  const submittedEmail = readString(vars, "lead.email");
  return {
    company_id: context.companyId,
    event_id: eventId,
    flow_id: context.flowId,
    source_id: readString(record, "source_id") ?? readString(vars, "source.id"),
    source_name: readString(record, "source_name") ?? readString(vars, "source.name"),
    lead_id: readString(record, "lead_id") ?? readString(vars, "lead.id", "submission.id"),
    event_type: readString(record, "type") ?? "unknown",
    occurred_at: toIso(startTimestamp, context.observedAt) ?? context.observedAt,
    outcome: readString(record, "outcome"),
    external_lead_id: externalLeadId,
    phone_normalized: normalizePhone(submittedPhone),
    email_normalized: normalizeEmail(submittedEmail),
    raw_status: readString(vars, "lead.status", "lead.disposition") ?? readString(record, "outcome"),
    step_id: readString(record, "step_id", "step.id") ?? readString(vars, "step.id"),
    step_name: readString(record, "step_name", "step.name") ?? readString(vars, "step.name"),
    rule_id: readString(record, "rule_id", "rule.id") ?? readString(vars, "rule.id"),
    rule_name: readString(record, "rule_name", "rule.name") ?? readString(vars, "rule.name"),
    rule_scope: leadConduitRuleScope(
      readString(record, "rule_scope", "rule.scope") ?? readString(vars, "rule.scope"),
    ),
    rule_scope_id: readString(record, "rule_scope_id", "rule.scope_id")
      ?? readString(vars, "rule.scope_id"),
    reason_category: readString(record, "reason_category", "reason.category", "reason.code")
      ?? readString(vars, "reason.category", "reason.code"),
    lead_name: leadConduitLeadName(vars),
    submitted_phone: submittedPhone,
    submitted_email: submittedEmail,
    submitted_address: readString(vars, "lead.address", "lead.submitted_address"),
    campaign: readString(vars, "lead.campaign", "campaign.name"),
    consent_reference: readString(vars, "lead.consent_reference", "lead.consent"),
    trustedform_url: readString(vars, "lead.trustedform_url", "lead.trustedform_cert_url"),
    attribution: compactRecord([["lead_external_id", externalLeadId]]),
    raw_payload: redactedRecord(record),
    is_test: readBoolean(record, "is_test") ?? readBoolean(vars, "lead.is_test", "submission.test") ?? false,
    ingestion_channels: [context.channel],
    first_observed_at: context.observedAt,
    webhook_received_at: context.channel === "webhook" ? context.observedAt : null,
    poll_observed_at: context.channel === "poll" ? context.observedAt : null,
    processing_status: "observed",
    piw_lead_id: null,
    processing_error_category: null,
    processing_attempts: 0,
    processing_claimed_at: null,
    processing_claimed_by: null,
    processing_next_attempt_at: null,
    ingested_at: context.observedAt,
  };
}

export function normalizeLeadConduitSourceMetadata(
  record: JsonRecord,
  context: LeadConduitSourceContext,
): LeadConduitSourceMetadataRow {
  const acceptance = asRecord(record.acceptance)
    ?? asRecord(record.acceptance_metadata)
    ?? {};
  return {
    company_id: context.companyId,
    flow_id: context.flowId,
    source_id: context.sourceId,
    source_name: readString(record, "name", "source_name"),
    field_names: leadConduitFieldNames(record),
    acceptance_metadata: redactedRecord(acceptance),
    raw_payload: redactedRecord(record),
    observed_at: context.observedAt,
  };
}

export function normalizeLeadConduitFlowStep(
  record: JsonRecord,
  context: LeadConduitTrustedFlowContext,
): LeadConduitFlowStepRow | null {
  const stepId = readString(record, "id", "step_id");
  const stepType = readString(record, "type", "step_type");
  if (!stepId || !stepType) return null;
  return {
    company_id: context.companyId,
    flow_id: context.flowId,
    step_id: stepId,
    step_type: stepType,
    step_name: readString(record, "name", "step_name"),
    step_order: readNumber(record, "order", "step_order") ?? 0,
    enabled: readBoolean(record, "enabled") ?? true,
    outcome: readString(record, "outcome"),
    observed_at: context.observedAt,
  };
}

export function normalizeLeadConduitFlowRule(
  record: JsonRecord,
  context: LeadConduitRuleContext,
): LeadConduitFlowRuleRow | null {
  const ruleId = readString(record, "id", "rule_id");
  const lhv = readString(record, "lhv", "left_hand_value");
  const operator = readString(record, "op", "operator");
  if (!ruleId || !lhv || !operator) return null;
  return {
    company_id: context.companyId,
    flow_id: context.flowId,
    rule_scope: context.ruleScope,
    rule_scope_id: context.ruleScopeId,
    rule_id: ruleId,
    rule_name: readString(record, "name", "rule_name"),
    lhv,
    operator,
    observed_at: context.observedAt,
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
    external_lead_id: readString(record, "external_lead_id", "external_id", "externalId", "lead_id"),
    display_name: readString(record, "display_name", "name") ?? (`${first} ${last}`.trim() || null),
    status: readString(record, "status_name", "status", "stage"),
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
    contact_id: readString(record, "contact_id", "contactId", "primary_contact_id", "customer_id")
      ?? jobNimbusPrimaryContactId(record),
    external_lead_id: readString(record, "external_lead_id", "externalId", "lead_id"),
    source_system: "jobnimbus",
    status: readString(record, "status_name", "status"),
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

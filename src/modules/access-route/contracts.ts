export type VendorSystem = "leadconduit" | "leadmaster" | "jobnimbus";

export type JsonRecord = Record<string, unknown>;

export type LeadConduitProbeResult = {
  ok: boolean;
  status: number;
  visibleFlowCount: number;
  approvedFlows: Array<{
    flowId: string;
    flowName: string;
    sourceCount: number;
    fieldNames: string[];
  }>;
  missingFlowNames: string[];
  errorCategory?: "authentication" | "authorization" | "rate_limit" | "upstream" | "invalid_response";
};

export type LeadConduitOperationalErrorCategory =
  | "authentication"
  | "authorization"
  | "rate_limit"
  | "upstream"
  | "invalid_response"
  | "persistence"
  | "mapping"
  | "invalid_payload"
  | "flow_mismatch"
  | "unsupported_event"
  | "retry_exhausted";

export type LeadConduitFlowRow = {
  company_id: string;
  flow_id: string;
  name: string;
  enabled: boolean;
  source_ids: string[];
  destination_ids: string[];
  field_ids: string[];
  raw_payload: JsonRecord;
  vendor_created_at: string | null;
  vendor_updated_at: string | null;
  ingested_at: string;
};

export type LeadConduitEventRow = {
  company_id: string;
  event_id: string;
  flow_id: string | null;
  source_id: string | null;
  source_name: string | null;
  lead_id: string | null;
  event_type: string;
  occurred_at: string;
  outcome: string | null;
  external_lead_id: string | null;
  phone_normalized: string | null;
  email_normalized: string | null;
  raw_status: string | null;
  raw_payload: JsonRecord;
  is_test: boolean;
  ingested_at: string;
};

export type LeadMasterRecordRow = {
  company_id: string;
  record_id: string;
  record_kind: "lead" | "opportunity";
  recdno: string | null;
  opportunity_id: string | null;
  external_lead_id: string | null;
  workgroup: string | null;
  lead_source: string | null;
  disposition: string | null;
  opportunity_status: string | null;
  opportunity_stage: string | null;
  opportunity_value: number | null;
  entered_at: string;
  vendor_updated_at: string | null;
  phone_normalized: string | null;
  email_normalized: string | null;
  raw_payload: JsonRecord;
  ingested_at: string;
};

export type LeadMasterCustomFieldRow = {
  company_id: string;
  workgroup: string;
  field_id: string;
  label: string;
  field_type: string | null;
  raw_payload: JsonRecord;
  ingested_at: string;
};

export type JobNimbusContactRow = {
  company_id: string;
  contact_id: string;
  external_lead_id: string | null;
  display_name: string | null;
  status: string | null;
  phone_normalized: string | null;
  email_normalized: string | null;
  vendor_created_at: string | null;
  vendor_updated_at: string | null;
  raw_payload: JsonRecord;
  ingested_at: string;
};

export type JobNimbusJobRow = {
  company_id: string;
  job_id: string;
  contact_id: string | null;
  external_lead_id: string | null;
  source_system: "jobnimbus";
  status: string | null;
  stage: string | null;
  appointment_status: string | null;
  appointment_at: string | null;
  sold_value: number | null;
  reengagement_triggered: boolean;
  vendor_created_at: string | null;
  vendor_updated_at: string | null;
  raw_payload: JsonRecord;
  ingested_at: string;
};

export interface AccessRouteRepository {
  getCompanyId(configuredCompanyId?: string): Promise<string>;
  getLastCursor(companyId: string, sourceSystem: VendorSystem): Promise<string | null>;
  beginRun(input: {
    companyId: string;
    sourceSystem: VendorSystem;
    syncKey: string;
  }): Promise<{ id: string; duplicate: boolean }>;
  finishRun(input: {
    runId: string;
    outcome: "succeeded" | "partial" | "failed" | "skipped";
    recordsSeen: number;
    recordsWritten: number;
    nextCursor?: string | null;
    errorCategory?: string | null;
    metadata?: JsonRecord;
  }): Promise<void>;
  upsertLeadConduitFlows(rows: LeadConduitFlowRow[]): Promise<number>;
  upsertLeadConduitEvents(rows: LeadConduitEventRow[]): Promise<number>;
  upsertLeadMasterRecords(rows: LeadMasterRecordRow[]): Promise<number>;
  upsertLeadMasterCustomFields(rows: LeadMasterCustomFieldRow[]): Promise<number>;
  upsertJobNimbusContacts(rows: JobNimbusContactRow[]): Promise<number>;
  upsertJobNimbusJobs(rows: JobNimbusJobRow[]): Promise<number>;
}

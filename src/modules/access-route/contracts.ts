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
  flow_id: string;
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
  step_id: string | null;
  step_name: string | null;
  rule_id: string | null;
  rule_name: string | null;
  rule_scope: string | null;
  rule_scope_id: string | null;
  reason_category: string | null;
  lead_name: string | null;
  submitted_phone: string | null;
  submitted_email: string | null;
  submitted_address: string | null;
  campaign: string | null;
  consent_reference: string | null;
  trustedform_url: string | null;
  attribution: JsonRecord;
  raw_payload: JsonRecord;
  is_test: boolean;
  ingestion_channels: Array<"webhook" | "poll">;
  first_observed_at: string;
  webhook_received_at: string | null;
  poll_observed_at: string | null;
  processing_status: "observed" | "pending" | "processed" | "failed" | "not_applicable";
  piw_lead_id: string | null;
  processing_error_category: LeadConduitOperationalErrorCategory | null;
  processing_attempts: number;
  processing_claimed_at: string | null;
  processing_claimed_by: string | null;
  processing_next_attempt_at: string | null;
  ingested_at: string;
};

export type LeadConduitSourceMetadataRow = {
  company_id: string;
  flow_id: string;
  source_id: string;
  source_name: string | null;
  field_names: string[];
  acceptance_metadata: JsonRecord;
  raw_payload: JsonRecord;
  observed_at: string;
};

export type LeadConduitFlowStepRow = {
  company_id: string;
  flow_id: string;
  step_id: string;
  step_type: string;
  step_name: string | null;
  step_order: number;
  enabled: boolean;
  outcome: string | null;
  observed_at: string;
};

export type LeadConduitRuleScope = "flow_acceptance" | "source_acceptance" | "filter_step";

export type LeadConduitFlowRuleRow = {
  company_id: string;
  flow_id: string;
  rule_scope: LeadConduitRuleScope;
  rule_scope_id: string;
  rule_id: string;
  rule_name: string | null;
  lhv: string;
  operator: string;
  observed_at: string;
};

export type LeadConduitEventBatch = {
  companyId: string;
  flowId: string;
  channel: "webhook" | "poll";
  observedAt: string;
  rows: LeadConduitEventRow[];
};

export type LeadConduitSnapshotBatch<T> = {
  companyId: string;
  flowId: string;
  rows: T[];
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
  upsertLeadConduitFlows(input: LeadConduitSnapshotBatch<LeadConduitFlowRow>): Promise<number>;
  upsertLeadConduitEvents(input: LeadConduitEventBatch): Promise<number>;
  upsertLeadConduitSourceMetadata?(
    input: LeadConduitSnapshotBatch<LeadConduitSourceMetadataRow>,
  ): Promise<number>;
  upsertLeadConduitFlowSteps?(
    input: LeadConduitSnapshotBatch<LeadConduitFlowStepRow>,
  ): Promise<number>;
  upsertLeadConduitFlowRules?(
    input: LeadConduitSnapshotBatch<LeadConduitFlowRuleRow>,
  ): Promise<number>;
  upsertLeadMasterRecords(rows: LeadMasterRecordRow[]): Promise<number>;
  upsertLeadMasterCustomFields(rows: LeadMasterCustomFieldRow[]): Promise<number>;
  upsertJobNimbusContacts(rows: JobNimbusContactRow[]): Promise<number>;
  upsertJobNimbusJobs(rows: JobNimbusJobRow[]): Promise<number>;
}

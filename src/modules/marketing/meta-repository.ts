import "server-only";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import type { MetaBrowserEventEnvelope, MetaDeliverySource } from "./meta-events";
import type { MetaDeliveryResult } from "./meta-conversions";

const POLICY_VERSION = "piw-privacy-v1";
const ALL_SEASON_SOURCE_URL = "https://allseasonsolar.net/";
const PIW_ASSESSMENT_SOURCE_URL = "https://piw-sepia.vercel.app/roof-estimate";

const metaEventNameSchema = z.enum(["Lead", "AssessmentCompleted"]);
const deliveryStatusSchema = z.enum([
  "pending",
  "sending",
  "sent",
  "retryable_failed",
  "permanent_failed",
]);
const isoDatetimeSchema = z.iso.datetime({ offset: true });

const deliveryRowSchema = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  lead_id: z.uuid(),
  assessment_id: z.uuid().nullable(),
  consent_id: z.uuid(),
  policy_version: z.literal(POLICY_VERSION),
  event_name: metaEventNameSchema,
  event_id: z.uuid(),
  event_time: isoDatetimeSchema,
  status: deliveryStatusSchema,
  attempt_count: z.number().int().nonnegative(),
  payload_hash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  meta_http_status: z.number().int().min(100).max(599).nullable(),
  meta_trace_id: z.string().max(128).nullable(),
  last_error_category: z.string().max(128).nullable(),
  last_attempted_at: isoDatetimeSchema.nullable(),
  sent_at: isoDatetimeSchema.nullable(),
  created_at: isoDatetimeSchema,
  updated_at: isoDatetimeSchema,
}).strict();

const deliveryRowsSchema = z.array(deliveryRowSchema).max(1);
const pendingRowsSchema = z.array(z.object({ id: z.uuid() }).strict()).max(50);
const contactRowSchema = z.object({
  email: z.string().min(1),
  phone: z.string().min(1),
  client_ip_address: z.string().nullable(),
  client_user_agent: z.string().nullable(),
  fbp: z.string().nullable(),
  fbc: z.string().nullable(),
}).strict();
const canonicalConsentEvidenceSchema = z.object({
  advertising_granted: z.boolean(),
  gpc_detected: z.boolean(),
  occurred_at: isoDatetimeSchema,
}).strict();
const canonicalConsentEvidenceRowsSchema = z.array(canonicalConsentEvidenceSchema).max(1);

const completionResultSchema = z.object({
  outcome: z.enum(["sent", "retryable_failed", "permanent_failed"]),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  traceId: z.string().max(128).nullable(),
  errorCategory: z.string().max(128).nullable(),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict().superRefine((result, context) => {
  if (result.outcome === "sent" && result.errorCategory !== null) {
    context.addIssue({ code: "custom", path: ["errorCategory"], message: "Sent delivery cannot have an error category" });
  }
  if (result.outcome !== "sent" && (result.traceId !== null || !result.errorCategory)) {
    context.addIssue({ code: "custom", path: ["errorCategory"], message: "Failed delivery requires one error category" });
  }
});

type RpcResponse = PromiseLike<{ data: unknown; error: unknown }>;
type ContactQuery = {
  select(columns: string): ContactQuery;
  eq(column: string, value: string): ContactQuery;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
};
type CanonicalConsentQuery = {
  select(columns: string): CanonicalConsentQuery;
  eq(column: "consent_id" | "policy_version", value: string): CanonicalConsentQuery;
  is(column: "company_id" | "lead_id", value: null): CanonicalConsentQuery;
  lte(column: "occurred_at", value: string): CanonicalConsentQuery;
  gte(column: "occurred_at", value: string): CanonicalConsentQuery;
  or(filters: string): CanonicalConsentQuery;
  order(column: "occurred_at", options: {ascending: boolean}): CanonicalConsentQuery;
  limit(value: number): CanonicalConsentQuery;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
  then<TResult1 = {data: unknown; error: unknown}, TResult2 = never>(
    onfulfilled?: ((value: {data: unknown; error: unknown}) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
};
type MetaRepositoryClient = {
  rpc(name: string, args: Record<string, unknown>): RpcResponse;
  from(table: "leads"): ContactQuery;
  from(table: "privacy_consent_evidence"): CanonicalConsentQuery;
};

export type ReservedMetaEvent = {
  deliveryId: string;
  envelope: MetaBrowserEventEnvelope;
};

export class MetaRepositoryError extends Error {
  constructor(operation: string) {
    super(`Meta delivery persistence failed during ${operation}`);
    this.name = "MetaRepositoryError";
  }
}

function oneDelivery(data: unknown, operation: string) {
  const parsed = deliveryRowsSchema.safeParse(data);
  if (!parsed.success) throw new MetaRepositoryError(operation);
  return parsed.data[0] ?? null;
}

function reservedEvent(row: z.infer<typeof deliveryRowSchema>): ReservedMetaEvent {
  return {
    deliveryId: row.id,
    envelope: {
      name: row.event_name,
      eventId: row.event_id,
      issuedAt: row.event_time,
    },
  };
}

export class SupabaseMetaRepository {
  constructor(
    private readonly client: MetaRepositoryClient = createServiceClient() as unknown as MetaRepositoryClient,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async reserveLead(input: {
    leadId: string;
    companyId: string;
    consentId: string;
    occurredAt: string;
  }): Promise<ReservedMetaEvent | null> {
    const { data, error } = await this.client.rpc("reserve_meta_lead_delivery", {
      p_lead_id: input.leadId,
      p_company_id: input.companyId,
      p_consent_id: input.consentId,
      p_policy_version: POLICY_VERSION,
      p_event_time: input.occurredAt,
    });
    if (error) throw new MetaRepositoryError("reserveLead");
    const row = oneDelivery(data, "reserveLead");
    if (!row) return null;
    if (
      row.event_name !== "Lead"
      || row.assessment_id !== null
      || row.lead_id !== input.leadId
      || row.company_id !== input.companyId
      || row.consent_id !== input.consentId
    ) {
      throw new MetaRepositoryError("reserveLead");
    }
    return reservedEvent(row);
  }

  async reserveAssessment(input: {
    assessmentId: string;
    companyId: string;
    consentId: string;
    occurredAt: string;
  }): Promise<ReservedMetaEvent | null> {
    const { data, error } = await this.client.rpc("reserve_meta_assessment_delivery", {
      p_assessment_id: input.assessmentId,
      p_company_id: input.companyId,
      p_consent_id: input.consentId,
      p_policy_version: POLICY_VERSION,
      p_event_time: input.occurredAt,
    });
    if (error) throw new MetaRepositoryError("reserveAssessment");
    const row = oneDelivery(data, "reserveAssessment");
    if (!row) return null;
    if (
      row.event_name !== "AssessmentCompleted"
      || row.assessment_id !== input.assessmentId
      || row.company_id !== input.companyId
      || row.consent_id !== input.consentId
    ) {
      throw new MetaRepositoryError("reserveAssessment");
    }
    return reservedEvent(row);
  }

  /**
   * Linked evidence authorizes the database reservation, but only the unlinked
   * canonical sequence can reflect a later website-origin revocation. Read it
   * before exposing contact or attribution fields to the CAPI sender.
   */
  private async hasCurrentCanonicalAdvertisingConsent(
    row: z.infer<typeof deliveryRowSchema>,
  ) {
    const historicalResult = await this.client
      .from("privacy_consent_evidence")
      .select("advertising_granted, gpc_detected, occurred_at")
      .eq("consent_id", row.consent_id)
      .eq("policy_version", row.policy_version)
      .is("company_id", null)
      .is("lead_id", null)
      .lte("occurred_at", row.event_time)
      .order("occurred_at", {ascending: false})
      .limit(1)
      .maybeSingle();
    if (historicalResult.error) throw new MetaRepositoryError("claimCanonicalConsent");
    const historical = canonicalConsentEvidenceSchema.safeParse(historicalResult.data);
    if (!historical.success || !historical.data.advertising_granted || historical.data.gpc_detected) {
      return false;
    }

    const revocationResult = await this.client
      .from("privacy_consent_evidence")
      .select("advertising_granted, gpc_detected, occurred_at")
      .eq("consent_id", row.consent_id)
      .eq("policy_version", row.policy_version)
      .is("company_id", null)
      .is("lead_id", null)
      .gte("occurred_at", row.event_time)
      .or("advertising_granted.eq.false,gpc_detected.eq.true")
      .limit(1);
    if (revocationResult.error) throw new MetaRepositoryError("claimCanonicalConsent");
    const revocations = canonicalConsentEvidenceRowsSchema.safeParse(revocationResult.data);
    if (!revocations.success) throw new MetaRepositoryError("claimCanonicalConsent");
    // Do not let a subsequent grant revive a historical delivery once a
    // revocation/GPC event exists at or after its original event time.
    return revocations.data.length === 0;
  }

  async claim(deliveryId: string): Promise<MetaDeliverySource | null> {
    const { data, error } = await this.client.rpc("claim_meta_delivery", {
      p_delivery_id: deliveryId,
      p_claimed_at: this.now(),
    });
    if (error) throw new MetaRepositoryError("claim");
    const row = oneDelivery(data, "claim");
    if (!row) return null;
    if (row.id !== deliveryId || row.status !== "sending") {
      throw new MetaRepositoryError("claim");
    }
    if (!await this.hasCurrentCanonicalAdvertisingConsent(row)) return null;

    const contactResult = await this.client
      .from("leads")
      .select("email, phone, client_ip_address, client_user_agent, fbp, fbc")
      .eq("id", row.lead_id)
      .eq("company_id", row.company_id)
      .maybeSingle();
    if (contactResult.error) throw new MetaRepositoryError("claimContact");
    const contact = contactRowSchema.safeParse(contactResult.data);
    if (!contact.success) throw new MetaRepositoryError("claimContact");

    return {
      deliveryId: row.id,
      eventName: row.event_name,
      eventId: row.event_id,
      eventTime: row.event_time,
      eventSourceUrl: row.event_name === "Lead"
        ? ALL_SEASON_SOURCE_URL
        : PIW_ASSESSMENT_SOURCE_URL,
      email: contact.data.email,
      phone: contact.data.phone,
      clientIpAddress: contact.data.client_ip_address,
      clientUserAgent: contact.data.client_user_agent,
      fbp: contact.data.fbp,
      fbc: contact.data.fbc,
    };
  }

  async listPending(limit: number): Promise<string[]> {
    const safeLimit = z.number().int().min(1).max(50).parse(limit);
    const { data, error } = await this.client.rpc("list_pending_meta_deliveries", {
      p_limit: safeLimit,
      p_observed_at: this.now(),
    });
    if (error) throw new MetaRepositoryError("listPending");
    const parsed = pendingRowsSchema.safeParse(data);
    if (!parsed.success) throw new MetaRepositoryError("listPending");
    return parsed.data.map((row) => row.id);
  }

  async complete(deliveryId: string, result: MetaDeliveryResult): Promise<void> {
    const parsedResult = completionResultSchema.parse(result);
    const diagnostic = parsedResult.outcome === "sent"
      ? parsedResult.traceId
      : parsedResult.errorCategory;
    const { data, error } = await this.client.rpc("complete_meta_delivery", {
      p_delivery_id: deliveryId,
      p_status: parsedResult.outcome,
      p_meta_http_status: parsedResult.httpStatus,
      p_payload_hash: parsedResult.payloadHash,
      p_diagnostic: diagnostic,
      p_completed_at: this.now(),
    });
    const row = error ? null : oneDelivery(data, "complete");
    if (error || !row || row.id !== deliveryId || row.status !== parsedResult.outcome) {
      throw new MetaRepositoryError("complete");
    }
  }
}

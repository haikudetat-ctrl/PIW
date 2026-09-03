import {z} from "zod";
import {createServiceClient} from "@/lib/supabase/service";
import {
  consultationCallWindows,
  consultationContactMethods,
  type ConsultationPreference,
  type ConsultationSummary,
} from "./consultation-preference";
import type {MetaBrowserEventEnvelope} from "@/modules/marketing/meta-events";
import type {VerifiedConsent} from "@/modules/privacy/consent";
export type {ConsultationCallWindow, ConsultationContactMethod, ConsultationPreference, ConsultationSummary} from "./consultation-preference";

export type CompletedAssessmentContext = {
  companyId: string;
  assessmentId: string;
  estimateId: string;
  /** Internal-only eligibility evidence. It is never serialized to the browser. */
  leadId?: string;
  calculationStatus?: "pending" | "ready" | "review_required" | "failed";
  hasTrustedMeasurement?: boolean;
  hasTrustedPricingPackages?: boolean;
};

export type AssessmentResultRepository = {
  findCompletedByToken(token: string): Promise<CompletedAssessmentContext | null>;
  requestConsultation(context: CompletedAssessmentContext, preference: ConsultationPreference, requestIp: string): Promise<ConsultationSummary>;
  consumeResultViewLimit(token: string, requestIp: string): Promise<boolean>;
  markResultViewed(input: {
    context: CompletedAssessmentContext;
    consent: VerifiedConsent | null;
    requestIp: string | null;
    userAgent: string;
  }): Promise<AssessmentResultViewAcknowledgement>;
};

export type AssessmentResultViewAcknowledgement = {
  resultViewedAt: string;
  metaDeliveryId: string | null;
  metaEvent: MetaBrowserEventEnvelope | null;
};

export class AssessmentResultAccessError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 429 | 503) { super(message); }
}

export class ConsultationRateLimitError extends Error {}

const preferenceSchema = z.object({
  contactMethod: z.enum(consultationContactMethods),
  callWindow: z.enum(consultationCallWindows).nullable(),
}).strict();
const ipSchema = z.union([z.ipv4(), z.ipv6()]);
const workflowStatusSchema = z.enum(["requested", "contacted", "booked", "closed"]);
const calculationStatusSchema = z.enum(["pending", "ready", "review_required", "failed"]);
const estimateRowSchema = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  lead_id: z.uuid(),
  status: calculationStatusSchema,
  roof_squares: z.coerce.number().finite().nullable(),
  range_low_cents: z.coerce.number().int().nullable(),
  range_high_cents: z.coerce.number().int().nullable(),
  pricing_version: z.string().min(1).nullable(),
}).strict();
const assessmentRowSchema = z.object({id: z.uuid(), lead_id: z.uuid()}).strict();
const packageRowSchema = z.object({
  tier_key: z.enum(["good", "better", "best"]),
  display_order: z.number().int().positive(),
  measured_roof_squares: z.coerce.number().finite(),
  range_low_cents: z.coerce.number().int(),
  range_high_cents: z.coerce.number().int(),
  pricing_version: z.string().min(1),
}).strict();
const consultationRpcSchema = z.array(z.object({
  request_id: z.uuid(),
  status: workflowStatusSchema,
  created_at: z.iso.datetime({offset: true}),
  contact_method: z.enum(consultationContactMethods),
  call_window: z.enum(consultationCallWindows).nullable(),
  timezone: z.literal("America/New_York"),
}).strict()).length(1);
const resultViewedRpcSchema = z.array(z.object({
  result_viewed_at: z.iso.datetime({offset: true}),
  meta_delivery_id: z.uuid().nullable(),
  meta_event_id: z.uuid().nullable(),
  meta_event_name: z.literal("AssessmentCompleted").nullable(),
  meta_event_time: z.iso.datetime({offset: true}).nullable(),
}).strict().superRefine((row, context) => {
  const values = [row.meta_delivery_id, row.meta_event_id, row.meta_event_name, row.meta_event_time];
  if (values.some((value) => value === null) && values.some((value) => value !== null)) {
    context.addIssue({code: "custom", message: "Malformed Meta acknowledgement envelope"});
  }
})).length(1);

export function parseConsultationRpcResult(data: unknown, preference: ConsultationPreference): ConsultationSummary {
  const parsed = consultationRpcSchema.safeParse(data);
  if (!parsed.success) throw new Error("Consultation persistence failed");
  const row = parsed.data[0];
  if (row.contact_method !== preference.contactMethod || row.call_window !== preference.callWindow) {
    throw new Error("Consultation persistence failed");
  }
  return {status: row.status, contactMethod: row.contact_method, callWindow: row.call_window, timezone: row.timezone};
}

export function parseResultViewedRpcResult(data: unknown) {
  const parsed = resultViewedRpcSchema.safeParse(data);
  if (!parsed.success) throw new Error("Result view persistence failed");
  const row = parsed.data[0];
  return {
    resultViewedAt: row.result_viewed_at,
    metaDeliveryId: row.meta_delivery_id,
    metaEvent: row.meta_event_id === null ? null : {
      name: row.meta_event_name!,
      eventId: row.meta_event_id,
      issuedAt: row.meta_event_time!,
    },
  } satisfies AssessmentResultViewAcknowledgement;
}

/**
 * Determines eligibility from server-only quote evidence. The browser receives
 * only a compact event envelope after this check has passed.
 */
export function isTrustedCompletedQuote(context: CompletedAssessmentContext) {
  return context.calculationStatus === "ready"
    && context.hasTrustedMeasurement === true
    && context.hasTrustedPricingPackages === true
    && Boolean(context.leadId);
}

function parsePreference(input: unknown): ConsultationPreference {
  const parsed = preferenceSchema.safeParse(input);
  if (!parsed.success) throw new AssessmentResultAccessError("Invalid consultation preference", 400);
  if (parsed.data.contactMethod === "call" && !parsed.data.callWindow) {
    throw new AssessmentResultAccessError("Choose an Eastern Time call window", 400);
  }
  if (parsed.data.contactMethod !== "call" && parsed.data.callWindow) {
    throw new AssessmentResultAccessError("Call windows are only available for calls", 400);
  }
  return parsed.data;
}

async function resolveCompleted(token: string, repository: AssessmentResultRepository) {
  if (!z.uuid().safeParse(token).success) throw new AssessmentResultAccessError("Assessment not found", 404);
  try {
    const context = await repository.findCompletedByToken(token);
    if (!context) throw new AssessmentResultAccessError("Assessment not found", 404);
    return context;
  } catch (error) {
    if (error instanceof AssessmentResultAccessError) throw error;
    throw new AssessmentResultAccessError("Assessment result is temporarily unavailable", 503);
  }
}

export async function requestRoofConsultation(token: string, input: unknown, requestIp: string, repository: AssessmentResultRepository) {
  const preference = parsePreference(input);
  if (!ipSchema.safeParse(requestIp).success) throw new AssessmentResultAccessError("Invalid request", 400);
  const context = await resolveCompleted(token, repository);
  try {
    return await repository.requestConsultation(context, preference, requestIp);
  } catch (error) {
    if (error instanceof ConsultationRateLimitError) {
      throw new AssessmentResultAccessError("Request limit reached. Please try again later.", 429);
    }
    throw new AssessmentResultAccessError("Assessment result is temporarily unavailable", 503);
  }
}

export async function markRoofAssessmentResultViewed(
  token: string,
  input: {
    consent: VerifiedConsent | null;
    requestIp: string | null;
    userAgent: string;
  },
  repository: AssessmentResultRepository,
) {
  const context = await resolveCompleted(token, repository);
  if (!isTrustedCompletedQuote(context)) {
    throw new AssessmentResultAccessError("Assessment quote is not ready", 409);
  }
  try {
    const result = await repository.markResultViewed({context, ...input});
    return {resultViewed: true as const, ...result, context};
  } catch {
    throw new AssessmentResultAccessError("Assessment result is temporarily unavailable", 503);
  }
}

type ServiceClient = ReturnType<typeof createServiceClient>;
type ResultViewRpcClient = {
  rpc(
    name: "consume_roof_assessment_result_view_limit",
    args: {p_public_token: string; p_request_ip: string},
  ): Promise<{data: unknown; error: {message?: string} | null}>;
  rpc(
    name: "acknowledge_roof_assessment_result_view",
    args: {
      p_company_id: string;
      p_assessment_id: string;
      p_estimate_id: string;
      p_consent_id: string | null;
      p_policy_version: string | null;
      p_analytics_granted: boolean | null;
      p_advertising_granted: boolean | null;
      p_gpc_detected: boolean | null;
      p_source: "banner" | "preferences" | "gpc" | null;
      p_request_ip: string | null;
      p_user_agent: string;
    },
  ): Promise<{data: unknown; error: {message?: string} | null}>;
};

export class SupabaseAssessmentResultRepository implements AssessmentResultRepository {
  constructor(private readonly service: ServiceClient = createServiceClient()) {}

  async findCompletedByToken(token: string) {
    const {data: estimate, error} = await this.service.from("roof_estimates")
      .select("id, company_id, lead_id, status, roof_squares, range_low_cents, range_high_cents, pricing_version")
      .eq("public_token", token).maybeSingle();
    if (error) throw error;
    if (!estimate) return null;
    const parsedEstimate = estimateRowSchema.safeParse(estimate);
    if (!parsedEstimate.success) throw new Error("Malformed estimate result");
    const {data: assessment, error: assessmentError} = await this.service.from("roof_assessments")
      .select("id, lead_id").eq("company_id", parsedEstimate.data.company_id).eq("estimate_id", parsedEstimate.data.id)
      .eq("status", "completed").maybeSingle();
    if (assessmentError) throw assessmentError;
    if (!assessment) return null;
    const parsedAssessment = assessmentRowSchema.safeParse(assessment);
    if (!parsedAssessment.success) throw new Error("Malformed assessment result");
    if (parsedAssessment.data.lead_id !== parsedEstimate.data.lead_id) return null;
    const {data: packages, error: packagesError} = await this.service.from("roof_estimate_packages")
      .select("tier_key, display_order, measured_roof_squares, range_low_cents, range_high_cents, pricing_version")
      .eq("company_id", parsedEstimate.data.company_id)
      .eq("estimate_id", parsedEstimate.data.id);
    if (packagesError) throw packagesError;
    const parsedPackages = z.array(packageRowSchema).safeParse(packages);
    if (!parsedPackages.success) throw new Error("Malformed assessment result");

    const estimateContext = parsedEstimate.data;
    const hasTrustedMeasurement = estimateContext.roof_squares !== null
      && estimateContext.roof_squares > 0
      && estimateContext.range_low_cents !== null
      && estimateContext.range_low_cents > 0
      && estimateContext.range_high_cents !== null
      && estimateContext.range_high_cents >= estimateContext.range_low_cents;
    const packagesMatchMeasurement = hasTrustedMeasurement
      && estimateContext.pricing_version !== null
      && parsedPackages.data.length === 3
      && parsedPackages.data.every((item) =>
        item.measured_roof_squares === estimateContext.roof_squares
        && item.pricing_version === estimateContext.pricing_version,
      );
    const good = parsedPackages.data.find((item) => item.tier_key === "good");
    const better = parsedPackages.data.find((item) => item.tier_key === "better");
    const best = parsedPackages.data.find((item) => item.tier_key === "best");
    const hasTrustedPricingPackages = packagesMatchMeasurement
      && good?.display_order === 1
      && better?.display_order === 2
      && better.range_low_cents === estimateContext.range_low_cents
      && better.range_high_cents === estimateContext.range_high_cents
      && best?.display_order === 3;
    return {
      companyId: estimateContext.company_id,
      leadId: estimateContext.lead_id,
      estimateId: estimateContext.id,
      assessmentId: parsedAssessment.data.id,
      calculationStatus: estimateContext.status,
      hasTrustedMeasurement,
      hasTrustedPricingPackages,
    };
  }

  async requestConsultation(context: CompletedAssessmentContext, preference: ConsultationPreference, requestIp: string): Promise<ConsultationSummary> {
    const {data, error} = await this.service.rpc("request_roof_consultation", {
      p_company_id: context.companyId,
      p_assessment_id: context.assessmentId,
      p_estimate_id: context.estimateId,
      p_contact_method: preference.contactMethod,
      p_call_window: preference.callWindow as never,
      p_timezone: "America/New_York",
      p_request_ip: requestIp,
    });
    if (error?.message === "Consultation rate limit exceeded") throw new ConsultationRateLimitError();
    if (error) throw new Error("Consultation persistence failed");
    return parseConsultationRpcResult(data, preference);
  }

  async consumeResultViewLimit(token: string, requestIp: string) {
    const {data, error} = await (this.service as unknown as ResultViewRpcClient).rpc("consume_roof_assessment_result_view_limit", {
      p_public_token: token,
      p_request_ip: requestIp,
    });
    if (error) throw new Error("Result view rate limit failed");
    const parsed = z.array(z.object({allowed: z.boolean()}).strict()).length(1).safeParse(data);
    if (!parsed.success) throw new Error("Result view rate limit failed");
    return parsed.data[0].allowed;
  }

  async markResultViewed({context, consent, requestIp, userAgent}: {
    context: CompletedAssessmentContext;
    consent: VerifiedConsent | null;
    requestIp: string | null;
    userAgent: string;
  }) {
    const {data, error} = await (this.service as unknown as ResultViewRpcClient).rpc("acknowledge_roof_assessment_result_view", {
      p_company_id: context.companyId,
      p_assessment_id: context.assessmentId,
      p_estimate_id: context.estimateId,
      p_consent_id: consent?.consentId ?? null,
      p_policy_version: consent?.policyVersion ?? null,
      p_analytics_granted: consent?.preferences.analytics ?? null,
      p_advertising_granted: consent?.preferences.advertising ?? null,
      p_gpc_detected: consent?.gpcDetected ?? null,
      p_source: consent ? (consent.gpcDetected ? "gpc" : "preferences") : null,
      p_request_ip: requestIp,
      p_user_agent: userAgent,
    });
    if (error) throw new Error("Result view persistence failed");
    return parseResultViewedRpcResult(data);
  }
}

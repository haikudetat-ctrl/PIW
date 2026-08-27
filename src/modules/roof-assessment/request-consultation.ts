import {z} from "zod";
import {createServiceClient} from "@/lib/supabase/service";
import {
  consultationCallWindows,
  consultationContactMethods,
  type ConsultationPreference,
  type ConsultationSummary,
} from "./consultation-preference";
export type {ConsultationCallWindow, ConsultationContactMethod, ConsultationPreference, ConsultationSummary} from "./consultation-preference";

export type CompletedAssessmentContext = {
  companyId: string;
  assessmentId: string;
  estimateId: string;
};

export type AssessmentResultRepository = {
  findCompletedByToken(token: string): Promise<CompletedAssessmentContext | null>;
  requestConsultation(context: CompletedAssessmentContext, preference: ConsultationPreference, requestIp: string): Promise<ConsultationSummary>;
  markResultViewed(context: CompletedAssessmentContext): Promise<{resultViewedAt: string}>;
};

export class AssessmentResultAccessError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 429 | 503) { super(message); }
}

export class ConsultationRateLimitError extends Error {}

const preferenceSchema = z.object({
  contactMethod: z.enum(consultationContactMethods),
  callWindow: z.enum(consultationCallWindows).nullable(),
}).strict();
const ipSchema = z.union([z.ipv4(), z.ipv6()]);
const workflowStatusSchema = z.enum(["requested", "contacted", "booked", "closed"]);
const estimateRowSchema = z.object({id: z.uuid(), company_id: z.uuid()}).strict();
const assessmentRowSchema = z.object({id: z.uuid()}).strict();
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
}).strict()).length(1);

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
  return {resultViewedAt: parsed.data[0].result_viewed_at};
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

export async function markRoofAssessmentResultViewed(token: string, repository: AssessmentResultRepository) {
  const context = await resolveCompleted(token, repository);
  try {
    await repository.markResultViewed(context);
    return {resultViewed: true as const};
  } catch {
    throw new AssessmentResultAccessError("Assessment result is temporarily unavailable", 503);
  }
}

type ServiceClient = ReturnType<typeof createServiceClient>;

export class SupabaseAssessmentResultRepository implements AssessmentResultRepository {
  constructor(private readonly service: ServiceClient = createServiceClient()) {}

  async findCompletedByToken(token: string) {
    const {data: estimate, error} = await this.service.from("roof_estimates")
      .select("id, company_id").eq("public_token", token).maybeSingle();
    if (error) throw error;
    if (!estimate) return null;
    const parsedEstimate = estimateRowSchema.safeParse(estimate);
    if (!parsedEstimate.success) throw new Error("Malformed estimate result");
    const {data: assessment, error: assessmentError} = await this.service.from("roof_assessments")
      .select("id").eq("company_id", parsedEstimate.data.company_id).eq("estimate_id", parsedEstimate.data.id)
      .eq("status", "completed").maybeSingle();
    if (assessmentError) throw assessmentError;
    if (!assessment) return null;
    const parsedAssessment = assessmentRowSchema.safeParse(assessment);
    if (!parsedAssessment.success) throw new Error("Malformed assessment result");
    return {companyId: parsedEstimate.data.company_id, estimateId: parsedEstimate.data.id, assessmentId: parsedAssessment.data.id};
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

  async markResultViewed(context: CompletedAssessmentContext) {
    const {data, error} = await this.service.rpc("mark_roof_assessment_result_viewed", {
      p_company_id: context.companyId,
      p_assessment_id: context.assessmentId,
      p_estimate_id: context.estimateId,
    });
    if (error) throw new Error("Result view persistence failed");
    return parseResultViewedRpcResult(data);
  }
}

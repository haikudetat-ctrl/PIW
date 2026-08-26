import {z} from "zod";
import {createServiceClient} from "@/lib/supabase/service";

export const consultationContactMethods = ["call", "text", "email"] as const;
export const consultationCallWindows = ["asap", "morning", "midday", "afternoon", "evening"] as const;
export type ConsultationContactMethod = typeof consultationContactMethods[number];
export type ConsultationCallWindow = typeof consultationCallWindows[number];

export type CompletedAssessmentContext = {
  companyId: string;
  assessmentId: string;
  estimateId: string;
};
export type ConsultationPreference = {
  contactMethod: ConsultationContactMethod;
  callWindow: ConsultationCallWindow | null;
};
export type ConsultationSummary = ConsultationPreference & {
  status: "requested";
  timezone: "America/New_York";
};

export type AssessmentResultRepository = {
  findCompletedByToken(token: string): Promise<CompletedAssessmentContext | null>;
  requestConsultation(context: CompletedAssessmentContext, preference: ConsultationPreference): Promise<ConsultationSummary>;
  markResultViewed(context: CompletedAssessmentContext): Promise<{resultViewedAt: string}>;
};

export class AssessmentResultAccessError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 503) { super(message); }
}

const preferenceSchema = z.object({
  contactMethod: z.enum(consultationContactMethods),
  callWindow: z.enum(consultationCallWindows).nullable(),
}).strict();

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

export async function requestRoofConsultation(token: string, input: unknown, repository: AssessmentResultRepository) {
  const preference = parsePreference(input);
  const context = await resolveCompleted(token, repository);
  try {
    return await repository.requestConsultation(context, preference);
  } catch {
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
    const {data: assessment, error: assessmentError} = await this.service.from("roof_assessments")
      .select("id").eq("company_id", estimate.company_id).eq("estimate_id", estimate.id)
      .eq("status", "completed").maybeSingle();
    if (assessmentError) throw assessmentError;
    return assessment ? {companyId: estimate.company_id, estimateId: estimate.id, assessmentId: assessment.id} : null;
  }

  async requestConsultation(context: CompletedAssessmentContext, preference: ConsultationPreference): Promise<ConsultationSummary> {
    const {data, error} = await this.service.rpc("request_roof_consultation", {
      p_company_id: context.companyId,
      p_assessment_id: context.assessmentId,
      p_estimate_id: context.estimateId,
      p_contact_method: preference.contactMethod,
      p_call_window: preference.callWindow as never,
      p_timezone: "America/New_York",
    });
    if (error || !data || data.length !== 1 || data[0].status !== "requested") throw new Error("Consultation persistence failed");
    return {...preference, status: "requested" as const, timezone: "America/New_York" as const};
  }

  async markResultViewed(context: CompletedAssessmentContext) {
    const {data, error} = await this.service.rpc("mark_roof_assessment_result_viewed", {
      p_company_id: context.companyId,
      p_assessment_id: context.assessmentId,
      p_estimate_id: context.estimateId,
    });
    if (error || !data || data.length !== 1) throw new Error("Result view persistence failed");
    return {resultViewedAt: data[0].result_viewed_at};
  }
}

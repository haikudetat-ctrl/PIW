import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type {
  AssessmentIntakeRepository,
  NormalizedAssessmentIntake,
} from "./start-or-resume";

export class AssessmentIntakePersistenceError extends Error {
  constructor() {
    super("Assessment intake persistence failed");
    this.name = "AssessmentIntakePersistenceError";
  }
}

function mapRpcResult(data: unknown): unknown {
  if (!Array.isArray(data) || data.length !== 1) return data;
  const row: unknown = data[0];
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;

  const record = row as Record<string, unknown>;
  return {
    attemptId: record.attempt_id,
    continuationSecret: record.continuation_secret,
    expiresAt: record.expires_at,
    isReplay: record.is_replay,
  };
}

export class SupabaseAssessmentIntakeRepository
implements AssessmentIntakeRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async startOrResume(input: NormalizedAssessmentIntake): Promise<unknown> {
    const {data, error} = await this.client.rpc("start_or_resume_roof_assessment", {
      p_company_id: input.companyId,
      p_submission_id: input.submissionId,
      p_name: input.name,
      p_phone_e164: input.phoneE164,
      p_email_normalized: input.emailNormalized,
      p_submitted_address: input.submittedAddress,
      p_google_place_id: input.googlePlaceId ?? "",
      p_presentation_key: input.presentationKey,
      p_entry_point: input.entryPoint,
      p_attribution: input.attribution as Json,
      p_referrer: input.referrer ?? "",
      p_disclosure_version: input.consent.disclosureVersion,
      p_consent_granted_at: input.consent.grantedAt,
      p_ip_address: input.consent.ipAddress,
      p_user_agent: input.consent.userAgent,
    });

    if (error) throw new AssessmentIntakePersistenceError();
    return mapRpcResult(data);
  }
}

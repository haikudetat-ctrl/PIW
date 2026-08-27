import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
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

const rawFirstIssueSchema = z.object({
  attempt_id: z.uuid(),
  continuation_secret: z.string().min(1),
  expires_at: z.iso.datetime({offset: true}),
  is_replay: z.literal(false),
}).strict();

const rawReplaySchema = z.object({
  attempt_id: z.uuid(),
  continuation_secret: z.null(),
  expires_at: z.iso.datetime({offset: true}),
  is_replay: z.literal(true),
}).strict();

const rawRpcEnvelopeSchema = z.tuple([
  z.discriminatedUnion("is_replay", [rawFirstIssueSchema, rawReplaySchema]),
]);

export class SupabaseAssessmentIntakeRepository
implements AssessmentIntakeRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async startOrResume(input: NormalizedAssessmentIntake): Promise<unknown> {
    try {
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

      const parsed = rawRpcEnvelopeSchema.safeParse(data);
      if (!parsed.success) throw new AssessmentIntakePersistenceError();
      const [row] = parsed.data;

      return {
        attemptId: row.attempt_id,
        continuationSecret: row.continuation_secret,
        expiresAt: row.expires_at,
        isReplay: row.is_replay,
      };
    } catch {
      throw new AssessmentIntakePersistenceError();
    }
  }
}

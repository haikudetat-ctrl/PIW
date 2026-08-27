import "server-only";
import {createHash, timingSafeEqual} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {z} from "zod";
import type {Database} from "@/lib/database.types";
import {readAssessmentSession} from "./assessment-session";
import {verifyContinuation} from "./continuation-token";

const attemptSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  assessmentId: z.uuid(),
  estimateId: z.uuid(),
  attemptKind: z.enum(["new", "resume_candidate"]),
  continuationSecretHash: z.string().regex(/^(?:\\x)?[a-f0-9]{64}$/i),
  expiresAt: z.iso.datetime({offset: true}),
  consumedAt: z.iso.datetime({offset: true}).nullable(),
});

const accessResultSchema = z.strictObject({
  assessmentId: z.uuid(),
  publicToken: z.uuid(),
});

export type ContinuationAuthorization =
  | {kind: "assessment"; assessmentId: string; publicToken: string}
  | {kind: "resume"; attemptId: string}
  | {kind: "invalid"};

export type ContinuationAuthorizationDependencies = {
  signingKey: string;
  now: () => Date;
  findAttempt: (attemptId: string) => Promise<unknown>;
  consumeNewAttempt: (input: {
    attemptId: string;
    companyId: string;
    assessmentId: string;
    estimateId: string;
    expectedSecretHash: string;
    consumedAt: string;
  }) => Promise<unknown>;
  resumeWithSession: (input: {
    attemptId: string;
    companyId: string;
    assessmentId: string;
    expectedSecretHash: string;
  }) => Promise<unknown>;
};

function normalizedHash(value: string) {
  return value.startsWith("\\x") ? value.slice(2).toLowerCase() : value.toLowerCase();
}

function continuationSecretMatches(secret: string, storedHash: string) {
  const supplied = createHash("sha256").update(secret, "utf8").digest();
  const stored = Buffer.from(normalizedHash(storedHash), "hex");
  return stored.length === supplied.length && timingSafeEqual(stored, supplied);
}

export async function authorizeAssessmentContinuation(
  continuation: string,
  sessionCookie: string | undefined,
  dependencies: ContinuationAuthorizationDependencies,
): Promise<ContinuationAuthorization> {
  try {
    const now = dependencies.now();
    if (!Number.isFinite(now.getTime())) return {kind: "invalid"};

    const capability = await verifyContinuation(
      continuation,
      dependencies.signingKey,
      now,
    );
    const attempt = attemptSchema.parse(await dependencies.findAttempt(capability.attemptId));
    if (
      attempt.id !== capability.attemptId
      || attempt.consumedAt !== null
      || Date.parse(attempt.expiresAt) <= now.getTime()
      || Date.parse(attempt.expiresAt) !== Date.parse(capability.expiresAt)
      || !continuationSecretMatches(capability.secret, attempt.continuationSecretHash)
    ) {
      return {kind: "invalid"};
    }

    if (attempt.attemptKind === "new") {
      const consumed = accessResultSchema.parse(await dependencies.consumeNewAttempt({
        attemptId: attempt.id,
        companyId: attempt.companyId,
        assessmentId: attempt.assessmentId,
        estimateId: attempt.estimateId,
        expectedSecretHash: normalizedHash(attempt.continuationSecretHash),
        consumedAt: now.toISOString(),
      }));
      if (consumed.assessmentId !== attempt.assessmentId) return {kind: "invalid"};
      return {kind: "assessment", ...consumed};
    }

    const session = await readAssessmentSession(
      sessionCookie,
      dependencies.signingKey,
      now,
    );
    if (!session || session.assessmentId !== attempt.assessmentId) {
      return {kind: "resume", attemptId: attempt.id};
    }

    const resumed = accessResultSchema.parse(await dependencies.resumeWithSession({
      attemptId: attempt.id,
      companyId: attempt.companyId,
      assessmentId: attempt.assessmentId,
      expectedSecretHash: normalizedHash(attempt.continuationSecretHash),
    }));
    if (resumed.assessmentId !== attempt.assessmentId) return {kind: "invalid"};
    return {kind: "assessment", ...resumed};
  } catch {
    return {kind: "invalid"};
  }
}

export function createSupabaseContinuationAuthorizationDependencies(
  client: SupabaseClient<Database>,
  signingKey: string,
): ContinuationAuthorizationDependencies {
  return {
    signingKey,
    now: () => new Date(),
    async findAttempt(attemptId) {
      const {data, error} = await client
        .from("roof_assessment_access_attempts")
        .select(
          "id, company_id, assessment_id, estimate_id, attempt_kind, continuation_secret_hash, expires_at, consumed_at",
        )
        .eq("id", attemptId)
        .maybeSingle();
      if (error) throw new Error("Assessment continuation unavailable");
      if (!data) return null;
      return {
        id: data.id,
        companyId: data.company_id,
        assessmentId: data.assessment_id,
        estimateId: data.estimate_id,
        attemptKind: data.attempt_kind,
        continuationSecretHash: data.continuation_secret_hash,
        expiresAt: data.expires_at,
        consumedAt: data.consumed_at,
      };
    },
    async consumeNewAttempt(input) {
      const {data: estimate, error: estimateError} = await client
        .from("roof_estimates")
        .select("public_token")
        .eq("id", input.estimateId)
        .eq("company_id", input.companyId)
        .maybeSingle();
      if (estimateError || !estimate) throw new Error("Assessment continuation unavailable");

      const {data, error} = await client
        .from("roof_assessment_access_attempts")
        .update({consumed_at: input.consumedAt, updated_at: input.consumedAt})
        .eq("id", input.attemptId)
        .eq("company_id", input.companyId)
        .eq("assessment_id", input.assessmentId)
        .eq("estimate_id", input.estimateId)
        .eq("attempt_kind", "new")
        .eq("continuation_secret_hash", `\\x${input.expectedSecretHash}`)
        .is("consumed_at", null)
        .gt("expires_at", input.consumedAt)
        .select("assessment_id")
        .maybeSingle();
      if (error) throw new Error("Assessment continuation unavailable");
      if (!data) return null;
      return {assessmentId: data.assessment_id, publicToken: estimate.public_token};
    },
    async resumeWithSession(input) {
      const {data, error} = await client.rpc("authorize_same_browser_roof_assessment_resume", {
        p_company_id: input.companyId,
        p_attempt_id: input.attemptId,
        p_assessment_id: input.assessmentId,
        p_continuation_secret_hash: `\\x${input.expectedSecretHash}`,
      });
      if (error || !data || data.length !== 1) {
        throw new Error("Assessment continuation unavailable");
      }
      return {
        assessmentId: data[0].assessment_id,
        publicToken: data[0].public_token,
      };
    },
  };
}

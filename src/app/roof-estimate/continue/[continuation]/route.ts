import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  ASSESSMENT_SESSION_COOKIE,
  readAssessmentSession,
  setAssessmentSession,
} from "@/modules/roof-assessment/assessment-session";
import { verifyContinuation } from "@/modules/roof-assessment/continuation-token";

const INVALID_LINK_MESSAGE = "This assessment link is invalid or has expired.";

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

type AccessResult = z.infer<typeof accessResultSchema>;

export type ContinuationRouteDependencies = {
  signingKey: string;
  now: () => Date;
  nodeEnv: "development" | "test" | "production";
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
    authorizedAt: string;
  }) => Promise<unknown>;
};

function invalidLinkResponse() {
  return new NextResponse(INVALID_LINK_MESSAGE, {
    status: 404,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function normalizedHash(value: string) {
  return value.startsWith("\\x") ? value.slice(2).toLowerCase() : value.toLowerCase();
}

function continuationSecretMatches(secret: string, storedHash: string) {
  const supplied = createHash("sha256").update(secret, "utf8").digest();
  const stored = Buffer.from(normalizedHash(storedHash), "hex");
  return stored.length === supplied.length && timingSafeEqual(stored, supplied);
}

function relativeRedirect(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url), 307);
}

async function assessmentRedirect(
  request: NextRequest,
  result: AccessResult,
  dependencies: ContinuationRouteDependencies,
  now: Date,
) {
  const response = relativeRedirect(request, `/roof-estimate/${result.publicToken}`);
  await setAssessmentSession(response, result.assessmentId, dependencies.signingKey, {
    now,
    nodeEnv: dependencies.nodeEnv,
  });
  return response;
}

export async function handleAssessmentContinuation(
  request: NextRequest,
  params: {continuation: string},
  dependencies: ContinuationRouteDependencies,
) {
  try {
    const now = dependencies.now();
    if (!Number.isFinite(now.getTime())) return invalidLinkResponse();

    const capability = await verifyContinuation(
      params.continuation,
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
      return invalidLinkResponse();
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
      if (consumed.assessmentId !== attempt.assessmentId) return invalidLinkResponse();
      return assessmentRedirect(request, consumed, dependencies, now);
    }

    const session = await readAssessmentSession(
      request.cookies.get(ASSESSMENT_SESSION_COOKIE)?.value,
      dependencies.signingKey,
      now,
    );
    if (!session || session.assessmentId !== attempt.assessmentId) {
      return relativeRedirect(request, `/roof-estimate/resume/${attempt.id}`);
    }

    const resumed = accessResultSchema.parse(await dependencies.resumeWithSession({
      attemptId: attempt.id,
      companyId: attempt.companyId,
      assessmentId: attempt.assessmentId,
      authorizedAt: now.toISOString(),
    }));
    if (resumed.assessmentId !== attempt.assessmentId) return invalidLinkResponse();
    return assessmentRedirect(request, resumed, dependencies, now);
  } catch {
    return invalidLinkResponse();
  }
}

function createRouteDependencies(
  signingKey: string,
  nodeEnv: "development" | "test" | "production",
): ContinuationRouteDependencies {
  const service = createServiceClient();

  return {
    signingKey,
    nodeEnv,
    now: () => new Date(),
    async findAttempt(attemptId) {
      const {data, error} = await service
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
      const {data: estimate, error: estimateError} = await service
        .from("roof_estimates")
        .select("public_token")
        .eq("id", input.estimateId)
        .eq("company_id", input.companyId)
        .maybeSingle();
      if (estimateError || !estimate) throw new Error("Assessment continuation unavailable");

      const {data, error} = await service
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
      const {data: authorized, error: authorizeError} = await service
        .from("roof_assessment_access_attempts")
        .update({verified_at: input.authorizedAt, updated_at: input.authorizedAt})
        .eq("id", input.attemptId)
        .eq("company_id", input.companyId)
        .eq("assessment_id", input.assessmentId)
        .eq("attempt_kind", "resume_candidate")
        .is("consumed_at", null)
        .gt("expires_at", input.authorizedAt)
        .select("id")
        .maybeSingle();
      if (authorizeError || !authorized) throw new Error("Assessment continuation unavailable");

      const {data, error} = await service.rpc("rotate_roof_estimate_public_token", {
        p_company_id: input.companyId,
        p_attempt_id: input.attemptId,
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

export async function GET(
  request: NextRequest,
  context: {params: Promise<{continuation: string}>},
) {
  try {
    const env = parseServerEnv(process.env);
    if (!env.ROOF_ASSESSMENT_SIGNING_SECRET) return invalidLinkResponse();
    return handleAssessmentContinuation(
      request,
      await context.params,
      createRouteDependencies(env.ROOF_ASSESSMENT_SIGNING_SECRET, env.NODE_ENV),
    );
  } catch {
    return invalidLinkResponse();
  }
}

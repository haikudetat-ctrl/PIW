import {NextRequest, NextResponse} from "next/server";
import {z} from "zod";
import {parseServerEnv} from "@/lib/env/server";
import {createServiceClient} from "@/lib/supabase/service";
import {setAssessmentSession} from "@/modules/roof-assessment/assessment-session";
import {
  checkResumeVerification,
  startResumeVerification,
  type CheckResumeVerificationResult,
  type ResumeVerificationDependencies,
  type ResumeVerificationRepository,
} from "@/modules/roof-assessment/resume-verification";
import {TwilioVerifyProvider} from "@/modules/roof-assessment/twilio-verify-provider";

const paramsSchema = z.strictObject({attempt: z.uuid()});
const requestSchema = z.discriminatedUnion("action", [
  z.strictObject({action: z.literal("start")}),
  z.strictObject({action: z.literal("check"), code: z.string().regex(/^[0-9]{6}$/)}),
]);
const ipSchema = z.union([z.ipv4(), z.ipv6()]);

type StartResult = {sent: boolean};

export type ResumeVerificationRouteDependencies = {
  signingKey: string;
  nodeEnv: "development" | "test" | "production";
  deploymentEnv: "development" | "test" | "preview" | "production";
  minimumResponseMs: number;
  nowMs: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  start: (input: {attemptId: string; requestIp: string}) => Promise<StartResult>;
  check: (input: {attemptId: string; code: string}) => Promise<CheckResumeVerificationResult>;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {"cache-control": "no-store"},
  });
}

function requestIp(
  request: NextRequest,
  deploymentEnv: ResumeVerificationRouteDependencies["deploymentEnv"],
) {
  if (deploymentEnv === "production") {
    // Vercel overwrites x-vercel-forwarded-for with the public client IP.
    // Never fall back to client-controlled x-forwarded-for in production.
    const marker = request.headers.get("x-vercel-id")?.trim();
    const vercelIp = request.headers.get("x-vercel-forwarded-for")?.trim();
    if (!marker || marker.length > 512 || !vercelIp || vercelIp.includes(",")) return null;
    const parsed = ipSchema.safeParse(vercelIp);
    return parsed.success ? parsed.data : null;
  }
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const direct = request.headers.get("x-real-ip")?.trim();
  const parsed = ipSchema.safeParse(forwarded || direct);
  return parsed.success ? parsed.data : null;
}

async function equalizeResponseTime(
  dependencies: ResumeVerificationRouteDependencies,
  startedAt: number,
) {
  const elapsed = Math.max(0, dependencies.nowMs() - startedAt);
  await dependencies.sleep(Math.max(0, dependencies.minimumResponseMs - elapsed));
}

export async function handleResumeVerification(
  request: NextRequest,
  rawParams: {attempt: string},
  dependencies: ResumeVerificationRouteDependencies,
) {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return json({status: "invalid_request"}, 400);
  const params = paramsSchema.safeParse(rawParams);
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return json({status: "invalid_request"}, 400);
  }
  const body = requestSchema.safeParse(rawBody);
  if (!params.success || !body.success) return json({status: "invalid_request"}, 400);

  const startedAt = dependencies.nowMs();
  let response: NextResponse;
  try {

    if (body.data.action === "start") {
      const ip = requestIp(request, dependencies.deploymentEnv);
      if (!ip) return json({status: "invalid_request"}, 400);
      try {
        await dependencies.start({attemptId: params.data.attempt, requestIp: ip});
      } catch {
        // Keep dependency/provider failures indistinguishable from accepted work.
      }
      // A valid, throttled, unknown, or provider-failed attempt is deliberately
      // indistinguishable so the endpoint cannot enumerate homeowners.
      response = json({status: "pending", cooldownSeconds: 60}, 202);
    } else {
      let checked: CheckResumeVerificationResult = {approved: false};
      try {
        checked = await dependencies.check({
          attemptId: params.data.attempt,
          code: body.data.code,
        });
      } catch {
        // Generic pending is the only externally visible failure.
      }
      if (!checked.approved) {
        response = json({status: "pending"});
      } else {
        response = json({
          status: "approved",
          redirectTo: `/roof-estimate/${checked.publicToken}`,
        });
        await setAssessmentSession(response, checked.assessmentId, dependencies.signingKey, {
          nodeEnv: dependencies.nodeEnv,
        });
      }
    }
  } catch {
    response = body.data.action === "start"
      ? json({status: "pending", cooldownSeconds: 60}, 202)
      : json({status: "pending"});
  }
  await equalizeResponseTime(dependencies, startedAt);
  return response;
}

function createRepository(): ResumeVerificationRepository {
  const service = createServiceClient();
  return {
    async reserveStart(input) {
      const {data, error} = await service.rpc("reserve_roof_assessment_verification_start", {
        p_attempt_id: input.attemptId,
        p_request_ip: input.requestIp,
      });
      if (error || !data || data.length !== 1) throw new Error("Verification unavailable");
      return {
        reservationId: data[0].reservation_id,
        companyId: data[0].company_id,
        to: data[0].destination_phone_e164,
      };
    },
    async recordProviderStart(input) {
      const {error} = await service.rpc("record_roof_assessment_verification_start", {
        p_company_id: input.companyId,
        p_attempt_id: input.attemptId,
        p_reservation_id: input.reservationId,
        p_provider_attempt_id: input.providerAttemptId,
      });
      if (error) throw new Error("Verification unavailable");
    },
    async findCheckContext(attemptId) {
      const {data, error} = await service
        .from("roof_assessment_access_attempts")
        .select("company_id, destination_phone_e164, provider_attempt_id")
        .eq("id", attemptId)
        .eq("attempt_kind", "resume_candidate")
        .is("consumed_at", null)
        .is("verified_at", null)
        .not("provider_attempt_id", "is", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (error || !data?.provider_attempt_id) return null;
      return {
        companyId: data.company_id,
        to: data.destination_phone_e164,
        providerAttemptId: data.provider_attempt_id,
      };
    },
    async approve(input) {
      const {data, error} = await service.rpc("approve_verified_roof_assessment_resume", {
        p_company_id: input.companyId,
        p_attempt_id: input.attemptId,
        p_provider_attempt_id: input.providerAttemptId,
      });
      if (error || !data || data.length !== 1) throw new Error("Verification unavailable");
      return {
        assessmentId: data[0].assessment_id,
        publicToken: data[0].public_token,
      };
    },
  };
}

function createDependencies(): ResumeVerificationRouteDependencies {
  const env = parseServerEnv(process.env);
  if (
    !env.TWILIO_VERIFY_ENABLED
    || !env.TWILIO_API_KEY_SID
    || !env.TWILIO_API_KEY_SECRET
    || !env.TWILIO_VERIFY_SERVICE_SID
    || !env.ROOF_ASSESSMENT_SIGNING_SECRET
  ) {
    return {
      signingKey: "verification-disabled-signing-key-32-bytes",
      nodeEnv: env.NODE_ENV,
      deploymentEnv: env.DEPLOYMENT_ENV,
      minimumResponseMs: 8_250,
      nowMs: () => Date.now(),
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      start: async () => ({sent: false}),
      check: async () => ({approved: false}),
    };
  }
  const useCases: ResumeVerificationDependencies = {
    repository: createRepository(),
    provider: new TwilioVerifyProvider({
      apiKeySid: env.TWILIO_API_KEY_SID,
      apiKeySecret: env.TWILIO_API_KEY_SECRET,
      serviceSid: env.TWILIO_VERIFY_SERVICE_SID,
    }),
  };
  return {
    signingKey: env.ROOF_ASSESSMENT_SIGNING_SECRET,
    nodeEnv: env.NODE_ENV,
    deploymentEnv: env.DEPLOYMENT_ENV,
    minimumResponseMs: 8_250,
    nowMs: () => Date.now(),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    start: (input) => startResumeVerification(input, useCases),
    check: (input) => checkResumeVerification(input, useCases),
  };
}

export async function POST(
  request: NextRequest,
  context: {params: Promise<{attempt: string}>},
) {
  try {
    const dependencies = createDependencies();
    return handleResumeVerification(request, await context.params, dependencies);
  } catch {
    return json({status: "pending"}, 202);
  }
}

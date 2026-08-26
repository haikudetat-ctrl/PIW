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
  start: (input: {attemptId: string; requestIp: string}) => Promise<StartResult>;
  check: (input: {attemptId: string; code: string}) => Promise<CheckResumeVerificationResult>;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {"cache-control": "no-store"},
  });
}

function requestIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const direct = request.headers.get("x-real-ip")?.trim();
  const parsed = ipSchema.safeParse(forwarded || direct);
  return parsed.success ? parsed.data : null;
}

export async function handleResumeVerification(
  request: NextRequest,
  rawParams: {attempt: string},
  dependencies: ResumeVerificationRouteDependencies,
) {
  try {
    const params = paramsSchema.safeParse(rawParams);
    const body = requestSchema.safeParse(await request.json());
    if (!params.success || !body.success) return json({status: "invalid_request"}, 400);

    if (body.data.action === "start") {
      const ip = requestIp(request);
      if (!ip) return json({status: "invalid_request"}, 400);
      await dependencies.start({attemptId: params.data.attempt, requestIp: ip});
      // A valid, throttled, unknown, or provider-failed attempt is deliberately
      // indistinguishable so the endpoint cannot enumerate homeowners.
      return json({status: "pending", cooldownSeconds: 60}, 202);
    }

    const checked = await dependencies.check({
      attemptId: params.data.attempt,
      code: body.data.code,
    });
    if (!checked.approved) return json({status: "pending"});

    const response = json({
      status: "approved",
      redirectTo: `/roof-estimate/${checked.publicToken}`,
    });
    await setAssessmentSession(response, checked.assessmentId, dependencies.signingKey, {
      nodeEnv: dependencies.nodeEnv,
    });
    return response;
  } catch {
    return json({status: "pending"});
  }
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

function createDependencies(): ResumeVerificationRouteDependencies | null {
  const env = parseServerEnv(process.env);
  if (
    !env.TWILIO_VERIFY_ENABLED
    || !env.TWILIO_API_KEY_SID
    || !env.TWILIO_API_KEY_SECRET
    || !env.TWILIO_VERIFY_SERVICE_SID
    || !env.ROOF_ASSESSMENT_SIGNING_SECRET
  ) return null;
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
    if (!dependencies) return json({status: "pending"}, 202);
    return handleResumeVerification(request, await context.params, dependencies);
  } catch {
    return json({status: "pending"}, 202);
  }
}

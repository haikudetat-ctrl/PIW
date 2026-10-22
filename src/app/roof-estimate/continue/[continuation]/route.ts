import {randomUUID} from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ASSESSMENT_SESSION_COOKIE } from "@/modules/roof-assessment/assessment-session";
import { createSupabaseContinuationAuthorizationDependencies } from "@/modules/roof-assessment/assessment-continuation";
import {
  applyContinuationSession,
  resolveContinuation,
  type ContinuationSessionDependencies,
} from "@/modules/roof-assessment/continuation-session";

const INVALID_LINK_MESSAGE = "This assessment link is invalid or has expired.";

export type ContinuationRouteDependencies = ContinuationSessionDependencies;

function invalidLinkResponse() {
  return new NextResponse(INVALID_LINK_MESSAGE, {
    status: 404,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function relativeRedirect(request: NextRequest, path: string) {
  const response = NextResponse.redirect(new URL(path, request.url), 307);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function handleAssessmentContinuation(
  request: NextRequest,
  params: {continuation: string},
  dependencies: ContinuationRouteDependencies,
) {
  const outcome = await resolveContinuation(
    params.continuation,
    request.cookies.get(ASSESSMENT_SESSION_COOKIE)?.value,
    dependencies,
  );
  if (outcome.kind === "invalid") return invalidLinkResponse();
  if (outcome.kind === "resume") {
    return relativeRedirect(request, `/roof-estimate/resume/${outcome.attemptId}`);
  }
  const response = relativeRedirect(request, `/roof-estimate/${outcome.publicToken}`);
  await applyContinuationSession(response, {
    assessmentId: outcome.assessmentId,
    continuation: params.continuation,
    privacyHandoff: request.nextUrl.searchParams.get("privacy_handoff"),
    transferPrivacy: outcome.firstVisit,
    now: dependencies.now(),
  }, dependencies);
  return response;
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
      {
        ...createSupabaseContinuationAuthorizationDependencies(
          createServiceClient(),
          env.ROOF_ASSESSMENT_SIGNING_SECRET,
        ),
        nodeEnv: env.NODE_ENV,
        privacySigningSecret: env.PRIVACY_CONSENT_SIGNING_SECRET,
        createConsentId: randomUUID,
      },
    );
  } catch {
    return invalidLinkResponse();
  }
}

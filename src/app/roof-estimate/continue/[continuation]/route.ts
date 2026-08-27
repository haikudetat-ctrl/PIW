import { NextRequest, NextResponse } from "next/server";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  ASSESSMENT_SESSION_COOKIE,
  setAssessmentSession,
} from "@/modules/roof-assessment/assessment-session";
import {
  authorizeAssessmentContinuation,
  createSupabaseContinuationAuthorizationDependencies,
  type ContinuationAuthorizationDependencies,
} from "@/modules/roof-assessment/assessment-continuation";

const INVALID_LINK_MESSAGE = "This assessment link is invalid or has expired.";

export type ContinuationRouteDependencies = ContinuationAuthorizationDependencies & {
  nodeEnv: "development" | "test" | "production";
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

function relativeRedirect(request: NextRequest, path: string) {
  const response = NextResponse.redirect(new URL(path, request.url), 307);
  response.headers.set("cache-control", "no-store");
  return response;
}

async function assessmentRedirect(
  request: NextRequest,
  result: {assessmentId: string; publicToken: string},
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
  const authorized = await authorizeAssessmentContinuation(
    params.continuation,
    request.cookies.get(ASSESSMENT_SESSION_COOKIE)?.value,
    dependencies,
  );
  if (authorized.kind === "invalid") return invalidLinkResponse();
  if (authorized.kind === "resume") {
    return relativeRedirect(request, `/roof-estimate/resume/${authorized.attemptId}`);
  }
  return assessmentRedirect(request, authorized, dependencies, dependencies.now());
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
      },
    );
  } catch {
    return invalidLinkResponse();
  }
}

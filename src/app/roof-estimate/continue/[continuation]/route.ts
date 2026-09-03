import {randomUUID} from "node:crypto";
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
import {
  CONSENT_POLICY_VERSION,
  PRIVACY_COOKIE_NAME,
  signConsentCookie,
} from "@/modules/privacy/consent";
import {verifyConsentHandoff} from "@/modules/privacy/consent-handoff";

const INVALID_LINK_MESSAGE = "This assessment link is invalid or has expired.";

export type ContinuationRouteDependencies = ContinuationAuthorizationDependencies & {
  nodeEnv: "development" | "test" | "production";
  privacySigningSecret?: string;
  createConsentId?: () => string;
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
  continuation: string,
  dependencies: ContinuationRouteDependencies,
  now: Date,
  transferPrivacy: boolean,
) {
  const response = relativeRedirect(request, `/roof-estimate/${result.publicToken}`);
  await setAssessmentSession(response, result.assessmentId, dependencies.signingKey, {
    now,
    nodeEnv: dependencies.nodeEnv,
  });
  const privacySigningSecret = dependencies.privacySigningSecret;
  if (
    transferPrivacy
    && privacySigningSecret
    && Buffer.byteLength(privacySigningSecret, "utf8") >= 32
  ) {
    let transferredConsent: Awaited<ReturnType<typeof verifyConsentHandoff>> | null = null;
    const privacyHandoff = request.nextUrl.searchParams.get("privacy_handoff");
    if (privacyHandoff) {
      try {
        transferredConsent = await verifyConsentHandoff(
          privacyHandoff,
          continuation,
          privacySigningSecret,
          now,
        );
      } catch {
        transferredConsent = null;
      }
    }
    const consent = {
      policyVersion: CONSENT_POLICY_VERSION,
      consentId: transferredConsent?.consentId
        ?? (dependencies.createConsentId ?? randomUUID)(),
      preferences: {
        necessary: true as const,
        analytics: transferredConsent?.analytics ?? false,
        advertising: transferredConsent?.advertising ?? false,
      },
      gpcDetected: transferredConsent?.gpc ?? false,
      updatedAt: now.toISOString(),
    };
    response.cookies.set({
      name: PRIVACY_COOKIE_NAME,
      value: signConsentCookie(consent, privacySigningSecret),
      httpOnly: true,
      secure: dependencies.nodeEnv === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 15_552_000,
    });
  }
  return response;
}

export async function handleAssessmentContinuation(
  request: NextRequest,
  params: {continuation: string},
  dependencies: ContinuationRouteDependencies,
) {
  let consumedNewAttempt = false;
  const authorized = await authorizeAssessmentContinuation(
    params.continuation,
    request.cookies.get(ASSESSMENT_SESSION_COOKIE)?.value,
    {
      ...dependencies,
      async consumeNewAttempt(input) {
        const result = await dependencies.consumeNewAttempt(input);
        if (result) consumedNewAttempt = true;
        return result;
      },
    },
  );
  if (authorized.kind === "invalid") return invalidLinkResponse();
  if (authorized.kind === "resume") {
    return relativeRedirect(request, `/roof-estimate/resume/${authorized.attemptId}`);
  }
  return assessmentRedirect(
    request,
    authorized,
    params.continuation,
    dependencies,
    dependencies.now(),
    consumedNewAttempt,
  );
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

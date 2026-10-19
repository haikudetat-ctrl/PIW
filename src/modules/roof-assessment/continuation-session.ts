import "server-only";
import {randomUUID} from "node:crypto";
import type {NextResponse} from "next/server";
import {
  ASSESSMENT_SESSION_COOKIE,
  setAssessmentSession,
} from "@/modules/roof-assessment/assessment-session";
import {
  authorizeAssessmentContinuation,
  type ContinuationAuthorizationDependencies,
} from "@/modules/roof-assessment/assessment-continuation";
import {
  CONSENT_POLICY_VERSION,
  PRIVACY_COOKIE_NAME,
  signConsentCookie,
} from "@/modules/privacy/consent";
import {verifyConsentHandoff} from "@/modules/privacy/consent-handoff";

export type ContinuationSessionDependencies = ContinuationAuthorizationDependencies & {
  nodeEnv: "development" | "test" | "production";
  privacySigningSecret?: string;
  createConsentId?: () => string;
};

export type ContinuationOutcome =
  | {kind: "invalid"}
  | {kind: "resume"; attemptId: string}
  | {kind: "assessment"; assessmentId: string; publicToken: string; firstVisit: boolean};

/**
 * Checks a continuation capability. A first visit consumes the attempt; later
 * visits need the browser's assessment session (or the resume check).
 */
export async function resolveContinuation(
  continuation: string,
  sessionCookie: string | undefined,
  dependencies: ContinuationSessionDependencies,
): Promise<ContinuationOutcome> {
  let firstVisit = false;
  const authorized = await authorizeAssessmentContinuation(continuation, sessionCookie, {
    ...dependencies,
    async consumeNewAttempt(input) {
      const result = await dependencies.consumeNewAttempt(input);
      if (result) firstVisit = true;
      return result;
    },
  });
  if (authorized.kind === "invalid") return {kind: "invalid"};
  if (authorized.kind === "resume") return {kind: "resume", attemptId: authorized.attemptId};
  return {kind: "assessment", assessmentId: authorized.assessmentId, publicToken: authorized.publicToken, firstVisit};
}

/**
 * Sets the browser's assessment session and, on the first visit, carries the
 * website's privacy choice over as a first-party consent cookie. Shared by the
 * continuation redirect and the quote chat's JSON exchange.
 */
export async function applyContinuationSession(
  response: NextResponse,
  input: {
    assessmentId: string;
    continuation: string;
    privacyHandoff: string | null;
    transferPrivacy: boolean;
    now: Date;
  },
  dependencies: ContinuationSessionDependencies,
) {
  await setAssessmentSession(response, input.assessmentId, dependencies.signingKey, {
    now: input.now,
    nodeEnv: dependencies.nodeEnv,
  });
  const privacySigningSecret = dependencies.privacySigningSecret;
  if (
    !input.transferPrivacy
    || !privacySigningSecret
    || Buffer.byteLength(privacySigningSecret, "utf8") < 32
  ) {
    return;
  }
  let transferredConsent: Awaited<ReturnType<typeof verifyConsentHandoff>> | null = null;
  if (input.privacyHandoff) {
    try {
      transferredConsent = await verifyConsentHandoff(
        input.privacyHandoff,
        input.continuation,
        privacySigningSecret,
        input.now,
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
    updatedAt: input.now.toISOString(),
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

export {ASSESSMENT_SESSION_COOKIE};

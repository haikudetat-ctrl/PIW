import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { describe, expect, test, vi } from "vitest";
import { setAssessmentSession } from "@/modules/roof-assessment/assessment-session";
import { createConsentHandoff } from "@/modules/privacy/consent-handoff";
import { verifyConsentCookie } from "@/modules/privacy/consent";
import { signContinuation } from "@/modules/roof-assessment/continuation-token";
import { handleAssessmentContinuation, type ContinuationRouteDependencies } from "./route";

const signingKey = "0123456789abcdef0123456789abcdef";
const now = new Date("2026-08-26T18:00:00.000Z");
const attemptId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const assessmentId = "33333333-3333-4333-8333-333333333333";
const estimateId = "44444444-4444-4444-8444-444444444444";
const publicToken = "55555555-5555-4555-8555-555555555555";
const secret = "a".repeat(64);
const secretHash = createHash("sha256").update(secret).digest("hex");
const privacySigningSecret = "0123456789abcdef0123456789abcdef";
const privacyConsentId = "77777777-7777-4777-8777-777777777777";

function request(cookie?: string, privacyHandoff?: string) {
  const url = new URL("https://roof.example/roof-estimate/continue/signed-token");
  if (privacyHandoff) url.searchParams.set("privacy_handoff", privacyHandoff);
  return new NextRequest(url, {
    headers: cookie ? {cookie: `as_roof_assessment=${cookie}`} : undefined,
  });
}

async function continuation() {
  return signContinuation(
    {attemptId, secret, expiresAt: "2026-08-26T18:15:00.000Z"},
    signingKey,
  );
}

function attempt(kind: "new" | "resume_candidate" = "new") {
  return {
    id: attemptId,
    companyId,
    assessmentId,
    estimateId,
    attemptKind: kind,
    continuationSecretHash: `\\x${secretHash}`,
    expiresAt: "2026-08-26T18:15:00.000Z",
    consumedAt: null,
  } as const;
}

function dependencies(
  overrides: Partial<ContinuationRouteDependencies> = {},
): ContinuationRouteDependencies {
  return {
    signingKey,
    now: () => now,
    nodeEnv: "production",
    privacySigningSecret,
    createConsentId: () => privacyConsentId,
    findAttempt: vi.fn(async () => attempt()),
    consumeNewAttempt: vi.fn(async () => ({assessmentId, publicToken})),
    resumeWithSession: vi.fn(async () => ({assessmentId, publicToken})),
    ...overrides,
  };
}

async function cookieFor(boundAssessmentId = assessmentId) {
  const response = NextResponse.json({ok: true});
  await setAssessmentSession(response, boundAssessmentId, signingKey, {now, nodeEnv: "test"});
  return response.cookies.get("as_roof_assessment")?.value;
}

async function responseBody(response: Response) {
  return {status: response.status, body: await response.text()};
}

describe("assessment continuation route", () => {
  test("sets transferred PIW consent only after successfully consuming a new attempt", async () => {
    const signedContinuation = await continuation();
    const handoff = await createConsentHandoff({
      consentId: privacyConsentId,
      policyVersion: "piw-privacy-v1",
      analytics: true,
      advertising: true,
      issuedAt: now.toISOString(),
    }, signedContinuation, privacySigningSecret);

    const response = await handleAssessmentContinuation(
      request(undefined, handoff),
      {continuation: signedContinuation},
      dependencies(),
    );

    const transferred = verifyConsentCookie(
      response.cookies.get("piw_privacy")?.value,
      privacySigningSecret,
    );
    expect(transferred).toMatchObject({
      consentId: privacyConsentId,
      preferences: {necessary: true, analytics: true, advertising: true},
    });
    expect(response.headers.get("location")).toBe(
      `https://roof.example/roof-estimate/${publicToken}`,
    );
  });

  test.each([
    ["missing", undefined],
    ["invalid", "not-a-valid-handoff"],
  ])("fails closed to Advertising denied for a %s handoff without blocking start", async (_case, handoff) => {
    const response = await handleAssessmentContinuation(
      request(undefined, handoff),
      {continuation: await continuation()},
      dependencies(),
    );

    expect(response.status).toBe(307);
    expect(verifyConsentCookie(
      response.cookies.get("piw_privacy")?.value,
      privacySigningSecret,
    )?.preferences).toEqual({necessary: true, analytics: false, advertising: false});
  });

  test("atomically consumes a new attempt, binds the browser, and redirects", async () => {
    const deps = dependencies();

    const response = await handleAssessmentContinuation(
      request(),
      {continuation: await continuation()},
      deps,
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://roof.example/roof-estimate/${publicToken}`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("as_roof_assessment=");
    expect(deps.consumeNewAttempt).toHaveBeenCalledWith({
      attemptId,
      companyId,
      assessmentId,
      estimateId,
      expectedSecretHash: secretHash,
      consumedAt: now.toISOString(),
    });
  });

  test("sends a resume candidate without its exact bound session to verification", async () => {
    const deps = dependencies({findAttempt: vi.fn(async () => attempt("resume_candidate"))});

    const response = await handleAssessmentContinuation(
      request(await cookieFor("66666666-6666-4666-8666-666666666666")),
      {continuation: await continuation()},
      deps,
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://roof.example/roof-estimate/resume/${attemptId}`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(deps.resumeWithSession).not.toHaveBeenCalled();
    expect(response.cookies.get("piw_privacy")).toBeUndefined();
  });

  test("rotates a resume candidate only when the signed session matches its assessment", async () => {
    const deps = dependencies({findAttempt: vi.fn(async () => attempt("resume_candidate"))});

    const response = await handleAssessmentContinuation(
      request(await cookieFor()),
      {continuation: await continuation()},
      deps,
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://roof.example/roof-estimate/${publicToken}`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(deps.resumeWithSession).toHaveBeenCalledWith({
      attemptId,
      companyId,
      assessmentId,
      expectedSecretHash: secretHash,
    });
    expect(response.cookies.get("piw_privacy")).toBeUndefined();
  });

  test.each([
    ["unknown", null],
    ["expired", {...attempt(), expiresAt: "2026-08-26T17:59:59.000Z"}],
    ["consumed", {...attempt(), consumedAt: "2026-08-26T17:59:00.000Z"}],
    ["wrong secret", {...attempt(), continuationSecretHash: `\\x${"b".repeat(64)}`}],
  ])("returns the same invalid-link response for an %s attempt", async (_name, found) => {
    const response = await handleAssessmentContinuation(
      request(),
      {continuation: await continuation()},
      dependencies({findAttempt: vi.fn(async () => found)}),
    );

    expect(await responseBody(response)).toEqual({
      status: 404,
      body: "This assessment link is invalid or has expired.",
    });
  });

  test("fails closed when a concurrent request consumes the attempt first", async () => {
    const response = await handleAssessmentContinuation(
      request(),
      {continuation: await continuation()},
      dependencies({consumeNewAttempt: vi.fn(async () => null)}),
    );

    expect(await responseBody(response)).toEqual({
      status: 404,
      body: "This assessment link is invalid or has expired.",
    });
    expect(response.cookies.get("piw_privacy")).toBeUndefined();
  });

  test("maps repository failures to the same generic invalid-link response", async () => {
    const response = await handleAssessmentContinuation(
      request(),
      {continuation: await continuation()},
      dependencies({findAttempt: vi.fn(async () => { throw new Error("database host leaked"); })}),
    );

    expect(await responseBody(response)).toEqual({
      status: 404,
      body: "This assessment link is invalid or has expired.",
    });
  });

  test("rejects a malformed database row before any state change", async () => {
    const consumeNewAttempt = vi.fn();
    const response = await handleAssessmentContinuation(
      request(),
      {continuation: await continuation()},
      dependencies({
        findAttempt: vi.fn(async () => ({...attempt(), leadId: crypto.randomUUID()})),
        consumeNewAttempt,
      }),
    );

    expect(response.status).toBe(404);
    expect(consumeNewAttempt).not.toHaveBeenCalled();
  });
});

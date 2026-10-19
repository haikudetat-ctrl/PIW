import {createHash} from "node:crypto";
import {NextRequest} from "next/server";
import {describe, expect, test, vi} from "vitest";
import {createConsentHandoff} from "@/modules/privacy/consent-handoff";
import {verifyConsentCookie} from "@/modules/privacy/consent";
import {signContinuation} from "@/modules/roof-assessment/continuation-token";
import type {ContinuationSessionDependencies} from "@/modules/roof-assessment/continuation-session";
import {handleContinuationExchange, parseContinuationPath} from "./continuation-exchange";

const signingKey = "0123456789abcdef0123456789abcdef";
const privacySigningSecret = "fedcba9876543210fedcba9876543210";
const now = new Date("2026-10-19T18:00:00.000Z");
const attemptId = "11111111-1111-4111-8111-111111111111";
const assessmentId = "33333333-3333-4333-8333-333333333333";
const publicToken = "55555555-5555-4555-8555-555555555555";
const secret = "a".repeat(64);
const secretHash = createHash("sha256").update(secret).digest("hex");

function dependencies(overrides: Partial<ContinuationSessionDependencies> = {}): ContinuationSessionDependencies {
  return {
    signingKey,
    now: () => now,
    nodeEnv: "production",
    privacySigningSecret,
    createConsentId: () => "77777777-7777-4777-8777-777777777777",
    findAttempt: vi.fn(async () => ({
      id: attemptId,
      companyId: "22222222-2222-4222-8222-222222222222",
      assessmentId,
      estimateId: "44444444-4444-4444-8444-444444444444",
      attemptKind: "new",
      continuationSecretHash: `\\x${secretHash}`,
      expiresAt: "2026-10-19T18:15:00.000Z",
      consumedAt: null,
    })),
    consumeNewAttempt: vi.fn(async () => ({assessmentId, publicToken})),
    resumeWithSession: vi.fn(async () => ({assessmentId, publicToken})),
    ...overrides,
  };
}

function exchange(path: unknown) {
  return new NextRequest("https://estimate.example.com/api/roof-estimate/continue", {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({path}),
  });
}

const signed = () => signContinuation({attemptId, secret, expiresAt: "2026-10-19T18:15:00.000Z"}, signingKey);

describe("parseContinuationPath", () => {
  test("takes the capability and the consent handoff from the intake's path", () => {
    expect(parseContinuationPath("/roof-estimate/continue/abc.def?privacy_handoff=xyz"))
      .toEqual({continuation: "abc.def", privacyHandoff: "xyz"});
    expect(parseContinuationPath("/roof-estimate/continue/abc")).toEqual({continuation: "abc", privacyHandoff: null});
  });

  test.each([
    "https://evil.example/roof-estimate/continue/abc",
    "//evil.example/roof-estimate/continue/abc",
    "/roof-estimate/continue/",
    "/roof-estimate/continue/abc/def",
    "/roof-estimate/abc",
  ])("rejects %s", (path) => {
    expect(parseContinuationPath(path)).toBeNull();
  });
});

describe("handleContinuationExchange", () => {
  test("answers with the estimate token and sets the same cookies as the redirect", async () => {
    const continuation = await signed();
    const handoff = await createConsentHandoff({
      consentId: "88888888-8888-4888-8888-888888888888",
      policyVersion: "piw-privacy-v1",
      analytics: true,
      advertising: false,
      issuedAt: now.toISOString(),
    }, continuation, privacySigningSecret);
    const response = await handleContinuationExchange(
      exchange(`/roof-estimate/continue/${continuation}?privacy_handoff=${handoff}`),
      dependencies(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({estimateToken: publicToken});
    expect(response.cookies.get("as_roof_assessment")?.value).toBeTruthy();
    expect(verifyConsentCookie(response.cookies.get("piw_privacy")?.value, privacySigningSecret)).toMatchObject({
      consentId: "88888888-8888-4888-8888-888888888888",
      preferences: {necessary: true, analytics: true, advertising: false},
    });
  });

  test("answers 409 when another browser already opened the estimate", async () => {
    const response = await handleContinuationExchange(
      exchange(`/roof-estimate/continue/${await signed()}`),
      dependencies({
        findAttempt: vi.fn(async () => ({
          id: attemptId,
          companyId: "22222222-2222-4222-8222-222222222222",
          assessmentId,
          estimateId: "44444444-4444-4444-8444-444444444444",
          attemptKind: "resume_candidate",
          continuationSecretHash: `\\x${secretHash}`,
          expiresAt: "2026-10-19T18:15:00.000Z",
          consumedAt: null,
        })),
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code: "verify"});
  });

  test.each([
    ["a path outside the continuation route", "/roof-estimate/p/abc"],
    ["a forged capability", "/roof-estimate/continue/forged.token"],
    ["no path at all", null],
  ])("answers 404 for %s", async (_label, path) => {
    const consume = vi.fn();
    const response = await handleContinuationExchange(exchange(path), dependencies({consumeNewAttempt: consume}));
    expect(response.status).toBe(404);
    expect(consume).not.toHaveBeenCalled();
  });
});

import {NextRequest} from "next/server";
import {describe, expect, test, vi} from "vitest";
import type {ResumeVerificationRouteDependencies} from "./route";
import {handleResumeVerification} from "./route";

const attemptId = "11111111-1111-4111-8111-111111111111";
const assessmentId = "22222222-2222-4222-8222-222222222222";
const publicToken = "33333333-3333-4333-8333-333333333333";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`https://roof.example/api/roof-estimate/resume/${attemptId}`, {
    method: "POST",
    headers: {"content-type": "application/json", "x-forwarded-for": "203.0.113.8", ...headers},
    body: JSON.stringify(body),
  });
}

function dependencies(overrides: Partial<ResumeVerificationRouteDependencies> = {}) {
  return {
    signingKey: "0123456789abcdef0123456789abcdef",
    nodeEnv: "production" as const,
    start: vi.fn(async () => ({sent: true})),
    check: vi.fn(async () => ({approved: false} as const)),
    ...overrides,
  } satisfies ResumeVerificationRouteDependencies;
}

describe("resume verification API", () => {
  test("returns the same no-store response whether a start is sent or unavailable", async () => {
    const sent = await handleResumeVerification(
      request({action: "start"}),
      {attempt: attemptId},
      dependencies(),
    );
    const unavailable = await handleResumeVerification(
      request({action: "start"}),
      {attempt: attemptId},
      dependencies({start: vi.fn(async () => ({sent: false}))}),
    );

    expect(sent.status).toBe(202);
    expect(await sent.json()).toEqual({status: "pending", cooldownSeconds: 60});
    expect(unavailable.status).toBe(202);
    expect(await unavailable.json()).toEqual({status: "pending", cooldownSeconds: 60});
    expect(sent.headers.get("cache-control")).toBe("no-store");
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
  });

  test("uses the first trusted forwarding address for the atomic start reservation", async () => {
    const deps = dependencies();

    await handleResumeVerification(
      request({action: "start"}, {"x-forwarded-for": "198.51.100.4, 10.0.0.2"}),
      {attempt: attemptId},
      deps,
    );

    expect(deps.start).toHaveBeenCalledWith({attemptId, requestIp: "198.51.100.4"});
  });

  test("sets the signed session and returns only a same-origin relative URL on approval", async () => {
    const response = await handleResumeVerification(
      request({action: "check", code: "314159"}),
      {attempt: attemptId},
      dependencies({check: vi.fn(async () => ({approved: true, assessmentId, publicToken}))}),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "approved",
      redirectTo: `/roof-estimate/${publicToken}`,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("as_roof_assessment=");
  });

  test("returns one generic no-store response for pending, unknown, expired, and provider failures", async () => {
    const cases = [
      dependencies(),
      dependencies({check: vi.fn(async () => { throw new Error("db detail"); })}),
    ];

    for (const deps of cases) {
      const response = await handleResumeVerification(
        request({action: "check", code: "314159"}),
        {attempt: attemptId},
        deps,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({status: "pending"});
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  test.each([
    ["malformed attempt", {attempt: "not-a-uuid"}, {action: "start"}],
    ["unknown action", {attempt: attemptId}, {action: "delete"}],
    ["extra field", {attempt: attemptId}, {action: "start", phone: "+16095550100"}],
    ["non-numeric code", {attempt: attemptId}, {action: "check", code: "31 4159"}],
    ["missing request address", {attempt: attemptId}, {action: "start"}],
  ])("rejects %s with the same no-store invalid-request response", async (label, params, body) => {
    const req = label === "missing request address"
      ? request(body, {"x-forwarded-for": ""})
      : request(body);
    const response = await handleResumeVerification(req, params, dependencies());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({status: "invalid_request"});
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

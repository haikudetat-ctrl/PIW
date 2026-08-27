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
    headers: {
      "content-type": "application/json",
      "x-vercel-forwarded-for": "203.0.113.8",
      "x-vercel-id": "cle1::iad1::request-123",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function dependencies(overrides: Partial<ResumeVerificationRouteDependencies> = {}) {
  return {
    signingKey: "0123456789abcdef0123456789abcdef",
    nodeEnv: "production" as const,
    deploymentEnv: "production" as const,
    minimumResponseMs: 8_250,
    nowMs: vi.fn(() => 0),
    sleep: vi.fn(async () => undefined),
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

  test("uses only Vercel's overwritten client address in production", async () => {
    const deps = dependencies();

    await handleResumeVerification(
      request({action: "start"}, {
        "x-vercel-forwarded-for": "198.51.100.4",
        "x-forwarded-for": "192.0.2.99, 10.0.0.2",
      }),
      {attempt: attemptId},
      deps,
    );

    expect(deps.start).toHaveBeenCalledWith({attemptId, requestIp: "198.51.100.4"});
  });

  test("fails closed without Vercel's production trust marker", async () => {
    const deps = dependencies();
    const response = await handleResumeVerification(
      request({action: "start"}, {"x-vercel-id": ""}),
      {attempt: attemptId},
      deps,
    );

    expect(response.status).toBe(400);
    expect(deps.start).not.toHaveBeenCalled();
  });

  test("allows controlled forwarding fallback only outside production", async () => {
    const deps = dependencies({deploymentEnv: "test"});
    const response = await handleResumeVerification(
      request({action: "start"}, {
        "x-vercel-forwarded-for": "",
        "x-vercel-id": "",
        "x-forwarded-for": "198.51.100.9, 10.0.0.2",
      }),
      {attempt: attemptId},
      deps,
    );

    expect(response.status).toBe(202);
    expect(deps.start).toHaveBeenCalledWith({attemptId, requestIp: "198.51.100.9"});
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
      ? request(body, {"x-vercel-forwarded-for": ""})
      : request(body);
    const response = await handleResumeVerification(req, params, dependencies());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({status: "invalid_request"});
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test.each([
    ["malformed JSON", "{", "application/json"],
    ["empty JSON", "", "application/json"],
    ["wrong content type", JSON.stringify({action: "start"}), "text/plain"],
  ])("returns a no-store invalid request for %s", async (_label, body, contentType) => {
    const req = new NextRequest(`https://roof.example/api/roof-estimate/resume/${attemptId}`, {
      method: "POST",
      headers: {"content-type": contentType},
      body,
    });

    const response = await handleResumeVerification(req, {attempt: attemptId}, dependencies());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({status: "invalid_request"});
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test.each([
    ["sent start", {action: "start"}, {}],
    ["unknown or throttled start", {action: "start"}, {start: vi.fn(async () => ({sent: false}))}],
    ["failed start dependency", {action: "start"}, {start: vi.fn(async () => { throw new Error("db"); })}],
    ["pending check", {action: "check", code: "314159"}, {}],
    ["failed check dependency", {action: "check", code: "314159"}, {check: vi.fn(async () => { throw new Error("provider"); })}],
    ["approved check", {action: "check", code: "314159"}, {
      check: vi.fn(async () => ({approved: true, assessmentId, publicToken})),
    }],
  ])("pads every syntactically valid %s branch to the same minimum", async (_label, body, overrides) => {
    const deps = dependencies(overrides);
    await handleResumeVerification(request(body), {attempt: attemptId}, deps);
    expect(deps.sleep).toHaveBeenCalledWith(8_250);
  });

  test("pads an eight-second provider timeout to the same 8.25-second response floor", async () => {
    const nowMs = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(9_000);
    const deps = dependencies({nowMs});

    await handleResumeVerification(
      request({action: "check", code: "314159"}),
      {attempt: attemptId},
      deps,
    );

    expect(deps.sleep).toHaveBeenCalledWith(250);
  });
});

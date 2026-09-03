import {describe, expect, test, vi} from "vitest";
import type {AssessmentResultRepository} from "@/modules/roof-assessment/request-consultation";
import {handleResultViewRequest, POST} from "./route";
import {NextRequest} from "next/server";

const token = "11111111-1111-4111-8111-111111111111";
const advertisingConsent = {
  policyVersion: "piw-privacy-v1" as const,
  consentId: "55555555-5555-4555-8555-555555555555",
  preferences: {necessary: true as const, analytics: false, advertising: true},
  gpcDetected: false,
  updatedAt: "2026-09-01T16:00:00.000Z",
};
const requestIp = "203.0.113.7";

function postRequest(origin: string | null, body: unknown = {}) {
  return new NextRequest("https://piw.example/api/roof-estimate/11111111-1111-4111-8111-111111111111/result-view", {
    method: "POST",
    headers: origin ? {origin, "content-type": "application/json"} : {"content-type": "application/json"},
    body: JSON.stringify(body),
  });
}

function repo(): AssessmentResultRepository {
  return {
    findCompletedByToken: vi.fn(async () => ({
      companyId: "22222222-2222-4222-8222-222222222222",
      leadId: "66666666-6666-4666-8666-666666666666",
      assessmentId: "33333333-3333-4333-8333-333333333333",
      estimateId: "44444444-4444-4444-8444-444444444444",
      calculationStatus: "ready" as const,
      hasTrustedMeasurement: true,
      hasTrustedPricingPackages: true,
    })),
    requestConsultation: vi.fn(),
    consumeResultViewLimit: vi.fn(async () => true),
    markResultViewed: vi.fn(async () => ({
      resultViewedAt: "2026-08-26T12:00:00.000Z",
      metaDeliveryId: null,
      metaEvent: null,
    })),
  };
}

function input(repository: AssessmentResultRepository, overrides: Partial<Parameters<typeof handleResultViewRequest>[0]> = {}) {
  return {
    token,
    repository,
    renderedReadyPackageQuote: true,
    requestIp,
    userAgent: "test-agent",
    ...overrides,
  };
}

describe("token-scoped result view route", () => {
  test("limits before looking up or acknowledging the completed result", async () => {
    const repository = repo();
    repository.consumeResultViewLimit = vi.fn(async () => false);

    const response = await handleResultViewRequest(input(repository));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({error: "Request limit reached. Please try again later."});
    expect(repository.findCompletedByToken).not.toHaveBeenCalled();
    expect(repository.markResultViewed).not.toHaveBeenCalled();
  });

  test("marks the exact completed result through one atomic acknowledgement RPC", async () => {
    const repository = repo();
    const response = await handleResultViewRequest(input(repository));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({resultViewed: true, metaEvent: null});
    expect(repository.consumeResultViewLimit).toHaveBeenCalledWith(token, requestIp);
    expect(repository.markResultViewed).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({assessmentId: "33333333-3333-4333-8333-333333333333"}),
      consent: null,
      requestIp,
      userAgent: "test-agent",
    }));
  });

  test("returns and dispatches the envelope that the atomic acknowledgement reserved", async () => {
    const repository = repo();
    repository.markResultViewed = vi.fn(async () => ({
      resultViewedAt: "2026-09-01T16:05:00.000Z",
      metaDeliveryId: "77777777-7777-4777-8777-777777777777",
      metaEvent: {
        name: "AssessmentCompleted" as const,
        eventId: "88888888-8888-4888-8888-888888888888",
        issuedAt: "2026-09-01T16:05:00.000Z",
      },
    }));
    const requestDelivery = vi.fn(async () => undefined);

    const response = await handleResultViewRequest(input(repository, {
      consent: advertisingConsent,
      metaTrackingEnabled: true,
      requestDelivery,
    }));

    await expect(response.json()).resolves.toEqual({
      resultViewed: true,
      metaEvent: {
        name: "AssessmentCompleted",
        eventId: "88888888-8888-4888-8888-888888888888",
        issuedAt: "2026-09-01T16:05:00.000Z",
      },
    });
    expect(repository.markResultViewed).toHaveBeenCalledWith(expect.objectContaining({consent: advertisingConsent}));
    expect(requestDelivery).toHaveBeenCalledWith("77777777-7777-4777-8777-777777777777");
  });

  test("never backfills an event when the first acknowledgement had no consent", async () => {
    const repository = repo();
    const requestDelivery = vi.fn(async () => undefined);
    const response = await handleResultViewRequest(input(repository, {
      consent: advertisingConsent,
      metaTrackingEnabled: true,
      requestDelivery,
    }));

    await expect(response.json()).resolves.toEqual({resultViewed: true, metaEvent: null});
    expect(requestDelivery).not.toHaveBeenCalled();
  });

  test.each([
    ["pending", false, true],
    ["failed", true, true],
    ["untrusted", true, false],
  ] as const)("%s pricing neither acknowledges nor reserves a result", async (calculationStatus, hasTrustedMeasurement, hasTrustedPricingPackages) => {
    const repository = repo();
    repository.findCompletedByToken = vi.fn(async () => ({
      companyId: "22222222-2222-4222-8222-222222222222",
      leadId: "66666666-6666-4666-8666-666666666666",
      assessmentId: "33333333-3333-4333-8333-333333333333",
      estimateId: "44444444-4444-4444-8444-444444444444",
      calculationStatus,
      hasTrustedMeasurement,
      hasTrustedPricingPackages,
    } as never));

    const response = await handleResultViewRequest(input(repository, {
      consent: advertisingConsent,
      metaTrackingEnabled: true,
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({error: "Assessment quote is not ready"});
    expect(repository.markResultViewed).not.toHaveBeenCalled();
  });

  test("keeps an acknowledged quote visible when queue dispatch fails", async () => {
    const repository = repo();
    repository.markResultViewed = vi.fn(async () => ({
      resultViewedAt: "2026-09-01T16:05:00.000Z",
      metaDeliveryId: "77777777-7777-4777-8777-777777777777",
      metaEvent: {
        name: "AssessmentCompleted" as const,
        eventId: "88888888-8888-4888-8888-888888888888",
        issuedAt: "2026-09-01T16:05:00.000Z",
      },
    }));
    const reportError = vi.fn();

    const response = await handleResultViewRequest(input(repository, {
      consent: advertisingConsent,
      metaTrackingEnabled: true,
      requestDelivery: async () => { throw new Error("queue unavailable"); },
      reportError,
    }));

    expect(response.status).toBe(200);
    expect(reportError).toHaveBeenCalledOnce();
  });

  test("does not accept a result acknowledgement unless the ready package quote rendered", async () => {
    const repository = repo();
    const response = await handleResultViewRequest(input(repository, {renderedReadyPackageQuote: false}));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({error: "Ready quote acknowledgement required"});
    expect(repository.consumeResultViewLimit).not.toHaveBeenCalled();
  });

  test.each([
    ["missing Origin", null, 403],
    ["mismatched Origin", "https://attacker.example", 403],
    ["same Origin", "https://piw.example", 400],
  ])("%s is enforced before result-view persistence", async (_label, origin, expectedStatus) => {
    const response = await POST(postRequest(origin), {params: Promise.resolve({token})});
    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

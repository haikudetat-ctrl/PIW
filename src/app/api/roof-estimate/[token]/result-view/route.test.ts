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
    markResultViewed: vi.fn(async () => ({resultViewedAt: "2026-08-26T12:00:00.000Z"})),
  };
}

describe("token-scoped result view route", () => {
  test("marks the exact completed result without returning internal state", async () => {
    const repository = repo();
    const response = await handleResultViewRequest({token, repository, renderedReadyPackageQuote: true});
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({resultViewed: true, metaEvent: null});
    expect(repository.markResultViewed).toHaveBeenCalledOnce();
  });

  test("uses a generic not-found response when the completed binding is absent", async () => {
    const repository = repo();
    repository.findCompletedByToken = vi.fn(async () => null);
    const response = await handleResultViewRequest({token, repository, renderedReadyPackageQuote: true});
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({error: "Assessment not found"});
  });

  test("returns AssessmentCompleted only after a consented trusted result is acknowledged", async () => {
    const repository = repo();
    const reserveAssessment = vi.fn(async () => ({
      deliveryId: "77777777-7777-4777-8777-777777777777",
      envelope: {
        name: "AssessmentCompleted" as const,
        eventId: "88888888-8888-4888-8888-888888888888",
        issuedAt: "2026-09-01T16:05:00.000Z",
      },
    }));
    const recordConsent = vi.fn(async () => undefined);
    const requestDelivery = vi.fn(async () => undefined);

    const response = await handleResultViewRequest({
      token,
      repository,
      consent: advertisingConsent,
      metaTrackingEnabled: true,
      recordConsent,
      reserveAssessment,
      requestDelivery,
      renderedReadyPackageQuote: true,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      resultViewed: true,
      metaEvent: {
        name: "AssessmentCompleted",
        eventId: "88888888-8888-4888-8888-888888888888",
        issuedAt: "2026-09-01T16:05:00.000Z",
      },
    });
    expect(repository.markResultViewed).toHaveBeenCalledBefore(recordConsent);
    expect(recordConsent).toHaveBeenCalledWith(expect.objectContaining({
      leadId: "66666666-6666-4666-8666-666666666666",
      companyId: "22222222-2222-4222-8222-222222222222",
      consent: advertisingConsent,
    }));
    expect(reserveAssessment).toHaveBeenCalledWith(expect.objectContaining({
      assessmentId: "33333333-3333-4333-8333-333333333333",
      companyId: "22222222-2222-4222-8222-222222222222",
      consentId: advertisingConsent.consentId,
    }));
    expect(requestDelivery).toHaveBeenCalledWith("77777777-7777-4777-8777-777777777777");
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
    const reserveAssessment = vi.fn();

    const response = await handleResultViewRequest({
      token,
      repository,
      consent: advertisingConsent,
      metaTrackingEnabled: true,
      recordConsent: vi.fn(async () => undefined),
      reserveAssessment,
      renderedReadyPackageQuote: true,
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({error: "Assessment quote is not ready"});
    expect(repository.markResultViewed).not.toHaveBeenCalled();
    expect(reserveAssessment).not.toHaveBeenCalled();
  });

  test("records a current consent revocation without reserving AssessmentCompleted", async () => {
    const repository = repo();
    const recordConsent = vi.fn(async () => undefined);
    const reserveAssessment = vi.fn();
    const response = await handleResultViewRequest({
      token,
      repository,
      consent: {
        ...advertisingConsent,
        preferences: {...advertisingConsent.preferences, advertising: false},
      },
      metaTrackingEnabled: true,
      recordConsent,
      reserveAssessment,
      renderedReadyPackageQuote: true,
    });

    await expect(response.json()).resolves.toEqual({resultViewed: true, metaEvent: null});
    expect(recordConsent).toHaveBeenCalledOnce();
    expect(reserveAssessment).not.toHaveBeenCalled();
  });

  test("keeps an acknowledged quote visible when Meta reservation fails", async () => {
    const repository = repo();
    const reportError = vi.fn();
    const response = await handleResultViewRequest({
      token,
      repository,
      consent: advertisingConsent,
      metaTrackingEnabled: true,
      recordConsent: vi.fn(async () => undefined),
      reserveAssessment: async () => { throw new Error("Meta unavailable"); },
      reportError,
      renderedReadyPackageQuote: true,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({resultViewed: true, metaEvent: null});
    expect(reportError).toHaveBeenCalledOnce();
  });

  test("does not accept a result acknowledgement unless the ready package quote rendered", async () => {
    const repository = repo();
    const reserveAssessment = vi.fn();
    const response = await handleResultViewRequest({
      token,
      repository,
      consent: advertisingConsent,
      metaTrackingEnabled: true,
      recordConsent: vi.fn(async () => undefined),
      reserveAssessment,
      renderedReadyPackageQuote: false,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({error: "Ready quote acknowledgement required"});
    expect(repository.markResultViewed).not.toHaveBeenCalled();
    expect(reserveAssessment).not.toHaveBeenCalled();
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

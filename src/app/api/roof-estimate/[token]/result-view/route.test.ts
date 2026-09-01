import {describe, expect, test, vi} from "vitest";
import type {AssessmentResultRepository} from "@/modules/roof-assessment/request-consultation";
import {handleResultViewRequest} from "./route";

const token = "11111111-1111-4111-8111-111111111111";
const advertisingConsent = {
  policyVersion: "piw-privacy-v1" as const,
  consentId: "55555555-5555-4555-8555-555555555555",
  preferences: {necessary: true as const, analytics: false, advertising: true},
  gpcDetected: false,
  updatedAt: "2026-09-01T16:00:00.000Z",
};
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
    const response = await handleResultViewRequest({token, repository});
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({resultViewed: true, metaEvent: null});
    expect(repository.markResultViewed).toHaveBeenCalledOnce();
  });

  test("uses a generic not-found response when the completed binding is absent", async () => {
    const repository = repo();
    repository.findCompletedByToken = vi.fn(async () => null);
    const response = await handleResultViewRequest({token, repository});
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
  ] as const)("%s pricing acknowledges the result without a Meta event", async (calculationStatus, hasTrustedMeasurement, hasTrustedPricingPackages) => {
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
    });

    await expect(response.json()).resolves.toEqual({resultViewed: true, metaEvent: null});
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
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({resultViewed: true, metaEvent: null});
    expect(reportError).toHaveBeenCalledOnce();
  });
});

import {describe, expect, test, vi} from "vitest";
import {SupabasePrivacyConsentRepository} from "./consent-repository";

const consentId = "11111111-1111-4111-8111-111111111111";

function currentEvidence(overrides: Record<string, unknown> = {}) {
  return {
    consent_id: consentId,
    policy_version: "piw-privacy-v1",
    analytics_granted: true,
    advertising_granted: false,
    gpc_detected: true,
    occurred_at: "2026-09-01T16:01:00.000Z",
    ...overrides,
  };
}

describe("SupabasePrivacyConsentRepository current consent", () => {
  test("reads only the latest unlinked canonical consent snapshot", async () => {
    const maybeSingle = vi.fn(async () => ({data: currentEvidence(), error: null}));
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      is: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      maybeSingle,
    };
    const service = {from: vi.fn(() => query)};
    const repository = new SupabasePrivacyConsentRepository(service as never);

    const consent = await (repository as unknown as {
      readCurrent(input: {consentId: string; policyVersion: "piw-privacy-v1"}): Promise<unknown>;
    }).readCurrent({consentId, policyVersion: "piw-privacy-v1"});

    expect(consent).toEqual({
      policyVersion: "piw-privacy-v1",
      consentId,
      preferences: {necessary: true, analytics: true, advertising: false},
      gpcDetected: true,
      updatedAt: "2026-09-01T16:01:00.000Z",
    });
    expect(service.from).toHaveBeenCalledWith("privacy_consent_evidence");
    expect(query.is).toHaveBeenCalledWith("company_id", null);
    expect(query.is).toHaveBeenCalledWith("lead_id", null);
    expect(query.order).toHaveBeenCalledWith("occurred_at", {ascending: false});
  });

  test("fails closed when canonical evidence cannot be read", async () => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      is: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({data: null, error: {message: "database unavailable"}})),
    };
    const repository = new SupabasePrivacyConsentRepository({from: vi.fn(() => query)} as never);

    await expect((repository as unknown as {
      readCurrent(input: {consentId: string; policyVersion: "piw-privacy-v1"}): Promise<unknown>;
    }).readCurrent({consentId, policyVersion: "piw-privacy-v1"})).rejects.toThrow(
      "Failed to read current privacy consent",
    );
  });
});

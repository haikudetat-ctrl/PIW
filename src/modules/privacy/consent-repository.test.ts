import {describe, expect, test, vi} from "vitest";
import {PrivacyConsentRateLimitError, SupabasePrivacyConsentRepository} from "./consent-repository";

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
    expect(query.order).toHaveBeenCalledWith("advertising_granted", {ascending: true});
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

  test("uses the atomic public-consent RPC and returns its canonical snapshot", async () => {
    const rpc = vi.fn(async () => ({data: [currentEvidence()], error: null}));
    const repository = new SupabasePrivacyConsentRepository({rpc} as never);

    await expect(repository.record({
      evidenceId: "22222222-2222-4222-8222-222222222222",
      consentId,
      policyVersion: "piw-privacy-v1",
      preferences: {necessary: true, analytics: true, advertising: false},
      gpcDetected: true,
      source: "gpc",
      requestIp: "203.0.113.7",
      userAgent: "test-agent",
      occurredAt: "2026-09-01T16:01:00.000Z",
    })).resolves.toMatchObject({
      consentId,
      preferences: {advertising: false},
      gpcDetected: true,
    });
    expect(rpc).toHaveBeenCalledWith("record_public_privacy_consent", expect.objectContaining({
      p_request_ip: "203.0.113.7",
      p_source: "gpc",
    }));
  });

  test("maps the database limit error to a route-safe typed error", async () => {
    const repository = new SupabasePrivacyConsentRepository({
      rpc: vi.fn(async () => ({data: null, error: {message: "Privacy consent request limit exceeded"}})),
    } as never);

    await expect(repository.record({
      evidenceId: "22222222-2222-4222-8222-222222222222",
      consentId,
      policyVersion: "piw-privacy-v1",
      preferences: {necessary: true, analytics: true, advertising: false},
      gpcDetected: false,
      source: "banner",
      requestIp: "203.0.113.7",
      userAgent: "test-agent",
      occurredAt: "2026-09-01T16:01:00.000Z",
    })).rejects.toBeInstanceOf(PrivacyConsentRateLimitError);
  });
});

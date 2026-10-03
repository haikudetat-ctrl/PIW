import { describe, expect, test, vi } from "vitest";
import { createPropertyPreview, type CreatePreviewDependencies, type CreatePreviewInput } from "./create-preview";

const exactEvidence = {
  submittedAddress: "1 Main St, Newark, NJ 07102",
  googlePlaceId: "ChIJ-one",
  canonicalAddress: "1 Main St, Newark, NJ 07102, USA",
  latitude: 40.7357,
  longitude: -74.1724,
  municipality: "Newark",
  county: "Essex",
  stateCode: "NJ",
  zip: "07102",
  matchMethod: "exact_single_match",
  confidence: 99,
};

function input(overrides: Partial<CreatePreviewInput> = {}): CreatePreviewInput {
  return {
    companyId: "11111111-1111-4111-8111-111111111111",
    address: "1 Main St, Newark, NJ 07102",
    googlePlaceId: "ChIJ-one",
    campaign: "weather-report",
    entryPoint: "campaign:weather-report",
    presentationKey: "weather-report",
    attribution: {utm_source: "facebook"},
    referrer: "https://allseasonroofingquote.com/campaigns/weather-report",
    clientIp: "203.0.113.5",
    userAgent: "Mozilla/5.0",
    turnstileToken: "turnstile-token",
    ...overrides,
  };
}

function dependencies(overrides: Partial<CreatePreviewDependencies> = {}) {
  const deps = {
    enabled: true,
    disclosureVersion: "all-season-property-preview-v1",
    verifyTurnstile: vi.fn(async () => ({kind: "passed" as const})),
    issueToken: vi.fn(() => ({token: "t".repeat(43), tokenHash: "a".repeat(64)})),
    resolveHost: vi.fn(async () => "estimate.allseasonroofingquote.com"),
    repository: {
      create: vi.fn(async () => ({previewId: "22222222-2222-4222-8222-222222222222", rateLimited: false})),
      applyPlace: vi.fn(async () => undefined),
      setMeasurementStatus: vi.fn(async () => undefined),
    },
    fetchPlaceDetails: vi.fn(async () => exactEvidence),
    requestMeasurement: vi.fn(async () => undefined),
    now: () => new Date("2026-10-03T12:00:00.000Z"),
    ...overrides,
  } satisfies CreatePreviewDependencies;
  return deps;
}

describe("createPropertyPreview", () => {
  test("creates a Google preview, resolves the place, and requests a measurement", async () => {
    const deps = dependencies();
    await expect(createPropertyPreview(input(), deps)).resolves.toEqual({
      kind: "created",
      previewUrl: `https://estimate.allseasonroofingquote.com/roof-estimate/p/${"t".repeat(43)}`,
    });
    expect(deps.repository.create).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "11111111-1111-4111-8111-111111111111",
      tokenHash: "a".repeat(64),
      addressMode: "google",
      googlePlaceId: "ChIJ-one",
      processingDisclosureVersion: "all-season-property-preview-v1",
      processingAcceptedAt: "2026-10-03T12:00:00.000Z",
    }));
    expect(deps.repository.applyPlace).toHaveBeenCalledWith({
      companyId: "11111111-1111-4111-8111-111111111111",
      previewId: "22222222-2222-4222-8222-222222222222",
      canonicalAddress: exactEvidence.canonicalAddress,
      latitude: exactEvidence.latitude,
      longitude: exactEvidence.longitude,
    });
    expect(deps.requestMeasurement).toHaveBeenCalledWith({
      companyId: "11111111-1111-4111-8111-111111111111",
      previewId: "22222222-2222-4222-8222-222222222222",
    });
  });

  test("verifies Turnstile before any write or provider call", async () => {
    const deps = dependencies({verifyTurnstile: vi.fn(async () => ({kind: "failed" as const}))});
    await expect(createPropertyPreview(input(), deps)).resolves.toEqual({kind: "challenge_failed"});
    expect(deps.repository.create).not.toHaveBeenCalled();
    expect(deps.fetchPlaceDetails).not.toHaveBeenCalled();
  });

  test("treats an unavailable challenge service as a failed challenge", async () => {
    const deps = dependencies({verifyTurnstile: vi.fn(async () => ({kind: "unavailable" as const}))});
    await expect(createPropertyPreview(input(), deps)).resolves.toEqual({kind: "challenge_failed"});
    expect(deps.repository.create).not.toHaveBeenCalled();
  });

  test("returns rate_limited without calling providers", async () => {
    const deps = dependencies();
    vi.mocked(deps.repository.create).mockResolvedValueOnce({previewId: null as unknown as string, rateLimited: true});
    await expect(createPropertyPreview(input(), deps)).resolves.toEqual({kind: "rate_limited"});
    expect(deps.fetchPlaceDetails).not.toHaveBeenCalled();
    expect(deps.requestMeasurement).not.toHaveBeenCalled();
  });

  test("is disabled when the flag is off or the company has no verified host", async () => {
    const off = dependencies({enabled: false});
    await expect(createPropertyPreview(input(), off)).resolves.toEqual({kind: "disabled"});
    expect(off.verifyTurnstile).not.toHaveBeenCalled();

    const noHost = dependencies({resolveHost: vi.fn(async () => null)});
    await expect(createPropertyPreview(input(), noHost)).resolves.toEqual({kind: "disabled"});
    expect(noHost.repository.create).not.toHaveBeenCalled();
  });

  test("still creates the preview when Place Details fails or is not an exact NJ match", async () => {
    for (const fetchPlaceDetails of [
      vi.fn(async () => { throw new Error("timeout"); }),
      vi.fn(async () => ({...exactEvidence, stateCode: "NY"})),
      vi.fn(async () => ({...exactEvidence, matchMethod: "approximate_match", confidence: 60})),
    ]) {
      const deps = dependencies({fetchPlaceDetails});
      await expect(createPropertyPreview(input(), deps)).resolves.toMatchObject({kind: "created"});
      expect(deps.repository.applyPlace).not.toHaveBeenCalled();
      expect(deps.requestMeasurement).not.toHaveBeenCalled();
      expect(deps.repository.setMeasurementStatus).toHaveBeenCalledWith(expect.objectContaining({status: "unavailable"}));
    }
  });

  test("gives Place Details a 2.5 second budget", async () => {
    const deps = dependencies();
    await createPropertyPreview(input(), deps);
    const call = vi.mocked(deps.fetchPlaceDetails).mock.calls[0] as unknown as [{signal: AbortSignal; googlePlaceId: string}];
    expect(call[0].googlePlaceId).toBe("ChIJ-one");
    expect(call[0].signal).toBeInstanceOf(AbortSignal);
  });

  test("manual addresses skip Place Details and are never measured", async () => {
    const deps = dependencies();
    await expect(createPropertyPreview(input({googlePlaceId: null}), deps)).resolves.toMatchObject({kind: "created"});
    expect(deps.repository.create).toHaveBeenCalledWith(expect.objectContaining({addressMode: "manual", googlePlaceId: null}));
    expect(deps.fetchPlaceDetails).not.toHaveBeenCalled();
    expect(deps.requestMeasurement).not.toHaveBeenCalled();
    expect(deps.repository.setMeasurementStatus).toHaveBeenCalledWith(expect.objectContaining({status: "unavailable"}));
  });

  test("a failed measurement request degrades the reveal without failing the preview", async () => {
    const deps = dependencies({requestMeasurement: vi.fn(async () => { throw new Error("inngest down"); })});
    await expect(createPropertyPreview(input(), deps)).resolves.toMatchObject({kind: "created"});
    expect(deps.repository.setMeasurementStatus).toHaveBeenCalledWith(expect.objectContaining({status: "unavailable"}));
  });
});

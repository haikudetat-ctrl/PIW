import {describe, expect, test, vi} from "vitest";
import type {AddressValidationResult} from "@/domain/property-identity";
import {
  runPostConsentPropertyPrefetch,
  type PostConsentPropertyPrefetchDependencies,
  type PropertyPrefetchRepository,
} from "./post-consent-property-prefetch";

const INPUT = {
  companyId: "00000000-0000-4000-8000-000000000001",
  attemptId: "00000000-0000-4000-8000-000000000002",
  submittedAddress: "354 Stockton St, Princeton, NJ 08540",
  googlePlaceId: "ChIJ-selected",
};

const EXACT_NJ: AddressValidationResult = {
  submittedAddress: INPUT.submittedAddress,
  googlePlaceId: INPUT.googlePlaceId,
  canonicalAddress: "354 Stockton St, Princeton, NJ 08540, USA",
  latitude: 40.3402,
  longitude: -74.6701,
  municipality: "Princeton",
  county: "Mercer County",
  stateCode: "NJ",
  zip: "08540",
  matchMethod: "exact_single_match",
  confidence: 98,
};

function repository(overrides: Partial<PropertyPrefetchRepository> = {}): PropertyPrefetchRepository {
  return {
    resolveScope: vi.fn().mockResolvedValue({eligible: true}),
    apply: vi.fn().mockResolvedValue({sideEffectsApplied: true}),
    ...overrides,
  };
}

function dependencies(overrides: Partial<PostConsentPropertyPrefetchDependencies> = {}) {
  return {
    enabled: true,
    repository: repository(),
    fetchGooglePlaceDetails: vi.fn().mockResolvedValue(EXACT_NJ),
    clock: () => 0,
    now: () => new Date("2026-08-28T20:00:00.000Z"),
    createTimeoutSignal: () => new AbortController().signal,
    logCompletion: vi.fn(),
    ...overrides,
  };
}

describe("runPostConsentPropertyPrefetch", () => {
  test("does not call Google when the fast path is disabled", async () => {
    const deps = dependencies({enabled: false});

    await expect(runPostConsentPropertyPrefetch(INPUT, deps)).resolves.toEqual({
      kind: "skipped", reason: "disabled",
    });
    expect(deps.fetchGooglePlaceDetails).not.toHaveBeenCalled();
    expect(deps.repository.resolveScope).not.toHaveBeenCalled();
  });

  test("skips a manual address without a selected Place ID", async () => {
    const deps = dependencies();

    await expect(runPostConsentPropertyPrefetch({...INPUT, googlePlaceId: ""}, deps)).resolves.toEqual({
      kind: "skipped", reason: "not_new",
    });
    expect(deps.fetchGooglePlaceDetails).not.toHaveBeenCalled();
    expect(deps.repository.resolveScope).not.toHaveBeenCalled();
  });

  test("does not call Google when scope preflight is not eligible", async () => {
    const deps = dependencies({repository: repository({
      resolveScope: vi.fn().mockResolvedValue({eligible: false}),
    })});

    await expect(runPostConsentPropertyPrefetch(INPUT, deps)).resolves.toEqual({
      kind: "skipped", reason: "not_new",
    });
    expect(deps.fetchGooglePlaceDetails).not.toHaveBeenCalled();
  });

  test("persists exact New Jersey evidence under budget and logs only completion metrics", async () => {
    let elapsed = 0;
    const logs: unknown[] = [];
    const deps = dependencies({
      clock: () => elapsed,
      fetchGooglePlaceDetails: vi.fn().mockImplementation(async () => {
        elapsed += 32;
        return EXACT_NJ;
      }),
      repository: repository({apply: vi.fn().mockImplementation(async () => {
        elapsed += 7;
        return {sideEffectsApplied: true};
      })}),
      logCompletion: (context) => { logs.push(context); },
    });

    await expect(runPostConsentPropertyPrefetch(INPUT, deps)).resolves.toEqual({
      kind: "applied", providerDurationMs: 32, totalDurationMs: 39,
    });
    expect(deps.repository.resolveScope).toHaveBeenCalledWith({
      companyId: INPUT.companyId, attemptId: INPUT.attemptId, googlePlaceId: INPUT.googlePlaceId,
    });
    expect(deps.repository.apply).toHaveBeenCalledWith(expect.objectContaining({
      companyId: INPUT.companyId,
      attemptId: INPUT.attemptId,
      evidence: EXACT_NJ,
      provider: "google_places",
      sourceIdentifier: INPUT.googlePlaceId,
      providerDurationMs: 32,
    }));
    expect(logs).toEqual([{
      outcome: "applied", reason: undefined, providerDurationMs: 32,
      persistenceDurationMs: 7, totalDurationMs: 39,
    }]);
  });

  test("returns already_applied when persistence revalidates an exact duplicate", async () => {
    const deps = dependencies({repository: repository({
      apply: vi.fn().mockResolvedValue({sideEffectsApplied: false}),
    })});

    await expect(runPostConsentPropertyPrefetch(INPUT, deps)).resolves.toMatchObject({
      kind: "already_applied",
    });
  });

  test("returns timeout when the injected 2,500 ms signal aborts Google", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const deps = dependencies({
      createTimeoutSignal: (timeoutMs) => {
        setTimeout(() => controller.abort(), timeoutMs);
        return controller.signal;
      },
      fetchGooglePlaceDetails: vi.fn(() => new Promise((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {once: true});
      })),
    });
    const pending = runPostConsentPropertyPrefetch(INPUT, deps);

    await vi.advanceTimersByTimeAsync(2_500);
    await expect(pending).resolves.toEqual({kind: "deferred", reason: "timeout"});
    vi.useRealTimers();
  });

  test("defers when Google rejects", async () => {
    const deps = dependencies({fetchGooglePlaceDetails: vi.fn().mockRejectedValue(new Error("provider"))});

    await expect(runPostConsentPropertyPrefetch(INPUT, deps)).resolves.toEqual({
      kind: "deferred", reason: "provider_failed",
    });
  });

  test.each([
    ["malformed", {googlePlaceId: INPUT.googlePlaceId}],
    ["non-New Jersey", {...EXACT_NJ, stateCode: null}],
    ["non-exact", {...EXACT_NJ, matchMethod: "multiple_matches" as const}],
  ])("skips %s evidence without persistence", async (_case, evidence) => {
    const deps = dependencies({fetchGooglePlaceDetails: vi.fn().mockResolvedValue(evidence)});

    await expect(runPostConsentPropertyPrefetch(INPUT, deps)).resolves.toEqual({
      kind: "skipped", reason: "not_exact",
    });
    expect(deps.repository.apply).not.toHaveBeenCalled();
  });

  test("defers when persistence rejects", async () => {
    const deps = dependencies({repository: repository({
      apply: vi.fn().mockRejectedValue(new Error("database")),
    })});

    await expect(runPostConsentPropertyPrefetch(INPUT, deps)).resolves.toEqual({
      kind: "deferred", reason: "persistence_failed",
    });
  });
});

import {describe, expect, test, vi} from "vitest";
import type {AddressValidationResult} from "@/domain/property-identity";
import type {PropertyPrefetchRepository} from "./post-consent-property-prefetch";
import {createPostConsentPrefetchComposition} from "./post-consent-prefetch-composition";

const companyId = "11111111-1111-4111-8111-111111111111";
const submissionId = "22222222-2222-4222-8222-222222222222";
const input = {
  companyId,
  attemptId: "33333333-3333-4333-8333-333333333333",
  submittedAddress: "18 Harbor View Dr, Red Bank, NJ 07701",
  googlePlaceId: "ChIJ-selected",
};
const evidence: AddressValidationResult = {
  submittedAddress: input.submittedAddress,
  googlePlaceId: input.googlePlaceId,
  canonicalAddress: "18 Harbor View Dr, Red Bank, NJ 07701, USA",
  latitude: 40.3501,
  longitude: -74.0642,
  municipality: "Red Bank",
  county: "Monmouth County",
  stateCode: "NJ",
  zip: "07701",
  matchMethod: "exact_single_match",
  confidence: 98,
};
const productionEnvironment = {
  NODE_ENV: "production",
  DEPLOYMENT_ENV: "production",
  ROOF_ASSESSMENT_TEST_FAKE_PLACE_DETAILS_ENABLED: "false",
  ROOF_ASSESSMENT_PROPERTY_PREFETCH_ENABLED: true,
  GOOGLE_MAPS_API_KEY: "server-maps-key",
  ROOF_ASSESSMENT_SIGNING_SECRET: "s".repeat(32),
};

function repository(eligible = true): PropertyPrefetchRepository {
  return {
    resolveScope: vi.fn().mockResolvedValue({eligible}),
    apply: vi.fn().mockResolvedValue({sideEffectsApplied: true}),
  };
}

function createHarness(overrides: {
  environment?: Partial<typeof productionEnvironment>;
  googlePlaceId?: string;
  eligible?: boolean;
  logInfo?: (label: string, record: unknown) => void;
} = {}) {
  const provider = vi.fn().mockResolvedValue(evidence);
  const scopedRepository = repository(overrides.eligible ?? true);
  const logInfo = vi.fn(overrides.logInfo ?? (() => undefined));
  const composition = createPostConsentPrefetchComposition({
    environment: {...productionEnvironment, ...overrides.environment},
    client: {} as never,
    companyId,
    submissionId,
    googlePlaceId: overrides.googlePlaceId ?? input.googlePlaceId,
    signingSecret: productionEnvironment.ROOF_ASSESSMENT_SIGNING_SECRET,
    testEnvironment: {
      NODE_ENV: overrides.environment?.NODE_ENV ?? productionEnvironment.NODE_ENV,
      DEPLOYMENT_ENV:
        overrides.environment?.DEPLOYMENT_ENV ?? productionEnvironment.DEPLOYMENT_ENV,
      ROOF_ASSESSMENT_TEST_FAKE_PLACE_DETAILS_ENABLED:
        overrides.environment?.ROOF_ASSESSMENT_TEST_FAKE_PLACE_DETAILS_ENABLED
        ?? productionEnvironment.ROOF_ASSESSMENT_TEST_FAKE_PLACE_DETAILS_ENABLED,
    },
  }, {
    createRepository: () => scopedRepository,
    fetchGooglePlaceDetails: provider,
    logInfo,
  });
  return {composition, logInfo, provider, scopedRepository};
}

describe("post-consent prefetch composition", () => {
  test("uses the bounded real provider once and buffers telemetry until acceptance", async () => {
    const {composition, logInfo, provider} = createHarness();

    await expect(composition.postConsentPrefetch?.(input)).resolves.toMatchObject({kind: "applied"});
    expect(provider).toHaveBeenCalledOnce();
    expect(provider).toHaveBeenCalledWith(expect.objectContaining({
      googlePlaceId: input.googlePlaceId,
      apiKey: "server-maps-key",
      signal: expect.any(AbortSignal),
    }));
    expect(logInfo).not.toHaveBeenCalled();

    composition.markAccepted();
    composition.markAccepted();

    expect(logInfo).toHaveBeenCalledTimes(2);
    expect(logInfo).toHaveBeenCalledWith(
      "roof_assessment_prefetch_path",
      expect.objectContaining({outcome: "prefetch_candidate"}),
    );
    expect(logInfo).toHaveBeenCalledWith(
      "roof_assessment_property_prefetch",
      expect.objectContaining({outcome: "applied"}),
    );
    expect(JSON.stringify(logInfo.mock.calls)).not.toMatch(
      /11111111-1111|22222222-2222|ChIJ-selected|Harbor View|server-maps-key|latitude|longitude/i,
    );
  });

  test("preserves the 2,500 ms provider timeout budget", async () => {
    const {composition, provider} = createHarness();

    await composition.postConsentPrefetch?.(input);

    const signal = provider.mock.calls[0]?.[0]?.signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  test("never constructs a real fast path for manual or flag-off input", () => {
    const manual = createHarness({googlePlaceId: ""});
    const flagOff = createHarness({
      environment: {ROOF_ASSESSMENT_PROPERTY_PREFETCH_ENABLED: false},
    });

    expect(manual.composition.postConsentPrefetch).toBeUndefined();
    expect(flagOff.composition.postConsentPrefetch).toBeUndefined();
    expect(manual.provider).not.toHaveBeenCalled();
    expect(flagOff.provider).not.toHaveBeenCalled();

    manual.composition.markAccepted();
    flagOff.composition.markAccepted();
    expect(manual.logInfo).toHaveBeenCalledWith(
      "roof_assessment_prefetch_path",
      expect.objectContaining({outcome: "async_manual"}),
    );
    expect(flagOff.logInfo).toHaveBeenCalledWith(
      "roof_assessment_prefetch_path",
      expect.objectContaining({outcome: "async_google_flag_off"}),
    );
  });

  test("does not call the provider for an ineligible server-side scope", async () => {
    const {composition, provider} = createHarness({eligible: false});

    await expect(composition.postConsentPrefetch?.(input)).resolves.toEqual({
      kind: "skipped",
      reason: "not_new",
    });
    expect(provider).not.toHaveBeenCalled();
  });

  test("uses the fake override only in explicitly guarded development test mode", async () => {
    const fakeProvider = vi.fn().mockResolvedValue({kind: "applied"});
    const realProvider = vi.fn();
    const logInfo = vi.fn();
    const composition = createPostConsentPrefetchComposition({
      environment: {
        ...productionEnvironment,
      },
      client: {} as never,
      companyId,
      submissionId,
      googlePlaceId: input.googlePlaceId,
      signingSecret: productionEnvironment.ROOF_ASSESSMENT_SIGNING_SECRET,
      testEnvironment: {
        NODE_ENV: "development",
        DEPLOYMENT_ENV: "development",
        ROOF_ASSESSMENT_TEST_FAKE_PLACE_DETAILS_ENABLED: "true",
      },
    }, {
      createFakePrefetch: () => fakeProvider,
      createRepository: () => repository(),
      fetchGooglePlaceDetails: realProvider,
      logInfo,
    });

    await composition.postConsentPrefetch?.(input);
    expect(fakeProvider).toHaveBeenCalledOnce();
    expect(realProvider).not.toHaveBeenCalled();
  });

  test("contains telemetry logger failures", async () => {
    const {composition} = createHarness({
      logInfo: () => {
        throw new Error("logger unavailable");
      },
    });

    await expect(composition.postConsentPrefetch?.(input)).resolves.toMatchObject({kind: "applied"});
    expect(() => composition.markAccepted()).not.toThrow();
  });
});

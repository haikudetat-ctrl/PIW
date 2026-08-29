import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parseServerEnv: vi.fn(),
  createServiceClient: vi.fn(),
  acceptAllSeasonCampaignEstimate: vi.fn(),
  startOrResumeRoofAssessment: vi.fn(),
  runPostConsentPropertyPrefetch: vi.fn(),
  SupabasePropertyPrefetchRepository: vi.fn(),
  fetchGooglePlaceDetails: vi.fn(),
}));

vi.mock("@/lib/env/server", () => ({parseServerEnv: mocks.parseServerEnv}));
vi.mock("@/lib/supabase/service", () => ({createServiceClient: mocks.createServiceClient}));
vi.mock("@/modules/leads/accept-all-season-campaign-estimate", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/modules/leads/accept-all-season-campaign-estimate")>(),
  acceptAllSeasonCampaignEstimate: mocks.acceptAllSeasonCampaignEstimate,
}));
vi.mock("@/modules/roof-assessment/start-or-resume", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/modules/roof-assessment/start-or-resume")>(),
  startOrResumeRoofAssessment: mocks.startOrResumeRoofAssessment,
}));
vi.mock("@/modules/roof-assessment/post-consent-property-prefetch", () => ({
  runPostConsentPropertyPrefetch: mocks.runPostConsentPropertyPrefetch,
}));
vi.mock("@/modules/roof-assessment/supabase-property-prefetch-repository", () => ({
  SupabasePropertyPrefetchRepository: mocks.SupabasePropertyPrefetchRepository,
}));
vi.mock("@/modules/providers/adapters/google-places", () => ({
  fetchGooglePlaceDetails: mocks.fetchGooglePlaceDetails,
}));

import {
  handleAllSeasonCampaignEstimateRequest,
  POST,
  toCampaignEstimateLeadInput,
  type AllSeasonCampaignEstimateInput,
} from "./route";

const validPayload = {
  submission_id: "11111111-1111-4111-8111-111111111111",
  campaign: "weather-report" as const,
  presentation_key: "weather-report" as const,
  entry_point: "campaign:weather-report" as const,
  name: "Alex Rivera",
  email: "alex@example.com",
  phone: "201-555-0100",
  address: "1 Main St, Newark, NJ 07102, USA",
  google_place_id: "ChIJN1t_tDeuEmsRUsoyG83frY4",
  address_line_1: "1 Main St",
  address_line_2: null,
  city: "Newark",
  state: "NJ" as const,
  postal_code: "07102",
  consent_to_contact: true as const,
  consent_to_process_property: true as const,
  source: "all-season-campaign" as const,
  submittedAt: "2026-08-24T14:00:00.000Z",
  disclosure_version: "all-season-campaign-estimate-v1" as const,
  client_ip_address: "203.0.113.10",
  client_user_agent: "homeowner-browser",
  referrer: "https://allseason.example/campaigns/weather-report",
  attribution: {
    utm_source: "facebook",
    utm_medium: "paid-social",
    utm_campaign: "20y",
    utm_term: null,
    utm_content: "receipt",
    fbclid: "click-123",
    fbp: "fb.1.100.200",
    fbc: "fb.1.100.click",
  },
};

function request(body: unknown, secret = "shared-secret") {
  return new NextRequest(
    "https://piw.example/api/integrations/all-season/campaign-estimate",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-all-season-intake-secret": secret,
      },
      body: JSON.stringify(body),
    },
  );
}

const serverEnvironment = {
  ROOF_ASSESSMENT_ENABLED: true,
  ROOF_ASSESSMENT_SIGNING_SECRET: "a".repeat(32),
  ALL_SEASON_INTAKE_SHARED_SECRET: "shared-secret",
  ALL_SEASON_INTAKE_COMPANY_ID: "22222222-2222-4222-8222-222222222222",
  PAID_PROVIDERS_ENABLED: true,
  GOOGLE_MAPS_API_KEY: "maps-server-key",
  ROOF_ASSESSMENT_PROPERTY_PREFETCH_ENABLED: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.parseServerEnv.mockReturnValue(serverEnvironment);
  mocks.createServiceClient.mockReturnValue({service: true});
  mocks.SupabasePropertyPrefetchRepository.mockImplementation(
    (class {
      constructor() {
        return {repository: true};
      }
    }) as unknown as () => unknown,
  );
  mocks.runPostConsentPropertyPrefetch.mockResolvedValue({
    kind: "deferred",
    reason: "timeout",
  });
  mocks.startOrResumeRoofAssessment.mockResolvedValue({
    kind: "continue",
    continuationPath: "/roof-estimate/continue/signed_token-123",
  });
  mocks.acceptAllSeasonCampaignEstimate.mockImplementation(async (input, dependencies) =>
    dependencies.startAssessment({
      companyId: "22222222-2222-4222-8222-222222222222",
      submittedAddress: input.submittedAddress,
      googlePlaceId: input.googlePlaceId,
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("All Season campaign estimate intake", () => {
  test("maps every external evidence field to the canonical campaign adapter", () => {
    const parsed = validPayload satisfies AllSeasonCampaignEstimateInput;

    expect(toCampaignEstimateLeadInput(parsed)).toEqual({
      submissionId: validPayload.submission_id,
      campaign: "weather-report",
      presentationKey: "weather-report",
      entryPoint: "campaign:weather-report",
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
      submittedAddress: validPayload.address,
      googlePlaceId: validPayload.google_place_id,
      clientIpAddress: validPayload.client_ip_address,
      clientUserAgent: validPayload.client_user_agent,
      submittedAt: validPayload.submittedAt,
      disclosureVersion: validPayload.disclosure_version,
      referrer: validPayload.referrer,
      attribution: validPayload.attribution,
    });
  });

  test("rejects a request with the wrong shared secret", async () => {
    const accept = vi.fn();
    const response = await handleAllSeasonCampaignEstimateRequest(
      request(validPayload, "wrong-secret"),
      { expectedSecret: "shared-secret", accept },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(accept).not.toHaveBeenCalled();
    expect(mocks.fetchGooglePlaceDetails).not.toHaveBeenCalled();
  });

  test("returns only the canonical continuation path for a first issue", async () => {
    const accept = vi.fn(async () => ({
      kind: "continue" as const,
      continuationPath: "/roof-estimate/continue/signed_token-123" as const,
    }));
    const response = await handleAllSeasonCampaignEstimateRequest(
      request(validPayload),
      { expectedSecret: "shared-secret", accept },
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      continuationPath: "/roof-estimate/continue/signed_token-123",
    });
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({
      campaign: "weather-report",
      presentation_key: "weather-report",
      entry_point: "campaign:weather-report",
    }));
  });

  test("accepts the canonical main-site framing without campaign attribution", async () => {
    const accept = vi.fn(async () => ({
      kind: "continue" as const,
      continuationPath: "/roof-estimate/continue/main_token" as const,
    }));
    const response = await handleAllSeasonCampaignEstimateRequest(
      request({
        ...validPayload,
        campaign: null,
        presentation_key: "all-season-main",
        entry_point: "main-drawer",
      }),
      {expectedSecret: "shared-secret", accept},
    );

    expect(response.status).toBe(202);
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({
      campaign: null,
      presentation_key: "all-season-main",
      entry_point: "main-drawer",
    }));
  });

  test("maps an idempotent replay to an explicit non-success restart response", async () => {
    const response = await handleAllSeasonCampaignEstimateRequest(
      request(validPayload),
      {
        expectedSecret: "shared-secret",
        accept: async () => ({kind: "duplicate_requires_restart"}),
      },
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Please restart this estimate request.",
      retryable: true,
    });
  });

  test.each([
    [{ ...validPayload, campaign: "do-it-right-once" }, "unknown campaign"],
    [{ ...validPayload, presentation_key: "seasonal-shield" }, "mismatched presentation"],
    [{ ...validPayload, entry_point: "campaign:seasonal-shield" }, "mismatched entry point"],
    [{ ...validPayload, consent_to_contact: false }, "contact consent"],
    [{ ...validPayload, consent_to_process_property: false }, "property consent"],
    [{ ...validPayload, client_ip_address: "not-an-ip" }, "client IP"],
    [{ ...validPayload, extra_secret: "must-not-pass" }, "unknown field"],
    [
      {
        ...validPayload,
        google_place_id: null,
        address_line_1: null,
        city: null,
        state: null,
        postal_code: null,
      },
      "manual address",
    ],
  ] as const)("rejects an invalid %s (%s)", async (payload, label) => {
    const accept = vi.fn();
    const response = await handleAllSeasonCampaignEstimateRequest(
      request(payload),
      { expectedSecret: "shared-secret", accept },
    );

    expect(label.length).toBeGreaterThan(0);
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(accept).not.toHaveBeenCalled();
    expect(mocks.fetchGooglePlaceDetails).not.toHaveBeenCalled();
  });

  test("returns a generic retryable response without leaking a dependency error", async () => {
    const response = await handleAllSeasonCampaignEstimateRequest(
      request(validPayload),
      {
        expectedSecret: "shared-secret",
        accept: async () => {
          throw new Error("database host secret-123 alex@example.com");
        },
      },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toBe('{"error":"Campaign estimate intake is temporarily unavailable"}');
    expect(body).not.toContain("secret-123");
    expect(body).not.toContain("alex@example.com");
  });

  test("injects the selected-place fast path with server-only dependencies", async () => {
    const response = await POST(request(validPayload));

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      continuationPath: "/roof-estimate/continue/signed_token-123",
    });
    expect(mocks.SupabasePropertyPrefetchRepository).not.toHaveBeenCalled();
    expect(mocks.startOrResumeRoofAssessment).toHaveBeenCalledWith(
      expect.objectContaining({googlePlaceId: validPayload.google_place_id}),
      expect.objectContaining({postConsentPrefetch: expect.any(Function)}),
    );
  });

  test("omits the fast path when the server feature flag is disabled", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.parseServerEnv.mockReturnValue({
      ...serverEnvironment,
      ROOF_ASSESSMENT_PROPERTY_PREFETCH_ENABLED: false,
    });

    const response = await POST(request(validPayload));

    expect(response.status).toBe(202);
    expect(mocks.SupabasePropertyPrefetchRepository).not.toHaveBeenCalled();
    expect(mocks.startOrResumeRoofAssessment).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({postConsentPrefetch: undefined}),
    );
    expect(mocks.fetchGooglePlaceDetails).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith("roof_assessment_prefetch_path", expect.objectContaining({
      correlation: expect.stringMatching(/^raj_[a-f0-9]{32}$/),
      event: "assessment_prefetch_path_selected",
      outcome: "async_google_flag_off",
    }));
  });

  test("returns a generic no-store configuration response when prefetch environment validation fails", async () => {
    mocks.parseServerEnv.mockImplementation(() => {
      throw new Error("ZodError: GOOGLE_MAPS_API_KEY maps-server-key is required");
    });

    const response = await POST(request(validPayload));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toBe('{"error":"All Season campaign estimate intake is not configured"}');
    expect(body).not.toContain("ZodError");
    expect(body).not.toContain("maps-server-key");
  });

  test("keeps a manual address out of the selected-place fast path", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const manualPayload = {
      ...validPayload,
      google_place_id: null,
    };
    const response = await POST(request(manualPayload));

    expect(response.status).toBe(202);
    expect(mocks.startOrResumeRoofAssessment).toHaveBeenCalledWith(
      expect.objectContaining({googlePlaceId: undefined}),
      expect.any(Object),
    );
    expect(mocks.fetchGooglePlaceDetails).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith("roof_assessment_prefetch_path", expect.objectContaining({
      correlation: expect.stringMatching(/^raj_[a-f0-9]{32}$/),
      event: "assessment_prefetch_path_selected",
      outcome: "async_manual",
    }));
  });

  test("returns 409 without property data when the canonical intake reports a duplicate", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.startOrResumeRoofAssessment.mockResolvedValue({kind: "duplicate_requires_restart"});

    const response = await POST(request(validPayload));

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toBe('{"error":"Please restart this estimate request.","retryable":true}');
    expect(body).not.toContain(validPayload.google_place_id);
    expect(info).not.toHaveBeenCalled();
    expect(mocks.fetchGooglePlaceDetails).not.toHaveBeenCalled();
  });

  test("still returns 202 when the selected-place fast path defers on timeout", async () => {
    mocks.startOrResumeRoofAssessment.mockImplementation(async (input, dependencies) => {
      await dependencies.postConsentPrefetch({
        companyId: input.companyId,
        attemptId: "33333333-3333-4333-8333-333333333333",
        submittedAddress: input.submittedAddress,
        googlePlaceId: input.googlePlaceId,
      });
      return {
        kind: "continue",
        continuationPath: "/roof-estimate/continue/signed_token-123",
      };
    });
    mocks.runPostConsentPropertyPrefetch.mockImplementation(async (prefetchInput, dependencies) => {
      await dependencies.fetchGooglePlaceDetails({
        submittedAddress: prefetchInput.submittedAddress,
        googlePlaceId: prefetchInput.googlePlaceId,
        signal: AbortSignal.abort(),
      });
      return {kind: "deferred", reason: "timeout"};
    });

    const response = await POST(request(validPayload));

    expect(response.status).toBe(202);
    expect(mocks.runPostConsentPropertyPrefetch).toHaveBeenCalledWith(
      expect.objectContaining({googlePlaceId: validPayload.google_place_id}),
      expect.objectContaining({
        enabled: true,
        repository: {repository: true},
        fetchGooglePlaceDetails: expect.any(Function),
      }),
    );
    expect(mocks.fetchGooglePlaceDetails).toHaveBeenCalledOnce();
    expect(mocks.fetchGooglePlaceDetails).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "maps-server-key",
      signal: expect.any(AbortSignal),
    }));
  });

  test.each([
    [
      "completed",
      {outcome: "applied", reason: undefined, providerDurationMs: 14, persistenceDurationMs: 8, totalDurationMs: 24},
      {kind: "applied", providerDurationMs: 14, totalDurationMs: 24},
    ],
    [
      "skipped",
      {outcome: "skipped", reason: "not_exact", providerDurationMs: 9, persistenceDurationMs: 0, totalDurationMs: 10},
      {kind: "skipped", reason: "not_exact"},
    ],
    [
      "failed",
      {outcome: "deferred", reason: "provider_failed", providerDurationMs: 2_500, persistenceDurationMs: 0, totalDurationMs: 2_501},
      {kind: "deferred", reason: "provider_failed"},
    ],
  ] as const)("emits one sanitized %s prefetch completion record", async (_outcome, completion, result) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.startOrResumeRoofAssessment.mockImplementation(async (input, dependencies) => {
      await dependencies.postConsentPrefetch({
        companyId: input.companyId,
        attemptId: "33333333-3333-4333-8333-333333333333",
        submittedAddress: input.submittedAddress,
        googlePlaceId: input.googlePlaceId,
      });
      return {
        kind: "continue",
        continuationPath: "/roof-estimate/continue/signed_token-123",
      };
    });
    mocks.runPostConsentPropertyPrefetch.mockImplementation(async (_input, dependencies) => {
      dependencies.logCompletion(completion);
      return result;
    });

    const response = await POST(request(validPayload));

    expect(response.status).toBe(202);
    expect(info).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledWith("roof_assessment_prefetch_path", expect.objectContaining({
      correlation: expect.stringMatching(/^raj_[a-f0-9]{32}$/),
      event: "assessment_prefetch_path_selected",
      outcome: "prefetch_candidate",
    }));
    expect(info).toHaveBeenCalledWith("roof_assessment_property_prefetch", {
      correlation: expect.stringMatching(/^raj_[a-f0-9]{32}$/),
      ...completion,
    });
    const serialized = JSON.stringify(info.mock.calls);
    expect(serialized).not.toMatch(
      /Alex Rivera|alex@example\.com|201-555-0100|1 Main St|ChIJN1t_tDeuEmsRUsoyG83frY4|latitude|longitude|signed_token|maps-server-key/i,
    );
    expect(serialized).not.toContain(validPayload.submission_id);
  });

  test("returns a generic no-store 503 when canonical intake fails", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.startOrResumeRoofAssessment.mockRejectedValue(
      new Error("raw intake failure with continuation-secret"),
    );

    const response = await POST(request(validPayload));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toBe('{"error":"Campaign estimate intake is temporarily unavailable"}');
    expect(body).not.toContain("continuation-secret");
    expect(body).not.toContain(validPayload.google_place_id);
    expect(body).not.toMatch(/latitude|longitude|evidence/i);
    expect(info).not.toHaveBeenCalled();
    expect(mocks.fetchGooglePlaceDetails).not.toHaveBeenCalled();
  });

  test("flushes candidate and completion telemetry only after accepted intake", async () => {
    const order: string[] = [];
    vi.spyOn(console, "info").mockImplementation(() => {
      order.push("telemetry");
    });
    mocks.startOrResumeRoofAssessment.mockImplementation(async (input, dependencies) => {
      await dependencies.postConsentPrefetch({
        companyId: input.companyId,
        attemptId: "33333333-3333-4333-8333-333333333333",
        submittedAddress: input.submittedAddress,
        googlePlaceId: input.googlePlaceId,
      });
      order.push("accepted");
      return {
        kind: "continue",
        continuationPath: "/roof-estimate/continue/signed_token-123",
      };
    });
    mocks.runPostConsentPropertyPrefetch.mockImplementation(async (_input, dependencies) => {
      dependencies.logCompletion({
        outcome: "applied",
        reason: undefined,
        providerDurationMs: 12,
        persistenceDurationMs: 4,
        totalDurationMs: 16,
      });
      return {kind: "applied", providerDurationMs: 12, totalDurationMs: 16};
    });

    const response = await POST(request(validPayload));

    expect(response.status).toBe(202);
    expect(order).toEqual(["accepted", "telemetry", "telemetry"]);
  });

  test("keeps an accepted response when telemetry logging throws", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("logger unavailable");
    });

    const response = await POST(request(validPayload));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      continuationPath: "/roof-estimate/continue/signed_token-123",
    });
  });
});

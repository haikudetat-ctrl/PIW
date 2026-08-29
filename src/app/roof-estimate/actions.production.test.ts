import {beforeEach, describe, expect, test, vi} from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeAssessmentContinuation: vi.fn(),
  cookies: vi.fn(),
  createPostConsentPrefetchComposition: vi.fn(),
  createServiceClient: vi.fn(),
  headers: vi.fn(),
  markAccepted: vi.fn(),
  parseServerEnv: vi.fn(),
  postConsentPrefetch: vi.fn(),
  redirect: vi.fn(),
  setAssessmentSessionCookie: vi.fn(),
  startOrResumeRoofAssessment: vi.fn(),
}));

vi.mock("next/headers", () => ({cookies: mocks.cookies, headers: mocks.headers}));
vi.mock("next/navigation", () => ({redirect: mocks.redirect}));
vi.mock("@/lib/env/server", () => ({parseServerEnv: mocks.parseServerEnv}));
vi.mock("@/lib/supabase/service", () => ({createServiceClient: mocks.createServiceClient}));
vi.mock("@/modules/roof-assessment/assessment-session", () => ({
  ASSESSMENT_SESSION_COOKIE: "roof_assessment_session",
  setAssessmentSessionCookie: mocks.setAssessmentSessionCookie,
}));
vi.mock("@/modules/roof-assessment/assessment-continuation", () => ({
  authorizeAssessmentContinuation: mocks.authorizeAssessmentContinuation,
  createSupabaseContinuationAuthorizationDependencies: vi.fn(() => ({authorization: true})),
}));
vi.mock("@/modules/roof-assessment/start-or-resume", () => ({
  startOrResumeRoofAssessment: mocks.startOrResumeRoofAssessment,
}));
vi.mock("@/modules/roof-assessment/supabase-assessment-intake-repository", () => ({
  SupabaseAssessmentIntakeRepository: class {},
}));
vi.mock("@/modules/roof-assessment/post-consent-prefetch-composition", () => ({
  createPostConsentPrefetchComposition: mocks.createPostConsentPrefetchComposition,
}));

import {submitPublicRoofEstimate} from "./actions";

const companyId = "11111111-1111-4111-8111-111111111111";
const assessmentId = "22222222-2222-4222-8222-222222222222";
const publicToken = "33333333-3333-4333-8333-333333333333";

function formData() {
  const data = new FormData();
  Object.entries({
    campaign: "for-every-season",
    name: "Jordan Homeowner",
    phone: "609-555-0100",
    email: "jordan@example.com",
    addressMode: "google",
    googlePlaceId: "ChIJ-selected",
    selectedAddress: "132 Windsor Ave, Haddon Township, NJ 08108, USA",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "NJ",
    postalCode: "",
    consentEstimate: "on",
    consentEmail: "on",
    consentSms: "on",
  }).forEach(([key, value]) => data.set(key, value));
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.parseServerEnv.mockReturnValue({
    NODE_ENV: "production",
    DEPLOYMENT_ENV: "production",
    ROOF_ASSESSMENT_ENABLED: true,
    ROOF_ASSESSMENT_PROPERTY_PREFETCH_ENABLED: true,
    ROOF_ASSESSMENT_SIGNING_SECRET: "s".repeat(32),
    GOOGLE_MAPS_API_KEY: "server-key",
    ROOF_ESTIMATE_COMPANY_ID: companyId,
  });
  mocks.createServiceClient.mockReturnValue({service: true});
  mocks.cookies.mockResolvedValue({get: vi.fn(), set: vi.fn()});
  mocks.headers.mockResolvedValue(new Headers({
    referer: "https://piw.example/roof-estimate",
    "user-agent": "homeowner-browser",
    "x-forwarded-for": "203.0.113.10",
  }));
  mocks.createPostConsentPrefetchComposition.mockReturnValue({
    postConsentPrefetch: mocks.postConsentPrefetch,
    markAccepted: mocks.markAccepted,
  });
  mocks.startOrResumeRoofAssessment.mockImplementation(async (input, dependencies) => {
    await dependencies.postConsentPrefetch?.({
      companyId: input.companyId,
      attemptId: "44444444-4444-4444-8444-444444444444",
      submittedAddress: input.submittedAddress,
      googlePlaceId: input.googlePlaceId,
    });
    return {kind: "continue", continuationPath: "/roof-estimate/continue/signed_token"};
  });
  mocks.authorizeAssessmentContinuation.mockResolvedValue({
    kind: "assessment",
    assessmentId,
    publicToken,
  });
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});

describe("production public roof estimate action composition", () => {
  test("shares the selected-place composition and flushes after cookie binding", async () => {
    const order: string[] = [];
    mocks.setAssessmentSessionCookie.mockImplementation(async () => {
      order.push("cookie");
    });
    mocks.markAccepted.mockImplementation(() => {
      order.push("telemetry");
    });
    mocks.redirect.mockImplementation((path: string) => {
      order.push("redirect");
      throw new Error(`redirect:${path}`);
    });

    await expect(submitPublicRoofEstimate({}, formData())).rejects.toThrow(
      `redirect:/roof-estimate/${publicToken}`,
    );

    expect(mocks.createPostConsentPrefetchComposition).toHaveBeenCalledWith(expect.objectContaining({
      client: {service: true},
      companyId,
      googlePlaceId: "ChIJ-selected",
      submissionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }));
    expect(mocks.postConsentPrefetch).toHaveBeenCalledOnce();
    expect(mocks.markAccepted).toHaveBeenCalledOnce();
    expect(order).toEqual(["cookie", "telemetry", "redirect"]);
  });

  test("does not flush or call Place Details for a duplicate replay", async () => {
    mocks.startOrResumeRoofAssessment.mockResolvedValue({kind: "duplicate_requires_restart"});

    await expect(submitPublicRoofEstimate({}, formData())).resolves.toEqual({
      error: "Please refresh the page and restart your estimate request.",
    });

    expect(mocks.postConsentPrefetch).not.toHaveBeenCalled();
    expect(mocks.markAccepted).not.toHaveBeenCalled();
    expect(mocks.setAssessmentSessionCookie).not.toHaveBeenCalled();
  });

  test("does not flush or bind a session for a resume candidate", async () => {
    mocks.authorizeAssessmentContinuation.mockResolvedValue({
      kind: "resume",
      attemptId: "55555555-5555-4555-8555-555555555555",
    });

    await expect(submitPublicRoofEstimate({}, formData())).rejects.toThrow(
      "redirect:/roof-estimate/resume/55555555-5555-4555-8555-555555555555",
    );

    expect(mocks.markAccepted).not.toHaveBeenCalled();
    expect(mocks.setAssessmentSessionCookie).not.toHaveBeenCalled();
  });
});

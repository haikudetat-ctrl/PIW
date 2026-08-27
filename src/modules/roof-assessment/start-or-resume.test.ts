import { describe, expect, test, vi } from "vitest";
import {
  StartAssessmentInputError,
  StartAssessmentInternalError,
  startOrResumeRoofAssessment,
  type AssessmentIntakeRepository,
  type ContinuationTokenIssuer,
  type StartAssessmentInput,
} from "./start-or-resume";
import {
  AssessmentIntakePersistenceError,
  SupabaseAssessmentIntakeRepository,
} from "./supabase-assessment-intake-repository";

const input: StartAssessmentInput = {
  submissionId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  name: "  Jamie   Homeowner  ",
  email: "  JAMIE@Example.COM ",
  phone: "(609) 555-0100",
  submittedAddress: "  12   Birch St., Trenton, NJ 08608  ",
  googlePlaceId: "  ChIJ-selected  ",
  campaign: "weather-report",
  presentationKey: "weather-report",
  entryPoint: "campaign:weather-report",
  attribution: {
    utm_source: "  facebook  ",
    utm_medium: "paid-social",
    utm_campaign: null,
    utm_term: null,
    utm_content: null,
    fbclid: null,
    fbp: null,
    fbc: null,
  },
  referrer: "  https://example.com/roofing  ",
  consent: {
    disclosureVersion: "  all-season-quote-v2  ",
    ipAddress: "203.0.113.9",
    userAgent: "  Example Browser/1.0  ",
    grantedAt: "2026-08-26T15:04:05.000Z",
  },
};

const firstAttempt = {
  attemptId: "33333333-3333-4333-8333-333333333333",
  continuationSecret: "one-time-secret",
  expiresAt: "2026-08-26T15:19:05.000Z",
  isReplay: false,
} as const;

const normalizedInput = {
  submissionId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  name: "Jamie Homeowner",
  emailNormalized: "jamie@example.com",
  phoneE164: "+16095550100",
  submittedAddress: "12 Birch St., Trenton, NJ 08608",
  googlePlaceId: "ChIJ-selected",
  campaign: "weather-report",
  presentationKey: "weather-report",
  entryPoint: "campaign:weather-report",
  attribution: {
    utm_source: "facebook",
    utm_medium: "paid-social",
    utm_campaign: null,
    utm_term: null,
    utm_content: null,
    fbclid: null,
    fbp: null,
    fbc: null,
  },
  referrer: "https://example.com/roofing",
  consent: {
    disclosureVersion: "all-season-quote-v2",
    ipAddress: "203.0.113.9",
    userAgent: "Example Browser/1.0",
    grantedAt: "2026-08-26T15:04:05.000Z",
  },
} as const;

function dependencies(repositoryResult: unknown = firstAttempt) {
  const repository: AssessmentIntakeRepository = {
    startOrResume: vi.fn().mockResolvedValue(repositoryResult),
  };
  const tokenIssuer: ContinuationTokenIssuer = {
    issue: vi.fn().mockResolvedValue("signed_token-123"),
  };
  return {repository, tokenIssuer};
}

describe("startOrResumeRoofAssessment", () => {
  test("normalizes intake and propagates consent evidence before issuing a continuation", async () => {
    const deps = dependencies();

    const result = await startOrResumeRoofAssessment(input, deps);

    expect(result).toEqual({
      kind: "continue",
      continuationPath: "/roof-estimate/continue/signed_token-123",
    });
    expect(deps.repository.startOrResume).toHaveBeenCalledWith(normalizedInput);
    expect(deps.tokenIssuer.issue).toHaveBeenCalledWith({
      attemptId: "33333333-3333-4333-8333-333333333333",
      secret: "one-time-secret",
      expiresAt: "2026-08-26T15:19:05.000Z",
    });
    expect(result).not.toHaveProperty("leadId");
    expect(result).not.toHaveProperty("publicToken");
  });

  test("rejects an invalid phone before persistence", async () => {
    const deps = dependencies();

    await expect(
      startOrResumeRoofAssessment({...input, phone: "555-0100"}, deps),
    ).rejects.toBeInstanceOf(StartAssessmentInputError);
    expect(deps.repository.startOrResume).not.toHaveBeenCalled();
    expect(deps.tokenIssuer.issue).not.toHaveBeenCalled();
  });

  test("rejects malformed input fields at the domain boundary", async () => {
    const deps = dependencies();

    await expect(startOrResumeRoofAssessment({
      ...input,
      entryPoint: "campaign:not-a-campaign" as StartAssessmentInput["entryPoint"],
      consent: {...input.consent, grantedAt: "not-a-timestamp"},
    }, deps)).rejects.toBeInstanceOf(StartAssessmentInputError);
    expect(deps.repository.startOrResume).not.toHaveBeenCalled();
  });

  test.each([
    [
      "campaign slug does not match the route",
      {
        campaign: "weather-report",
        presentationKey: "weather-report",
        entryPoint: "campaign:seasonal-shield",
      },
    ],
    [
      "campaign presentation does not match the route",
      {
        campaign: "weather-report",
        presentationKey: "for-every-season",
        entryPoint: "campaign:weather-report",
      },
    ],
    [
      "main route carries campaign framing",
      {
        campaign: "weather-report",
        presentationKey: "weather-report",
        entryPoint: "main-home",
      },
    ],
    [
      "main route carries a campaign presentation",
      {
        campaign: null,
        presentationKey: "weather-report",
        entryPoint: "roof-estimate",
      },
    ],
  ] as const)("rejects mismatched campaign context: %s", async (_label, context) => {
    const deps = dependencies();

    await expect(startOrResumeRoofAssessment({
      ...input,
      ...context,
    }, deps)).rejects.toBeInstanceOf(StartAssessmentInputError);
    expect(deps.repository.startOrResume).not.toHaveBeenCalled();
    expect(deps.tokenIssuer.issue).not.toHaveBeenCalled();
  });

  test.each([
    ["a non-UUID attempt", {...firstAttempt, attemptId: "attempt-123"}],
    ["an invalid expiry", {...firstAttempt, expiresAt: "tomorrow"}],
    ["a first attempt without a secret", {...firstAttempt, continuationSecret: null}],
    ["a replay carrying a secret", {...firstAttempt, isReplay: true}],
    ["an unrecognized object", {leadId: "44444444-4444-4444-8444-444444444444"}],
  ])("rejects malformed repository output: %s", async (_label, repositoryResult) => {
    const deps = dependencies(repositoryResult);

    await expect(startOrResumeRoofAssessment(input, deps)).rejects.toBeInstanceOf(
      StartAssessmentInternalError,
    );
    expect(deps.tokenIssuer.issue).not.toHaveBeenCalled();
  });

  test("returns a safe restart result for a duplicate submission without minting a capability", async () => {
    const deps = dependencies({
      attemptId: "33333333-3333-4333-8333-333333333333",
      continuationSecret: null,
      expiresAt: "2026-08-26T15:19:05.000Z",
      isReplay: true,
    });

    const result = await startOrResumeRoofAssessment(input, deps);

    expect(result).toEqual({kind: "duplicate_requires_restart"});
    expect(deps.tokenIssuer.issue).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("attemptId");
    expect(result).not.toHaveProperty("continuationPath");
    expect(result).not.toHaveProperty("leadId");
    expect(result).not.toHaveProperty("publicToken");
  });

  test("rejects an unsafe token returned by the issuer", async () => {
    const deps = dependencies();
    vi.mocked(deps.tokenIssuer.issue).mockResolvedValue("../public-token");

    await expect(startOrResumeRoofAssessment(input, deps)).rejects.toBeInstanceOf(
      StartAssessmentInternalError,
    );
  });

  test("sanitizes a rejected token issuer error", async () => {
    const deps = dependencies();
    vi.mocked(deps.tokenIssuer.issue).mockRejectedValue(
      new Error("sensitive signing key path /private/keys/continuation.key"),
    );

    await expect(startOrResumeRoofAssessment(input, deps)).rejects.toEqual(
      expect.objectContaining<Partial<StartAssessmentInternalError>>({
        name: "StartAssessmentInternalError",
        message: "Unable to start roof assessment",
      }),
    );
  });
});

describe("SupabaseAssessmentIntakeRepository", () => {
  test("maps normalized intake to the privileged RPC and returns a canonical result", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        attempt_id: "33333333-3333-4333-8333-333333333333",
        continuation_secret: "one-time-secret",
        expires_at: "2026-08-26T15:19:05.000+00:00",
        is_replay: false,
      }],
      error: null,
    });
    const repository = new SupabaseAssessmentIntakeRepository({rpc} as never);

    const result = await repository.startOrResume(normalizedInput);

    expect(result).toEqual({
      attemptId: "33333333-3333-4333-8333-333333333333",
      continuationSecret: "one-time-secret",
      expiresAt: "2026-08-26T15:19:05.000+00:00",
      isReplay: false,
    });
    expect(rpc).toHaveBeenCalledWith("start_or_resume_roof_assessment", {
      p_company_id: "22222222-2222-4222-8222-222222222222",
      p_submission_id: "11111111-1111-4111-8111-111111111111",
      p_name: "Jamie Homeowner",
      p_phone_e164: "+16095550100",
      p_email_normalized: "jamie@example.com",
      p_submitted_address: "12 Birch St., Trenton, NJ 08608",
      p_google_place_id: "ChIJ-selected",
      p_presentation_key: "weather-report",
      p_entry_point: "campaign:weather-report",
      p_attribution: {
        utm_source: "facebook",
        utm_medium: "paid-social",
        utm_campaign: null,
        utm_term: null,
        utm_content: null,
        fbclid: null,
        fbp: null,
        fbc: null,
      },
      p_referrer: "https://example.com/roofing",
      p_disclosure_version: "all-season-quote-v2",
      p_consent_granted_at: "2026-08-26T15:04:05.000Z",
      p_ip_address: "203.0.113.9",
      p_user_agent: "Example Browser/1.0",
    });
  });

  test("turns a Supabase RPC failure into a safe persistence error", async () => {
    const repository = new SupabaseAssessmentIntakeRepository({
      rpc: vi.fn().mockResolvedValue({data: null, error: {message: "sensitive database detail"}}),
    } as never);

    await expect(repository.startOrResume(normalizedInput)).rejects.toEqual(
      expect.objectContaining<Partial<AssessmentIntakePersistenceError>>({
        name: "AssessmentIntakePersistenceError",
        message: "Assessment intake persistence failed",
      }),
    );
  });

  test.each([
    ["zero rows", []],
    ["multiple rows", [
      {
        attempt_id: "33333333-3333-4333-8333-333333333333",
        continuation_secret: "one-time-secret",
        expires_at: "2026-08-26T15:19:05.000+00:00",
        is_replay: false,
      },
      {
        attempt_id: "44444444-4444-4444-8444-444444444444",
        continuation_secret: "another-secret",
        expires_at: "2026-08-26T15:19:05.000+00:00",
        is_replay: false,
      },
    ]],
    ["an extra lead identifier", [{
      attempt_id: "33333333-3333-4333-8333-333333333333",
      continuation_secret: "one-time-secret",
      expires_at: "2026-08-26T15:19:05.000+00:00",
      is_replay: false,
      lead_id: "55555555-5555-4555-8555-555555555555",
    }]],
    ["an extra public token", [{
      attempt_id: "33333333-3333-4333-8333-333333333333",
      continuation_secret: "one-time-secret",
      expires_at: "2026-08-26T15:19:05.000+00:00",
      is_replay: false,
      public_token: "not-allowed",
    }]],
    ["a malformed attempt identifier", [{
      attempt_id: "attempt-123",
      continuation_secret: "one-time-secret",
      expires_at: "2026-08-26T15:19:05.000+00:00",
      is_replay: false,
    }]],
    ["a malformed expiry", [{
      attempt_id: "33333333-3333-4333-8333-333333333333",
      continuation_secret: "one-time-secret",
      expires_at: "tomorrow",
      is_replay: false,
    }]],
    ["a first issue with no secret", [{
      attempt_id: "33333333-3333-4333-8333-333333333333",
      continuation_secret: null,
      expires_at: "2026-08-26T15:19:05.000+00:00",
      is_replay: false,
    }]],
    ["a replay carrying a secret", [{
      attempt_id: "33333333-3333-4333-8333-333333333333",
      continuation_secret: "one-time-secret",
      expires_at: "2026-08-26T15:19:05.000+00:00",
      is_replay: true,
    }]],
  ])("rejects malformed raw RPC output: %s", async (_label, data) => {
    const repository = new SupabaseAssessmentIntakeRepository({
      rpc: vi.fn().mockResolvedValue({data, error: null}),
    } as never);

    await expect(repository.startOrResume(normalizedInput)).rejects.toBeInstanceOf(
      AssessmentIntakePersistenceError,
    );
  });

  test("sanitizes a rejected Supabase client error", async () => {
    const repository = new SupabaseAssessmentIntakeRepository({
      rpc: vi.fn().mockRejectedValue(
        new Error("fetch failed for https://secret-project.supabase.co/rest/v1/rpc"),
      ),
    } as never);

    await expect(repository.startOrResume(normalizedInput)).rejects.toEqual(
      expect.objectContaining<Partial<AssessmentIntakePersistenceError>>({
        name: "AssessmentIntakePersistenceError",
        message: "Assessment intake persistence failed",
      }),
    );
  });
});

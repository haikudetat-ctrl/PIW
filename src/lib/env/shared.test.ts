import { describe, expect, test } from "vitest";
import { parseClientEnv } from "./client";
import { parseServerEnv, resolveLeadDistributionConfiguration, resolveMetaTrackingConfiguration } from "./server";

const base = {
  NODE_ENV: "test",
  DEPLOYMENT_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
  INNGEST_EVENT_KEY: "local-event-key",
  INNGEST_SIGNING_KEY: "local-signing-key",
};

describe("parseServerEnv", () => {
  test("disables paid providers by default", () => {
    const environment = parseServerEnv(base);
    expect(environment.PAID_PROVIDERS_ENABLED).toBe(false);
    expect(environment.ROOF_ASSESSMENT_ENABLED).toBe(false);
    expect(environment.COST_INTELLIGENCE_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADMASTER_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_JOBNIMBUS_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_JOBNIMBUS_CANARY_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_CALLTOOLS_ENABLED).toBe(false);
    expect(environment.JOBNIMBUS_PAGE_LIMIT).toBe(50);
    expect(environment.JOBNIMBUS_MAX_PAGES).toBe(1);
    expect(environment.COST_MONTHLY_BUDGET_USD).toBe(1500);
    expect(environment.META_TRACKING_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADCONDUIT_SUBMISSION_ENABLED).toBe(false);
    expect(environment.INTERNAL_LEAD_EMAIL_ENABLED).toBe(false);
  });

  test("enables lead distribution only with complete destination configuration", () => {
    expect(resolveLeadDistributionConfiguration(parseServerEnv(base))).toEqual({
      companyId: null,
      activeProspect: null,
      internalEmail: null,
    });
    const configured = parseServerEnv({
      ...base,
      INTEGRATIONS_LEADCONDUIT_SUBMISSION_ENABLED: "true",
      INTERNAL_LEAD_EMAIL_ENABLED: "true",
      RESEND_API_KEY: "re_test_key",
      LEAD_NOTIFICATION_FROM_EMAIL: "leads@allseason.solar",
      VERCEL_PROJECT_PRODUCTION_URL: "piw-sepia.vercel.app",
      ACCESS_ROUTE_COMPANY_ID: "00000000-0000-4000-8000-000000000001",
    });
    expect(resolveLeadDistributionConfiguration(configured)).toEqual({
      companyId: "00000000-0000-4000-8000-000000000001",
      activeProspect: {enabled: true},
      internalEmail: {
        apiKey: "re_test_key",
        fromEmail: "leads@allseason.solar",
        appBaseUrl: "https://piw-sepia.vercel.app",
      },
    });
  });

  test("rejects incomplete enabled internal lead email configuration", () => {
    expect(() => parseServerEnv({...base, INTERNAL_LEAD_EMAIL_ENABLED: "true"}))
      .toThrow("RESEND_API_KEY is required");
  });

  test("Meta tracking resolves disabled until matching server and public configuration is complete", () => {
    expect(resolveMetaTrackingConfiguration(parseServerEnv({ ...base, META_TRACKING_ENABLED: "true" })))
      .toBeNull();

    const configured = {
      ...base,
      META_TRACKING_ENABLED: "true",
      META_PIXEL_ID: "3142520615938086",
      NEXT_PUBLIC_META_PIXEL_ID: "3142520615938086",
      META_CAPI_ACCESS_TOKEN: "private-token",
      META_GRAPH_API_VERSION: "v26.0",
    };
    expect(resolveMetaTrackingConfiguration(parseServerEnv({
      ...configured,
      PRIVACY_CONSENT_SIGNING_SECRET: "a".repeat(32),
    }))).toMatchObject({
      pixelId: "3142520615938086",
      graphApiVersion: "v26.0",
    });
    expect(resolveMetaTrackingConfiguration(parseServerEnv({
      ...configured,
      NEXT_PUBLIC_META_PIXEL_ID: "9999999999999999",
      PRIVACY_CONSENT_SIGNING_SECRET: "a".repeat(32),
    }))).toBeNull();
    expect(resolveMetaTrackingConfiguration(parseServerEnv({
      ...configured,
      META_GRAPH_API_VERSION: "latest",
      PRIVACY_CONSENT_SIGNING_SECRET: "a".repeat(32),
    }))).toBeNull();
  });

  test("permits a Meta Test Events code in Vercel preview and disables it in production", () => {
    const configured = {
      ...base,
      META_TRACKING_ENABLED: "true",
      META_PIXEL_ID: "3142520615938086",
      NEXT_PUBLIC_META_PIXEL_ID: "3142520615938086",
      META_CAPI_ACCESS_TOKEN: "private-token",
      META_GRAPH_API_VERSION: "v26.0",
      META_TEST_EVENT_CODE: "TEST123",
    };

    expect(resolveMetaTrackingConfiguration(parseServerEnv({
      ...configured,
      PRIVACY_CONSENT_SIGNING_SECRET: "a".repeat(32),
    }))?.testEventCode).toBe("TEST123");
    expect(resolveMetaTrackingConfiguration(parseServerEnv({
      ...configured,
      NODE_ENV: "production",
      DEPLOYMENT_ENV: "production",
      VERCEL_ENV: "preview",
      PRIVACY_CONSENT_SIGNING_SECRET: "a".repeat(32),
    }))?.testEventCode).toBe("TEST123");
    expect(resolveMetaTrackingConfiguration(parseServerEnv({
      ...configured,
      NODE_ENV: "production",
      DEPLOYMENT_ENV: "production",
      VERCEL_ENV: "production",
      PRIVACY_CONSENT_SIGNING_SECRET: "a".repeat(32),
    }))).toBeNull();
    expect(resolveMetaTrackingConfiguration(parseServerEnv({
      ...configured,
      NODE_ENV: "production",
      DEPLOYMENT_ENV: "preview",
      VERCEL_ENV: "production",
      PRIVACY_CONSENT_SIGNING_SECRET: "a".repeat(32),
    }))).toBeNull();
    expect(resolveMetaTrackingConfiguration(parseServerEnv({
      ...configured,
      NODE_ENV: "production",
      DEPLOYMENT_ENV: "production",
      PRIVACY_CONSENT_SIGNING_SECRET: "a".repeat(32),
    }))).toBeNull();
  });

  test("treats a blank optional Meta Graph API version as unset while disabled", () => {
    expect(parseServerEnv({
      ...base,
      META_GRAPH_API_VERSION: "",
    }).META_GRAPH_API_VERSION).toBeUndefined();
  });

  test("defaults both LeadConduit receivers to disabled", () => {
    const environment = parseServerEnv(base);

    expect(environment.INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RECEIVER_ENABLED).toBe(false);
  });

  test("does not surface an obsolete LeadConduit filter caveat setting", () => {
    const environment = parseServerEnv({
      ...base,
      LEADCONDUIT_FILTER_CAVEAT_ACTIVE: "false",
    });

    expect(environment).not.toHaveProperty("LEADCONDUIT_FILTER_CAVEAT_ACTIVE");
  });

  test.each([
    ["roofing", "INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED", "LEADCONDUIT_ROOFING_FLOW_ID", "LEADCONDUIT_ROOFING_WEBHOOK_TOKEN", "6377949a81800d03d54119b5"],
    ["virtual quote", "INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RECEIVER_ENABLED", "LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID", "LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN", "68d597a7e5a45ce2a9c822fe"],
  ] as const)("requires the company, exact flow ID, and active token for an enabled %s receiver", (_label, receiverFlag, flowId, token, approvedFlowId) => {
    expect(() => parseServerEnv({ ...base, [receiverFlag]: "true" })).toThrow("ACCESS_ROUTE_COMPANY_ID is required");
    expect(() => parseServerEnv({
      ...base,
      ACCESS_ROUTE_COMPANY_ID: "00000000-0000-4000-8000-000000000001",
      [receiverFlag]: "true",
    })).toThrow(`${flowId} is required`);
    expect(() => parseServerEnv({
      ...base,
      ACCESS_ROUTE_COMPANY_ID: "00000000-0000-4000-8000-000000000001",
      [flowId]: approvedFlowId,
      [receiverFlag]: "true",
    })).toThrow(`${token} is required`);
  });

  test("does not require LeadConduit identifiers or tokens while both receivers are disabled", () => {
    expect(() => parseServerEnv(base)).not.toThrow();
  });

  test("keeps an enabled receiver and its active token valid after next-token expiry", () => {
    const environment = parseServerEnv({
      ...base,
      ACCESS_ROUTE_COMPANY_ID: "00000000-0000-4000-8000-000000000001",
      INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED: "true",
      LEADCONDUIT_ROOFING_FLOW_ID: "6377949a81800d03d54119b5",
      LEADCONDUIT_ROOFING_WEBHOOK_TOKEN: "active-token",
      LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT: "next-token",
      LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT_EXPIRES_AT: "2020-01-01T00:00:00.000Z",
    });

    expect(environment.INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED).toBe(true);
    expect(environment.LEADCONDUIT_ROOFING_WEBHOOK_TOKEN).toBe("active-token");
  });

  test.each([
    ["roofing", "INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED", "LEADCONDUIT_ROOFING_FLOW_ID", "LEADCONDUIT_ROOFING_WEBHOOK_TOKEN", "6377949a81800d03d54119b5", "68d597a7e5a45ce2a9c822fe"],
    ["virtual quote", "INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RECEIVER_ENABLED", "LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID", "LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN", "68d597a7e5a45ce2a9c822fe", "6377949a81800d03d54119b5"],
  ] as const)("requires the approved %s flow ID when the receiver is enabled", (_label, receiverFlag, flowId, token, approvedFlowId, swappedFlowId) => {
    const receiver = {
      ...base,
      ACCESS_ROUTE_COMPANY_ID: "00000000-0000-4000-8000-000000000001",
      [receiverFlag]: "true",
      [token]: "flow-token",
    };

    expect(() => parseServerEnv({ ...receiver, [flowId]: "unapproved-flow-id" })).toThrow(`${flowId} must equal ${approvedFlowId}`);
    expect(() => parseServerEnv({ ...receiver, [flowId]: swappedFlowId })).toThrow(`${flowId} must equal ${approvedFlowId}`);
    expect(() => parseServerEnv({ ...receiver, [flowId]: approvedFlowId })).not.toThrow();
  });

  test.each([
    ["active/active", "LEADCONDUIT_ROOFING_WEBHOOK_TOKEN", "LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN"],
    ["active/next", "LEADCONDUIT_ROOFING_WEBHOOK_TOKEN", "LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN_NEXT"],
    ["next/active", "LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT", "LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN"],
    ["next/next", "LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT", "LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN_NEXT"],
  ] as const)("rejects a LeadConduit token shared across flows in the %s position", (_position, roofingTokenKey, virtualQuoteTokenKey) => {
    expect(() => parseServerEnv({
      ...base,
      LEADCONDUIT_ROOFING_WEBHOOK_TOKEN: "roofing-active-token",
      LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT: "roofing-next-token",
      LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT_EXPIRES_AT: "2030-01-01T00:00:00.000Z",
      LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN: "virtual-quote-active-token",
      LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN_NEXT: "virtual-quote-next-token",
      LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN_NEXT_EXPIRES_AT: "2030-01-01T00:00:00.000Z",
      [roofingTokenKey]: "shared-cross-flow-token",
      [virtualQuoteTokenKey]: "shared-cross-flow-token",
    })).toThrow("LeadConduit webhook tokens must not be shared across flows");
  });

  test("rejects JobNimbus import limits above their safety bounds", () => {
    expect(() => parseServerEnv({ ...base, JOBNIMBUS_PAGE_LIMIT: "501" })).toThrow();
    expect(() => parseServerEnv({ ...base, JOBNIMBUS_MAX_PAGES: "26" })).toThrow();
  });

  test("enables the public roof assessment explicitly", () => {
    expect(parseServerEnv({
      ...base,
      ROOF_ASSESSMENT_ENABLED: "true",
      ROOF_ASSESSMENT_SIGNING_SECRET: "a".repeat(32),
    }).ROOF_ASSESSMENT_ENABLED).toBe(true);
  });

  test("rejects paid providers in preview", () => {
    expect(() =>
      parseServerEnv({
        ...base,
        DEPLOYMENT_ENV: "preview",
        PAID_PROVIDERS_ENABLED: "true",
      }),
    ).toThrow("Paid providers cannot be enabled in preview or test");
  });

  test("requires a Google key when live paid providers are enabled", () => {
    expect(() =>
      parseServerEnv({
        ...base,
        NODE_ENV: "production",
        DEPLOYMENT_ENV: "production",
        PRIVACY_CONSENT_SIGNING_SECRET: "a".repeat(32),
        PAID_PROVIDERS_ENABLED: "true",
      }),
    ).toThrow("Google Maps API key is required");
  });

  test("treats blank optional estimate settings as unset", () => {
    expect(
      parseServerEnv({
        ...base,
        GOOGLE_MAPS_API_KEY: "",
        ESTIMATE_SMS_WEBHOOK_URL: "",
        ESTIMATE_EMAIL_WEBHOOK_URL: "",
        ESTIMATE_DELIVERY_SHARED_SECRET: "",
        SLACK_CONTEXT_DIALER_WEBHOOK_URL: "",
        CONTEXT_DIALER_BASE_URL: "",
        ROOF_ESTIMATE_COMPANY_ID: "",
      }).GOOGLE_MAPS_API_KEY,
    ).toBeUndefined();
  });

  test("allows Vercel's system domain to supply the Context Dialer URL", () => {
    expect(
      parseServerEnv({
        ...base,
        SLACK_CONTEXT_DIALER_WEBHOOK_URL: "https://hooks.slack.com/services/test",
        VERCEL_PROJECT_PRODUCTION_URL: "piw-sepia.vercel.app",
      }).VERCEL_PROJECT_PRODUCTION_URL,
    ).toBe("piw-sepia.vercel.app");
  });

  test("does not let malformed optional Slack configuration block core services", () => {
    expect(
      parseServerEnv({
        ...base,
        SLACK_CONTEXT_DIALER_WEBHOOK_URL: "not-a-valid-webhook-url",
        CONTEXT_DIALER_BASE_URL: "https://piw.example.com",
      }).SLACK_CONTEXT_DIALER_WEBHOOK_URL,
    ).toBe("not-a-valid-webhook-url");
  });

  test("requires the All Season company and shared secret together", () => {
    expect(() =>
      parseServerEnv({
        ...base,
        ALL_SEASON_INTAKE_SHARED_SECRET: "shared-secret",
      }),
    ).toThrow("All Season intake requires both its company ID and shared secret");
  });

  test("accepts only a configured roof assessment signing secret of at least 32 bytes", () => {
    expect(() =>
      parseServerEnv({...base, ROOF_ASSESSMENT_SIGNING_SECRET: "short-secret"}),
    ).toThrow("Roof assessment signing secret must be at least 32 bytes");
    expect(
      parseServerEnv({...base, ROOF_ASSESSMENT_SIGNING_SECRET: "é".repeat(16)})
        .ROOF_ASSESSMENT_SIGNING_SECRET,
    ).toBe("é".repeat(16));
  });

  test("requires the signing secret when roof assessments are enabled", () => {
    expect(() =>
      parseServerEnv({...base, ROOF_ASSESSMENT_ENABLED: "true"}),
    ).toThrow("Roof assessment signing secret is required when assessments are enabled");
  });

  test("allows disabled environments to omit the signing secret", () => {
    expect(parseServerEnv(base).ROOF_ASSESSMENT_SIGNING_SECRET).toBeUndefined();
  });

  test("does not let missing production privacy tracking config reject core parsing", () => {
    expect(parseServerEnv({
      ...base,
      NODE_ENV: "production",
      DEPLOYMENT_ENV: "production",
    })).toMatchObject({DEPLOYMENT_ENV: "production"});
  });

  test("allows test and development environments to omit the privacy consent signing secret", () => {
    expect(parseServerEnv(base).PRIVACY_CONSENT_SIGNING_SECRET).toBeUndefined();
    expect(parseServerEnv({ ...base, NODE_ENV: "development", DEPLOYMENT_ENV: "development" })
      .PRIVACY_CONSENT_SIGNING_SECRET).toBeUndefined();
  });

  test("treats short privacy configuration as tracking-disabled rather than a core startup error", () => {
    const environment = parseServerEnv({
      ...base,
      META_TRACKING_ENABLED: "true",
      META_PIXEL_ID: "3142520615938086",
      NEXT_PUBLIC_META_PIXEL_ID: "3142520615938086",
      META_CAPI_ACCESS_TOKEN: "private-token",
      META_GRAPH_API_VERSION: "v26.0",
      PRIVACY_CONSENT_SIGNING_SECRET: "short-secret",
    });
    expect(resolveMetaTrackingConfiguration(environment)).toBeNull();
  });

  test("requires complete Twilio Verify and assessment session configuration when enabled", () => {
    expect(() => parseServerEnv({...base, TWILIO_VERIFY_ENABLED: "true"}))
      .toThrow("Twilio Verify requires API credentials, a service SID, and assessment signing");

    expect(parseServerEnv({
      ...base,
      ROOF_ASSESSMENT_ENABLED: "true",
      ROOF_ASSESSMENT_SIGNING_SECRET: "a".repeat(32),
      TWILIO_VERIFY_ENABLED: "true",
      TWILIO_API_KEY_SID: "SK_test_key",
      TWILIO_API_KEY_SECRET: "test-secret",
      TWILIO_VERIFY_SERVICE_SID: "VA_test_service",
    }).TWILIO_VERIFY_ENABLED).toBe(true);
  });
});

describe("parseClientEnv", () => {
  test("returns only public environment values", () => {
    expect(
      parseClientEnv({
        ...base,
        META_TRACKING_ENABLED: "true",
        NEXT_PUBLIC_META_PIXEL_ID: "3142520615938086",
        META_CAPI_ACCESS_TOKEN: "must-not-reach-client-code",
        SUPABASE_SERVICE_ROLE_KEY: "must-not-reach-client-code",
      }),
    ).toEqual({
      DEPLOYMENT_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable-key",
      META_TRACKING_ENABLED: true,
      NEXT_PUBLIC_META_PIXEL_ID: "3142520615938086",
    });
  });
});

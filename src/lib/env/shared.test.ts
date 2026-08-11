import { describe, expect, test } from "vitest";
import { parseClientEnv } from "./client";
import { parseServerEnv } from "./server";

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
    expect(environment.COST_INTELLIGENCE_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADCONDUIT_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADMASTER_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_JOBNIMBUS_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_CALLTOOLS_ENABLED).toBe(false);
    expect(environment.JOBNIMBUS_PAGE_LIMIT).toBe(50);
    expect(environment.JOBNIMBUS_MAX_PAGES).toBe(1);
    expect(environment.COST_MONTHLY_BUDGET_USD).toBe(1500);
  });

  test("defaults every LeadConduit capability and bounded reader setting to its safe value", () => {
    const environment = parseServerEnv(base);

    expect(environment.INTEGRATIONS_LEADCONDUIT_PROBE_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADCONDUIT_ROOFING_SHADOW_IMPORT_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_SHADOW_IMPORT_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADCONDUIT_ROOFING_POLLING_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_POLLING_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RECEIVER_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADCONDUIT_ROOFING_PROCESSING_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_PROCESSING_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADCONDUIT_ROOFING_RESCUE_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RESCUE_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADCONDUIT_ROOFING_RESCUE_ACTIONS_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RESCUE_ACTIONS_ENABLED).toBe(false);
    expect(environment.LEADCONDUIT_SHADOW_PAGE_LIMIT).toBe(50);
    expect(environment.LEADCONDUIT_SHADOW_MAX_PAGES).toBe(1);
    expect(environment.LEADCONDUIT_PAGE_LIMIT).toBe(50);
    expect(environment.LEADCONDUIT_MAX_PAGES).toBe(1);
    expect(environment.LEADCONDUIT_INITIAL_LOOKBACK_MINUTES).toBe(1440);
    expect(environment.LEADCONDUIT_WEBHOOK_ATTEMPT_RATE_LIMIT_PER_MINUTE).toBe(600);
    expect(environment.LEADCONDUIT_WEBHOOK_DELIVERY_RATE_LIMIT_PER_MINUTE).toBe(300);
  });

  test("requires only the credentials for each enabled LeadConduit capability", () => {
    expect(() => parseServerEnv({
      ...base,
      INTEGRATIONS_LEADCONDUIT_PROBE_ENABLED: "true",
    })).toThrow("LEADCONDUIT_API_KEY is required");

    expect(() => parseServerEnv({
      ...base,
      INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED: "true",
    })).toThrow("ACCESS_ROUTE_COMPANY_ID is required");

    expect(() => parseServerEnv({
      ...base,
      ACCESS_ROUTE_COMPANY_ID: "00000000-0000-4000-8000-000000000001",
      INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED: "true",
    })).toThrow("LEADCONDUIT_ROOFING_FLOW_ID is required");

    expect(() => parseServerEnv({
      ...base,
      ACCESS_ROUTE_COMPANY_ID: "00000000-0000-4000-8000-000000000001",
      LEADCONDUIT_ROOFING_FLOW_ID: "roofing-flow",
      INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED: "true",
    })).toThrow("LEADCONDUIT_ROOFING_WEBHOOK_TOKEN is required");

    expect(() => parseServerEnv({
      ...base,
      INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_POLLING_ENABLED: "true",
    })).toThrow("LEADCONDUIT_API_KEY is required");

    expect(() => parseServerEnv({
      ...base,
      LEADCONDUIT_API_KEY: "test-api-key",
      INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_POLLING_ENABLED: "true",
    })).toThrow("LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID is required");
  });

  test("requires rescue recommendations and processing before enabling rescue actions", () => {
    expect(() => parseServerEnv({
      ...base,
      INTEGRATIONS_LEADCONDUIT_ROOFING_RESCUE_ACTIONS_ENABLED: "true",
    })).toThrow("Roofing rescue actions require rescue recommendations and processing");

    expect(() => parseServerEnv({
      ...base,
      INTEGRATIONS_LEADCONDUIT_ROOFING_RESCUE_ACTIONS_ENABLED: "true",
      INTEGRATIONS_LEADCONDUIT_ROOFING_RESCUE_ENABLED: "true",
      INTEGRATIONS_LEADCONDUIT_ROOFING_PROCESSING_ENABLED: "true",
    })).not.toThrow();
  });

  test("rejects LeadConduit settings above their safety bounds", () => {
    expect(() => parseServerEnv({ ...base, LEADCONDUIT_SHADOW_PAGE_LIMIT: "51" })).toThrow();
    expect(() => parseServerEnv({ ...base, LEADCONDUIT_SHADOW_MAX_PAGES: "2" })).toThrow();
    expect(() => parseServerEnv({ ...base, LEADCONDUIT_PAGE_LIMIT: "1001" })).toThrow();
    expect(() => parseServerEnv({ ...base, LEADCONDUIT_MAX_PAGES: "26" })).toThrow();
    expect(() => parseServerEnv({ ...base, LEADCONDUIT_INITIAL_LOOKBACK_MINUTES: "129601" })).toThrow();
    expect(() => parseServerEnv({ ...base, LEADCONDUIT_WEBHOOK_ATTEMPT_RATE_LIMIT_PER_MINUTE: "10001" })).toThrow();
    expect(() => parseServerEnv({ ...base, LEADCONDUIT_WEBHOOK_DELIVERY_RATE_LIMIT_PER_MINUTE: "5001" })).toThrow();
  });

  test("rejects a next LeadConduit webhook token with a past expiry", () => {
    expect(() => parseServerEnv({
      ...base,
      LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT: "next-token",
      LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT_EXPIRES_AT: "2020-01-01T00:00:00.000Z",
    })).toThrow("LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT_EXPIRES_AT must be in the future");
  });

  test("rejects JobNimbus import limits above their safety bounds", () => {
    expect(() => parseServerEnv({ ...base, JOBNIMBUS_PAGE_LIMIT: "501" })).toThrow();
    expect(() => parseServerEnv({ ...base, JOBNIMBUS_MAX_PAGES: "26" })).toThrow();
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
});

describe("parseClientEnv", () => {
  test("returns only public environment values", () => {
    expect(
      parseClientEnv({
        ...base,
        SUPABASE_SERVICE_ROLE_KEY: "must-not-reach-client-code",
      }),
    ).toEqual({
      DEPLOYMENT_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable-key",
    });
  });
});

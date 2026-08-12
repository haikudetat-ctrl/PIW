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
    expect(environment.INTEGRATIONS_LEADMASTER_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_JOBNIMBUS_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_CALLTOOLS_ENABLED).toBe(false);
    expect(environment.JOBNIMBUS_PAGE_LIMIT).toBe(50);
    expect(environment.JOBNIMBUS_MAX_PAGES).toBe(1);
    expect(environment.COST_MONTHLY_BUDGET_USD).toBe(1500);
  });

  test("defaults both LeadConduit receivers to disabled", () => {
    const environment = parseServerEnv(base);

    expect(environment.INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RECEIVER_ENABLED).toBe(false);
  });

  test.each([
    ["roofing", "INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED", "LEADCONDUIT_ROOFING_FLOW_ID", "LEADCONDUIT_ROOFING_WEBHOOK_TOKEN"],
    ["virtual quote", "INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RECEIVER_ENABLED", "LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID", "LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN"],
  ] as const)("requires the company, exact flow ID, and active token for an enabled %s receiver", (_label, receiverFlag, flowId, token) => {
    expect(() => parseServerEnv({ ...base, [receiverFlag]: "true" })).toThrow("ACCESS_ROUTE_COMPANY_ID is required");
    expect(() => parseServerEnv({
      ...base,
      ACCESS_ROUTE_COMPANY_ID: "00000000-0000-4000-8000-000000000001",
      [receiverFlag]: "true",
    })).toThrow(`${flowId} is required`);
    expect(() => parseServerEnv({
      ...base,
      ACCESS_ROUTE_COMPANY_ID: "00000000-0000-4000-8000-000000000001",
      [flowId]: "flow-id",
      [receiverFlag]: "true",
    })).toThrow(`${token} is required`);
  });

  test("does not require LeadConduit identifiers or tokens while both receivers are disabled", () => {
    expect(() => parseServerEnv(base)).not.toThrow();
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

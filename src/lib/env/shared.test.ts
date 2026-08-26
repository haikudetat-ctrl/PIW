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
    expect(environment.ROOF_ASSESSMENT_ENABLED).toBe(false);
    expect(environment.COST_INTELLIGENCE_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADCONDUIT_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_LEADMASTER_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_JOBNIMBUS_ENABLED).toBe(false);
    expect(environment.INTEGRATIONS_CALLTOOLS_ENABLED).toBe(false);
    expect(environment.COST_MONTHLY_BUDGET_USD).toBe(1500);
  });

  test("enables the public roof assessment explicitly", () => {
    expect(parseServerEnv({...base, ROOF_ASSESSMENT_ENABLED: "true"}).ROOF_ASSESSMENT_ENABLED).toBe(true);
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

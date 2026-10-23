import {describe, expect, test} from "vitest";
import {parseServerEnv} from "./server";

const base = {
  NODE_ENV: "test",
  DEPLOYMENT_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
  INNGEST_EVENT_KEY: "local-event-key",
  INNGEST_SIGNING_KEY: "local-signing-key",
};

const enabledPrefetch = {
  ...base,
  NODE_ENV: "production",
  DEPLOYMENT_ENV: "production",
  ROOF_ASSESSMENT_PROPERTY_PREFETCH_ENABLED: "true",
  ROOF_ASSESSMENT_ENABLED: "true",
  ROOF_ASSESSMENT_SIGNING_SECRET: "a".repeat(32),
  PRIVACY_CONSENT_SIGNING_SECRET: "a".repeat(32),
  PAID_PROVIDERS_ENABLED: "true",
  GOOGLE_MAPS_API_KEY: "maps-key",
};

describe("parseServerEnv property prefetch", () => {
  test("disables property prefetch by default", () => {
    expect(parseServerEnv(base).ROOF_ASSESSMENT_PROPERTY_PREFETCH_ENABLED).toBe(false);
  });

  test.each([
    ["assessment intake", {ROOF_ASSESSMENT_ENABLED: "false", ROOF_ASSESSMENT_SIGNING_SECRET: undefined}],
    ["paid providers", {PAID_PROVIDERS_ENABLED: "false"}],
    ["a Google Maps API key", {GOOGLE_MAPS_API_KEY: undefined}],
  ] as const)("rejects enabled property prefetch without %s", (_requirement, invalid) => {
    expect(() => parseServerEnv({...enabledPrefetch, ...invalid})).toThrow(
      "Property prefetch requires roof assessments, paid providers, and a Google Maps API key",
    );
  });

  test("accepts property prefetch only with all required server capabilities", () => {
    expect(parseServerEnv(enabledPrefetch).ROOF_ASSESSMENT_PROPERTY_PREFETCH_ENABLED).toBe(true);
  });
});

describe("parseServerEnv property preview", () => {
  const enabledPreview = {
    ...enabledPrefetch,
    ROOF_ASSESSMENT_PROPERTY_PREFETCH_ENABLED: "false",
    PROPERTY_PREVIEW_ENABLED: "true",
    TURNSTILE_SECRET_KEY: "turnstile-secret",
  };

  test("disables property previews by default", () => {
    expect(parseServerEnv(base).PROPERTY_PREVIEW_ENABLED).toBe(false);
  });

  test.each([
    ["a Turnstile secret", {TURNSTILE_SECRET_KEY: undefined}],
    ["roof assessments", {ROOF_ASSESSMENT_ENABLED: "false", ROOF_ASSESSMENT_SIGNING_SECRET: undefined}],
    ["paid providers", {PAID_PROVIDERS_ENABLED: "false"}],
  ] as const)("rejects enabled previews without %s", (_requirement, invalid) => {
    expect(() => parseServerEnv({...enabledPreview, ...invalid})).toThrow(
      "Property previews require a Turnstile secret, roof assessments, and paid providers",
    );
  });

  test("accepts previews with all required capabilities", () => {
    expect(parseServerEnv(enabledPreview).PROPERTY_PREVIEW_ENABLED).toBe(true);
  });
});

describe("parseServerEnv quote chat", () => {
  test("is off by default", () => {
    expect(parseServerEnv(base).QUOTE_CHAT_ENABLED).toBe(false);
  });

  test("needs property previews", () => {
    expect(() => parseServerEnv({...base, QUOTE_CHAT_ENABLED: "true"})).toThrow("enable those first");
    expect(parseServerEnv({
      ...enabledPrefetch,
      ROOF_ASSESSMENT_PROPERTY_PREFETCH_ENABLED: "false",
      PROPERTY_PREVIEW_ENABLED: "true",
      TURNSTILE_SECRET_KEY: "turnstile-secret",
      QUOTE_CHAT_ENABLED: "true",
    }).QUOTE_CHAT_ENABLED).toBe(true);
  });
});

describe("parseServerEnv fast quote booking", () => {
  test("is off by default", () => {
    expect(parseServerEnv(base).QUOTE_FAST_BOOKING_ENABLED).toBe(false);
  });

  test("needs property previews", () => {
    expect(() => parseServerEnv({...base, QUOTE_FAST_BOOKING_ENABLED: "true"})).toThrow("enable those first");
    expect(parseServerEnv({
      ...enabledPrefetch,
      ROOF_ASSESSMENT_PROPERTY_PREFETCH_ENABLED: "false",
      PROPERTY_PREVIEW_ENABLED: "true",
      TURNSTILE_SECRET_KEY: "turnstile-secret",
      QUOTE_FAST_BOOKING_ENABLED: "true",
    }).QUOTE_FAST_BOOKING_ENABLED).toBe(true);
  });
});

describe("parseServerEnv virtual booking", () => {
  const keyless = {
    ...base,
    VIRTUAL_BOOKING_ENABLED: "true",
    BOOKING_LINK_SIGNING_SECRET: "b".repeat(32),
    GOOGLE_CALENDAR_DELEGATED_USER: "scheduling@allseason.example",
    GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL: "booking@project.iam.gserviceaccount.com",
    GOOGLE_WORKLOAD_IDENTITY_PROVIDER: "projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/vercel",
  };

  test("accepts keyless Google access without a service account key", () => {
    expect(parseServerEnv(keyless).VIRTUAL_BOOKING_ENABLED).toBe(true);
  });

  test("accepts a service account key instead", () => {
    expect(parseServerEnv({
      ...keyless,
      GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL: undefined,
      GOOGLE_WORKLOAD_IDENTITY_PROVIDER: undefined,
      GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON: "{}",
    }).VIRTUAL_BOOKING_ENABLED).toBe(true);
  });

  test("rejects enabled booking with no Google credential", () => {
    expect(() => parseServerEnv({...keyless, GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL: undefined, GOOGLE_WORKLOAD_IDENTITY_PROVIDER: undefined}))
      .toThrow("either workload identity or a service account key");
  });

  test("rejects half of the keyless pair", () => {
    expect(() => parseServerEnv({...keyless, GOOGLE_WORKLOAD_IDENTITY_PROVIDER: undefined, GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON: "{}"}))
      .toThrow("needs both the service account email and the workload identity provider");
  });

  test("rejects a provider ID that is not the full resource name", () => {
    expect(() => parseServerEnv({...keyless, GOOGLE_WORKLOAD_IDENTITY_PROVIDER: "vercel"}))
      .toThrow("Use the full provider resource name");
  });
});

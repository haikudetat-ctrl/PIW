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

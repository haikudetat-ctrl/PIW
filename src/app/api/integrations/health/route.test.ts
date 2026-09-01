import { afterEach, expect, test, vi } from "vitest";
import { GET } from "./route";

const requiredEnvironment = {
  NODE_ENV: "test",
  DEPLOYMENT_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
  INNGEST_EVENT_KEY: "local-event-key",
  INNGEST_SIGNING_KEY: "local-signing-key",
};

afterEach(() => vi.unstubAllEnvs());

test("reports only LeadConduit receipt booleans", async () => {
  for (const [key, value] of Object.entries(requiredEnvironment)) vi.stubEnv(key, value);

  const response = await GET();

  const body = await response.json();
  expect(body).toMatchObject({
    status: "ok",
    databaseHost: "127.0.0.1:54321",
    vendors: { leadconduit: false, leadmaster: false, jobnimbus: false, calltools: false },
    leadconduit: {
      roofing: false,
      virtualQuote: false,
    },
  });
  expect(Object.keys(body.leadconduit)).not.toEqual(expect.arrayContaining([
    expect.stringMatching(/probe|shadow|poll|process|rescue|token|flowId|api/i),
  ]));
});

test("continues reporting an active receiver after its next token has expired", async () => {
  for (const [key, value] of Object.entries({
    ...requiredEnvironment,
    ACCESS_ROUTE_COMPANY_ID: "00000000-0000-4000-8000-000000000001",
    INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED: "true",
    LEADCONDUIT_ROOFING_FLOW_ID: "6377949a81800d03d54119b5",
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN: "active-token",
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT: "expired-next-token",
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT_EXPIRES_AT: "2020-01-01T00:00:00.000Z",
  })) vi.stubEnv(key, value);

  await expect(GET()).resolves.toMatchObject({ status: 200 });
  expect(await (await GET()).json()).toMatchObject({
    leadconduit: { roofing: true, virtualQuote: false },
  });
});

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

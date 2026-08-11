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

test("reports the LeadConduit capability booleans without identifiers or credentials", async () => {
  for (const [key, value] of Object.entries(requiredEnvironment)) vi.stubEnv(key, value);

  const response = await GET();

  expect(await response.json()).toEqual({
    status: "ok",
    vendors: { leadconduit: false, leadmaster: false, jobnimbus: false, calltools: false },
    leadconduit: {
      probe: false,
      roofing: {
        shadowImport: false,
        polling: false,
        receipt: false,
        processing: false,
        rescueRecommendations: false,
        rescueActions: false,
      },
      virtualQuote: {
        shadowImport: false,
        polling: false,
        receipt: false,
        processing: false,
        rescueRecommendations: false,
        rescueActions: false,
      },
    },
  });
});

import { expect, test } from "vitest";
import { leadConduitCapabilityFlagsSnapshot } from "./flags";

const base = {
  NODE_ENV: "test",
  DEPLOYMENT_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
  INNGEST_EVENT_KEY: "local-event-key",
  INNGEST_SIGNING_KEY: "local-signing-key",
};

test("keeps each LeadConduit flow capability independently controlled", () => {
  const flags = leadConduitCapabilityFlagsSnapshot({
    ...base,
    INTEGRATIONS_LEADCONDUIT_ROOFING_SHADOW_IMPORT_ENABLED: "true",
    INTEGRATIONS_LEADCONDUIT_ROOFING_POLLING_ENABLED: "true",
    INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED: "true",
    INTEGRATIONS_LEADCONDUIT_ROOFING_PROCESSING_ENABLED: "true",
    INTEGRATIONS_LEADCONDUIT_ROOFING_RESCUE_ENABLED: "true",
    INTEGRATIONS_LEADCONDUIT_ROOFING_RESCUE_ACTIONS_ENABLED: "true",
    ACCESS_ROUTE_COMPANY_ID: "00000000-0000-4000-8000-000000000001",
    LEADCONDUIT_ROOFING_FLOW_ID: "roofing-flow",
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN: "roofing-token",
    LEADCONDUIT_API_KEY: "test-api-key",
  });

  expect(flags).toEqual({
    probe: false,
    roofing: {
      shadowImport: true,
      polling: true,
      receipt: true,
      processing: true,
      rescueRecommendations: true,
      rescueActions: true,
    },
    virtualQuote: {
      shadowImport: false,
      polling: false,
      receipt: false,
      processing: false,
      rescueRecommendations: false,
      rescueActions: false,
    },
  });
});

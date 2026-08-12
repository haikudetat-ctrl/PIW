import { expect, test } from "vitest";
import {
  integrationFlagsSnapshot,
  isIntegrationEnabled,
  leadConduitReceiptFlagsSnapshot,
} from "./flags";

const base = {
  NODE_ENV: "test",
  DEPLOYMENT_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
  INNGEST_EVENT_KEY: "local-event-key",
  INNGEST_SIGNING_KEY: "local-signing-key",
};

test("reports independent LeadConduit receipt receivers", () => {
  const flags = leadConduitReceiptFlagsSnapshot({
    ...base,
    INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED: "true",
    ACCESS_ROUTE_COMPANY_ID: "00000000-0000-4000-8000-000000000001",
    LEADCONDUIT_ROOFING_FLOW_ID: "roofing-flow",
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN: "roofing-token",
  });

  expect(flags).toEqual({
    roofing: true,
    virtualQuote: false,
  });
});

test("enables the generic LeadConduit vendor when either receipt receiver is enabled", () => {
  expect(isIntegrationEnabled("leadconduit", base)).toBe(false);
  expect(integrationFlagsSnapshot(base).leadconduit).toBe(false);

  const roofing = {
    ...base,
    ACCESS_ROUTE_COMPANY_ID: "00000000-0000-4000-8000-000000000001",
    LEADCONDUIT_ROOFING_FLOW_ID: "roofing-flow",
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN: "roofing-token",
    INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED: "true",
  };
  expect(isIntegrationEnabled("leadconduit", roofing)).toBe(true);
  expect(integrationFlagsSnapshot(roofing).leadconduit).toBe(true);

  const virtualQuote = {
    ...base,
    ACCESS_ROUTE_COMPANY_ID: "00000000-0000-4000-8000-000000000001",
    LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID: "virtual-quote-flow",
    LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN: "virtual-quote-token",
    INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RECEIVER_ENABLED: "true",
  };
  expect(isIntegrationEnabled("leadconduit", virtualQuote)).toBe(true);
  expect(integrationFlagsSnapshot(virtualQuote).leadconduit).toBe(true);
});

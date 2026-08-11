import { expect, test } from "vitest";
import { parseServerEnv } from "@/lib/env/server";
import { getLeadConduitFlowBinding } from "./leadconduit-config";

const base = {
  NODE_ENV: "test",
  DEPLOYMENT_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
  INNGEST_EVENT_KEY: "local-event-key",
  INNGEST_SIGNING_KEY: "local-signing-key",
  ACCESS_ROUTE_COMPANY_ID: "00000000-0000-4000-8000-000000000001",
  LEADCONDUIT_ROOFING_FLOW_ID: "roofing-flow",
  LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID: "virtual-quote-flow",
};

test("binds only the configured Roofing flow to its fixed identity and capabilities", () => {
  const binding = getLeadConduitFlowBinding("roofing", parseServerEnv({
    ...base,
    INTEGRATIONS_LEADCONDUIT_ROOFING_SHADOW_IMPORT_ENABLED: "true",
    INTEGRATIONS_LEADCONDUIT_ROOFING_POLLING_ENABLED: "true",
    INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED: "true",
    INTEGRATIONS_LEADCONDUIT_ROOFING_PROCESSING_ENABLED: "true",
    INTEGRATIONS_LEADCONDUIT_ROOFING_RESCUE_ENABLED: "true",
    INTEGRATIONS_LEADCONDUIT_ROOFING_RESCUE_ACTIONS_ENABLED: "true",
    LEADCONDUIT_API_KEY: "test-api-key",
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN: "active-roofing-token",
  }));

  expect(binding).toEqual({
    slug: "roofing",
    companyId: "00000000-0000-4000-8000-000000000001",
    flowId: "roofing-flow",
    flowName: "Roofing",
    capabilities: {
      shadowImport: true,
      polling: true,
      receipt: true,
      processing: true,
      rescueRecommendations: true,
      rescueActions: true,
    },
    tokens: [{ value: "active-roofing-token", validUntil: null }],
  });
});

test("binds only the configured virtual quote flow and rejects unknown slugs", () => {
  const environment = parseServerEnv({ ...base });

  expect(getLeadConduitFlowBinding("roofing-virtual-quote", environment)).toMatchObject({
    slug: "roofing-virtual-quote",
    flowId: "virtual-quote-flow",
    flowName: "Roofing Virtual Quote",
    capabilities: {
      shadowImport: false,
      polling: false,
      receipt: false,
      processing: false,
      rescueRecommendations: false,
      rescueActions: false,
    },
  });
  expect(getLeadConduitFlowBinding("unconfigured-flow", environment)).toBeNull();
});

test("deduplicates active and next webhook tokens and ignores an expired next token", () => {
  const environment = parseServerEnv({
    ...base,
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN: "same-token",
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT: "same-token",
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT_EXPIRES_AT: "2030-01-01T00:00:00.000Z",
  });

  expect(getLeadConduitFlowBinding("roofing", environment, new Date("2029-01-01T00:00:00.000Z"))?.tokens).toEqual([
    { value: "same-token", validUntil: null },
  ]);

  const expired = parseServerEnv({
    ...base,
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN: "active-token",
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT: "next-token",
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT_EXPIRES_AT: "2029-01-01T00:00:00.000Z",
  });

  expect(getLeadConduitFlowBinding("roofing", expired, new Date("2030-01-01T00:00:00.000Z"))?.tokens).toEqual([
    { value: "active-token", validUntil: null },
  ]);
});

test("requires an ISO expiry for a next webhook token", () => {
  expect(() => parseServerEnv({
    ...base,
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT: "next-token",
  })).toThrow("LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT_EXPIRES_AT is required");
});

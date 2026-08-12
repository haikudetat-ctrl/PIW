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
};
const COMPANY_ID = "00000000-0000-4000-8000-000000000001";

test("binds Roofing receipt to its server company, flow, and active token", () => {
  const binding = getLeadConduitFlowBinding("roofing", parseServerEnv({
    ...base,
    ACCESS_ROUTE_COMPANY_ID: COMPANY_ID,
    LEADCONDUIT_ROOFING_FLOW_ID: "6377949a81800d03d54119b5",
    INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED: "true",
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN: "roofing-token",
  }));

  expect(binding).toEqual({
    slug: "roofing",
    companyId: COMPANY_ID,
    flowId: "6377949a81800d03d54119b5",
    flowName: "Roofing",
    receiptEnabled: true,
    tokens: [{ value: "roofing-token", validUntil: null }],
  });
});

test("keeps Virtual Quote disabled independently", () => {
  const environment = parseServerEnv({ ...base });
  expect(getLeadConduitFlowBinding("roofing-virtual-quote", environment)).toBeNull();
});

test("deduplicates active and next webhook tokens and ignores an expired next token", () => {
  const environment = parseServerEnv({
    ...base,
    ACCESS_ROUTE_COMPANY_ID: COMPANY_ID,
    LEADCONDUIT_ROOFING_FLOW_ID: "6377949a81800d03d54119b5",
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN: "same-token",
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT: "same-token",
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT_EXPIRES_AT: "2030-01-01T00:00:00.000Z",
  });

  expect(getLeadConduitFlowBinding("roofing", environment, new Date("2029-01-01T00:00:00.000Z"))?.tokens).toEqual([
    { value: "same-token", validUntil: null },
  ]);

  const expired = parseServerEnv({
    ...base,
    ACCESS_ROUTE_COMPANY_ID: COMPANY_ID,
    LEADCONDUIT_ROOFING_FLOW_ID: "6377949a81800d03d54119b5",
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
    ACCESS_ROUTE_COMPANY_ID: COMPANY_ID,
    LEADCONDUIT_ROOFING_FLOW_ID: "roofing-flow",
    LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT: "next-token",
  })).toThrow("LEADCONDUIT_ROOFING_WEBHOOK_TOKEN_NEXT_EXPIRES_AT is required");
});

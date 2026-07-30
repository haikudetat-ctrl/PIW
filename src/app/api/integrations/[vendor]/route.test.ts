import { expect, test } from "vitest";
import {
  handleIntegrationWebhookRequest,
  type IntegrationWebhookDependencies,
} from "./route";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const SHARED_SECRET = "test-shared-secret";

function makeDeps(overrides: Partial<IntegrationWebhookDependencies> = {}) {
  const recorded: Array<{ idempotencyKey: string }> = [];
  const enqueued: Array<{ integrationEventId: string }> = [];
  const seenKeys = new Set<string>();

  const deps: IntegrationWebhookDependencies = {
    isVendorEnabled: () => true,
    expectedSharedSecret: SHARED_SECRET,
    getCompanyId: async () => COMPANY_ID,
    recordEvent: async (input) => {
      recorded.push({ idempotencyKey: input.idempotencyKey });
      const isDuplicate = seenKeys.has(input.idempotencyKey);
      seenKeys.add(input.idempotencyKey);
      return { eventId: `event-for-${input.idempotencyKey}`, isDuplicate };
    },
    enqueueIntegrationEventReceived: async (input) => {
      enqueued.push({ integrationEventId: input.integrationEventId });
    },
    ...overrides,
  };

  return { deps, recorded, enqueued };
}

test("rejects an unknown vendor", async () => {
  const { deps } = makeDeps();

  const result = await handleIntegrationWebhookRequest(
    { vendor: "not-a-real-vendor", sharedSecret: SHARED_SECRET, rawBody: {}, vendorEventId: null },
    deps,
  );

  expect(result.status).toBe(400);
});

test("rejects a disabled vendor without touching config", async () => {
  const { deps } = makeDeps({ isVendorEnabled: () => false });

  const result = await handleIntegrationWebhookRequest(
    { vendor: "leadconduit", sharedSecret: SHARED_SECRET, rawBody: {}, vendorEventId: null },
    deps,
  );

  expect(result.status).toBe(503);
});

test("rejects a missing or incorrect shared secret", async () => {
  const { deps } = makeDeps();

  const result = await handleIntegrationWebhookRequest(
    { vendor: "leadconduit", sharedSecret: "wrong-secret", rawBody: {}, vendorEventId: null },
    deps,
  );

  expect(result.status).toBe(401);
});

test("records and enqueues a valid webhook", async () => {
  const { deps, recorded, enqueued } = makeDeps();

  const result = await handleIntegrationWebhookRequest(
    {
      vendor: "leadconduit",
      sharedSecret: SHARED_SECRET,
      rawBody: { event_type: "lead.created", event_id: "lc-1" },
      vendorEventId: null,
    },
    deps,
  );

  expect(result.status).toBe(200);
  expect(recorded).toHaveLength(1);
  expect(enqueued).toHaveLength(1);
});

test("a redelivered event is recorded but not re-enqueued", async () => {
  const { deps, recorded, enqueued } = makeDeps();
  const input = {
    vendor: "leadconduit",
    sharedSecret: SHARED_SECRET,
    rawBody: { event_type: "lead.created", event_id: "lc-1" },
    vendorEventId: null,
  };

  const first = await handleIntegrationWebhookRequest(input, deps);
  const second = await handleIntegrationWebhookRequest(input, deps);

  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(recorded).toHaveLength(2);
  expect(enqueued).toHaveLength(1);
});

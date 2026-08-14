import { expect, test } from "vitest";
import { handleIntegrationWebhookRequest, POST } from "./route";

test("rejects an unknown vendor", () => {
  expect(handleIntegrationWebhookRequest("not-a-real-vendor")).toEqual({
    status: 400,
    body: { error: "Unknown integration vendor" },
  });
});

test("keeps LeadConduit on its tenant-bound flow-specific receiver", () => {
  expect(handleIntegrationWebhookRequest("leadconduit")).toEqual({
    status: 400,
    body: { error: "Unsupported integration vendor" },
  });
});

test.each(["leadmaster", "jobnimbus", "calltools"])(
  "hard-disables the generic %s webhook independently of scheduled read flags",
  (vendor) => {
    expect(handleIntegrationWebhookRequest(vendor)).toEqual({
      status: 503,
      body: { error: "Integration disabled" },
    });
  },
);

test("returns disabled before reading a generic webhook body", async () => {
  const request = {
    json: () => {
      throw new Error("request body must not be read");
    },
  } as unknown as Request;

  const response = await POST(request, {
    params: Promise.resolve({ vendor: "jobnimbus" }),
  });

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({ error: "Integration disabled" });
});

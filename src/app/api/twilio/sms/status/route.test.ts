// @vitest-environment node
import {afterEach, beforeEach, expect, test, vi} from "vitest";
import {NextRequest} from "next/server";

vi.mock("server-only", () => ({}));
const store = vi.hoisted(() => ({
  findBySid: vi.fn(async () => ({id: "message-one", status: "sent" as const})),
  updateStatus: vi.fn(async () => undefined),
}));
vi.mock("@/lib/supabase/service", () => ({createServiceClient: vi.fn(() => ({}))}));
vi.mock("@/modules/sms/supabase-store", async (original) => ({
  ...(await original<typeof import("@/modules/sms/supabase-store")>()),
  createSmsWebhookStore: vi.fn(() => store),
}));
const {POST} = await import("./route");
const {twilioSignature} = await import("@/modules/sms/twilio");
const {createSmsWebhookStore} = await import("@/modules/sms/supabase-store");
const URL = "https://piw.example/api/twilio/sms/status";
const ACCOUNT = `AC${"3".repeat(32)}`;
const PARAMS = {AccountSid: ACCOUNT, MessageSid: `SM${"b".repeat(32)}`, MessageStatus: "delivered"};

function request(token: string, params = PARAMS) {
  return new NextRequest(URL, {method: "POST", body: new URLSearchParams(params), headers: {"x-twilio-signature": twilioSignature(token, URL, params)}});
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SMS_ENABLED", "false");
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "parent-token");
  vi.stubEnv("TWILIO_SMS_CLIENTS_JSON", JSON.stringify([{
    companyId: "22222222-2222-4222-8222-222222222222", accountSid: ACCOUNT,
    apiKeySid: `SK${"4".repeat(32)}`, apiKeySecret: "key-secret", authToken: "client-two-token",
  }]));
});
afterEach(() => vi.unstubAllEnvs());

test("accepts delayed statuses with the subaccount token when outbound is off", async () => {
  expect((await POST(request("client-two-token"))).status).toBe(204);
  expect(createSmsWebhookStore).toHaveBeenCalledWith({}, "22222222-2222-4222-8222-222222222222");
  expect(store.updateStatus).toHaveBeenCalledWith("message-one", "delivered", null);
});

test("rejects wrong tokens and spoofed account IDs before database access", async () => {
  expect((await POST(request("parent-token"))).status).toBe(403);
  expect((await POST(request("client-one-token"))).status).toBe(403);
  expect((await POST(request("client-two-token", {...PARAMS, AccountSid: `AC${"9".repeat(32)}`}))).status).toBe(403);
  expect(createSmsWebhookStore).not.toHaveBeenCalled();
  expect(store.updateStatus).not.toHaveBeenCalled();
});

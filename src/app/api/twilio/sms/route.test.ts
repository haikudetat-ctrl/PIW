// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
const store = vi.hoisted(() => ({
  findCompanyByNumber: vi.fn(async () => "company-1"),
  findLeadByPhone: vi.fn(async () => "lead-1"),
  insertInbound: vi.fn(async () => undefined),
  suppress: vi.fn(async () => undefined),
  unsuppress: vi.fn(async () => undefined),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn(() => ({})) }));
vi.mock("@/modules/sms/supabase-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/sms/supabase-store")>()),
  createSmsWebhookStore: vi.fn(() => store),
}));

const { POST } = await import("./route");
const { twilioSignature } = await import("@/modules/sms/twilio");
const {createSmsWebhookStore} = await import("@/modules/sms/supabase-store");

const URL = "https://piw.example/api/twilio/sms";
const ACCOUNT = `AC${"1".repeat(32)}`;
const PARAMS = { AccountSid: ACCOUNT, From: "+16095550101", To: "+16095550199", Body: "STOP", MessageSid: `SM${"a".repeat(32)}` };

function request(signature: string | null, params = PARAMS) {
  return new NextRequest(URL, {
    method: "POST",
    body: new URLSearchParams(params),
    headers: signature ? { "x-twilio-signature": signature } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SMS_ENABLED", "true");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "parent-token-must-not-work");
  vi.stubEnv("TWILIO_SMS_CLIENTS_JSON", JSON.stringify([{
    companyId: "11111111-1111-4111-8111-111111111111", accountSid: ACCOUNT,
    apiKeySid: `SK${"2".repeat(32)}`, apiKeySecret: "secret", authToken: "test-auth-token",
  }]));
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

test("records a signed inbound text and answers with empty TwiML", async () => {
  const response = await POST(request(twilioSignature("test-auth-token", URL, PARAMS)));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/xml");
  expect(await response.text()).toContain("<Response></Response>");
  expect(store.insertInbound).toHaveBeenCalled();
  expect(store.suppress).toHaveBeenCalledWith("company-1", "+16095550101");
  expect(createSmsWebhookStore).toHaveBeenCalledWith({}, "11111111-1111-4111-8111-111111111111");
});

test("rejects unsigned or wrongly signed requests", async () => {
  store.insertInbound.mockClear();
  expect((await POST(request(null))).status).toBe(403);
  expect((await POST(request(twilioSignature("wrong-token", URL, PARAMS)))).status).toBe(403);
  expect(store.insertInbound).not.toHaveBeenCalled();
});

test("still records opt-outs while outbound texting is switched off", async () => {
  vi.stubEnv("SMS_ENABLED", "false");
  expect((await POST(request(twilioSignature("test-auth-token", URL, PARAMS)))).status).toBe(200);
  expect(store.suppress).toHaveBeenCalled();
});

test("rejects a parent token and an unknown subaccount before database access", async () => {
  expect((await POST(request(twilioSignature("parent-token-must-not-work", URL, PARAMS)))).status).toBe(403);
  const params = {...PARAMS, AccountSid: `AC${"9".repeat(32)}`};
  expect((await POST(request(twilioSignature("test-auth-token", URL, params), params))).status).toBe(403);
  expect(createSmsWebhookStore).not.toHaveBeenCalled();
});

test("rejects an absent registry without using global credentials", async () => {
  vi.stubEnv("TWILIO_SMS_CLIENTS_JSON", "");
  expect((await POST(request(twilioSignature("parent-token-must-not-work", URL, PARAMS)))).status).toBe(403);
  expect(createSmsWebhookStore).not.toHaveBeenCalled();
});

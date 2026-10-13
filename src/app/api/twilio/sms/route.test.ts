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

const URL = "https://piw.example/api/twilio/sms";
const PARAMS = { From: "+16095550101", To: "+16095550199", Body: "STOP", MessageSid: `SM${"a".repeat(32)}` };

function request(signature: string | null) {
  return new NextRequest(URL, {
    method: "POST",
    body: new URLSearchParams(PARAMS),
    headers: signature ? { "x-twilio-signature": signature } : {},
  });
}

beforeEach(() => {
  vi.stubEnv("SMS_ENABLED", "true");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "test-auth-token");
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
});

test("rejects unsigned or wrongly signed requests", async () => {
  store.insertInbound.mockClear();
  expect((await POST(request(null))).status).toBe(403);
  expect((await POST(request(twilioSignature("wrong-token", URL, PARAMS)))).status).toBe(403);
  expect(store.insertInbound).not.toHaveBeenCalled();
});

test("does nothing while texting is switched off", async () => {
  vi.stubEnv("SMS_ENABLED", "false");
  expect((await POST(request(twilioSignature("test-auth-token", URL, PARAMS)))).status).toBe(404);
});

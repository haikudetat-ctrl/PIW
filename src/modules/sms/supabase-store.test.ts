// @vitest-environment node
import { expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { phoneVariants, smsWebhookUrls } = await import("./supabase-store");

test("matches the ways a US number is typed into a lead", () => {
  expect(phoneVariants("+18565550142")).toEqual([
    "+18565550142",
    "8565550142",
    "18565550142",
    "(856) 555-0142",
    "856-555-0142",
    "856.555.0142",
  ]);
  expect(phoneVariants("+442071234567")).toEqual(["+442071234567"]);
});

test("checks signatures against the request URL and the production URL", () => {
  expect(smsWebhookUrls("https://piw-abc.vercel.app/api/twilio/sms", "/api/twilio/sms", "app.rake.example")).toEqual([
    "https://piw-abc.vercel.app/api/twilio/sms",
    "https://app.rake.example/api/twilio/sms",
  ]);
  expect(smsWebhookUrls("https://x/api/twilio/sms", "/api/twilio/sms", undefined)).toEqual(["https://x/api/twilio/sms"]);
});

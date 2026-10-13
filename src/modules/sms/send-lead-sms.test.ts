import { expect, test, vi } from "vitest";
import { leadSmsBlock, sendLeadSms, type SendLeadSmsDeps, type SmsContext } from "./send-lead-sms";

// Noon in New York.
const NOON = new Date("2026-10-13T16:00:00Z");
const MESSAGING_SERVICE = `MG${"3".repeat(32)}`;

function context(overrides: Partial<SmsContext> = {}): SmsContext {
  return {
    companyId: "company-1",
    leadId: "lead-1",
    phone: "(609) 555-0101",
    smsConsent: true,
    suppressed: false,
    settings: { enabled: true, messagingServiceSid: MESSAGING_SERVICE, fromE164: "+16095550199", quietStartHour: 21, quietEndHour: 8 },
    ...overrides,
  };
}

function deps(overrides: Partial<SendLeadSmsDeps> = {}) {
  return {
    now: NOON,
    smsEnabled: true,
    userId: "user-1",
    statusCallback: "https://app.example/api/twilio/sms/status",
    insertMessage: vi.fn(async () => ({ id: "message-1" })),
    updateMessage: vi.fn(async () => undefined),
    send: vi.fn(async () => ({ sid: `SM${"b".repeat(32)}`, status: "accepted" })),
    ...overrides,
  };
}

test("sends a text, logging it first and recording Twilio's message id", async () => {
  const d = deps();
  const result = await sendLeadSms(context(), "  Hi Maria, see you Thursday.  ", d);

  expect(result).toEqual({ ok: true, messageId: "message-1" });
  expect(d.insertMessage).toHaveBeenCalledWith({
    company_id: "company-1",
    lead_id: "lead-1",
    direction: "outbound",
    body: "Hi Maria, see you Thursday.",
    from_e164: "+16095550199",
    to_e164: "+16095550101",
    status: "sending",
    segments: 1,
    sent_by: "user-1",
  });
  expect(d.send).toHaveBeenCalledWith({
    messagingServiceSid: MESSAGING_SERVICE,
    to: "+16095550101",
    body: "Hi Maria, see you Thursday.",
    statusCallback: "https://app.example/api/twilio/sms/status",
  });
  expect(d.updateMessage).toHaveBeenCalledWith("message-1", { status: "queued", provider_sid: `SM${"b".repeat(32)}` });
});

test.each([
  ["disabled", context({ settings: null }), {}],
  ["disabled", context(), { smsEnabled: false }],
  ["no_phone", context({ phone: "555-0101" }), {}],
  ["no_consent", context({ smsConsent: false }), {}],
  ["suppressed", context({ suppressed: true }), {}],
  ["quiet_hours", context(), { now: new Date("2026-10-14T02:00:00Z") }],
] as const)("blocks %s before writing or sending anything", async (reason, ctx, extra) => {
  const d = deps(extra);
  const result = await sendLeadSms(ctx, "Hi Maria", d);
  expect(result).toMatchObject({ ok: false, reason });
  expect(d.insertMessage).not.toHaveBeenCalled();
  expect(d.send).not.toHaveBeenCalled();
});

test("refuses empty, oversized or half-filled messages", async () => {
  await expect(sendLeadSms(context(), "   ", deps())).resolves.toMatchObject({ reason: "empty" });
  await expect(sendLeadSms(context(), "a".repeat(153 * 6 + 1), deps())).resolves.toMatchObject({ reason: "too_long" });
  await expect(sendLeadSms(context(), "Hi {first_name}", deps())).resolves.toMatchObject({ reason: "unfilled" });
  await expect(sendLeadSms(null, "Hi", deps())).resolves.toMatchObject({ reason: "not_found" });
});

test("marks the text failed with Twilio's code when the send fails", async () => {
  const error = Object.assign(new Error("Attempt to send to unsubscribed recipient"), { code: "21610" });
  const d = deps({ send: vi.fn(async () => Promise.reject(error)) });
  const result = await sendLeadSms(context(), "Hi Maria", d);
  expect(result).toMatchObject({ ok: false, reason: "provider" });
  expect(d.updateMessage).toHaveBeenCalledWith("message-1", { status: "failed", error_code: "21610" });
});

test("explains why a lead can't be texted right now", () => {
  expect(leadSmsBlock(context(), true, NOON)).toBeNull();
  expect(leadSmsBlock(context({ smsConsent: false }), true, NOON)?.message).toBe("This lead hasn't agreed to texts.");
});

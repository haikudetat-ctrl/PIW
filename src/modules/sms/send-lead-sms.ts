import { MAX_SEGMENTS, countSegments, isQuietHours, mapTwilioStatus, toUsE164, unfilledFields } from "./rules";

export type SendBlockReason =
  | "not_found"
  | "disabled"
  | "no_phone"
  | "no_consent"
  | "suppressed"
  | "quiet_hours"
  | "empty"
  | "too_long"
  | "unfilled"
  | "provider";

export type SendResult = { ok: true; messageId: string } | { ok: false; reason: SendBlockReason; message: string };

export type SmsContext = {
  companyId: string;
  leadId: string;
  phone: string | null;
  smsConsent: boolean;
  suppressed: boolean;
  settings: {
    enabled: boolean;
    messagingServiceSid: string;
    fromE164: string;
    quietStartHour: number;
    quietEndHour: number;
  } | null;
};

export type SendLeadSmsDeps = {
  now: Date;
  smsEnabled: boolean;
  userId: string;
  statusCallback: string | null;
  insertMessage(row: {
    company_id: string;
    lead_id: string;
    direction: "outbound";
    body: string;
    from_e164: string;
    to_e164: string;
    status: "sending";
    segments: number;
    sent_by: string;
  }): Promise<{ id: string }>;
  updateMessage(id: string, patch: { status: string; provider_sid?: string; error_code?: string | null }): Promise<void>;
  send(input: { messagingServiceSid: string; to: string; body: string; statusCallback: string | null }): Promise<{ sid: string; status: string }>;
};

const BLOCK_MESSAGE: Record<Exclude<SendBlockReason, "provider">, string> = {
  not_found: "Lead not found.",
  disabled: "Texting isn't set up for this company yet.",
  no_phone: "This lead has no textable US mobile number.",
  no_consent: "This lead hasn't agreed to texts.",
  suppressed: "This number replied STOP and can't be texted.",
  quiet_hours: "It's quiet hours — texts can go out between 8am and 9pm.",
  empty: "Write a message first.",
  too_long: `Keep it under ${MAX_SEGMENTS} text segments.`,
  unfilled: "Fill in the template fields in braces first.",
};

function blocked(reason: Exclude<SendBlockReason, "provider">): SendResult {
  return { ok: false, reason, message: BLOCK_MESSAGE[reason] };
}

// Whether this lead can be texted right now, regardless of what is written.
export function leadSmsBlock(
  context: SmsContext | null,
  smsEnabled: boolean,
  now: Date,
): { reason: Exclude<SendBlockReason, "provider">; message: string } | null {
  if (!context) return { reason: "not_found", message: BLOCK_MESSAGE.not_found };
  const settings = context.settings;
  if (!smsEnabled || !settings?.enabled) return { reason: "disabled", message: BLOCK_MESSAGE.disabled };
  if (!toUsE164(context.phone)) return { reason: "no_phone", message: BLOCK_MESSAGE.no_phone };
  if (!context.smsConsent) return { reason: "no_consent", message: BLOCK_MESSAGE.no_consent };
  if (context.suppressed) return { reason: "suppressed", message: BLOCK_MESSAGE.suppressed };
  if (isQuietHours(now, settings.quietStartHour, settings.quietEndHour)) {
    return { reason: "quiet_hours", message: BLOCK_MESSAGE.quiet_hours };
  }
  return null;
}

// Every guard runs before anything is written or sent.
export async function sendLeadSms(context: SmsContext | null, rawBody: string, deps: SendLeadSmsDeps): Promise<SendResult> {
  if (!context) return blocked("not_found");
  const body = rawBody.trim();
  if (!body) return blocked("empty");
  if (unfilledFields(body).length > 0) return blocked("unfilled");
  const segments = countSegments(body).segments;
  if (segments > MAX_SEGMENTS) return blocked("too_long");
  const block = leadSmsBlock(context, deps.smsEnabled, deps.now);
  if (block) return blocked(block.reason);
  const settings = context.settings!;
  const to = toUsE164(context.phone)!;

  const { id } = await deps.insertMessage({
    company_id: context.companyId,
    lead_id: context.leadId,
    direction: "outbound",
    body,
    from_e164: settings.fromE164,
    to_e164: to,
    status: "sending",
    segments,
    sent_by: deps.userId,
  });
  try {
    const result = await deps.send({
      messagingServiceSid: settings.messagingServiceSid,
      to,
      body,
      statusCallback: deps.statusCallback,
    });
    await deps.updateMessage(id, { status: mapTwilioStatus(result.status) ?? "queued", provider_sid: result.sid });
    return { ok: true, messageId: id };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code ?? "") : "";
    await deps.updateMessage(id, { status: "failed", error_code: code || null });
    return {
      ok: false,
      reason: "provider",
      message: error instanceof Error ? `Twilio didn't send it: ${error.message}` : "Twilio didn't send it.",
    };
  }
}

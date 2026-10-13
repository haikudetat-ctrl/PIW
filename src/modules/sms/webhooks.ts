import { mapTwilioStatus, optKeyword, shouldApplyStatus, type SmsStatus } from "./rules";

const E164 = /^\+[1-9][0-9]{7,14}$/;
const MESSAGE_SID = /^(SM|MM)[0-9a-fA-F]{32}$/;

export type InboundDeps = {
  findCompanyByNumber(toE164: string): Promise<string | null>;
  findLeadByPhone(companyId: string, fromE164: string): Promise<string | null>;
  // Ignores a duplicate delivery of the same MessageSid.
  insertInbound(row: {
    company_id: string;
    lead_id: string | null;
    direction: "inbound";
    body: string;
    from_e164: string;
    to_e164: string;
    status: "received";
    provider_sid: string;
  }): Promise<void>;
  suppress(companyId: string, phoneE164: string): Promise<void>;
  unsuppress(companyId: string, phoneE164: string): Promise<void>;
};

export type InboundOutcome = "recorded" | "ignored";

// Twilio's Advanced Opt-Out sends the STOP/START replies itself; Rake records
// the opt-out so nobody can text the number from Rake afterwards.
export async function handleInboundSms(params: Record<string, string>, deps: InboundDeps): Promise<InboundOutcome> {
  const from = params.From ?? "";
  const to = params.To ?? "";
  const sid = params.MessageSid ?? params.SmsSid ?? "";
  const body = (params.Body ?? "").slice(0, 1600);
  if (!E164.test(from) || !E164.test(to) || !MESSAGE_SID.test(sid)) return "ignored";

  const companyId = await deps.findCompanyByNumber(to);
  if (!companyId) return "ignored";
  const leadId = await deps.findLeadByPhone(companyId, from);
  await deps.insertInbound({
    company_id: companyId,
    lead_id: leadId,
    direction: "inbound",
    body: body.trim() ? body : "(empty message)",
    from_e164: from,
    to_e164: to,
    status: "received",
    provider_sid: sid,
  });

  const keyword = optKeyword(body);
  if (keyword === "stop") await deps.suppress(companyId, from);
  if (keyword === "start") await deps.unsuppress(companyId, from);
  return "recorded";
}

export type StatusDeps = {
  findBySid(sid: string): Promise<{ id: string; status: SmsStatus } | null>;
  updateStatus(id: string, status: SmsStatus, errorCode: string | null): Promise<void>;
};

export async function handleStatusCallback(params: Record<string, string>, deps: StatusDeps): Promise<"updated" | "ignored"> {
  const sid = params.MessageSid ?? "";
  const next = mapTwilioStatus(params.MessageStatus ?? "");
  if (!MESSAGE_SID.test(sid) || !next) return "ignored";
  const message = await deps.findBySid(sid);
  if (!message || !shouldApplyStatus(message.status, next)) return "ignored";
  await deps.updateStatus(message.id, next, params.ErrorCode?.trim() || null);
  return "updated";
}

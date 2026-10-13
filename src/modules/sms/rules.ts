// Texting rules that do not need the network: message length, quiet hours,
// opt-out keywords, Twilio statuses and templates.

const COMPANY_TIME_ZONE = "America/New_York";

// GSM-7 basic set plus the extension table (which costs two characters).
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€\f";

export type SegmentInfo = { encoding: "GSM-7" | "UCS-2"; length: number; segments: number; perSegment: number };

export function countSegments(body: string): SegmentInfo {
  const characters = [...body];
  const gsm = characters.every((char) => GSM_BASIC.includes(char) || GSM_EXTENDED.includes(char));
  if (gsm) {
    const length = characters.reduce((sum, char) => sum + (GSM_EXTENDED.includes(char) ? 2 : 1), 0);
    const perSegment = length <= 160 ? 160 : 153;
    return { encoding: "GSM-7", length, segments: Math.max(1, Math.ceil(length / perSegment)), perSegment };
  }
  // UCS-2 counts UTF-16 code units, so an emoji takes two.
  const length = body.length;
  const perSegment = length <= 70 ? 70 : 67;
  return { encoding: "UCS-2", length, segments: Math.max(1, Math.ceil(length / perSegment)), perSegment };
}

export const MAX_SEGMENTS = 6;

function localHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: COMPANY_TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(now),
  );
}

// Quiet hours wrap past midnight (e.g. 21 → 8).
export function isQuietHours(now: Date, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  const hour = localHour(now);
  return startHour > endHour ? hour >= startHour || hour < endHour : hour >= startHour && hour < endHour;
}

// The carrier-standard keywords Twilio's Advanced Opt-Out also honours.
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"]);
const START_WORDS = new Set(["START", "UNSTOP", "YES", "OPTIN"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);

export function optKeyword(body: string): "stop" | "start" | "help" | null {
  const word = body.trim().replace(/[.!]+$/, "").toUpperCase();
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  if (HELP_WORDS.has(word)) return "help";
  return null;
}

export type SmsStatus = "sending" | "queued" | "sent" | "delivered" | "undelivered" | "failed" | "received";

export function mapTwilioStatus(status: string): SmsStatus | null {
  switch (status) {
    case "accepted":
    case "scheduled":
    case "queued":
      return "queued";
    case "sending":
    case "sent":
    case "delivered":
    case "undelivered":
    case "failed":
      return status;
    case "read":
      return "delivered";
    case "canceled":
      return "failed";
    default:
      return null;
  }
}

// A later status never moves a message backwards (callbacks can arrive out of
// order); a failure always wins.
const STATUS_RANK: Record<SmsStatus, number> = {
  sending: 0,
  queued: 1,
  sent: 2,
  delivered: 3,
  undelivered: 4,
  failed: 4,
  received: 0,
};

export function shouldApplyStatus(current: SmsStatus, next: SmsStatus): boolean {
  return STATUS_RANK[next] > STATUS_RANK[current];
}

export type SmsTemplate = { key: string; label: string; stage: string; body: string };

export const SMS_TEMPLATES: SmsTemplate[] = [
  {
    key: "first_touch",
    label: "First touch",
    stage: "New",
    body: "Hi {first_name}, it's {rep_name} from {company_name}. Got your roof request — when's a good time for a quick call?",
  },
  {
    key: "missed_call",
    label: "Missed call — text back",
    stage: "Any",
    body: "Hi {first_name}, sorry I missed you. This is {rep_name} from {company_name} — text back a good time and I'll call you.",
  },
  {
    key: "inspection_confirm",
    label: "Inspection confirmation",
    stage: "Appointment set",
    body: "Hi {first_name}, confirming your free roof inspection. Reply here if anything changes. — {rep_name}, {company_name}",
  },
  {
    key: "estimate_follow_up",
    label: "Estimate follow-up",
    stage: "Estimating",
    body: "Hi {first_name}, any questions on your roof estimate? Happy to walk through options. — {rep_name}",
  },
  {
    key: "proposal_nudge",
    label: "Proposal nudge",
    stage: "Proposal sent",
    body: "Hi {first_name}, just checking you got the proposal from {company_name}. Want to go over it together?",
  },
];

export function fillTemplate(body: string, fields: Record<string, string | null | undefined>): string {
  return body.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = fields[key]?.trim();
    return value ? value : match;
  });
}

export function unfilledFields(body: string): string[] {
  return [...new Set([...body.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))];
}

// US numbers only: 10 digits, or 11 starting with 1.
export function toUsE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  if (/^\+1[2-9][0-9]{9}$/.test(phone)) return phone;
  const digits = phone.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^[2-9][0-9]{9}$/.test(national) ? `+1${national}` : null;
}

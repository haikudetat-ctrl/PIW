import {z} from "zod";

export const metaLeadSources = ["Meta70", "Meta30"] as const;
export type MetaLeadSource = (typeof metaLeadSources)[number];
export const webLeadSources = ["Web Solar", "Web Roofing"] as const;
export type WebLeadSource = (typeof webLeadSources)[number];
export type LeadDistributionSource = MetaLeadSource | WebLeadSource;

export type MetaDistributionLead = {
  id: string;
  name: string;
  phone: string;
  email: string;
  submittedAddress: string;
  sourceSystem: string;
  sourceSubmittedAt: string;
  clientIpAddress: string | null;
  clientUserAgent: string | null;
  trustedFormUrl: string | null;
};

export type LeadConduitDisposition =
  | "sent"
  | "rejected"
  | "retryable_failed"
  | "permanent_failed";

export type LeadConduitResult = {
  status: LeadConduitDisposition;
  externalId: string | null;
  reason: string | null;
};

const responseSchema = z.object({
  outcome: z.enum(["success", "failure"]),
  reason: z.string().optional(),
  lead: z.object({id: z.string().length(24)}),
}).passthrough();

export function mapMetaLeadSource(
  utmSource: string | null | undefined,
  campaign: string | null | undefined,
): MetaLeadSource | null {
  const source = utmSource?.trim().toLowerCase();
  if (!source || !["meta", "facebook", "instagram"].includes(source)) return null;

  switch (campaign?.trim()) {
    case "AS | Campaign 1":
    case "Meta70":
      return "Meta70";
    case "AS | Campaign 2":
    case "Meta30":
      return "Meta30";
    default:
      return null;
  }
}

function splitName(name: string) {
  const [firstName, ...remainder] = name.trim().split(/\s+/);
  return {firstName, lastName: remainder.join(" ")};
}

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE",
  "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD",
  "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR",
]);
const COUNTRY_SUFFIX = /^(?:USA|US|United States(?: of America)?)$/i;
const STATE_AND_ZIP = /^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/;
const TRAILING_STATE_AND_ZIP = /^(.*?)[\s,]+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/;

type SplitAddress = {street: string; city: string; state: string; postalCode: string};

// Addresses arrive as one line: the website joins its street, unit, city, state
// and ZIP fields as "street[, unit], city, ST 12345", and Google returns the same
// shape with ", USA" on the end. LeadConduit wants them back in separate fields.
// Any US state is accepted; the website also offers PA, DE and NY.
export function splitUsAddress(address: string): SplitAddress {
  const trimmed = address.trim();
  const parts = trimmed.split(",").map((part) => part.trim()).filter(Boolean);
  while (parts.length > 0 && COUNTRY_SUFFIX.test(parts[parts.length - 1])) parts.pop();

  const last = parts.length >= 3 ? STATE_AND_ZIP.exec(parts[parts.length - 1]) : null;
  if (last && US_STATE_CODES.has(last[1].toUpperCase())) {
    return {
      street: parts.slice(0, -2).join(", "),
      city: parts[parts.length - 2],
      state: last[1].toUpperCase(),
      postalCode: last[2],
    };
  }

  // No comma before the city: keep the state and ZIP, leave the city to the street line.
  const trailing = TRAILING_STATE_AND_ZIP.exec(parts.join(", "));
  if (trailing && trailing[1].trim() && US_STATE_CODES.has(trailing[2].toUpperCase())) {
    return {
      street: trailing[1].replace(/,\s*$/, "").trim(),
      city: "",
      state: trailing[2].toUpperCase(),
      postalCode: trailing[3],
    };
  }

  // Unrecognized: send it whole rather than guess a state.
  return {street: trimmed, city: "", state: "", postalCode: ""};
}

export function toLeadConduitForm(
  lead: MetaDistributionLead,
  source: LeadDistributionSource,
) {
  const {firstName, lastName} = splitName(lead.name);
  const address = splitUsAddress(lead.submittedAddress);
  const fields: Record<string, string | null> = {
    first_name: firstName,
    last_name: lastName,
    phone_1: lead.phone,
    email: lead.email,
    address_1: address.street,
    city: address.city,
    state: address.state,
    postal_code: address.postalCode,
    trustedform_cert_url: lead.trustedFormUrl,
    lead_id_allss: lead.id,
    source_class_allss: "webform",
    ip_address: lead.clientIpAddress,
    user_agent: lead.clientUserAgent,
    reference: lead.id,
    original_source: source,
    source_timestamp: lead.sourceSubmittedAt,
    campaign_source: source,
    country: "United States",
  };
  return new URLSearchParams(
    Object.entries(fields).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

export function classifyLeadConduitResponse(
  httpStatus: number,
  body: unknown,
): LeadConduitResult {
  if (httpStatus === 429 || httpStatus >= 500) {
    return {status: "retryable_failed", externalId: null, reason: `HTTP ${httpStatus}`};
  }
  const parsed = responseSchema.safeParse(body);
  if (httpStatus === 201 && parsed.success) {
    return {
      status: parsed.data.outcome === "success" ? "sent" : "rejected",
      externalId: parsed.data.lead.id,
      reason: parsed.data.outcome === "failure" ? parsed.data.reason ?? "Lead rejected" : null,
    };
  }
  const message = z.object({message: z.string()}).safeParse(body);
  return {
    status: "permanent_failed",
    externalId: null,
    reason: message.success ? message.data.message : `Unexpected HTTP ${httpStatus}`,
  };
}

export function buildInternalLeadEmail(
  lead: MetaDistributionLead,
  source: MetaLeadSource,
  leadUrl: string,
) {
  return {
    subject: `[${source}] New roofing lead — ${lead.name}`,
    text: [
      `New ${source} roofing lead`,
      "",
      `Name: ${lead.name}`,
      `Phone: ${lead.phone}`,
      `Email: ${lead.email}`,
      `Property: ${lead.submittedAddress}`,
      `Submitted: ${lead.sourceSubmittedAt}`,
      `PIW lead: ${leadUrl}`,
    ].join("\n"),
  };
}

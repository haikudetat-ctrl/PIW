import {z} from "zod";

export const metaLeadSources = ["Meta70", "Meta30"] as const;
export type MetaLeadSource = (typeof metaLeadSources)[number];

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

function splitNewJerseyAddress(address: string) {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const stateIndex = parts.findIndex((part) => /^NJ\s+\d{5}(?:-\d{4})?$/i.test(part));
  const stateMatch = stateIndex >= 0
    ? /^NJ\s+(\d{5}(?:-\d{4})?)$/i.exec(parts[stateIndex])
    : null;
  if (stateIndex >= 2 && stateMatch) {
    return {
      street: parts.slice(0, stateIndex - 1).join(", "),
      city: parts[stateIndex - 1],
      state: "NJ",
      postalCode: stateMatch[1],
    };
  }
  return {street: address.trim(), city: "", state: "NJ", postalCode: ""};
}

export function toLeadConduitForm(
  lead: MetaDistributionLead,
  source: MetaLeadSource,
) {
  const {firstName, lastName} = splitName(lead.name);
  const address = splitNewJerseyAddress(lead.submittedAddress);
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

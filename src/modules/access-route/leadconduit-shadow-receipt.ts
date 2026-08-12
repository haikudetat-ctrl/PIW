import { createHash } from "node:crypto";
import { z } from "zod";
import type { LeadConduitEventRow } from "./contracts";
import type { LeadConduitFlowBinding, LeadConduitFlowSlug } from "./leadconduit-config";
import { normalizeEmail, normalizePhone } from "./normalize";

export const LEADCONDUIT_SHADOW_CHECKPOINT = "after_corelogic" as const;

export type LeadConduitShadowCategory =
  | "apartment_classification"
  | "multiple_property_match"
  | "vacant_property_classification";

export const LEADCONDUIT_SHADOW_EXEMPT_SOURCE_IDS = [
  "66294ffc805cf61e9575ee40",
  "65a84540388af4b003c1b8de",
] as const;

const exemptSourceNames = new Set([
  "RoofingCalculator",
  "Webrunner Media Group",
  "Angies Leads",
  "Angi",
  "Facebook Lead Ads",
  "1MDE",
]);
const exemptSourceIds = new Set<string>(LEADCONDUIT_SHADOW_EXEMPT_SOURCE_IDS);
const multiplePropertyReason = "Incomplete address. Multiple property results returned.";
const categoryOrder: LeadConduitShadowCategory[] = [
  "apartment_classification",
  "multiple_property_match",
  "vacant_property_classification",
];

const optionalLeaf = z.string().trim().nullable().optional();

const leadConduitShadowPayloadSchema = z.object({
  schema_version: z.literal(1),
  lead_id: z.string().trim().min(1),
  flow_id: z.string().trim().min(1),
  checkpoint: z.literal(LEADCONDUIT_SHADOW_CHECKPOINT),
  source: z.object({
    id: optionalLeaf,
    name: optionalLeaf,
  }).strict().refine(
    (source) => Boolean(source.id || source.name),
    { message: "source identity is required" },
  ),
  submitted_at: z.string().datetime({ offset: true }),
  is_test: z.boolean(),
  lead: z.object({
    name: optionalLeaf,
    phone: optionalLeaf,
    email: optionalLeaf,
    submitted_address: optionalLeaf,
    trustedform_url: optionalLeaf,
  }).strict(),
  corelogic: z.object({
    outcome: optionalLeaf,
    reason: optionalLeaf,
    building_comments: optionalLeaf,
    site_land_use: optionalLeaf,
  }).strict(),
}).strict();

export type LeadConduitShadowPayload = z.infer<typeof leadConduitShadowPayloadSchema>;

export function parseLeadConduitShadowPayload(value: unknown):
  | { ok: true; value: LeadConduitShadowPayload }
  | { ok: false; invalidFields: string[] } {
  const result = leadConduitShadowPayloadSchema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };

  const invalidFields = result.error.issues.flatMap((issue) => {
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => [...issue.path, key].join("."));
    }
    return [issue.path.length > 0 ? issue.path.join(".") : "$"];
  });
  return {
    ok: false,
    invalidFields: [...new Set(invalidFields)].sort(),
  };
}

function trimmed(value: string | null | undefined): string | null {
  const result = value?.trim();
  return result || null;
}

function includesIgnoringCase(value: string | null | undefined, expected: string): boolean {
  return trimmed(value)?.toLocaleLowerCase().includes(expected.toLocaleLowerCase()) ?? false;
}

function isExemptSource(payload: LeadConduitShadowPayload): boolean {
  const sourceId = trimmed(payload.source.id);
  const sourceName = trimmed(payload.source.name);
  return (sourceId !== null && (exemptSourceIds.has(sourceId) || exemptSourceNames.has(sourceId)))
    || (sourceName !== null && (exemptSourceIds.has(sourceName) || exemptSourceNames.has(sourceName)));
}

export function classifyLeadConduitShadow(input: {
  flowSlug: LeadConduitFlowSlug;
  payload: LeadConduitShadowPayload;
}): LeadConduitShadowCategory[] {
  const { payload } = input;
  if (isExemptSource(payload) || trimmed(payload.corelogic.outcome)?.toLocaleLowerCase() !== "success") {
    return [];
  }

  const categories: LeadConduitShadowCategory[] = [];
  if (
    includesIgnoringCase(payload.corelogic.building_comments, "APARTMENT")
    || includesIgnoringCase(payload.corelogic.site_land_use, "APARTMENT")
  ) {
    categories.push("apartment_classification");
  }
  if (input.flowSlug === "roofing" && trimmed(payload.corelogic.reason) === multiplePropertyReason) {
    categories.push("multiple_property_match");
  }
  if (input.flowSlug === "roofing" && includesIgnoringCase(payload.corelogic.site_land_use, "VACANT")) {
    categories.push("vacant_property_classification");
  }
  return categories;
}

function orderedCategories(categories: LeadConduitShadowCategory[]): LeadConduitShadowCategory[] {
  return categoryOrder.filter((category) => categories.includes(category));
}

export function toLeadConduitShadowEvent(input: {
  binding: LeadConduitFlowBinding;
  payload: LeadConduitShadowPayload;
  categories: LeadConduitShadowCategory[];
  observedAt: string;
}): LeadConduitEventRow {
  const categories = orderedCategories(input.categories);
  const isCandidate = categories.length > 0;
  const { binding, payload, observedAt } = input;
  const rawPayload = isCandidate
    ? {
      schema_version: 1,
      checkpoint: LEADCONDUIT_SHADOW_CHECKPOINT,
      corelogic: {
        outcome: payload.corelogic.outcome ?? null,
        reason: payload.corelogic.reason ?? null,
        building_comments: payload.corelogic.building_comments ?? null,
        site_land_use: payload.corelogic.site_land_use ?? null,
      },
      candidate_categories: categories,
    }
    : {
      schema_version: 1,
      checkpoint: LEADCONDUIT_SHADOW_CHECKPOINT,
      candidate_categories: [],
    };

  return {
    company_id: binding.companyId,
    event_id: `shadow:${createHash("sha256").update([binding.flowId, payload.lead_id, payload.checkpoint].join("\0")).digest("hex")}`,
    flow_id: binding.flowId,
    source_id: payload.source.id ?? null,
    source_name: payload.source.name ?? null,
    lead_id: payload.lead_id,
    event_type: "shadow_checkpoint",
    occurred_at: payload.submitted_at,
    outcome: isCandidate ? payload.corelogic.outcome ?? null : null,
    external_lead_id: null,
    phone_normalized: isCandidate ? normalizePhone(payload.lead.phone ?? null) : null,
    email_normalized: isCandidate ? normalizeEmail(payload.lead.email ?? null) : null,
    raw_status: isCandidate ? "likely_filter_match" : "observed",
    step_id: null,
    step_name: null,
    rule_id: null,
    rule_name: null,
    rule_scope: null,
    rule_scope_id: null,
    reason_category: categories[0] ?? null,
    lead_name: isCandidate ? payload.lead.name ?? null : null,
    submitted_phone: isCandidate ? payload.lead.phone ?? null : null,
    submitted_email: isCandidate ? payload.lead.email ?? null : null,
    submitted_address: isCandidate ? payload.lead.submitted_address ?? null : null,
    campaign: null,
    consent_reference: null,
    trustedform_url: isCandidate ? payload.lead.trustedform_url ?? null : null,
    attribution: { shadow_categories: categories },
    raw_payload: rawPayload,
    is_test: payload.is_test,
    ingestion_channels: ["webhook"],
    first_observed_at: observedAt,
    webhook_received_at: observedAt,
    poll_observed_at: null,
    processing_status: isCandidate ? "observed" : "not_applicable",
    piw_lead_id: null,
    processing_error_category: null,
    processing_attempts: 0,
    processing_claimed_at: null,
    processing_claimed_by: null,
    processing_next_attempt_at: null,
    ingested_at: observedAt,
  };
}

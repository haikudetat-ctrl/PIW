import { createHash } from "node:crypto";
import { z } from "zod";
import type { LeadConduitEventRow } from "./contracts";
import type { LeadConduitFlowBinding, LeadConduitFlowSlug } from "./leadconduit-config";
import { normalizeEmail, normalizePhone } from "./normalize";

export const LEADCONDUIT_SHADOW_CHECKPOINT = "after_corelogic" as const;

// Recipients placed at three points in each flow. A lead seen at intake but
// not at a later checkpoint was filtered between the two.
//   intake          — immediately after source acceptance, before any filter
//   after_corelogic — the original shadow checkpoint, with CoreLogic outputs
//   delivered       — after the last client destination
export const LEADCONDUIT_CHECKPOINTS = ["intake", LEADCONDUIT_SHADOW_CHECKPOINT, "delivered"] as const;
export type LeadConduitCheckpoint = (typeof LEADCONDUIT_CHECKPOINTS)[number];

const CHECKPOINT_EVENT_TYPES: Record<LeadConduitCheckpoint, string> = {
  intake: "checkpoint_intake",
  after_corelogic: "shadow_checkpoint",
  delivered: "checkpoint_delivered",
};

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
  checkpoint: z.enum(LEADCONDUIT_CHECKPOINTS),
  // PIW's own lead ID when the lead originated in PIW (sent outbound as
  // lead_id_allss / reference). Recorded as attribution only; it is not
  // trusted as a link to a PIW lead until matched.
  piw_lead_id: z.uuid().nullable().optional(),
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
  }).strict().optional(),
}).strict().superRefine((payload, context) => {
  // CoreLogic outputs exist only after the CoreLogic step; a body that claims
  // otherwise is a misconfigured recipient.
  const expectsCorelogic = payload.checkpoint === LEADCONDUIT_SHADOW_CHECKPOINT;
  if (expectsCorelogic !== (payload.corelogic !== undefined)) {
    context.addIssue({ code: "custom", path: ["corelogic"], message: "corelogic does not match checkpoint" });
  }
});

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
  const corelogic = payload.corelogic;
  if (
    payload.checkpoint !== LEADCONDUIT_SHADOW_CHECKPOINT
    || !corelogic
    || isExemptSource(payload)
    || trimmed(corelogic.outcome)?.toLocaleLowerCase() !== "success"
  ) {
    return [];
  }

  const categories: LeadConduitShadowCategory[] = [];
  if (
    includesIgnoringCase(corelogic.building_comments, "APARTMENT")
    || includesIgnoringCase(corelogic.site_land_use, "APARTMENT")
  ) {
    categories.push("apartment_classification");
  }
  if (input.flowSlug === "roofing" && trimmed(corelogic.reason) === multiplePropertyReason) {
    categories.push("multiple_property_match");
  }
  if (input.flowSlug === "roofing" && includesIgnoringCase(corelogic.site_land_use, "VACANT")) {
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
  const { binding, payload, observedAt } = input;
  const eventId = `shadow:${createHash("sha256").update([binding.flowId, payload.lead_id, payload.checkpoint].join("\0")).digest("hex")}`;
  if (payload.checkpoint !== LEADCONDUIT_SHADOW_CHECKPOINT) {
    return toJourneyCheckpointEvent({ binding, payload, observedAt, eventId, checkpoint: payload.checkpoint });
  }

  const categories = orderedCategories(input.categories);
  const isCandidate = categories.length > 0;
  const corelogic = payload.corelogic ?? {};
  const rawPayload = isCandidate
    ? {
      schema_version: 1,
      checkpoint: LEADCONDUIT_SHADOW_CHECKPOINT,
      corelogic: {
        outcome: corelogic.outcome ?? null,
        reason: corelogic.reason ?? null,
        building_comments: corelogic.building_comments ?? null,
        site_land_use: corelogic.site_land_use ?? null,
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
    event_id: eventId,
    flow_id: binding.flowId,
    source_id: payload.source.id ?? null,
    source_name: payload.source.name ?? null,
    lead_id: payload.lead_id,
    event_type: CHECKPOINT_EVENT_TYPES.after_corelogic,
    occurred_at: payload.submitted_at,
    outcome: isCandidate ? corelogic.outcome ?? null : null,
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

// Journey checkpoints. Intake keeps the submitted contact details because a
// lead that stops there is a recovery candidate and nothing else holds them in
// PIW. Delivered keeps only normalized phone and email for matching; the lead
// itself lives in the client's systems. Retention of intake contact details is
// governed by redact_leadconduit_checkpoint_contacts.
function toJourneyCheckpointEvent(input: {
  binding: LeadConduitFlowBinding;
  payload: LeadConduitShadowPayload;
  observedAt: string;
  eventId: string;
  checkpoint: Exclude<LeadConduitCheckpoint, "after_corelogic">;
}): LeadConduitEventRow {
  const { binding, payload, observedAt, checkpoint } = input;
  const keepContact = checkpoint === "intake";
  return {
    company_id: binding.companyId,
    event_id: input.eventId,
    flow_id: binding.flowId,
    source_id: payload.source.id ?? null,
    source_name: payload.source.name ?? null,
    lead_id: payload.lead_id,
    event_type: CHECKPOINT_EVENT_TYPES[checkpoint],
    occurred_at: payload.submitted_at,
    outcome: null,
    external_lead_id: null,
    phone_normalized: normalizePhone(payload.lead.phone ?? null),
    email_normalized: normalizeEmail(payload.lead.email ?? null),
    raw_status: "observed",
    step_id: null,
    step_name: null,
    rule_id: null,
    rule_name: null,
    rule_scope: null,
    rule_scope_id: null,
    reason_category: null,
    lead_name: keepContact ? payload.lead.name ?? null : null,
    submitted_phone: keepContact ? payload.lead.phone ?? null : null,
    submitted_email: keepContact ? payload.lead.email ?? null : null,
    submitted_address: keepContact ? payload.lead.submitted_address ?? null : null,
    campaign: null,
    consent_reference: null,
    trustedform_url: keepContact ? payload.lead.trustedform_url ?? null : null,
    attribution: { checkpoint, piw_reference: payload.piw_lead_id ?? null },
    raw_payload: { schema_version: 1, checkpoint },
    is_test: payload.is_test,
    ingestion_channels: ["webhook"],
    first_observed_at: observedAt,
    webhook_received_at: observedAt,
    poll_observed_at: null,
    processing_status: "not_applicable",
    piw_lead_id: null,
    processing_error_category: null,
    processing_attempts: 0,
    processing_claimed_at: null,
    processing_claimed_by: null,
    processing_next_attempt_at: null,
    ingested_at: observedAt,
  };
}

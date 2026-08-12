import { describe, expect, it } from "vitest";
import type { LeadConduitFlowBinding } from "./leadconduit-config";
import {
  LEADCONDUIT_SHADOW_EXEMPT_SOURCE_IDS,
  classifyLeadConduitShadow,
  parseLeadConduitShadowPayload,
  toLeadConduitShadowEvent,
} from "./leadconduit-shadow-receipt";

const OBSERVED_AT = "2026-08-12T16:00:00.000Z";

const binding: LeadConduitFlowBinding = {
  slug: "roofing",
  companyId: "00000000-0000-4000-8000-000000000002",
  flowId: "trusted-roofing-flow",
  flowName: "Roofing",
  receiptEnabled: false,
  tokens: [],
};

const syntheticPayload = {
  schema_version: 1,
  lead_id: "synthetic-lead-101",
  flow_id: "trusted-roofing-flow",
  checkpoint: "after_corelogic",
  source: { id: "synthetic-source-id", name: "Synthetic Source" },
  submitted_at: "2026-08-12T15:59:00.000Z",
  is_test: true,
  lead: {
    name: "Synthetic Homeowner",
    phone: "(609) 555-0101",
    email: "SYNTHETIC@EXAMPLE.INVALID",
    submitted_address: "101 Synthetic Way, Trenton, NJ",
    trustedform_url: "https://cert.example.invalid/synthetic-101",
  },
  corelogic: {
    outcome: "Success",
    reason: "Synthetic reason",
    building_comments: "Synthetic building",
    site_land_use: "Single Family",
  },
};

function parsed(value: unknown = syntheticPayload) {
  const result = parseLeadConduitShadowPayload(value);
  if (!result.ok) throw new Error(`Fixture should parse: ${result.invalidFields.join(", ")}`);
  return result.value;
}

describe("LeadConduit shadow receipt schema", () => {
  it("requires the exact logical receipt contract", () => {
    for (const payload of [
      { ...syntheticPayload, schema_version: 2 },
      { ...syntheticPayload, checkpoint: "before_corelogic" },
      { ...syntheticPayload, lead_id: "" },
      { ...syntheticPayload, flow_id: "" },
      { ...syntheticPayload, submitted_at: "2026-08-12" },
      (() => { const { is_test: _isTest, ...withoutTest } = syntheticPayload; return withoutTest; })(),
      { ...syntheticPayload, source: { id: " ", name: null } },
    ]) {
      expect(parseLeadConduitShadowPayload(payload).ok).toBe(false);
    }
  });

  it("accepts omitted and null optional leaves, including a skipped CoreLogic outcome", () => {
    const payload = {
      ...syntheticPayload,
      lead: { name: null, phone: undefined, email: undefined, submitted_address: undefined, trustedform_url: undefined },
      corelogic: { outcome: null, reason: undefined, building_comments: undefined, site_land_use: undefined },
    };

    expect(parseLeadConduitShadowPayload(payload)).toEqual({
      ok: true,
      value: {
        ...syntheticPayload,
        lead: { name: null },
        corelogic: { outcome: null },
      },
    });
  });

  it("rejects unknown keys and returns only sorted field paths without submitted values", () => {
    const secret = "must-not-survive";
    const result = parseLeadConduitShadowPayload({
      ...syntheticPayload,
      extra: secret,
      lead: { ...syntheticPayload.lead, secret_note: secret },
      corelogic: { ...syntheticPayload.corelogic, debug: secret },
    });

    expect(result).toEqual({ ok: false, invalidFields: ["corelogic.debug", "extra", "lead.secret_note"] });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

describe("LeadConduit shadow receipt classifier", () => {
  it.each([
    ["Building Comments: APARTMENT HOUSE", "Single Family", ["apartment_classification"]],
    [null, "Garden Apartment", ["apartment_classification"]],
    [null, "Vacant Residential", ["vacant_property_classification"]],
  ] as const)("classifies known Roofing property values", (buildingComments, siteLandUse, expected) => {
    expect(classifyLeadConduitShadow({
      flowSlug: "roofing",
      payload: parsed({
        ...syntheticPayload,
        corelogic: { ...syntheticPayload.corelogic, building_comments: buildingComments, site_land_use: siteLandUse },
      }),
    })).toEqual(expected);
  });

  it("deduplicates apartment and orders all Roofing categories", () => {
    expect(classifyLeadConduitShadow({
      flowSlug: "roofing",
      payload: parsed({
        ...syntheticPayload,
        corelogic: {
          outcome: " success ",
          reason: "Incomplete address. Multiple property results returned.",
          building_comments: "apartment house",
          site_land_use: "VACANT APARTMENT",
        },
      }),
    })).toEqual([
      "apartment_classification",
      "multiple_property_match",
      "vacant_property_classification",
    ]);
  });

  it("exempts only exact trimmed source identities through either source field", () => {
    const exemptNames = ["RoofingCalculator", "Webrunner Media Group", "Angies Leads", "Angi", "Facebook Lead Ads", "1MDE"];
    for (const source of [...exemptNames, ...LEADCONDUIT_SHADOW_EXEMPT_SOURCE_IDS]) {
      for (const sourceKey of ["id", "name"] as const) {
        expect(classifyLeadConduitShadow({
          flowSlug: "roofing",
          payload: parsed({
            ...syntheticPayload,
            source: sourceKey === "id" ? { id: ` ${source} `, name: null } : { id: null, name: ` ${source} ` },
            corelogic: { ...syntheticPayload.corelogic, building_comments: "APARTMENT" },
          }),
        })).toEqual([]);
      }
    }
  });

  it("does not case-fold source exemptions", () => {
    expect(classifyLeadConduitShadow({
      flowSlug: "roofing",
      payload: parsed({
        ...syntheticPayload,
        source: { id: null, name: "angi" },
        corelogic: { ...syntheticPayload.corelogic, building_comments: "APARTMENT" },
      }),
    })).toEqual(["apartment_classification"]);
  });

  it.each([undefined, null, "Failed"] as const)("rejects non-success or absent CoreLogic outcome", (outcome) => {
    expect(classifyLeadConduitShadow({
      flowSlug: "roofing",
      payload: parsed({ ...syntheticPayload, corelogic: { ...syntheticPayload.corelogic, outcome, building_comments: "APARTMENT" } }),
    })).toEqual([]);
  });

  it("limits Virtual Quote to apartments and denies unknown values", () => {
    const virtualQuotePayload = parsed({
      ...syntheticPayload,
      corelogic: {
        outcome: "Success",
        reason: "Incomplete address. Multiple property results returned.",
        building_comments: "Unknown building text",
        site_land_use: "Vacant Residential",
      },
    });
    expect(classifyLeadConduitShadow({ flowSlug: "roofing-virtual-quote", payload: virtualQuotePayload })).toEqual([]);
    expect(classifyLeadConduitShadow({
      flowSlug: "roofing-virtual-quote",
      payload: parsed({ ...virtualQuotePayload, corelogic: { ...virtualQuotePayload.corelogic, building_comments: "APARTMENT" } }),
    })).toEqual(["apartment_classification"]);
  });
});

describe("LeadConduit shadow receipt event mapping", () => {
  it("maps candidates with trusted identity, normalized review data, and an allowlisted snapshot", () => {
    const payload = parsed({
      ...syntheticPayload,
      corelogic: {
        outcome: "Success",
        reason: "Incomplete address. Multiple property results returned.",
        building_comments: "APARTMENT HOUSE",
        site_land_use: "Vacant Residential",
      },
    });
    const row = toLeadConduitShadowEvent({
      binding,
      payload,
      categories: ["apartment_classification", "multiple_property_match", "vacant_property_classification"],
      observedAt: OBSERVED_AT,
    });

    expect(row).toMatchObject({
      company_id: binding.companyId,
      flow_id: binding.flowId,
      source_id: "synthetic-source-id",
      source_name: "Synthetic Source",
      lead_id: "synthetic-lead-101",
      event_type: "shadow_checkpoint",
      occurred_at: "2026-08-12T15:59:00.000Z",
      raw_status: "likely_filter_match",
      reason_category: "apartment_classification",
      lead_name: "Synthetic Homeowner",
      submitted_phone: "(609) 555-0101",
      phone_normalized: "+16095550101",
      submitted_email: "SYNTHETIC@EXAMPLE.INVALID",
      email_normalized: "synthetic@example.invalid",
      submitted_address: "101 Synthetic Way, Trenton, NJ",
      trustedform_url: "https://cert.example.invalid/synthetic-101",
      attribution: { shadow_categories: ["apartment_classification", "multiple_property_match", "vacant_property_classification"] },
      is_test: true,
      ingestion_channels: ["webhook"],
      webhook_received_at: OBSERVED_AT,
      poll_observed_at: null,
      processing_status: "observed",
      piw_lead_id: null,
    });
    expect(row.event_id).toMatch(/^shadow:[a-f0-9]{64}$/);
    expect(row.raw_payload).toEqual({
      schema_version: 1,
      checkpoint: "after_corelogic",
      corelogic: {
        outcome: "Success",
        reason: "Incomplete address. Multiple property results returned.",
        building_comments: "APARTMENT HOUSE",
        site_land_use: "Vacant Residential",
      },
      candidate_categories: ["apartment_classification", "multiple_property_match", "vacant_property_classification"],
    });
    expect(Object.keys(row.raw_payload)).toEqual(["schema_version", "checkpoint", "corelogic", "candidate_categories"]);
  });

  it("removes customer and CoreLogic values from non-candidates", () => {
    const payload = parsed({ ...syntheticPayload, corelogic: { ...syntheticPayload.corelogic, site_land_use: "Single Family" } });
    const row = toLeadConduitShadowEvent({ binding, payload, categories: [], observedAt: OBSERVED_AT });

    expect(row).toMatchObject({
      raw_status: "observed",
      processing_status: "not_applicable",
      reason_category: null,
      lead_name: null,
      submitted_phone: null,
      phone_normalized: null,
      submitted_email: null,
      email_normalized: null,
      submitted_address: null,
      trustedform_url: null,
      attribution: { shadow_categories: [] },
    });
    expect(row.raw_payload).toEqual({ schema_version: 1, checkpoint: "after_corelogic", candidate_categories: [] });
  });
});

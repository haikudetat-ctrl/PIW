import { describe, expect, it } from "vitest";
import {
  normalizeJobNimbusContact,
  normalizeJobNimbusJob,
  normalizeLeadConduitEvent,
  normalizeLeadConduitFlowRule,
  normalizeLeadConduitFlowStep,
  normalizeLeadConduitSourceMetadata,
  normalizeLeadMasterRecord,
  redactSecrets,
} from "./normalize";

const NOW = "2026-08-04T16:00:00.000Z";
const COMPANY = "00000000-0000-4000-8000-000000000001";
const LEADCONDUIT_CONTEXT = {
  companyId: COMPANY,
  flowId: "roofing-flow-exact",
  channel: "poll" as const,
  observedAt: NOW,
};

describe("access route normalization", () => {
  it("normalizes LeadConduit source events while retaining a redacted audit copy", () => {
    const row = normalizeLeadConduitEvent({
      id: "event-1",
      type: "source",
      outcome: "failure",
      flow_id: "roofing-flow-exact",
      start_timestamp: 1_775_299_200_000,
      api_key: "must-not-land",
      step: { id: "step-exact", name: "Synthetic Source Step" },
      rule: {
        id: "rule-exact",
        name: "Synthetic Acceptance Rule",
        scope: "source_acceptance",
        scope_id: "source-1",
      },
      reason: { category: "invalid_phone", detail: "Synthetic customer detail must stay raw" },
      vars: {
        "flow.id": "roofing-flow-exact",
        "source.id": "source-1",
        "source.name": "Meta NJ",
        "lead.id": "lead-1",
        "lead.external_id": "attribution-only-id",
        "lead.first_name": "Synthetic",
        "lead.last_name": "Homeowner",
        "lead.phone_1": "(609) 555-0100",
        "lead.email": " Person@Example.com ",
        "lead.address": "10 Synthetic Way, Trenton, NJ",
        "lead.campaign": "Synthetic Campaign",
        "lead.consent_reference": "consent-synthetic",
        "lead.trustedform_url": "https://cert.example.invalid/synthetic",
      },
    }, LEADCONDUIT_CONTEXT);

    expect(row).toMatchObject({
      company_id: COMPANY,
      event_id: "event-1",
      flow_id: "roofing-flow-exact",
      source_id: "source-1",
      source_name: "Meta NJ",
      lead_id: "lead-1",
      step_id: "step-exact",
      step_name: "Synthetic Source Step",
      rule_id: "rule-exact",
      rule_name: "Synthetic Acceptance Rule",
      rule_scope: "source_acceptance",
      rule_scope_id: "source-1",
      reason_category: "invalid_phone",
      lead_name: "Synthetic Homeowner",
      submitted_phone: "(609) 555-0100",
      submitted_email: "Person@Example.com",
      submitted_address: "10 Synthetic Way, Trenton, NJ",
      campaign: "Synthetic Campaign",
      consent_reference: "consent-synthetic",
      trustedform_url: "https://cert.example.invalid/synthetic",
      external_lead_id: "attribution-only-id",
      attribution: { lead_external_id: "attribution-only-id" },
      phone_normalized: "+16095550100",
      email_normalized: "person@example.com",
      ingestion_channels: ["poll"],
      first_observed_at: NOW,
      webhook_received_at: null,
      poll_observed_at: NOW,
      processing_status: "observed",
      piw_lead_id: null,
    });
    expect(row?.raw_payload.api_key).toBe("[REDACTED]");
  });

  it("rejects payload flow identity that does not match the trusted configured flow", () => {
    expect(normalizeLeadConduitEvent({
      id: "event-untrusted-flow",
      flow_id: "payload-controlled-flow",
      type: "source",
    }, LEADCONDUIT_CONTEXT)).toBeNull();
  });

  it("uses trusted tenant, flow, and source identity for recursively redacted source metadata", () => {
    const row = normalizeLeadConduitSourceMetadata({
      id: "payload-source-must-not-control-identity",
      name: "Synthetic Source",
      fields: [{ name: "phone" }, { id: "email" }, "address"],
      acceptance: {
        rules: [{ id: "acceptance-rule", access_token: "must-not-land" }],
      },
      nested: { credential: "must-not-land", diagnostic: "retained" },
    }, {
      companyId: COMPANY,
      flowId: "roofing-flow-exact",
      sourceId: "source-exact",
      observedAt: NOW,
    });

    expect(row).toEqual({
      company_id: COMPANY,
      flow_id: "roofing-flow-exact",
      source_id: "source-exact",
      source_name: "Synthetic Source",
      field_names: ["address", "email", "phone"],
      acceptance_metadata: {
        rules: [{ id: "acceptance-rule", access_token: "[REDACTED]" }],
      },
      raw_payload: {
        id: "payload-source-must-not-control-identity",
        name: "Synthetic Source",
        fields: [{ name: "phone" }, { id: "email" }, "address"],
        acceptance: {
          rules: [{ id: "acceptance-rule", access_token: "[REDACTED]" }],
        },
        nested: { credential: "[REDACTED]", diagnostic: "retained" },
      },
      observed_at: NOW,
    });
  });

  it("materializes exact flow-step fields without downstream raw-payload parsing", () => {
    expect(normalizeLeadConduitFlowStep({
      id: "step-exact",
      type: "filter",
      name: "Synthetic Eligibility Filter",
      order: 7,
      enabled: true,
      outcome: "continue",
    }, {
      companyId: COMPANY,
      flowId: "roofing-flow-exact",
      observedAt: NOW,
    })).toEqual({
      company_id: COMPANY,
      flow_id: "roofing-flow-exact",
      step_id: "step-exact",
      step_type: "filter",
      step_name: "Synthetic Eligibility Filter",
      step_order: 7,
      enabled: true,
      outcome: "continue",
      observed_at: NOW,
    });
  });

  it("uses trusted rule scope identity and preserves typed policy operands", () => {
    expect(normalizeLeadConduitFlowRule({
      id: "rule-exact",
      name: "Synthetic State Rule",
      lhv: "lead.state",
      op: "is equal to",
      scope: "payload-scope-must-not-win",
      scope_id: "payload-scope-id-must-not-win",
    }, {
      companyId: COMPANY,
      flowId: "roofing-flow-exact",
      ruleScope: "filter_step",
      ruleScopeId: "step-exact",
      observedAt: NOW,
    })).toEqual({
      company_id: COMPANY,
      flow_id: "roofing-flow-exact",
      rule_scope: "filter_step",
      rule_scope_id: "step-exact",
      rule_id: "rule-exact",
      rule_name: "Synthetic State Rule",
      lhv: "lead.state",
      operator: "is equal to",
      observed_at: NOW,
    });
  });

  it("uses LeadMaster Entered as the canonical lead-in timestamp", () => {
    const row = normalizeLeadMasterRecord({
      recordIDField: 42,
      enteredField: "2026-08-03T09:15:00-04:00",
      lastUpdatedField: "2026-08-04T10:30:00-04:00",
      lead_StatusField: "Demo Complete",
    }, "lead", COMPANY, NOW);

    expect(row?.entered_at).toBe("2026-08-03T13:15:00.000Z");
    expect(row?.vendor_updated_at).toBe("2026-08-04T14:30:00.000Z");
    expect(row?.disposition).toBe("Demo Complete");
  });

  it("does not infer that JobNimbus triggered re-engagement", () => {
    const row = normalizeJobNimbusJob({
      id: "job-1",
      contact_id: "contact-1",
      appointment_status: "No-Show",
      sold_value: 25000,
      gross_margin: 8000,
    }, COMPANY, NOW);
    expect(row?.reengagement_triggered).toBe(false);
    expect(row?.appointment_status).toBe("No-Show");
    expect(row?.sold_value).toBeNull();
    expect(row?.raw_payload.gross_margin).toBe("[REDACTED:NOT_APPROVED]");
  });

  it("uses the JobNimbus contact status name instead of its numeric status id", () => {
    const row = normalizeJobNimbusContact({
      jnid: "contact-1",
      display_name: "Synthetic Contact",
      status: 480,
      status_name: "Lead",
    }, COMPANY, NOW);

    expect(row?.status).toBe("Lead");
  });

  it("retains the JobNimbus external id for cross-vendor reconciliation", () => {
    const row = normalizeJobNimbusContact({
      jnid: "contact-1",
      external_id: "source-lead-1",
    }, COMPANY, NOW);

    expect(row?.external_lead_id).toBe("source-lead-1");
  });

  it("uses the JobNimbus job status name instead of its numeric status id", () => {
    const row = normalizeJobNimbusJob({
      jnid: "job-1",
      status: 483,
      status_name: "In Production",
    }, COMPANY, NOW);

    expect(row?.status).toBe("In Production");
  });

  it("links a JobNimbus job to its primary contact relationship", () => {
    const row = normalizeJobNimbusJob({
      jnid: "job-1",
      primary: {
        id: "contact-1",
        type: "contact",
        name: "Synthetic Contact",
      },
    }, COMPANY, NOW);

    expect(row?.contact_id).toBe("contact-1");
  });

  it("does not treat a non-contact JobNimbus primary relationship as a contact", () => {
    const row = normalizeJobNimbusJob({
      jnid: "job-1",
      primary: {
        id: "parent-job-1",
        type: "job",
        name: "Synthetic Parent Job",
      },
    }, COMPANY, NOW);

    expect(row?.contact_id).toBeNull();
  });

  it("recursively redacts credentials without removing diagnostic fields", () => {
    expect(redactSecrets({
      nested: {
        access_token: "secret",
        refreshToken: "secret",
        private_key: "secret",
        credential: "secret",
        status: "ok",
      },
    })).toEqual({
      nested: {
        access_token: "[REDACTED]",
        refreshToken: "[REDACTED]",
        private_key: "[REDACTED]",
        credential: "[REDACTED]",
        status: "ok",
      },
    });
  });
});

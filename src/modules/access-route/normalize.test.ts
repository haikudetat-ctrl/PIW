import { describe, expect, it } from "vitest";
import {
  normalizeJobNimbusContact,
  normalizeJobNimbusJob,
  normalizeLeadConduitEvent,
  normalizeLeadMasterRecord,
  redactSecrets,
} from "./normalize";

const NOW = "2026-08-04T16:00:00.000Z";
const COMPANY = "00000000-0000-4000-8000-000000000001";

describe("access route normalization", () => {
  it("normalizes LeadConduit source events while retaining a redacted audit copy", () => {
    const row = normalizeLeadConduitEvent({
      id: "event-1",
      type: "source",
      outcome: "failure",
      start_timestamp: 1_775_299_200_000,
      api_key: "must-not-land",
      vars: {
        "flow.id": "flow-1",
        "source.id": "source-1",
        "source.name": "Meta NJ",
        "lead.id": "lead-1",
        "lead.phone_1": "(609) 555-0100",
        "lead.email": " Person@Example.com ",
      },
    }, COMPANY, NOW);

    expect(row).toMatchObject({
      event_id: "event-1",
      flow_id: "flow-1",
      source_id: "source-1",
      source_name: "Meta NJ",
      lead_id: "lead-1",
      phone_normalized: "+16095550100",
      email_normalized: "person@example.com",
    });
    expect(row?.raw_payload.api_key).toBe("[REDACTED]");
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
    expect(redactSecrets({ nested: { access_token: "secret", status: "ok" } })).toEqual({
      nested: { access_token: "[REDACTED]", status: "ok" },
    });
  });
});

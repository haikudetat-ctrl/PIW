import {describe, expect, test} from "vitest";
import {
  buildInternalLeadEmail,
  classifyLeadConduitResponse,
  mapMetaLeadSource,
  toLeadConduitForm,
} from "./meta-lead-distribution";

const lead = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Alex Morgan",
  phone: "+12015550100",
  email: "alex@example.com",
  submittedAddress: "123 Main Street, Newark, NJ 07102",
  sourceSystem: "canonical-roof-assessment",
  sourceSubmittedAt: "2026-09-03T19:32:38.000Z",
  clientIpAddress: "198.51.100.4",
  clientUserAgent: "Mozilla/5.0",
  trustedFormUrl: null,
};

describe("Meta lead source routing", () => {
  test.each([
    ["meta", "AS | Campaign 1", "Meta70"],
    ["facebook", "Meta70", "Meta70"],
    ["instagram", "AS | Campaign 2", "Meta30"],
    ["meta", "Meta30", "Meta30"],
  ] as const)("maps %s / %s to %s", (utmSource, campaign, expected) => {
    expect(mapMetaLeadSource(utmSource, campaign)).toBe(expected);
  });

  test.each([
    ["google", "AS | Campaign 1"],
    ["meta", "AS | Campaign 3"],
    [null, "Meta70"],
  ])("rejects unapproved attribution %s / %s", (utmSource, campaign) => {
    expect(mapMetaLeadSource(utmSource, campaign)).toBeNull();
  });
});

describe("LeadConduit submission", () => {
  test("builds the confirmed form-encoded contract without a redirect", () => {
    const form = toLeadConduitForm(lead, "Meta70");

    expect(Object.fromEntries(form.entries())).toEqual({
      first_name: "Alex",
      last_name: "Morgan",
      phone_1: "+12015550100",
      email: "alex@example.com",
      address_1: "123 Main Street",
      city: "Newark",
      state: "NJ",
      postal_code: "07102",
      lead_id_allss: lead.id,
      source_class_allss: "webform",
      ip_address: "198.51.100.4",
      user_agent: "Mozilla/5.0",
      reference: lead.id,
      original_source: "Meta70",
      source_timestamp: "2026-09-03T19:32:38.000Z",
      campaign_source: "Meta70",
      country: "United States",
    });
    expect(form.has("redir_url")).toBe(false);
  });

  test("includes TrustedForm only when captured", () => {
    const form = toLeadConduitForm({
      ...lead,
      trustedFormUrl: "https://cert.trustedform.com/example",
    }, "Meta30");
    expect(form.get("trustedform_cert_url")).toBe("https://cert.trustedform.com/example");
  });

  test.each([
    [201, {outcome: "success", lead: {id: "5e256787fa37c91d52600dfe"}}, "sent"],
    [201, {outcome: "failure", reason: "filtered", lead: {id: "5e25cbe0bb6c0070ca4797fe"}}, "rejected"],
    [422, {message: "Invalid source ID"}, "permanent_failed"],
    [429, {message: "slow down"}, "retryable_failed"],
    [503, {message: "unavailable"}, "retryable_failed"],
  ] as const)("classifies HTTP %s as %s", (status, body, expected) => {
    expect(classifyLeadConduitResponse(status, body).status).toBe(expected);
  });
});

describe("internal lead email", () => {
  test("renders the approved source and customer contact details", () => {
    expect(buildInternalLeadEmail(lead, "Meta30", "https://piw.example/leads/111")).toEqual({
      subject: "[Meta30] New roofing lead — Alex Morgan",
      text: [
        "New Meta30 roofing lead",
        "",
        "Name: Alex Morgan",
        "Phone: +12015550100",
        "Email: alex@example.com",
        "Property: 123 Main Street, Newark, NJ 07102",
        "Submitted: 2026-09-03T19:32:38.000Z",
        "PIW lead: https://piw.example/leads/111",
      ].join("\n"),
    });
  });
});

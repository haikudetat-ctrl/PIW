import { describe, expect, test } from "vitest";
import { buildPreviewConversionInput, previewContactSchema } from "./convert-preview";

const preview = {
  submitted_address: "1 Main St, Newark, NJ 07102",
  canonical_address: "1 Main St, Newark, NJ 07102, USA",
  google_place_id: "ChIJ-one",
  campaign: "weather-report",
  entry_point: "campaign:weather-report",
  presentation_key: "weather-report",
  attribution: {utm_source: "facebook", utm_medium: null, utm_campaign: "fall", utm_term: null, utm_content: null, fbclid: "abc"},
  referrer: "https://allseasonroofingquote.com/campaigns/weather-report",
};

const contact = {
  submission_id: "55555555-5555-4555-8555-555555555555",
  name: "Alex Rivera",
  email: "alex@example.com",
  phone: "201-555-0100",
};

describe("buildPreviewConversionInput", () => {
  test("builds the canonical intake input from the preview and contact details", () => {
    expect(buildPreviewConversionInput({
      preview,
      contact,
      clientIp: "203.0.113.5",
      userAgent: "Mozilla/5.0",
      advertisingCookies: {fbp: "fb.1.1.1", fbc: null},
      now: new Date("2026-10-03T12:05:00.000Z"),
    })).toEqual({
      submission_id: contact.submission_id,
      campaign: "weather-report",
      presentation_key: "weather-report",
      entry_point: "campaign:weather-report",
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
      source: "all-season-campaign",
      submittedAt: "2026-10-03T12:05:00.000Z",
      disclosure_version: "all-season-campaign-estimate-v5",
      client_ip_address: "203.0.113.5",
      client_user_agent: "Mozilla/5.0",
      referrer: preview.referrer,
      attribution: {...preview.attribution, fbp: "fb.1.1.1", fbc: null},
      address: "1 Main St, Newark, NJ 07102, USA",
      google_place_id: "ChIJ-one",
      consent_to_contact: true,
      consent_to_process_property: true,
    });
  });

  test("uses the submitted address and no Place ID for a manual preview", () => {
    const input = buildPreviewConversionInput({
      preview: {...preview, canonical_address: null, google_place_id: null},
      contact,
      clientIp: "203.0.113.5",
      userAgent: "Mozilla/5.0",
      advertisingCookies: {fbp: null, fbc: null},
      now: new Date(),
    });
    expect(input.address).toBe("1 Main St, Newark, NJ 07102");
    expect(input.google_place_id).toBeNull();
  });

  test("ignores unexpected attribution keys stored on the preview", () => {
    const input = buildPreviewConversionInput({
      preview: {...preview, attribution: {utm_source: "x", injected: "y"}},
      contact,
      clientIp: "203.0.113.5",
      userAgent: "Mozilla/5.0",
      advertisingCookies: {fbp: null, fbc: null},
      now: new Date(),
    });
    expect(input.attribution).toEqual({
      utm_source: "x", utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null,
      fbclid: null, fbp: null, fbc: null,
    });
  });
});

describe("previewContactSchema", () => {
  test("accepts contact details and rejects extra fields", () => {
    expect(previewContactSchema.safeParse(contact).success).toBe(true);
    expect(previewContactSchema.safeParse({...contact, address: "x"}).success).toBe(false);
    expect(previewContactSchema.safeParse({...contact, email: "nope"}).success).toBe(false);
    expect(previewContactSchema.safeParse({...contact, name: "A"}).success).toBe(false);
  });
});

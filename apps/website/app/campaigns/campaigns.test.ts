import {describe, expect, test} from "vitest";
import {campaignSlugs} from "../../../../shared/all-season-campaign-themes";
import {
  buildCampaignSubmission,
  getCampaign,
} from "./campaigns";

describe("All Season campaign definitions", () => {
  test("publishes the four approved campaign routes", () => {
    expect(campaignSlugs).toEqual([
      "do-it-right-once",
      "weather-report",
      "seasonal-shield",
      "for-every-season",
    ]);
    expect(getCampaign("do-it-right-once")?.proof).toContain("20+ years");
    expect(getCampaign("do-it-right-once")?.warranty).toBe("Lifetime warranty");
    expect(getCampaign("not-a-campaign")).toBeUndefined();
  });
});

describe("campaign estimate submission", () => {
  test("builds a Google-normalized payload with paid-campaign attribution", () => {
    const form = new FormData();
    form.set("name", "Alex Rivera");
    form.set("email", "alex@example.com");
    form.set("phone", "201-555-0100");

    expect(buildCampaignSubmission({
      campaign: "weather-report",
      submissionId: "11111111-1111-4111-8111-111111111111",
      form,
      selectedAddress: "12 Birch Street, Newark, NJ 07102, USA",
      googlePlaceId: "ChIJ-selected",
      search: "?utm_source=facebook&utm_medium=paid-social&utm_campaign=storm-week&utm_content=forecast&fbclid=click-123",
    })).toEqual({
      submission_id: "11111111-1111-4111-8111-111111111111",
      campaign: "weather-report",
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: "201-555-0100",
      address: "12 Birch Street, Newark, NJ 07102, USA",
      google_place_id: "ChIJ-selected",
      consent_to_contact: true,
      consent_to_process_property: true,
      utm_source: "facebook",
      utm_medium: "paid-social",
      utm_campaign: "storm-week",
      utm_term: null,
      utm_content: "forecast",
      fbclid: "click-123",
    });
  });

  test("builds a complete manual New Jersey address when Google has no match", () => {
    const form = new FormData();
    form.set("name", "Sam Lee");
    form.set("email", "sam@example.com");
    form.set("phone", "732-555-0100");
    form.set("address_line_1", "8 Shore Road");
    form.set("address_line_2", "Unit 2");
    form.set("city", "Toms River");
    form.set("postal_code", "08753");

    expect(buildCampaignSubmission({
      campaign: "seasonal-shield",
      submissionId: "22222222-2222-4222-8222-222222222222",
      form,
      selectedAddress: "",
      googlePlaceId: "",
      search: "",
    })).toEqual(expect.objectContaining({
      address: "8 Shore Road, Unit 2, Toms River, NJ 08753",
      google_place_id: null,
      address_line_1: "8 Shore Road",
      address_line_2: "Unit 2",
      city: "Toms River",
      state: "NJ",
      postal_code: "08753",
    }));
  });
});

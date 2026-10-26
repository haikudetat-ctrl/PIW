import {describe, expect, test} from "vitest";
import {
  advertisingConsentModel,
  advertisingStorageAllowed,
  googleConsentState,
  resolveGoogleTagConfiguration,
} from "./google-tag";

const SECRET = "x".repeat(32);

describe("resolveGoogleTagConfiguration", () => {
  test("stays off unless enabled with a valid tag ID and the consent signing secret", () => {
    expect(resolveGoogleTagConfiguration({})).toBeNull();
    expect(resolveGoogleTagConfiguration({NEXT_PUBLIC_GOOGLE_ADS_TRACKING_ENABLED: "true", NEXT_PUBLIC_GOOGLE_ADS_TAG_ID: "AW-123456789"})).toBeNull();
    expect(resolveGoogleTagConfiguration({
      NEXT_PUBLIC_GOOGLE_ADS_TRACKING_ENABLED: "true",
      NEXT_PUBLIC_GOOGLE_ADS_TAG_ID: "G-NOTADS",
      PRIVACY_CONSENT_SIGNING_SECRET: SECRET,
    })).toBeNull();
    expect(resolveGoogleTagConfiguration({
      NEXT_PUBLIC_GOOGLE_ADS_TRACKING_ENABLED: "true",
      NEXT_PUBLIC_GOOGLE_ADS_TAG_ID: "AW-123456789",
      PRIVACY_CONSENT_SIGNING_SECRET: SECRET,
    })).toEqual({tagId: "AW-123456789", consentModel: "opt_in", callConversion: null});
  });

  test("enables the call number swap only with a valid label and number", () => {
    const base = {
      NEXT_PUBLIC_GOOGLE_ADS_TRACKING_ENABLED: "true",
      NEXT_PUBLIC_GOOGLE_ADS_TAG_ID: "AW-123456789",
      PRIVACY_CONSENT_SIGNING_SECRET: SECRET,
    };
    expect(resolveGoogleTagConfiguration({...base, NEXT_PUBLIC_GOOGLE_ADS_CALL_CONVERSION_LABEL: "AbC-123_x", NEXT_PUBLIC_GOOGLE_ADS_CALL_TRACKED_NUMBER: "(866) 835-6022"})?.callConversion)
      .toEqual({label: "AbC-123_x", phoneNumber: "(866) 835-6022"});
    expect(resolveGoogleTagConfiguration({...base, NEXT_PUBLIC_GOOGLE_ADS_CALL_CONVERSION_LABEL: "AbC-123_x", NEXT_PUBLIC_GOOGLE_ADS_CALL_TRACKED_NUMBER: "8668356022"})?.callConversion)
      .toBeNull();
  });
});

describe("consent", () => {
  test("defaults to opt-in", () => {
    expect(advertisingConsentModel({})).toBe("opt_in");
    expect(advertisingConsentModel({NEXT_PUBLIC_ADVERTISING_CONSENT_MODEL: "opt_out"})).toBe("opt_out");
    expect(advertisingConsentModel({NEXT_PUBLIC_ADVERTISING_CONSENT_MODEL: "anything"})).toBe("opt_in");
  });

  test.each([
    ["opt_in", false, false, false, false],
    ["opt_in", true, false, false, false],
    ["opt_in", true, true, false, true],
    ["opt_in", true, true, true, false],
    ["opt_out", false, false, false, true],
    ["opt_out", true, false, false, false],
    ["opt_out", false, false, true, false],
  ] as const)("%s decided=%s advertising=%s gpc=%s -> %s", (model, decided, advertising, gpc, expected) => {
    expect(advertisingStorageAllowed({model, decided, advertising, gpc})).toBe(expected);
  });

  test("never grants ad personalization", () => {
    expect(googleConsentState({advertising: true, analytics: true})).toEqual({
      ad_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "denied",
      analytics_storage: "granted",
    });
  });
});

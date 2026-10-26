/**
 * Browser Google tag configuration. The tag is optional and does not record
 * lead conversions: PIW uploads those server side (one source of truth, no
 * double counting). In the browser it provides the conversion linker, page
 * views for audience-free reporting, and, when configured, Google's website
 * call conversion number swap.
 */

export type AdvertisingConsentModel = "opt_in" | "opt_out";

export type GoogleTagConfiguration = {
  tagId: string;
  consentModel: AdvertisingConsentModel;
  callConversion: {label: string; phoneNumber: string} | null;
};

type Environment = Record<string, string | undefined>;

export function advertisingConsentModel(environment: Environment): AdvertisingConsentModel {
  // Until AllSeason decides on NJDPA treatment, advertising tags wait for an
  // explicit opt-in. "opt_out" is accepted only when set deliberately.
  return environment.NEXT_PUBLIC_ADVERTISING_CONSENT_MODEL === "opt_out" ? "opt_out" : "opt_in";
}

export function resolveGoogleTagConfiguration(environment: Environment): GoogleTagConfiguration | null {
  if (environment.NEXT_PUBLIC_GOOGLE_ADS_TRACKING_ENABLED !== "true") return null;
  const tagId = environment.NEXT_PUBLIC_GOOGLE_ADS_TAG_ID?.trim() ?? "";
  if (!/^AW-\d{6,15}$/.test(tagId)) return null;
  // The signed consent cookie is the only consent authority; without its
  // secret the tag must not load at all.
  const signingSecret = environment.PRIVACY_CONSENT_SIGNING_SECRET ?? "";
  if (new TextEncoder().encode(signingSecret).length < 32) return null;

  const label = environment.NEXT_PUBLIC_GOOGLE_ADS_CALL_CONVERSION_LABEL?.trim() ?? "";
  const phoneNumber = environment.NEXT_PUBLIC_GOOGLE_ADS_CALL_TRACKED_NUMBER?.trim() ?? "";
  const callConversion = /^[A-Za-z0-9_-]{6,64}$/.test(label) && /^\(\d{3}\) \d{3}-\d{4}$/.test(phoneNumber)
    ? {label, phoneNumber}
    : null;

  return {tagId, consentModel: advertisingConsentModel(environment), callConversion};
}

/**
 * Whether advertising storage may be granted for this visitor.
 * opt_in: only an explicit Advertising grant.
 * opt_out: allowed until the visitor declines, and never under GPC.
 */
export function advertisingStorageAllowed(input: {
  model: AdvertisingConsentModel;
  decided: boolean;
  advertising: boolean;
  gpc: boolean;
}): boolean {
  if (input.gpc) return false;
  if (input.model === "opt_in") return input.decided && input.advertising;
  return !input.decided || input.advertising;
}

export type GoogleConsentState = {
  ad_storage: "granted" | "denied";
  ad_user_data: "granted" | "denied";
  ad_personalization: "granted" | "denied";
  analytics_storage: "granted" | "denied";
};

/** Consent Mode v2 signals. Remarketing stays off: ad_personalization is always denied. */
export function googleConsentState(input: {advertising: boolean; analytics: boolean}): GoogleConsentState {
  return {
    ad_storage: input.advertising ? "granted" : "denied",
    ad_user_data: input.advertising ? "granted" : "denied",
    ad_personalization: "denied",
    analytics_storage: input.analytics ? "granted" : "denied",
  };
}

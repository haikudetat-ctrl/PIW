export {
  CONSENT_POLICY_VERSION,
  createConsentHandoff,
  normalizeConsentPreferences,
  PRIVACY_COOKIE_NAME,
  verifyConsentHandoff,
} from "../../../shared/privacy-consent";
export type {
  ConsentHandoff,
  ConsentHandoffInput,
  ConsentPreferences,
  VerifiedConsent as VerifiedWebsiteConsent,
} from "../../../shared/privacy-consent";

import {
  signConsentCookie,
  verifyConsentCookie,
  type VerifiedConsent,
} from "../../../shared/privacy-consent";

export function signWebsiteConsent(consent: VerifiedConsent, secret: string) {
  return signConsentCookie(consent, secret);
}

export function readWebsiteConsent(value: string | undefined, secret: string) {
  return verifyConsentCookie(value, secret);
}

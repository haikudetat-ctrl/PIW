import "server-only";
export {
  CONSENT_POLICY_VERSION,
  normalizeConsentPreferences,
  PRIVACY_COOKIE_NAME,
  signConsentCookie,
  verifyConsentCookie,
} from "../../../shared/privacy-consent";
export type {
  ConsentPreferences,
  VerifiedConsent,
} from "../../../shared/privacy-consent";

import "server-only";
import {
  normalizeConsentPreferences,
  verifyConsentCookie,
  type VerifiedConsent,
} from "./consent";
import type {CurrentPrivacyConsentRepository} from "./consent-repository";

function sameConsentIdentity(left: VerifiedConsent, right: VerifiedConsent) {
  return left.consentId === right.consentId && left.policyVersion === right.policyVersion;
}

function applyGpc(
  consent: VerifiedConsent,
  gpcDetected: boolean,
  updatedAt: string,
): VerifiedConsent {
  if (!gpcDetected) return consent;
  return {
    ...consent,
    preferences: normalizeConsentPreferences(consent.preferences, true),
    gpcDetected: true,
    updatedAt,
  };
}

function canonicalCanSupersedeLocal(
  local: VerifiedConsent,
  canonical: VerifiedConsent,
) {
  if (local.preferences.advertising || !canonical.preferences.advertising) return true;
  return Date.parse(canonical.updatedAt) > Date.parse(local.updatedAt);
}

/**
 * Request-time tracking boundary: the signed cookie authenticates the consent
 * identity, while the unlinked canonical row determines its current state.
 * It intentionally returns null on every uncertain path so business handling
 * can continue with no browser/server Meta delivery.
 */
export async function resolveCurrentVerifiedConsent({
  consentToken,
  signingSecret,
  gpcDetected,
  now,
  repository,
}: {
  consentToken: string | undefined;
  signingSecret: string;
  gpcDetected: boolean;
  now: () => Date;
  repository: CurrentPrivacyConsentRepository;
}): Promise<VerifiedConsent | null> {
  const signed = verifyConsentCookie(consentToken, signingSecret);
  if (!signed) return null;
  const timestamp = now().toISOString();
  const local = applyGpc(signed, gpcDetected, timestamp);
  try {
    const canonical = await repository.readCurrent({
      consentId: local.consentId,
      policyVersion: local.policyVersion,
    });
    if (!canonical || !sameConsentIdentity(local, canonical)) return null;
    if (gpcDetected) return applyGpc(canonical, true, local.updatedAt);
    return canonicalCanSupersedeLocal(local, canonical) ? canonical : null;
  } catch {
    return null;
  }
}

export function requestHasGlobalPrivacyControl(headers: Headers) {
  return headers.get("sec-gpc") === "1" || headers.get("x-all-season-gpc") === "1";
}

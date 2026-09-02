import {z} from "zod";
import {
  normalizeConsentPreferences,
  signWebsiteConsent,
  type VerifiedWebsiteConsent,
} from "./privacy-consent";

const canonicalConsentSchema = z.object({
  policyVersion: z.literal("piw-privacy-v1"),
  consentId: z.uuid(),
  preferences: z.object({
    necessary: z.literal(true),
    analytics: z.boolean(),
    advertising: z.boolean(),
  }).strict(),
  gpcDetected: z.boolean(),
  updatedAt: z.iso.datetime({offset: true}),
}).strict().refine((consent) => !(consent.gpcDetected && consent.preferences.advertising));

function piwOrigin(value: string | undefined, nodeEnv: string | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.origin !== value.replace(/\/$/, "") || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return null;
    }
    if (parsed.protocol === "https:") return parsed.origin;
    const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    return nodeEnv !== "production" && local && parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function applyWebsiteGlobalPrivacyControl(
  consent: VerifiedWebsiteConsent,
  active: boolean,
  updatedAt: string,
): VerifiedWebsiteConsent {
  // `gpcDetected` in a cookie is historical evidence, not a live browser
  // signal. Only the current request may carry GPC authority forward.
  if (!active) return {...consent, gpcDetected: false};
  return {
    ...consent,
    preferences: normalizeConsentPreferences(consent.preferences, true),
    gpcDetected: true,
    updatedAt,
  };
}

function sameConsentIdentity(left: VerifiedWebsiteConsent, right: VerifiedWebsiteConsent) {
  return left.consentId === right.consentId && left.policyVersion === right.policyVersion;
}

/**
 * Rejects an uncertain cross-origin state rather than treating a local cookie
 * as tracking permission. A newer canonical grant can supersede an older local
 * denial, but a local GPC signal is always authoritative for this request.
 */
export function currentCanonicalWebsiteConsent(
  local: VerifiedWebsiteConsent,
  canonical: VerifiedWebsiteConsent | null,
): VerifiedWebsiteConsent | null {
  if (!canonical || !sameConsentIdentity(local, canonical)) return null;
  if (local.gpcDetected && (!canonical.gpcDetected || canonical.preferences.advertising)) return null;
  if (
    !local.gpcDetected
    && !local.preferences.advertising
    && canonical.preferences.advertising
    && Date.parse(canonical.updatedAt) <= Date.parse(local.updatedAt)
  ) return null;
  return canonical;
}

/**
 * Sends only an opaque signed consent token over the authenticated website →
 * PIW boundary. A malformed, divergent, or unavailable response is null so
 * callers can safely retain necessary form behavior while disabling tracking.
 */
export async function synchronizeCanonicalWebsiteConsent({
  consent,
  signingSecret,
  sharedSecret,
  publicPiwUrl,
  websiteOrigin,
  nodeEnv,
  liveGpcDetected = false,
}: {
  consent: VerifiedWebsiteConsent;
  signingSecret: string | undefined;
  sharedSecret: string | undefined;
  publicPiwUrl: string | undefined;
  websiteOrigin: string;
  nodeEnv: string | undefined;
  liveGpcDetected?: boolean;
}): Promise<VerifiedWebsiteConsent | null> {
  if (!signingSecret || !sharedSecret) return null;
  const origin = piwOrigin(publicPiwUrl, nodeEnv);
  if (!origin) return null;
  const requestConsent = liveGpcDetected
    ? consent
    : {...consent, gpcDetected: false};

  try {
    const response = await fetch(new URL("/api/privacy/consent/current", `${origin}/`), {
      method: "POST",
      headers: {
        origin: websiteOrigin,
        "x-all-season-intake-secret": sharedSecret,
        "x-piw-privacy-consent": signWebsiteConsent(requestConsent, signingSecret),
        ...(liveGpcDetected ? {"sec-gpc": "1"} : {}),
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(1_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || typeof body !== "object" || !("consent" in body)) return null;
    const parsed = canonicalConsentSchema.safeParse((body as {consent?: unknown}).consent);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Resolves a website cookie against PIW's canonical unlinked evidence. The
 * returned state must be used before accessing browser attribution identifiers.
 */
export async function resolveCanonicalWebsiteConsent(input: {
  consent: VerifiedWebsiteConsent;
  signingSecret: string | undefined;
  sharedSecret: string | undefined;
  publicPiwUrl: string | undefined;
  websiteOrigin: string;
  nodeEnv: string | undefined;
  liveGpcDetected?: boolean;
}): Promise<VerifiedWebsiteConsent | null> {
  const canonical = await synchronizeCanonicalWebsiteConsent(input);
  return currentCanonicalWebsiteConsent(input.consent, canonical);
}

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const CONSENT_POLICY_VERSION = "piw-privacy-v1" as const;
export const PRIVACY_COOKIE_NAME = "piw_privacy" as const;

export type ConsentPreferences = {
  necessary: true;
  analytics: boolean;
  advertising: boolean;
};

export type VerifiedConsent = {
  policyVersion: typeof CONSENT_POLICY_VERSION;
  consentId: string;
  preferences: ConsentPreferences;
  gpcDetected: boolean;
  updatedAt: string;
};

type ConsentCookieInput = Omit<VerifiedConsent, "policyVersion">;

const cookiePayloadSchema = z.strictObject({
  v: z.literal(CONSENT_POLICY_VERSION),
  cid: z.uuid(),
  a: z.boolean(),
  d: z.boolean(),
  g: z.boolean(),
  at: z.iso.datetime({ offset: true }),
});

const cookieValuePattern = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/;

function encodePayload(payload: z.infer<typeof cookiePayloadSchema>) {
  return Buffer.from(JSON.stringify({
    v: payload.v,
    cid: payload.cid,
    a: payload.a,
    d: payload.d,
    g: payload.g,
    at: payload.at,
  }), "utf8").toString("base64url");
}

function signatureFor(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload, "ascii").digest();
}

export function normalizeConsentPreferences(
  input: { analytics?: boolean; advertising?: boolean },
  gpcDetected = false,
): ConsentPreferences {
  return {
    necessary: true,
    analytics: input.analytics === true,
    advertising: !gpcDetected && input.advertising === true,
  };
}

export function signConsentCookie(input: ConsentCookieInput, secret: string) {
  const payload = cookiePayloadSchema.parse({
    v: CONSENT_POLICY_VERSION,
    cid: input.consentId,
    a: input.preferences.analytics,
    d: normalizeConsentPreferences(input.preferences, input.gpcDetected).advertising,
    g: input.gpcDetected,
    at: input.updatedAt,
  });
  const encoded = encodePayload(payload);
  return `${encoded}.${signatureFor(encoded, secret).toString("base64url")}`;
}

export function verifyConsentCookie(value: string | undefined, secret: string): VerifiedConsent | null {
  try {
    if (!value) return null;
    const match = cookieValuePattern.exec(value);
    if (!match) return null;

    const [, encoded, encodedSignature] = match;
    const suppliedSignature = Buffer.from(encodedSignature, "base64url");
    const expectedSignature = signatureFor(encoded, secret);
    if (
      suppliedSignature.length !== expectedSignature.length
      || !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return null;
    }

    const payload = cookiePayloadSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    if (payload.g && payload.d) return null;
    if (encodePayload(payload) !== encoded) return null;

    return {
      policyVersion: payload.v,
      consentId: payload.cid,
      preferences: {
        necessary: true,
        analytics: payload.a,
        advertising: payload.d,
      },
      gpcDetected: payload.g,
      updatedAt: payload.at,
    };
  } catch {
    return null;
  }
}

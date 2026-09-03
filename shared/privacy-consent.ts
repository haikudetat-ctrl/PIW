import {createHash, createHmac, timingSafeEqual} from "node:crypto";
import {z} from "zod";

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

export type ConsentHandoff = {
  version: typeof CONSENT_POLICY_VERSION;
  consentId: string;
  analytics: boolean;
  advertising: boolean;
  gpc: boolean;
  continuationHash: string;
  issuedAt: string;
};

export type ConsentHandoffInput = {
  consentId: string;
  policyVersion: typeof CONSENT_POLICY_VERSION;
  analytics: boolean;
  advertising: boolean;
  gpc?: boolean;
  issuedAt: string;
};

type ConsentCookieInput = Omit<VerifiedConsent, "policyVersion">;

const cookiePayloadSchema = z.strictObject({
  v: z.literal(CONSENT_POLICY_VERSION),
  cid: z.uuid(),
  a: z.boolean(),
  d: z.boolean(),
  g: z.boolean(),
  at: z.iso.datetime({offset: true}),
});
const handoffPayloadSchema = z.strictObject({
  version: z.literal(CONSENT_POLICY_VERSION),
  consentId: z.uuid(),
  analytics: z.boolean(),
  advertising: z.boolean(),
  gpc: z.boolean(),
  continuationHash: z.string().regex(/^[a-f0-9]{64}$/),
  issuedAt: z.iso.datetime({offset: true}),
}).refine((payload) => !(payload.gpc && payload.advertising));
const handoffInputSchema = z.strictObject({
  consentId: z.uuid(),
  policyVersion: z.literal(CONSENT_POLICY_VERSION),
  analytics: z.boolean(),
  advertising: z.boolean(),
  gpc: z.boolean().optional().default(false),
  issuedAt: z.iso.datetime({offset: true}),
}).refine((input) => !(input.gpc && input.advertising));
const signedValuePattern = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/;
const MAX_HANDOFF_AGE_MS = 5 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 30 * 1000;

function encodeJson(payload: unknown) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signatureFor(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload, "ascii").digest();
}

function hasUsableSecret(secret: string) {
  return Buffer.byteLength(secret, "utf8") >= 32;
}

function verifySignedPayload(value: string, secret: string) {
  if (!hasUsableSecret(secret)) return null;
  const match = signedValuePattern.exec(value);
  if (!match) return null;
  const [, encodedPayload, encodedSignature] = match;
  const suppliedSignature = Buffer.from(encodedSignature, "base64url");
  const expectedSignature = signatureFor(encodedPayload, secret);
  if (
    suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)
  ) return null;
  return encodedPayload;
}

function encodeCookiePayload(payload: z.infer<typeof cookiePayloadSchema>) {
  return encodeJson({
    v: payload.v,
    cid: payload.cid,
    a: payload.a,
    d: payload.d,
    g: payload.g,
    at: payload.at,
  });
}

function encodeHandoffPayload(payload: ConsentHandoff) {
  return encodeJson({
    version: payload.version,
    consentId: payload.consentId,
    analytics: payload.analytics,
    advertising: payload.advertising,
    gpc: payload.gpc,
    continuationHash: payload.continuationHash,
    issuedAt: payload.issuedAt,
  });
}

function continuationHash(continuation: string) {
  return createHash("sha256").update(continuation, "utf8").digest("hex");
}

export function normalizeConsentPreferences(
  input: {analytics?: boolean; advertising?: boolean},
  gpcDetected = false,
): ConsentPreferences {
  return {
    necessary: true,
    analytics: input.analytics === true,
    advertising: !gpcDetected && input.advertising === true,
  };
}

export function signConsentCookie(input: ConsentCookieInput, secret: string) {
  if (!hasUsableSecret(secret)) throw new Error("Invalid privacy consent signing secret");
  const payload = cookiePayloadSchema.parse({
    v: CONSENT_POLICY_VERSION,
    cid: input.consentId,
    a: input.preferences.analytics,
    d: normalizeConsentPreferences(input.preferences, input.gpcDetected).advertising,
    g: input.gpcDetected,
    at: input.updatedAt,
  });
  const encoded = encodeCookiePayload(payload);
  return `${encoded}.${signatureFor(encoded, secret).toString("base64url")}`;
}

export function verifyConsentCookie(value: string | undefined, secret: string): VerifiedConsent | null {
  try {
    if (!value) return null;
    const encoded = verifySignedPayload(value, secret);
    if (!encoded) return null;
    const payload = cookiePayloadSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    if (payload.g && payload.d) return null;
    if (encodeCookiePayload(payload) !== encoded) return null;
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

export async function createConsentHandoff(
  consent: ConsentHandoffInput,
  continuation: string,
  secret: string,
): Promise<string> {
  if (!hasUsableSecret(secret) || !continuation) {
    throw new Error("Invalid consent handoff");
  }
  const input = handoffInputSchema.parse(consent);
  const payload: ConsentHandoff = {
    version: CONSENT_POLICY_VERSION,
    consentId: input.consentId,
    analytics: input.analytics,
    advertising: input.advertising,
    gpc: input.gpc,
    continuationHash: continuationHash(continuation),
    issuedAt: input.issuedAt,
  };
  const encoded = encodeHandoffPayload(payload);
  return `${encoded}.${signatureFor(encoded, secret).toString("base64url")}`;
}

export async function verifyConsentHandoff(
  token: string,
  continuation: string,
  secret: string,
  now = new Date(),
): Promise<ConsentHandoff> {
  try {
    if (!continuation || Number.isNaN(now.getTime())) throw new Error("invalid");
    const encoded = verifySignedPayload(token, secret);
    if (!encoded) throw new Error("invalid");
    const payload = handoffPayloadSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    if (encodeHandoffPayload(payload) !== encoded) throw new Error("invalid");
    if (payload.continuationHash !== continuationHash(continuation)) throw new Error("invalid");
    const issuedAt = Date.parse(payload.issuedAt);
    const age = now.getTime() - issuedAt;
    if (age < -MAX_FUTURE_SKEW_MS) throw new Error("invalid");
    if (age > MAX_HANDOFF_AGE_MS) throw new Error("expired");
    return payload;
  } catch (error) {
    if (error instanceof Error && error.message === "expired") {
      throw new Error("Expired consent handoff");
    }
    throw new Error("Invalid consent handoff");
  }
}

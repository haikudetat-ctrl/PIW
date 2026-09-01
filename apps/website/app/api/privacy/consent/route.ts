import {randomUUID} from "node:crypto";
import {NextResponse, type NextRequest} from "next/server";
import {z} from "zod";
import {
  CONSENT_POLICY_VERSION,
  normalizeConsentPreferences,
  PRIVACY_COOKIE_NAME,
  readWebsiteConsent,
  signWebsiteConsent,
} from "../../../../lib/privacy-consent";

const consentRequestSchema = z.strictObject({
  analytics: z.boolean(),
  advertising: z.boolean(),
});

export type WebsitePrivacyConsentDependencies = {
  signingSecret: string | undefined;
  nodeEnv: "development" | "test" | "production";
  now: () => Date;
  createId: () => string;
};

export type WebsitePrivacyConsentStatusDependencies = {
  signingSecret: string | undefined;
};

function noStoreJson(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {"cache-control": "no-store"},
  });
}

function readCookie(request: NextRequest) {
  return request.cookies.get(PRIVACY_COOKIE_NAME)?.value;
}

/** Returns only server-verified consent; browser storage is never trusted. */
export async function handlePrivacyConsentStatusRequest(
  request: NextRequest,
  dependencies: WebsitePrivacyConsentStatusDependencies,
) {
  const consent = dependencies.signingSecret
    ? readWebsiteConsent(readCookie(request), dependencies.signingSecret)
    : null;
  return noStoreJson({consent}, 200);
}

export async function handlePrivacyConsentRequest(
  request: NextRequest,
  dependencies: WebsitePrivacyConsentDependencies,
) {
  const parsed = consentRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({error: "Invalid privacy consent"}, 400);

  const signingSecret = dependencies.signingSecret;
  if (!signingSecret || Buffer.byteLength(signingSecret, "utf8") < 32) {
    return noStoreJson({error: "Privacy consent is temporarily unavailable"}, 503);
  }

  const existing = readWebsiteConsent(readCookie(request), signingSecret);
  const gpcDetected = request.headers.get("sec-gpc") === "1";
  const consent = {
    policyVersion: CONSENT_POLICY_VERSION,
    consentId: existing?.consentId ?? dependencies.createId(),
    preferences: normalizeConsentPreferences(parsed.data, gpcDetected),
    gpcDetected,
    updatedAt: dependencies.now().toISOString(),
  };
  const response = noStoreJson({consent}, 200);
  response.cookies.set({
    name: PRIVACY_COOKIE_NAME,
    value: signWebsiteConsent(consent, signingSecret),
    httpOnly: true,
    secure: dependencies.nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 15_552_000,
  });
  return response;
}

export async function POST(request: NextRequest) {
  try {
    return await handlePrivacyConsentRequest(request, {
      signingSecret: process.env.PRIVACY_CONSENT_SIGNING_SECRET,
      nodeEnv: process.env.NODE_ENV,
      now: () => new Date(),
      createId: randomUUID,
    });
  } catch {
    return noStoreJson({error: "Privacy consent is temporarily unavailable"}, 503);
  }
}

export async function GET(request: NextRequest) {
  try {
    return await handlePrivacyConsentStatusRequest(request, {
      signingSecret: process.env.PRIVACY_CONSENT_SIGNING_SECRET,
    });
  } catch {
    return noStoreJson({consent: null}, 200);
  }
}

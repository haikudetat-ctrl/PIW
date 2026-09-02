import {randomUUID} from "node:crypto";
import {NextResponse, type NextRequest} from "next/server";
import {z} from "zod";
import {
  CONSENT_POLICY_VERSION,
  normalizeConsentPreferences,
  PRIVACY_COOKIE_NAME,
  readWebsiteConsent,
  signWebsiteConsent,
  type VerifiedWebsiteConsent,
} from "../../../../lib/privacy-consent";
import {
  applyWebsiteGlobalPrivacyControl,
  currentCanonicalWebsiteConsent,
  synchronizeCanonicalWebsiteConsent,
} from "../../../../lib/canonical-privacy-consent";

const consentRequestSchema = z.strictObject({
  analytics: z.boolean(),
  advertising: z.boolean(),
  gpcDetected: z.boolean().optional().default(false),
});

export type WebsitePrivacyConsentDependencies = {
  signingSecret: string | undefined;
  nodeEnv: "development" | "test" | "production";
  now: () => Date;
  createId: () => string;
  synchronize?: (consent: VerifiedWebsiteConsent) => Promise<VerifiedWebsiteConsent | null>;
};

export type WebsitePrivacyConsentStatusDependencies = {
  signingSecret: string | undefined;
  nodeEnv?: "development" | "test" | "production";
  now?: () => Date;
  synchronize?: (consent: VerifiedWebsiteConsent) => Promise<VerifiedWebsiteConsent | null>;
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

function requestHasGpc(request: NextRequest) {
  return request.headers.get("sec-gpc") === "1" || request.headers.get("x-all-season-gpc") === "1";
}

function failClosed(consent: VerifiedWebsiteConsent): VerifiedWebsiteConsent {
  return {
    ...consent,
    preferences: {...consent.preferences, advertising: false},
  };
}

async function resolveCurrentConsent({
  candidate,
  synchronize,
}: {
  candidate: VerifiedWebsiteConsent;
  synchronize: ((consent: VerifiedWebsiteConsent) => Promise<VerifiedWebsiteConsent | null>) | undefined;
}) {
  let canonical: VerifiedWebsiteConsent | null = null;
  try {
    canonical = synchronize ? await synchronize(candidate) : null;
  } catch {
    canonical = null;
  }
  const current = currentCanonicalWebsiteConsent(candidate, canonical);
  if (!current) {
    return {consent: failClosed(candidate), canonical: false};
  }
  return {consent: current, canonical: true};
}

function setConsentCookie(
  response: NextResponse,
  consent: VerifiedWebsiteConsent,
  signingSecret: string,
  nodeEnv: "development" | "test" | "production",
) {
  response.cookies.set({
    name: PRIVACY_COOKIE_NAME,
    value: signWebsiteConsent(consent, signingSecret),
    httpOnly: true,
    secure: nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 15_552_000,
  });
}

/** Returns only server-verified consent; browser storage is never trusted. */
export async function handlePrivacyConsentStatusRequest(
  request: NextRequest,
  dependencies: WebsitePrivacyConsentStatusDependencies,
) {
  const localConsent = dependencies.signingSecret
    ? readWebsiteConsent(readCookie(request), dependencies.signingSecret)
    : null;
  if (!localConsent || !dependencies.signingSecret) return noStoreJson({consent: null}, 200);

  const now = dependencies.now?.() ?? new Date();
  const candidate = applyWebsiteGlobalPrivacyControl(
    localConsent,
    requestHasGpc(request),
    requestHasGpc(request) ? now.toISOString() : localConsent.updatedAt,
  );
  const current = await resolveCurrentConsent({candidate, synchronize: dependencies.synchronize});
  const response = noStoreJson({consent: current.consent}, 200);
  if (current.canonical) {
    setConsentCookie(
      response,
      current.consent,
      dependencies.signingSecret,
      dependencies.nodeEnv ?? "production",
    );
  }
  return response;
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
  const gpcDetected = requestHasGpc(request) || parsed.data.gpcDetected;
  const candidate: VerifiedWebsiteConsent = {
    policyVersion: CONSENT_POLICY_VERSION,
    consentId: existing?.consentId ?? dependencies.createId(),
    preferences: normalizeConsentPreferences(parsed.data, gpcDetected),
    gpcDetected,
    updatedAt: dependencies.now().toISOString(),
  };
  const current = await resolveCurrentConsent({candidate, synchronize: dependencies.synchronize});
  const response = noStoreJson({consent: current.consent}, 200);
  // Preserve a locally recorded choice for a future retry, but never expose it
  // as effective Advertising consent until PIW has returned canonical state.
  setConsentCookie(response, current.canonical ? current.consent : candidate, signingSecret, dependencies.nodeEnv);
  return response;
}

export async function POST(request: NextRequest) {
  try {
    return await handlePrivacyConsentRequest(request, {
      signingSecret: process.env.PRIVACY_CONSENT_SIGNING_SECRET,
      nodeEnv: process.env.NODE_ENV,
      now: () => new Date(),
      createId: randomUUID,
      synchronize: (consent) => synchronizeCanonicalWebsiteConsent({
        consent,
        signingSecret: process.env.PRIVACY_CONSENT_SIGNING_SECRET,
        sharedSecret: process.env.INTAKE_WEBHOOK_SHARED_SECRET,
        publicPiwUrl: process.env.PIW_PUBLIC_APP_URL,
        websiteOrigin: request.nextUrl.origin,
        nodeEnv: process.env.NODE_ENV,
      }),
    });
  } catch {
    return noStoreJson({error: "Privacy consent is temporarily unavailable"}, 503);
  }
}

export async function GET(request: NextRequest) {
  try {
    return await handlePrivacyConsentStatusRequest(request, {
      signingSecret: process.env.PRIVACY_CONSENT_SIGNING_SECRET,
      nodeEnv: process.env.NODE_ENV,
      now: () => new Date(),
      synchronize: (consent) => synchronizeCanonicalWebsiteConsent({
        consent,
        signingSecret: process.env.PRIVACY_CONSENT_SIGNING_SECRET,
        sharedSecret: process.env.INTAKE_WEBHOOK_SHARED_SECRET,
        publicPiwUrl: process.env.PIW_PUBLIC_APP_URL,
        websiteOrigin: request.nextUrl.origin,
        nodeEnv: process.env.NODE_ENV,
      }),
    });
  } catch {
    return noStoreJson({consent: null}, 200);
  }
}

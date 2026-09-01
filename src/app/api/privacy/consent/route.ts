import {randomUUID} from "node:crypto";
import {NextResponse, type NextRequest} from "next/server";
import {z} from "zod";
import {parseServerEnv} from "@/lib/env/server";
import {
  CONSENT_POLICY_VERSION,
  normalizeConsentPreferences,
  PRIVACY_COOKIE_NAME,
  signConsentCookie,
  verifyConsentCookie,
} from "@/modules/privacy/consent";
import {
  type PrivacyConsentRepository,
  SupabasePrivacyConsentRepository,
} from "@/modules/privacy/consent-repository";

const consentRequestSchema = z.strictObject({
  analytics: z.boolean(),
  advertising: z.boolean(),
  gpcDetected: z.boolean(),
  source: z.enum(["banner", "preferences", "gpc"]),
});

type PrivacyConsentDependencies = {
  signingSecret: string | undefined;
  deploymentEnvironment: "development" | "preview" | "test" | "production";
  requestIp: string;
  now: () => Date;
  createId: () => string;
  repository: PrivacyConsentRepository;
};

function unavailable() {
  return NextResponse.json(
    {error: "Privacy consent is temporarily unavailable"},
    {status: 503, headers: {"cache-control": "no-store"}},
  );
}

function hasUsableSigningSecret(secret: string | undefined) {
  return Boolean(secret && Buffer.byteLength(secret, "utf8") >= 32);
}

function readConsentCookie(request: NextRequest) {
  const nextCookies = (request as Partial<NextRequest>).cookies;
  if (nextCookies) return nextCookies.get(PRIVACY_COOKIE_NAME)?.value;
  const encodedName = `${PRIVACY_COOKIE_NAME}=`;
  return request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(encodedName))?.slice(encodedName.length);
}

export async function handlePrivacyConsentRequest(
  request: NextRequest,
  dependencies: PrivacyConsentDependencies,
) {
  const parsed = consentRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {error: "Invalid privacy consent"},
      {status: 400, headers: {"cache-control": "no-store"}},
    );
  }
  const signingSecret = dependencies.signingSecret;
  if (!signingSecret || !hasUsableSigningSecret(signingSecret)) return unavailable();
  const existingConsent = verifyConsentCookie(
    readConsentCookie(request),
    signingSecret,
  );
  const consentId = existingConsent?.consentId ?? dependencies.createId();
  const gpcDetected = parsed.data.gpcDetected || request.headers.get("sec-gpc") === "1";
  const preferences = normalizeConsentPreferences(parsed.data, gpcDetected);
  const occurredAt = dependencies.now().toISOString();
  const consent = {
    policyVersion: CONSENT_POLICY_VERSION,
    consentId,
    preferences,
    gpcDetected,
    updatedAt: occurredAt,
  };

  try {
    await dependencies.repository.record({
      evidenceId: dependencies.createId(),
      consentId,
      policyVersion: CONSENT_POLICY_VERSION,
      preferences,
      gpcDetected,
      source: parsed.data.source,
      requestIp: dependencies.requestIp,
      userAgent: request.headers.get("user-agent") ?? "",
      occurredAt,
    });
  } catch {
    return unavailable();
  }

  const response = NextResponse.json(
    {consent},
    {headers: {"cache-control": "no-store"}},
  );
  response.cookies.set({
    name: PRIVACY_COOKIE_NAME,
    value: signConsentCookie(consent, signingSecret),
    httpOnly: true,
    secure: dependencies.deploymentEnvironment === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 15_552_000,
  });
  return response;
}

export async function POST(request: NextRequest) {
  try {
    const environment = parseServerEnv(process.env);
    const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    return await handlePrivacyConsentRequest(request, {
      signingSecret: environment.PRIVACY_CONSENT_SIGNING_SECRET,
      deploymentEnvironment: environment.DEPLOYMENT_ENV,
      requestIp: forwardedFor,
      now: () => new Date(),
      createId: randomUUID,
      repository: new SupabasePrivacyConsentRepository(),
    });
  } catch {
    return unavailable();
  }
}

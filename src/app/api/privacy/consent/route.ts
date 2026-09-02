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
  type CurrentPrivacyConsentRepository,
  type PrivacyConsentRepository,
  SupabasePrivacyConsentRepository,
} from "@/modules/privacy/consent-repository";
import {
  requestHasGlobalPrivacyControl,
  resolveCurrentVerifiedConsent,
} from "@/modules/privacy/current-consent";

const consentRequestSchema = z.strictObject({
  analytics: z.boolean(),
  advertising: z.boolean(),
  gpcDetected: z.boolean(),
  source: z.enum(["banner", "preferences", "gpc"]),
});
const CONSENT_WRITE_LIMIT = 12;
const CONSENT_WRITE_WINDOW_MS = 60 * 60 * 1000;

type PrivacyConsentDependencies = {
  signingSecret: string | undefined;
  deploymentEnvironment: "development" | "preview" | "test" | "production";
  requestIp: string;
  now: () => Date;
  createId: () => string;
  repository: PrivacyConsentRepository;
};

type PrivacyConsentStatusDependencies = {
  signingSecret: string | undefined;
  deploymentEnvironment: "development" | "preview" | "test" | "production";
  requestIp: string | null;
  now: () => Date;
  createId: () => string;
  repository: CurrentPrivacyConsentRepository;
};

function unavailable() {
  return NextResponse.json(
    {error: "Privacy consent is temporarily unavailable"},
    {status: 503, headers: {"cache-control": "no-store"}},
  );
}

function unavailableStatus() {
  return NextResponse.json(
    {consent: null},
    {headers: {"cache-control": "no-store"}},
  );
}

function forbidden() {
  return NextResponse.json(
    {error: "Invalid request origin"},
    {status: 403, headers: {"cache-control": "no-store"}},
  );
}

function rateLimited() {
  return NextResponse.json(
    {error: "Privacy consent request limit exceeded"},
    {status: 429, headers: {"cache-control": "no-store", "retry-after": "3600"}},
  );
}

function isSameOriginRequest(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === origin && origin === new URL(request.url).origin;
  } catch {
    return false;
  }
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

function setConsentCookie(
  response: NextResponse,
  consent: {
    policyVersion: typeof CONSENT_POLICY_VERSION;
    consentId: string;
    preferences: ReturnType<typeof normalizeConsentPreferences>;
    gpcDetected: boolean;
    updatedAt: string;
  },
  signingSecret: string,
  deploymentEnvironment: PrivacyConsentDependencies["deploymentEnvironment"],
) {
  response.cookies.set({
    name: PRIVACY_COOKIE_NAME,
    value: signConsentCookie(consent, signingSecret),
    httpOnly: true,
    secure: deploymentEnvironment === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 15_552_000,
  });
}

function failClosedConsent(
  consent: ReturnType<typeof verifyConsentCookie>,
  gpcDetected: boolean,
  updatedAt: string,
) {
  if (!consent) return null;
  return {
    ...consent,
    preferences: normalizeConsentPreferences(
      {...consent.preferences, advertising: false},
      gpcDetected || consent.gpcDetected,
    ),
    gpcDetected: gpcDetected || consent.gpcDetected,
    updatedAt: gpcDetected ? updatedAt : consent.updatedAt,
  };
}

/**
 * Same-origin browser status boundary. A local signed cookie authenticates an
 * identity, but only PIW's unlinked canonical preference may re-enable
 * Advertising. Missing, divergent, or unavailable canonical state is a
 * usable no-store denial rather than a business-flow error.
 */
export async function handlePrivacyConsentStatusRequest(
  request: NextRequest,
  dependencies: PrivacyConsentStatusDependencies,
) {
  const signingSecret = dependencies.signingSecret;
  if (!signingSecret || !hasUsableSigningSecret(signingSecret)) return unavailableStatus();
  const token = readConsentCookie(request);
  const localConsent = verifyConsentCookie(token, signingSecret);
  if (!localConsent) return unavailableStatus();

  const gpcDetected = requestHasGlobalPrivacyControl(request.headers);
  const observedAt = dependencies.now().toISOString();
  if (gpcDetected) {
    try {
      const existing = await dependencies.repository.readCurrent({
        consentId: localConsent.consentId,
        policyVersion: localConsent.policyVersion,
      });
      if (!existing?.gpcDetected) {
        await dependencies.repository.record({
          evidenceId: dependencies.createId(),
          consentId: localConsent.consentId,
          policyVersion: localConsent.policyVersion,
          preferences: normalizeConsentPreferences(localConsent.preferences, true),
          gpcDetected: true,
          source: "gpc",
          requestIp: dependencies.requestIp,
          userAgent: request.headers.get("user-agent") ?? "",
          occurredAt: observedAt,
        });
      }
    } catch {
      return NextResponse.json(
        {consent: failClosedConsent(localConsent, true, observedAt)},
        {headers: {"cache-control": "no-store"}},
      );
    }
  }
  const current = await resolveCurrentVerifiedConsent({
    consentToken: token,
    signingSecret,
    gpcDetected,
    now: () => new Date(observedAt),
    repository: dependencies.repository,
  });
  const consent = current ?? failClosedConsent(
    localConsent,
    gpcDetected,
    observedAt,
  );
  if (!consent) return unavailableStatus();

  const response = NextResponse.json(
    {consent},
    {headers: {"cache-control": "no-store"}},
  );
  if (current) {
    setConsentCookie(
      response,
      current,
      signingSecret,
      dependencies.deploymentEnvironment,
    );
  }
  return response;
}

export async function handlePrivacyConsentRequest(
  request: NextRequest,
  dependencies: PrivacyConsentDependencies,
) {
  if (!isSameOriginRequest(request)) return forbidden();
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
    const writeAllowed = dependencies.repository.isWriteAllowed
      ? await dependencies.repository.isWriteAllowed({
          consentId,
          since: new Date(dependencies.now().getTime() - CONSENT_WRITE_WINDOW_MS).toISOString(),
          limit: CONSENT_WRITE_LIMIT,
        })
      : true;
    if (!writeAllowed) {
      const current = "readCurrent" in dependencies.repository
        ? await (dependencies.repository as CurrentPrivacyConsentRepository).readCurrent({
            consentId,
            policyVersion: CONSENT_POLICY_VERSION,
          })
        : null;
      const isCurrentGrantRevocation = !preferences.advertising
        && current?.preferences.advertising === true;
      if (!isCurrentGrantRevocation) return rateLimited();
    }
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
  setConsentCookie(response, consent, signingSecret, dependencies.deploymentEnvironment);
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

export async function GET(request: NextRequest) {
  try {
    const environment = parseServerEnv(process.env);
    const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    return await handlePrivacyConsentStatusRequest(request, {
      signingSecret: environment.PRIVACY_CONSENT_SIGNING_SECRET,
      deploymentEnvironment: environment.DEPLOYMENT_ENV,
      requestIp: forwardedFor,
      now: () => new Date(),
      createId: randomUUID,
      repository: new SupabasePrivacyConsentRepository(),
    });
  } catch {
    return unavailableStatus();
  }
}

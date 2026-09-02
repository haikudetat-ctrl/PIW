import {createHash, randomUUID, timingSafeEqual} from "node:crypto";
import {NextResponse, type NextRequest} from "next/server";
import {parseServerEnv} from "@/lib/env/server";
import {
  normalizeConsentPreferences,
  verifyConsentCookie,
  type VerifiedConsent,
} from "@/modules/privacy/consent";
import {
  type CurrentPrivacyConsentRepository,
  SupabasePrivacyConsentRepository,
} from "@/modules/privacy/consent-repository";

const MAX_FUTURE_CONSENT_SKEW_MS = 30 * 1000;
const CONSENT_WRITE_LIMIT = 12;
const CONSENT_WRITE_WINDOW_MS = 60 * 60 * 1000;

export type CurrentPrivacyConsentSyncDependencies = {
  signingSecret: string | undefined;
  expectedSharedSecret: string | undefined;
  now: () => Date;
  createId: () => string;
  isAllowedWebsiteOrigin(origin: string): boolean;
  repository: CurrentPrivacyConsentRepository;
};

function unavailable(status = 503) {
  return NextResponse.json(
    {error: "Privacy consent is unavailable"},
    {status, headers: {"cache-control": "no-store"}},
  );
}

function rateLimited() {
  return NextResponse.json(
    {error: "Privacy consent request limit exceeded"},
    {status: 429, headers: {"cache-control": "no-store", "retry-after": "3600"}},
  );
}

function secretsMatch(actual: string, expected: string | undefined) {
  if (!expected || !actual) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

function validCurrentTimestamp(value: string, now: Date) {
  const time = Date.parse(value);
  return !Number.isNaN(time) && time <= now.getTime() + MAX_FUTURE_CONSENT_SKEW_MS;
}

function hasGlobalPrivacyControl(request: NextRequest) {
  return request.headers.get("sec-gpc") === "1";
}

function applyGpc(consent: VerifiedConsent, detected: boolean, updatedAt: string): VerifiedConsent {
  if (!detected) return consent;
  return {
    ...consent,
    preferences: normalizeConsentPreferences(consent.preferences, true),
    gpcDetected: true,
    updatedAt,
  };
}

function originIsAllowed(origin: string | null, dependencies: CurrentPrivacyConsentSyncDependencies) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return false;
    }
  } catch {
    return false;
  }
  return dependencies.isAllowedWebsiteOrigin(origin);
}

/**
 * Authenticated server-to-server boundary for the website's opaque consent token.
 * It returns a minimal canonical snapshot and never accepts contact, lead, property,
 * quote, attribution, or browser identifiers.
 */
export async function handleCurrentPrivacyConsentSyncRequest(
  request: NextRequest,
  dependencies: CurrentPrivacyConsentSyncDependencies,
) {
  const origin = request.headers.get("origin");
  const token = request.headers.get("x-piw-privacy-consent") ?? "";
  const upstreamSecret = request.headers.get("x-all-season-intake-secret") ?? "";
  if (
    !originIsAllowed(origin, dependencies)
    || !secretsMatch(upstreamSecret, dependencies.expectedSharedSecret)
    || !dependencies.signingSecret
  ) return unavailable(403);

  const verified = verifyConsentCookie(token, dependencies.signingSecret);
  if (!verified) return unavailable(403);

  const now = dependencies.now();
  if (Number.isNaN(now.getTime()) || !validCurrentTimestamp(verified.updatedAt, now)) {
    return unavailable(403);
  }
  const candidate = applyGpc(
    verified,
    hasGlobalPrivacyControl(request),
    hasGlobalPrivacyControl(request) ? now.toISOString() : verified.updatedAt,
  );

  try {
    const current = await dependencies.repository.readCurrent({
      consentId: candidate.consentId,
      policyVersion: candidate.policyVersion,
    });
    const currentTime = current ? Date.parse(current.updatedAt) : Number.NEGATIVE_INFINITY;
    const candidateTime = Date.parse(candidate.updatedAt);
    const equalTimeCandidateDenies = currentTime === candidateTime
      && current?.preferences.advertising === true
      && candidate.preferences.advertising === false;
    if (current && currentTime >= candidateTime && !equalTimeCandidateDenies) {
      return NextResponse.json({consent: current}, {headers: {"cache-control": "no-store"}});
    }

    const writeAllowed = dependencies.repository.isWriteAllowed
      ? await dependencies.repository.isWriteAllowed({
          consentId: candidate.consentId,
          since: new Date(now.getTime() - CONSENT_WRITE_WINDOW_MS).toISOString(),
          limit: CONSENT_WRITE_LIMIT,
        })
      : true;
    if (!writeAllowed) {
      const isCurrentGrantRevocation = !candidate.preferences.advertising
        && current?.preferences.advertising === true;
      if (!isCurrentGrantRevocation) return rateLimited();
    }

    await dependencies.repository.record({
      evidenceId: dependencies.createId(),
      consentId: candidate.consentId,
      policyVersion: candidate.policyVersion,
      preferences: candidate.preferences,
      gpcDetected: candidate.gpcDetected,
      source: candidate.gpcDetected ? "gpc" : "preferences",
      requestIp: null,
      userAgent: "",
      occurredAt: candidate.updatedAt,
    });
    const synchronized = await dependencies.repository.readCurrent({
      consentId: candidate.consentId,
      policyVersion: candidate.policyVersion,
    });
    if (!synchronized) return unavailable();
    return NextResponse.json({consent: synchronized}, {headers: {"cache-control": "no-store"}});
  } catch {
    return unavailable();
  }
}

function allowedAllSeasonWebsiteOrigin(origin: string, environment: "development" | "preview" | "test" | "production") {
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:") {
    return environment !== "production"
      && parsed.protocol === "http:"
      && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  }
  if (["allseasonsolar.net", "www.allseasonsolar.net"].includes(parsed.hostname)) return true;
  return environment !== "production" && parsed.hostname.endsWith(".vercel.app");
}

export async function POST(request: NextRequest) {
  try {
    const environment = parseServerEnv(process.env);
    return await handleCurrentPrivacyConsentSyncRequest(request, {
      signingSecret: environment.PRIVACY_CONSENT_SIGNING_SECRET,
      expectedSharedSecret: environment.ALL_SEASON_INTAKE_SHARED_SECRET,
      now: () => new Date(),
      createId: randomUUID,
      isAllowedWebsiteOrigin: (origin) => allowedAllSeasonWebsiteOrigin(origin, environment.DEPLOYMENT_ENV),
      repository: new SupabasePrivacyConsentRepository(),
    });
  } catch {
    return unavailable();
  }
}

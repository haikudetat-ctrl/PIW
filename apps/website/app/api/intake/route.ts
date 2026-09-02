import {NextRequest, NextResponse} from "next/server";
import {z} from "zod";
import {
  PRIVACY_COOKIE_NAME,
  readWebsiteConsent,
  signWebsiteConsent,
  type VerifiedWebsiteConsent,
} from "../../../lib/privacy-consent";
import {
  applyWebsiteGlobalPrivacyControl,
  currentCanonicalWebsiteConsent,
  resolveCanonicalWebsiteConsent,
} from "../../../lib/canonical-privacy-consent";

const leadSchema = z.object({
  submission_id: z.uuid(),
  name: z.string().trim().min(1).max(160),
  email: z.email(),
  phone: z.string().trim().min(7).max(40),
  address: z.string().trim().min(5).max(500),
  google_place_id: z.string().trim().min(1).max(500).optional(),
  project_interest: z.enum(["roofing", "solar", "both"]),
  consent_to_contact: z.literal(true),
  consent_to_process_property: z.literal(true),
  fbclid: z.string().trim().max(500).nullish(),
});

const leadMetaEventSchema = z.strictObject({
  name: z.literal("Lead"),
  eventId: z.uuid(),
  issuedAt: z.iso.datetime({offset: true}),
});

const acceptedResponseSchema = z.strictObject({
  accepted: z.literal(true),
  leadId: z.uuid().optional(),
  duplicate: z.boolean().optional(),
  metaEvent: leadMetaEventSchema.nullable(),
});

type ForwardLead = (
  payload: Record<string, unknown>,
  options?: {consentToken: string},
) => Promise<Response>;

type ResolveCanonicalConsent = (input: {
  request: NextRequest;
  localConsent: VerifiedWebsiteConsent;
}) => Promise<VerifiedWebsiteConsent | null>;

function requestHasGpc(request: NextRequest) {
  return request.headers.get("sec-gpc") === "1" || request.headers.get("x-all-season-gpc") === "1";
}

async function currentConsentForTracking({
  request,
  localConsent,
  resolveCanonical,
}: {
  request: NextRequest;
  localConsent: VerifiedWebsiteConsent | null;
  resolveCanonical: ResolveCanonicalConsent | undefined;
}) {
  if (!localConsent || !resolveCanonical) return null;
  const candidate = applyWebsiteGlobalPrivacyControl(
    localConsent,
    requestHasGpc(request),
    requestHasGpc(request) ? new Date().toISOString() : localConsent.updatedAt,
  );
  try {
    return currentCanonicalWebsiteConsent(candidate, await resolveCanonical({request, localConsent: candidate}));
  } catch {
    return null;
  }
}

export async function handleIntakeRequest(
  request: NextRequest,
  forward: ForwardLead,
  privacySigningSecret = process.env.PRIVACY_CONSENT_SIGNING_SECRET,
  resolveCanonical?: ResolveCanonicalConsent,
) {
  const parsed = leadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({error: "Invalid lead submission"}, {status: 400});
  }

  const consentToken = request.cookies.get(PRIVACY_COOKIE_NAME)?.value;
  const verifiedConsent = privacySigningSecret
    ? readWebsiteConsent(consentToken, privacySigningSecret)
    : null;
  const canonicalConsent = await currentConsentForTracking({
    request,
    localConsent: verifiedConsent,
    resolveCanonical,
  });
  const advertisingAllowed = canonicalConsent?.preferences.advertising === true;
  const canonicalConsentToken = canonicalConsent && privacySigningSecret
    ? signWebsiteConsent(canonicalConsent, privacySigningSecret)
    : null;
  const payload = {
    ...parsed.data,
    attribution: {
      fbclid: parsed.data.fbclid ?? null,
      fbp: advertisingAllowed ? request.cookies.get("_fbp")?.value ?? null : null,
      fbc: advertisingAllowed ? request.cookies.get("_fbc")?.value ?? null : null,
    },
    source: "all-season-website",
    submittedAt: new Date().toISOString(),
  };

  const upstream = await (canonicalConsentToken
    ? forward(payload, {consentToken: canonicalConsentToken})
    : forward(payload)).catch(() => null);
  if (!upstream?.ok) {
    return NextResponse.json({error: "Lead intake is temporarily unavailable"}, {status: 502});
  }

  const accepted = acceptedResponseSchema.safeParse(
    await upstream.json().catch(() => null),
  );
  if (!accepted.success) {
    return NextResponse.json({error: "Lead intake is temporarily unavailable"}, {status: 502});
  }

  return NextResponse.json({
    accepted: true,
    metaEvent: accepted.data.metaEvent,
  }, {status: 202});
}

export async function POST(request: NextRequest) {
  const webhookUrl = process.env.INTAKE_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({error: "Lead intake is not configured"}, {status: 503});
  }

  return handleIntakeRequest(request, (payload, options) =>
    fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.INTAKE_WEBHOOK_SHARED_SECRET
          ? {"x-all-season-intake-secret": process.env.INTAKE_WEBHOOK_SHARED_SECRET}
          : {}),
        ...(options?.consentToken
          ? {"x-piw-privacy-consent": options.consentToken}
          : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    }),
    process.env.PRIVACY_CONSENT_SIGNING_SECRET,
    ({localConsent}) => resolveCanonicalWebsiteConsent({
      consent: localConsent,
      signingSecret: process.env.PRIVACY_CONSENT_SIGNING_SECRET,
      sharedSecret: process.env.INTAKE_WEBHOOK_SHARED_SECRET,
      publicPiwUrl: process.env.PIW_PUBLIC_APP_URL,
      websiteOrigin: request.nextUrl.origin,
      nodeEnv: process.env.NODE_ENV,
    }),
  );
}

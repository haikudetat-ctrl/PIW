import {NextRequest, NextResponse} from "next/server";
import {z} from "zod";
import {
  createConsentHandoff,
  PRIVACY_COOKIE_NAME,
  readWebsiteConsent,
} from "../../../lib/privacy-consent";
import {campaignSlugs} from "../../campaigns/campaigns";

const optionalAttribution = z.string().trim().max(500).nullish();
const browserEvidenceSchema = z.strictObject({
  clientIpAddress: z.union([z.ipv4(), z.ipv6()]),
  clientUserAgent: z.string().trim().min(1).max(1_000),
  referrer: z.url().max(2_000).nullable(),
  fbp: optionalAttribution,
  fbc: optionalAttribution,
});
const campaignEstimateSchema = z.object({
  submission_id: z.uuid(),
  campaign: z.enum(campaignSlugs).nullable(),
  presentation_key: z.enum(["all-season-main", ...campaignSlugs]),
  entry_point: z.enum([
    "main-home",
    "main-contact",
    "main-drawer",
    ...campaignSlugs.map((campaign) => `campaign:${campaign}` as const),
  ]),
  name: z.string().trim().min(2).max(160),
  email: z.email().max(320),
  phone: z.string().trim().min(7).max(40),
  address: z.string().trim().min(5).max(500),
  google_place_id: z.string().trim().min(1).max(300).nullish(),
  address_line_1: z.string().trim().min(3).max(200).optional(),
  address_line_2: z.string().trim().max(200).nullish(),
  city: z.string().trim().min(2).max(100).optional(),
  state: z.literal("NJ").optional(),
  postal_code: z.string().trim().optional(),
  consent_to_contact: z.literal(true),
  consent_to_process_property: z.literal(true),
  utm_source: optionalAttribution,
  utm_medium: optionalAttribution,
  utm_campaign: optionalAttribution,
  utm_content: optionalAttribution,
  utm_term: optionalAttribution,
  fbclid: optionalAttribution,
}).strict().superRefine((input, context) => {
  if (input.google_place_id) return;

  if (!input.address_line_1) {
    context.addIssue({code: "custom", path: ["address_line_1"], message: "Street address is required"});
  }
  if (!input.city) {
    context.addIssue({code: "custom", path: ["city"], message: "City is required"});
  }
  if (input.state !== "NJ") {
    context.addIssue({code: "custom", path: ["state"], message: "State must be NJ"});
  }
  if (!/^\d{5}(?:-\d{4})?$/.test(input.postal_code ?? "")) {
    context.addIssue({code: "custom", path: ["postal_code"], message: "A valid New Jersey ZIP code is required"});
  }
}).superRefine((input, context) => {
  if (input.entry_point.startsWith("campaign:")) {
    const routeCampaign = input.entry_point.slice("campaign:".length);
    if (input.campaign !== routeCampaign || input.presentation_key !== routeCampaign) {
      context.addIssue({code: "custom", path: ["entry_point"], message: "Campaign context must match"});
    }
    return;
  }
  if (input.campaign !== null || input.presentation_key !== "all-season-main") {
    context.addIssue({code: "custom", path: ["presentation_key"], message: "Main-site context must match"});
  }
});

const acceptedResponseSchema = z.strictObject({
  accepted: z.literal(true),
  continuationPath: z.string().regex(/^\/roof-estimate\/continue\/[A-Za-z0-9_-]+$/),
  metaEvent: z.strictObject({
    name: z.literal("Lead"),
    eventId: z.uuid(),
    issuedAt: z.iso.datetime({offset: true}),
  }).nullable().optional(),
});

type ForwardEstimate = (
  payload: Record<string, unknown>,
  options?: {consentToken: string},
) => Promise<Response>;

function nullable(value: string | null | undefined) {
  return value || null;
}

function manualAddress(input: z.infer<typeof campaignEstimateSchema>) {
  return [
    input.address_line_1,
    input.address_line_2,
    input.city,
    input.state && input.postal_code ? `${input.state} ${input.postal_code}` : undefined,
  ].filter(Boolean).join(", ");
}

async function jsonObject(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>;
}

function noStoreJson(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {"cache-control": "no-store"},
  });
}

function configuredPiwOrigin(
  value: string,
  nodeEnv: "development" | "test" | "production",
) {
  try {
    const url = new URL(value);
    if (
      url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
    ) return null;
    if (url.protocol === "https:") return url.origin;
    const localhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (nodeEnv !== "production" && url.protocol === "http:" && localhost) return url.origin;
    return null;
  } catch {
    return null;
  }
}

export async function handleCampaignEstimateRequest(
  request: NextRequest,
  forward: ForwardEstimate,
  publicAppUrl: string,
  nodeEnv: "development" | "test" | "production" = "development",
  privacySigningSecret = process.env.PRIVACY_CONSENT_SIGNING_SECRET,
  now: () => Date = () => new Date(),
) {
  const parsed = campaignEstimateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return noStoreJson({error: "Invalid estimate submission"}, 400);
  }

  const input = parsed.data;
  const consentToken = request.cookies.get(PRIVACY_COOKIE_NAME)?.value;
  const verifiedConsent = privacySigningSecret
    ? readWebsiteConsent(consentToken, privacySigningSecret)
    : null;
  const advertisingAllowed = verifiedConsent?.preferences.advertising === true;
  const evidence = browserEvidenceSchema.safeParse({
    clientIpAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    clientUserAgent: request.headers.get("user-agent")?.trim(),
    referrer: request.headers.get("referer"),
    fbp: advertisingAllowed ? request.cookies.get("_fbp")?.value : null,
    fbc: advertisingAllowed ? request.cookies.get("_fbc")?.value : null,
  });
  if (!evidence.success) {
    return noStoreJson({error: "Invalid estimate submission"}, 400);
  }
  const origin = configuredPiwOrigin(publicAppUrl, nodeEnv);
  if (!origin) {
    return noStoreJson({error: "Estimate intake is temporarily unavailable"}, 502);
  }
  const payload = {
    submission_id: input.submission_id,
    campaign: input.campaign,
    presentation_key: input.presentation_key,
    entry_point: input.entry_point,
    name: input.name,
    email: input.email,
    phone: input.phone,
    address: input.google_place_id ? input.address : manualAddress(input),
    google_place_id: input.google_place_id ?? null,
    address_line_1: input.address_line_1,
    address_line_2: input.address_line_2,
    city: input.city,
    state: input.state,
    postal_code: input.postal_code,
    consent_to_contact: input.consent_to_contact,
    consent_to_process_property: input.consent_to_process_property,
    client_ip_address: evidence.data.clientIpAddress,
    client_user_agent: evidence.data.clientUserAgent,
    attribution: {
      utm_source: nullable(input.utm_source),
      utm_medium: nullable(input.utm_medium),
      utm_campaign: nullable(input.utm_campaign),
      utm_content: nullable(input.utm_content),
      utm_term: nullable(input.utm_term),
      fbclid: nullable(input.fbclid),
      fbp: nullable(evidence.data.fbp),
      fbc: nullable(evidence.data.fbc),
    },
    referrer: evidence.data.referrer,
    disclosure_version: "all-season-campaign-estimate-v1",
    source: "all-season-campaign",
    submittedAt: new Date().toISOString(),
  };

  const upstream = await (verifiedConsent && consentToken
    ? forward(payload, {consentToken})
    : forward(payload)).catch(() => null);
  if (!upstream) {
    return noStoreJson({error: "Estimate intake is temporarily unavailable"}, 502);
  }

  if (upstream.status === 400) {
    return noStoreJson({error: "Invalid estimate submission"}, 400);
  }

  if (upstream.status === 409) {
    return noStoreJson(
      {error: "Please restart this estimate request.", retryable: true},
      409,
    );
  }

  if (!upstream.ok) {
    return noStoreJson({error: "Estimate intake is temporarily unavailable"}, 502);
  }

  const accepted = acceptedResponseSchema.safeParse(await jsonObject(upstream));
  if (!accepted.success) {
    return noStoreJson({error: "Estimate intake is temporarily unavailable"}, 502);
  }
  const continuationPath = accepted.data.continuationPath;
  const estimateUrl = new URL(continuationPath, `${origin}/`);

  if (verifiedConsent && privacySigningSecret) {
    const continuation = continuationPath.slice(
      "/roof-estimate/continue/".length,
    );
    const privacyHandoff = await createConsentHandoff({
      consentId: verifiedConsent.consentId,
      policyVersion: verifiedConsent.policyVersion,
      analytics: verifiedConsent.preferences.analytics,
      advertising: verifiedConsent.preferences.advertising,
      gpc: verifiedConsent.gpcDetected,
      issuedAt: now().toISOString(),
    }, continuation, privacySigningSecret);
    estimateUrl.searchParams.set("privacy_handoff", privacyHandoff);
  }

  return noStoreJson({
    accepted: true,
    estimateUrl: estimateUrl.toString(),
    metaEvent: accepted.data.metaEvent ?? null,
  }, 202);
}

export async function POST(request: NextRequest) {
  const webhookUrl = process.env.CAMPAIGN_ESTIMATE_WEBHOOK_URL;
  const sharedSecret = process.env.INTAKE_WEBHOOK_SHARED_SECRET;
  const publicAppUrl = process.env.PIW_PUBLIC_APP_URL;
  if (!webhookUrl || !sharedSecret || !publicAppUrl) {
    return noStoreJson({error: "Estimate intake is not configured"}, 503);
  }

  return handleCampaignEstimateRequest(
    request,
    (payload, options) => fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-all-season-intake-secret": sharedSecret,
        ...(options?.consentToken
          ? {"x-piw-privacy-consent": options.consentToken}
          : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    }),
    publicAppUrl,
    process.env.NODE_ENV,
  );
}

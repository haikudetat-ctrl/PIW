import {NextResponse, type NextRequest} from "next/server";
import {z} from "zod";
import {campaignSlugs} from "../../campaigns/campaigns";
import {PRIVACY_COOKIE_NAME, readWebsiteConsent} from "../../../lib/privacy-consent";
import {trustedPiwOidcHeaders} from "../../../lib/vercel-protection";

// Value-first address step. Forwards only what the homeowner entered plus the
// browser evidence this server observed; PIW verifies Turnstile and creates
// the preview. The website's signed consent token travels with it so PIW can
// apply the visitor's current consent at conversion on the estimate host.

const optionalAttribution = z.string().trim().max(500).nullish();
const requestSchema = z.strictObject({
  address: z.string().trim().min(5).max(500),
  google_place_id: z.string().trim().min(1).max(300).nullable(),
  campaign: z.enum(campaignSlugs).nullable(),
  entry_point: z.enum([
    "main-home",
    "main-contact",
    "main-drawer",
    ...campaignSlugs.map((campaign) => `campaign:${campaign}` as const),
  ]),
  presentation_key: z.enum(["all-season-main", ...campaignSlugs]),
  turnstile_token: z.string().min(1).max(2048),
  utm_source: optionalAttribution,
  utm_medium: optionalAttribution,
  utm_campaign: optionalAttribution,
  utm_term: optionalAttribution,
  utm_content: optionalAttribution,
  fbclid: optionalAttribution,
}).superRefine((input, context) => {
  if (input.entry_point.startsWith("campaign:")) {
    const routeCampaign = input.entry_point.slice("campaign:".length);
    if (input.campaign !== routeCampaign || input.presentation_key !== routeCampaign) {
      context.addIssue({code: "custom", path: ["entry_point"], message: "Campaign context must match"});
    }
  } else if (input.campaign !== null || input.presentation_key !== "all-season-main") {
    context.addIssue({code: "custom", path: ["presentation_key"], message: "Main-site context must match"});
  }
});

const previewResponseSchema = z.strictObject({
  previewUrl: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && /^\/roof-estimate\/p\/[A-Za-z0-9_-]{43}$/.test(url.pathname);
  }),
});

type ForwardPreview = (payload: unknown, options: {consentToken: string | undefined}) => Promise<Response>;

const noStoreJson = (body: unknown, status: number) =>
  NextResponse.json(body, {status, headers: {"cache-control": "no-store"}});

const nullable = (value: string | null | undefined) => value ?? null;

export async function handlePropertyPreviewRequest(
  request: NextRequest,
  forward: ForwardPreview,
  privacySigningSecret = process.env.PRIVACY_CONSENT_SIGNING_SECRET,
) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({error: "Invalid address"}, 400);
  const input = parsed.data;

  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const userAgent = request.headers.get("user-agent")?.trim() ?? "";
  if (!z.union([z.ipv4(), z.ipv6()]).safeParse(clientIp).success || !userAgent) {
    return noStoreJson({error: "Invalid address"}, 400);
  }
  const referrer = request.headers.get("referer");

  const cookieToken = request.cookies.get(PRIVACY_COOKIE_NAME)?.value;
  const consentToken = cookieToken && privacySigningSecret && readWebsiteConsent(cookieToken, privacySigningSecret)
    ? cookieToken
    : undefined;

  const upstream = await forward({
    address: input.address,
    google_place_id: input.google_place_id,
    campaign: input.campaign,
    entry_point: input.entry_point,
    presentation_key: input.presentation_key,
    attribution: {
      utm_source: nullable(input.utm_source),
      utm_medium: nullable(input.utm_medium),
      utm_campaign: nullable(input.utm_campaign),
      utm_term: nullable(input.utm_term),
      utm_content: nullable(input.utm_content),
      fbclid: nullable(input.fbclid),
    },
    referrer: referrer && z.url().safeParse(referrer).success ? referrer.slice(0, 2000) : null,
    client_ip_address: clientIp,
    client_user_agent: userAgent.slice(0, 1000),
    turnstile_token: input.turnstile_token,
  }, {consentToken}).catch(() => null);

  if (!upstream) return noStoreJson({error: "unavailable"}, 502);
  if (upstream.status === 403) return noStoreJson({error: "challenge_failed"}, 403);
  if (upstream.status === 429) return noStoreJson({error: "rate_limited"}, 429);
  if (upstream.status === 503) return noStoreJson({error: "unavailable"}, 503);
  if (upstream.status !== 201) return noStoreJson({error: "unavailable"}, 502);

  const accepted = previewResponseSchema.safeParse(await upstream.json().catch(() => null));
  if (!accepted.success) return noStoreJson({error: "unavailable"}, 502);
  return noStoreJson({previewUrl: accepted.data.previewUrl}, 201);
}

export async function POST(request: NextRequest) {
  const webhookUrl = process.env.PROPERTY_PREVIEW_WEBHOOK_URL;
  const sharedSecret = process.env.INTAKE_WEBHOOK_SHARED_SECRET;
  if (process.env.NEXT_PUBLIC_PROPERTY_PREVIEW_ENABLED !== "true" || !webhookUrl || !sharedSecret) {
    return noStoreJson({error: "unavailable"}, 503);
  }
  return handlePropertyPreviewRequest(request, (payload, options) => fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-all-season-intake-secret": sharedSecret,
      ...(options.consentToken ? {"x-piw-privacy-consent": options.consentToken} : {}),
      ...trustedPiwOidcHeaders(request.headers),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  }));
}

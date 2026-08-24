import {NextRequest, NextResponse} from "next/server";
import {z} from "zod";

const campaignSlugs = [
  "do-it-right-once",
  "weather-report",
  "seasonal-shield",
  "for-every-season",
] as const;

const optionalAttribution = z.string().trim().max(500).nullish();
const campaignEstimateSchema = z.object({
  submission_id: z.uuid(),
  campaign: z.enum(campaignSlugs),
  name: z.string().trim().min(2).max(160),
  email: z.email().max(320),
  phone: z.string().trim().min(7).max(40),
  address: z.string().trim().min(5).max(500),
  google_place_id: z.string().trim().min(1).max(500).nullish(),
  address_line_1: z.string().trim().min(3).max(200).optional(),
  address_line_2: z.string().trim().max(200).nullish(),
  city: z.string().trim().min(2).max(100).optional(),
  state: z.string().trim().max(2).optional(),
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
});

const acceptedResponseSchema = z.object({
  accepted: z.literal(true),
  resultPath: z.string().optional(),
  publicToken: z.uuid().optional(),
});

type ForwardEstimate = (payload: Record<string, unknown>) => Promise<Response>;

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

function resultPath(result: z.infer<typeof acceptedResponseSchema>) {
  if (result.publicToken) return `/roof-estimate/${result.publicToken}`;
  const match = result.resultPath?.match(/^\/roof-estimate\/([0-9a-fA-F-]{36})$/);
  if (!match || !z.uuid().safeParse(match[1]).success) return null;
  return result.resultPath ?? null;
}

async function jsonObject(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>;
}

export async function handleCampaignEstimateRequest(
  request: NextRequest,
  forward: ForwardEstimate,
  publicAppUrl: string,
) {
  const parsed = campaignEstimateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({error: "Invalid estimate submission"}, {status: 400});
  }

  const input = parsed.data;
  const clientIpAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientUserAgent = request.headers.get("user-agent")?.trim();
  if (!clientIpAddress || !clientUserAgent) {
    return NextResponse.json({error: "Invalid estimate submission"}, {status: 400});
  }
  const payload = {
    ...input,
    address: input.google_place_id ? input.address : manualAddress(input),
    google_place_id: input.google_place_id ?? null,
    client_ip_address: clientIpAddress,
    client_user_agent: clientUserAgent,
    attribution: {
      utm_source: nullable(input.utm_source),
      utm_medium: nullable(input.utm_medium),
      utm_campaign: nullable(input.utm_campaign),
      utm_content: nullable(input.utm_content),
      utm_term: nullable(input.utm_term),
      fbclid: nullable(input.fbclid),
      fbp: request.cookies.get("_fbp")?.value ?? null,
      fbc: request.cookies.get("_fbc")?.value ?? null,
    },
    source: "all-season-campaign",
    submittedAt: new Date().toISOString(),
  };

  const upstream = await forward(payload).catch(() => null);
  if (!upstream) {
    return NextResponse.json({error: "Estimate intake is temporarily unavailable"}, {status: 502});
  }

  if (upstream.status === 400) {
    const body = await jsonObject(upstream);
    const error = z.object({error: z.string().trim().min(1).max(240)}).safeParse(body);
    return NextResponse.json(
      {error: error.success ? error.data.error : "Invalid estimate submission"},
      {status: 400},
    );
  }

  if (!upstream.ok) {
    return NextResponse.json({error: "Estimate intake is temporarily unavailable"}, {status: 502});
  }

  const accepted = acceptedResponseSchema.safeParse(await jsonObject(upstream));
  const path = accepted.success ? resultPath(accepted.data) : null;
  let estimateUrl: string | null = null;
  if (path) {
    try {
      estimateUrl = new URL(path, publicAppUrl).toString();
    } catch {
      estimateUrl = null;
    }
  }
  if (!estimateUrl) {
    return NextResponse.json({error: "Estimate intake is temporarily unavailable"}, {status: 502});
  }

  return NextResponse.json({accepted: true, estimateUrl}, {status: 202});
}

export async function POST(request: NextRequest) {
  const webhookUrl = process.env.CAMPAIGN_ESTIMATE_WEBHOOK_URL;
  const sharedSecret = process.env.INTAKE_WEBHOOK_SHARED_SECRET;
  const publicAppUrl = process.env.PIW_PUBLIC_APP_URL;
  if (!webhookUrl || !sharedSecret || !publicAppUrl) {
    return NextResponse.json({error: "Estimate intake is not configured"}, {status: 503});
  }

  return handleCampaignEstimateRequest(
    request,
    (payload) => fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-all-season-intake-secret": sharedSecret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    }),
    publicAppUrl,
  );
}

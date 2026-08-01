import {NextRequest, NextResponse} from "next/server";
import {z} from "zod";

const leadSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.email(),
  phone: z.string().trim().min(7).max(40),
  address: z.string().trim().min(5).max(500),
  fbclid: z.string().trim().max(500).nullish(),
});

type ForwardLead = (payload: Record<string, unknown>) => Promise<Response>;

export async function handleIntakeRequest(request: NextRequest, forward: ForwardLead) {
  const parsed = leadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({error: "Invalid lead submission"}, {status: 400});
  }

  const payload = {
    ...parsed.data,
    attribution: {
      fbclid: parsed.data.fbclid ?? null,
      fbp: request.cookies.get("_fbp")?.value ?? null,
      fbc: request.cookies.get("_fbc")?.value ?? null,
    },
    source: "rake-website",
    submittedAt: new Date().toISOString(),
  };

  const upstream = await forward(payload).catch(() => null);
  if (!upstream?.ok) {
    return NextResponse.json({error: "Lead intake is temporarily unavailable"}, {status: 502});
  }

  return NextResponse.json({accepted: true}, {status: 202});
}

export async function POST(request: NextRequest) {
  const webhookUrl = process.env.INTAKE_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({error: "Lead intake is not configured"}, {status: 503});
  }

  return handleIntakeRequest(request, (payload) =>
    fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.INTAKE_WEBHOOK_SHARED_SECRET
          ? {"x-rake-webhook-secret": process.env.INTAKE_WEBHOOK_SHARED_SECRET}
          : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    }),
  );
}

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createSmsWebhookStore, smsWebhookUrls } from "@/modules/sms/supabase-store";
import { isValidTwilioSignature } from "@/modules/sms/twilio";
import { handleStatusCallback } from "@/modules/sms/webhooks";

export const runtime = "nodejs";

// Delivery updates for texts sent from Rake (queued → sent → delivered/failed).
export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (process.env.SMS_ENABLED !== "true" || !authToken) {
    return new NextResponse("Texting is not enabled", { status: 404 });
  }
  const form = await request.formData().catch(() => null);
  if (!form) return new NextResponse("Bad request", { status: 400 });
  const params = Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));
  const urls = smsWebhookUrls(request.url, "/api/twilio/sms/status", process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (!isValidTwilioSignature(authToken, urls, params, request.headers.get("x-twilio-signature"))) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  await handleStatusCallback(params, createSmsWebhookStore(createServiceClient()));
  return new NextResponse(null, { status: 204 });
}

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createSmsWebhookStore, smsWebhookUrls } from "@/modules/sms/supabase-store";
import { isValidTwilioSignature } from "@/modules/sms/twilio";
import { handleInboundSms } from "@/modules/sms/webhooks";
import {resolveSmsClient} from "@/modules/sms/client-config";

export const runtime = "nodejs";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// Twilio Messaging Service inbound webhook: a lead texted the company number.
export async function POST(request: NextRequest) {
  // Outbound's kill switch must not discard inbound opt-outs.
  const form = await request.formData().catch(() => null);
  if (!form) return new NextResponse("Bad request", { status: 400 });
  const params = Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));
  const client = resolveSmsClient({accountSid: params.AccountSid ?? ""});
  const urls = smsWebhookUrls(request.url, "/api/twilio/sms", process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (!client || !isValidTwilioSignature(client.authToken, urls, params, request.headers.get("x-twilio-signature"))) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  await handleInboundSms(params, createSmsWebhookStore(createServiceClient(), client.companyId));
  // Reply with nothing: Rake users answer from the conversation screen.
  return new NextResponse(EMPTY_TWIML, { status: 200, headers: { "content-type": "text/xml" } });
}

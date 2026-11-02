import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createSmsWebhookStore, smsWebhookUrls } from "@/modules/sms/supabase-store";
import { isValidTwilioSignature } from "@/modules/sms/twilio";
import { handleStatusCallback } from "@/modules/sms/webhooks";
import {z} from "zod";
import {mapTwilioStatus} from "@/modules/sms/rules";
import {resolveSmsClient} from "@/modules/sms/client-config";

export const runtime = "nodejs";

// Delivery updates for texts sent from Rake (queued → sent → delivered/failed).
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  if (!form) return new NextResponse("Bad request", { status: 400 });
  const params = Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));
  const client = resolveSmsClient({accountSid: params.AccountSid ?? ""});
  const query=new URL(request.url).search;
  const urls = smsWebhookUrls(request.url, "/api/twilio/sms/status"+query, process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (!client || !isValidTwilioSignature(client.authToken, urls, params, request.headers.get("x-twilio-signature"))) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const search=new URL(request.url).searchParams;
  if(search.has("delivery")||search.has("attempt")){
    const correlation=z.object({delivery:z.uuid(),attempt:z.uuid()}).safeParse({delivery:search.get("delivery"),attempt:search.get("attempt")});
    if(!correlation.success)return new NextResponse("Invalid correlation",{status:400});
    const status=mapTwilioStatus(params.MessageStatus??params.SmsStatus??"");
    if(!status)return new NextResponse(null,{status:204});
    const {error}=await createServiceClient().rpc("apply_approved_sms_callback",{
      p_company_id:client.companyId,p_delivery_id:correlation.data.delivery,p_token:correlation.data.attempt,
      p_sid:params.MessageSid??params.SmsSid??"",p_status:status,p_to:params.To??"",p_from:params.From??"",p_error_code:params.ErrorCode??"",
    });
    if(error)return new NextResponse("Status recording unavailable",{status:503});
    return new NextResponse(null,{status:204});
  }
  await handleStatusCallback(params, createSmsWebhookStore(createServiceClient(), client.companyId));
  return new NextResponse(null, { status: 204 });
}

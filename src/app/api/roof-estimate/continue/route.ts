import {randomUUID} from "node:crypto";
import {NextResponse, type NextRequest} from "next/server";
import {parseServerEnv} from "@/lib/env/server";
import {createServiceClient} from "@/lib/supabase/service";
import {createSupabaseContinuationAuthorizationDependencies} from "@/modules/roof-assessment/assessment-continuation";
import {handleContinuationExchange} from "@/modules/quote-chat/continuation-exchange";

export const runtime = "nodejs";

const notFound = () => NextResponse.json({error: "Not found"}, {status: 404, headers: {"cache-control": "no-store"}});

export async function POST(request: NextRequest) {
  try {
    const env = parseServerEnv(process.env);
    if (!env.ROOF_ASSESSMENT_SIGNING_SECRET) return notFound();
    return await handleContinuationExchange(request, {
      ...createSupabaseContinuationAuthorizationDependencies(createServiceClient(), env.ROOF_ASSESSMENT_SIGNING_SECRET),
      nodeEnv: env.NODE_ENV,
      privacySigningSecret: env.PRIVACY_CONSENT_SIGNING_SECRET,
      createConsentId: randomUUID,
    });
  } catch {
    return notFound();
  }
}

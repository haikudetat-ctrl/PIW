import {NextResponse, type NextRequest} from "next/server";
import {createServiceClient} from "@/lib/supabase/service";
import {loadChatEstimateSummary} from "@/modules/quote-chat/estimate-summary";

export const runtime = "nodejs";

const noStore = {"cache-control": "no-store"};

/** The price-first result for the quote chat. The estimate token is the capability, as on the estimate page. */
export async function GET(_request: NextRequest, context: {params: Promise<{token: string}>}) {
  const {token} = await context.params;
  try {
    const summary = await loadChatEstimateSummary(createServiceClient(), token);
    if (!summary) return NextResponse.json({error: "Not found"}, {status: 404, headers: noStore});
    return NextResponse.json(summary, {headers: noStore});
  } catch {
    return NextResponse.json({error: "unavailable"}, {status: 503, headers: noStore});
  }
}

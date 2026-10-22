import type {NextRequest} from "next/server";
import {createServiceClient} from "@/lib/supabase/service";
import {handleCallbackRequest} from "@/modules/quote-chat/callback";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: {params: Promise<{token: string}>}) {
  const {token} = await context.params;
  const client = createServiceClient();
  return handleCallbackRequest({
    token,
    body: await request.json().catch(() => null),
    repository: {
      async requestCallback({estimateToken, callWindow, dueAt}) {
        const {data, error} = await client.rpc("request_estimate_callback", {
          p_public_token: estimateToken,
          p_call_window: callWindow,
          p_due_at: dueAt.toISOString(),
        });
        if (error?.message === "Estimate not found") return null;
        if (error || !data?.[0]) throw new Error("Callback request failed");
        return {created: data[0].created};
      },
    },
  });
}

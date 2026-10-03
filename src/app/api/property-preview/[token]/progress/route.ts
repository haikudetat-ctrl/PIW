import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePreviewScope } from "@/modules/property-preview/request-scope";
import { resolvePublicHost } from "@/modules/tenancy/public-host";
import { createSupabasePublicHostLookup } from "@/modules/tenancy/supabase-public-host-lookup";

export const runtime = "nodejs";

// Server-side funnel timestamps (reveal shown, contact step shown). These are
// first-party records of the preview itself, so they cover every visitor
// regardless of analytics consent, and carry no form values.
const progressSchema = z.strictObject({step: z.enum(["revealed", "contact_viewed"])});

export async function POST(request: NextRequest, {params}: {params: Promise<{token: string}>}) {
  const {token} = await params;
  const service = createServiceClient();
  const lookup = createSupabasePublicHostLookup(service);
  const scope = await resolvePreviewScope(
    request.headers.get("host"),
    token,
    async (host) => (await resolvePublicHost(host, lookup))?.companyId ?? null,
  );
  const parsed = progressSchema.safeParse(await request.json().catch(() => null));
  if (scope && parsed.success) {
    await service.rpc("mark_property_preview_progress", {
      p_company_id: scope.companyId,
      p_token_hash: scope.tokenHash,
      p_step: parsed.data.step,
    });
  }
  // Always 204: progress beacons are best-effort and reveal nothing.
  return new NextResponse(null, {status: 204, headers: {"cache-control": "no-store"}});
}

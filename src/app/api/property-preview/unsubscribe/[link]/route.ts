import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { unsubscribePreviewEmail } from "@/modules/property-preview/email-link-handlers";
import { verifyPreviewLink } from "@/modules/property-preview/preview-links";
import { createSupabaseEmailLinkStore } from "@/modules/property-preview/supabase-email-links";
import { resolvePublicHost } from "@/modules/tenancy/public-host";
import { createSupabasePublicHostLookup } from "@/modules/tenancy/supabase-public-host-lookup";

export const runtime = "nodejs";

// POST only. Mail clients send RFC 8058 one-click requests here; the
// confirmation page's form posts here too. GET never unsubscribes, so link
// scanners can't.
export async function POST(request: NextRequest, {params}: {params: Promise<{link: string}>}) {
  const {link} = await params;
  const service = createServiceClient();
  const tenant = await resolvePublicHost(request.headers.get("host"), createSupabasePublicHostLookup(service));
  const secret = process.env.ROOF_ASSESSMENT_SIGNING_SECRET ?? "";
  if (tenant && secret) {
    await unsubscribePreviewEmail({link, companyId: tenant.companyId}, {
      verify: (value) => verifyPreviewLink("unsubscribe", value, secret),
      unsubscribe: createSupabaseEmailLinkStore(service).unsubscribe,
    });
  }

  const form = await request.formData().catch(() => null);
  if (form?.get("List-Unsubscribe") === "One-Click") {
    return new NextResponse(null, {status: 200, headers: {"cache-control": "no-store"}});
  }
  return NextResponse.redirect(new URL(`/roof-estimate/p/unsubscribe/${link}?done=1`, request.url), {
    status: 303,
    headers: {"cache-control": "no-store"},
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resumePreviewFromEmail } from "@/modules/property-preview/email-link-handlers";
import { verifyPreviewLink } from "@/modules/property-preview/preview-links";
import { issuePreviewToken } from "@/modules/property-preview/preview-token";
import { createSupabaseEmailLinkStore } from "@/modules/property-preview/supabase-email-links";
import { resolvePublicHost } from "@/modules/tenancy/public-host";
import { createSupabasePublicHostLookup } from "@/modules/tenancy/supabase-public-host-lookup";

export const runtime = "nodejs";

export async function GET(request: NextRequest, {params}: {params: Promise<{link: string}>}) {
  const {link} = await params;
  const service = createServiceClient();
  const tenant = await resolvePublicHost(request.headers.get("host"), createSupabasePublicHostLookup(service));
  const secret = process.env.ROOF_ASSESSMENT_SIGNING_SECRET ?? "";
  const path = tenant && secret
    ? await resumePreviewFromEmail({link, companyId: tenant.companyId}, {
        verify: (value) => verifyPreviewLink("resume", value, secret),
        issueToken: issuePreviewToken,
        rotate: createSupabaseEmailLinkStore(service).rotate,
      })
    : "/roof-estimate";
  return NextResponse.redirect(new URL(path, request.url), {
    status: 303,
    headers: {"cache-control": "no-store", "referrer-policy": "no-referrer"},
  });
}

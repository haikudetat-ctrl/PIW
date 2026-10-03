import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadPreviewView, type PreviewView } from "@/modules/property-preview/preview-read-model";
import { resolvePreviewScope } from "@/modules/property-preview/request-scope";
import { createSupabasePreviewReadDependencies } from "@/modules/property-preview/supabase-preview-read";
import { resolvePublicHost } from "@/modules/tenancy/public-host";
import { createSupabasePublicHostLookup } from "@/modules/tenancy/supabase-public-host-lookup";

export const runtime = "nodejs";

const noStore = {"cache-control": "no-store"};
const notFound = () => NextResponse.json({error: "Preview not found"}, {status: 404, headers: noStore});

export async function handlePreviewViewRequest(
  request: NextRequest,
  token: string,
  dependencies: {
    resolveCompany(host: string | null): Promise<string | null>;
    loadView(scope: {companyId: string; tokenHash: string}): Promise<PreviewView | null>;
  },
) {
  const scope = await resolvePreviewScope(request.headers.get("host"), token, dependencies.resolveCompany);
  if (!scope) return notFound();
  const view = await dependencies.loadView(scope);
  if (!view) return notFound();
  return NextResponse.json(view, {headers: noStore});
}

export async function GET(request: NextRequest, {params}: {params: Promise<{token: string}>}) {
  const {token} = await params;
  const service = createServiceClient();
  const lookup = createSupabasePublicHostLookup(service);
  try {
    return await handlePreviewViewRequest(request, token, {
      resolveCompany: async (host) => (await resolvePublicHost(host, lookup))?.companyId ?? null,
      loadView: (scope) => loadPreviewView(scope, createSupabasePreviewReadDependencies(service)),
    });
  } catch {
    return NextResponse.json({error: "Preview temporarily unavailable"}, {status: 503, headers: noStore});
  }
}

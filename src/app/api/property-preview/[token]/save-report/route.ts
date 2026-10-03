import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { inngest } from "@/inngest/client";
import { PREVIEW_EMAIL_DISCLOSURE_VERSION } from "@/modules/property-preview/disclosure";
import { resolvePreviewScope } from "@/modules/property-preview/request-scope";
import { resolvePublicHost } from "@/modules/tenancy/public-host";
import { createSupabasePublicHostLookup } from "@/modules/tenancy/supabase-public-host-lookup";

export const runtime = "nodejs";

const bodySchema = z.strictObject({email: z.email().max(320)});
const noStore = {"cache-control": "no-store"};
const json = (body: unknown, status: number) => NextResponse.json(body, {status, headers: noStore});

type SaveResult = {kind: "saved"; previewId: string} | {kind: "limited"} | {kind: "inactive"};

export async function handleSaveReportRequest(
  request: NextRequest,
  token: string,
  dependencies: {
    resolveCompany(host: string | null): Promise<string | null>;
    save(input: {companyId: string; tokenHash: string; email: string; disclosureVersion: string; acceptedAt: string}): Promise<SaveResult>;
    requestReport(input: {companyId: string; previewId: string}): Promise<void>;
    now?: () => Date;
  },
) {
  const scope = await resolvePreviewScope(request.headers.get("host"), token, dependencies.resolveCompany);
  if (!scope) return json({error: "Preview not found"}, 404);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({error: "Invalid email"}, 400);

  const result = await dependencies.save({
    ...scope,
    email: parsed.data.email,
    disclosureVersion: PREVIEW_EMAIL_DISCLOSURE_VERSION,
    acceptedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
  });
  if (result.kind === "inactive") return json({error: "Preview not found"}, 404);
  if (result.kind === "limited") return json({error: "rate_limited"}, 429);

  await dependencies.requestReport({companyId: scope.companyId, previewId: result.previewId});
  return new NextResponse(null, {status: 204, headers: noStore});
}

export async function POST(request: NextRequest, {params}: {params: Promise<{token: string}>}) {
  const {token} = await params;
  const service = createServiceClient();
  const lookup = createSupabasePublicHostLookup(service);
  return handleSaveReportRequest(request, token, {
    resolveCompany: async (host) => (await resolvePublicHost(host, lookup))?.companyId ?? null,
    async save({companyId, tokenHash, email, disclosureVersion, acceptedAt}) {
      const {data, error} = await service.rpc("save_property_preview_email", {
        p_company_id: companyId,
        p_token_hash: tokenHash,
        p_email: email,
        p_disclosure_version: disclosureVersion,
        p_accepted_at: acceptedAt,
      });
      const row = data?.[0];
      if (error || !row) return {kind: "inactive"};
      return row.allowed ? {kind: "saved", previewId: row.preview_id} : {kind: "limited"};
    },
    async requestReport(input) {
      await inngest.send({name: "property/preview_report_requested", data: input});
    },
  });
}

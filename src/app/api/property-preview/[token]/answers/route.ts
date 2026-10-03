import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { roofAssessmentResponsesBaseSchema } from "@/domain/roof-assessment";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePreviewScope } from "@/modules/property-preview/request-scope";
import { resolvePublicHost } from "@/modules/tenancy/public-host";
import { createSupabasePublicHostLookup } from "@/modules/tenancy/supabase-public-host-lookup";

export const runtime = "nodejs";

// Only the three pre-contact questions; the rest are asked after the price.
const answersSchema = roofAssessmentResponsesBaseSchema
  .pick({reason: true, roofAge: true, timeline: true})
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one answer is required");

const noStore = {"cache-control": "no-store"};

export async function handlePreviewAnswersRequest(
  request: NextRequest,
  token: string,
  dependencies: {
    resolveCompany(host: string | null): Promise<string | null>;
    record(input: {companyId: string; tokenHash: string; responses: z.infer<typeof answersSchema>}): Promise<boolean>;
  },
) {
  const scope = await resolvePreviewScope(request.headers.get("host"), token, dependencies.resolveCompany);
  if (!scope) return NextResponse.json({error: "Preview not found"}, {status: 404, headers: noStore});
  const parsed = answersSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({error: "Invalid answers"}, {status: 400, headers: noStore});
  const recorded = await dependencies.record({...scope, responses: parsed.data});
  if (!recorded) return NextResponse.json({error: "Preview not found"}, {status: 404, headers: noStore});
  return new NextResponse(null, {status: 204, headers: noStore});
}

export async function POST(request: NextRequest, {params}: {params: Promise<{token: string}>}) {
  const {token} = await params;
  const service = createServiceClient();
  const lookup = createSupabasePublicHostLookup(service);
  return handlePreviewAnswersRequest(request, token, {
    resolveCompany: async (host) => (await resolvePublicHost(host, lookup))?.companyId ?? null,
    async record({companyId, tokenHash, responses}) {
      const {error} = await service.rpc("record_property_preview_responses", {
        p_company_id: companyId,
        p_token_hash: tokenHash,
        p_responses: responses,
      });
      return !error;
    },
  });
}

import {NextResponse, type NextRequest} from "next/server";
import {createServiceClient} from "@/lib/supabase/service";
import {noStore} from "@/modules/booking/booking-http";
import {ensureBookingUrl, isVirtualBookingAvailable, resolveBookingConfiguration} from "@/modules/booking/booking-runtime";
import {handleEstimateBookingLink} from "@/modules/booking/estimate-booking-link";

type RouteContext = {params: Promise<{token: string}>};

export async function POST(_request: NextRequest, context: RouteContext) {
  const configuration = resolveBookingConfiguration();
  if (!configuration) return NextResponse.json({error: "Not found"}, {status: 404, headers: noStore});
  const {token} = await context.params;
  const client = createServiceClient();
  return handleEstimateBookingLink({
    token,
    repository: {
      async findLeadByEstimateToken(value) {
        const {data, error} = await client.from("roof_estimates")
          .select("company_id, lead_id")
          .eq("public_token", value)
          .maybeSingle();
        if (error) throw new Error("Failed to load the estimate");
        return data?.lead_id ? {companyId: data.company_id, leadId: data.lead_id} : null;
      },
    },
    available: (companyId) => isVirtualBookingAvailable(client, companyId),
    ensureUrl: ({companyId, leadId}) => ensureBookingUrl({
      client,
      configuration,
      companyId,
      leadId,
      source: "estimate_result",
      createdBy: null,
    }),
  });
}

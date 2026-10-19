import {NextResponse, type NextRequest} from "next/server";
import {
  bookingDependenciesOrNull,
  noStore,
  notFoundResponse,
  requestIpFor,
  respondWithBooking,
} from "@/modules/booking/booking-http";
import {cancelConsultation} from "@/modules/booking/booking-service";

type RouteContext = {params: Promise<{token: string}>};

export async function POST(request: NextRequest, context: RouteContext) {
  const dependencies = bookingDependenciesOrNull();
  if (!dependencies) return notFoundResponse();
  const requestIp = requestIpFor(request);
  if (!requestIp) return NextResponse.json({error: "Invalid request", code: "invalid"}, {status: 400, headers: noStore});
  const {token} = await context.params;
  return respondWithBooking(() => cancelConsultation(token, requestIp, dependencies));
}

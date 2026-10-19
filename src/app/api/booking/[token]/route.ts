import {NextResponse, type NextRequest} from "next/server";
import {
  bookingDependenciesOrNull,
  noStore,
  notFoundResponse,
  requestIpFor,
  respondWithBooking,
} from "@/modules/booking/booking-http";
import {bookConsultation, listSlots} from "@/modules/booking/booking-service";

type RouteContext = {params: Promise<{token: string}>};

/** Fresh availability, used after a slot is taken out from under the homeowner. */
export async function GET(_request: NextRequest, context: RouteContext) {
  const dependencies = bookingDependenciesOrNull();
  if (!dependencies) return notFoundResponse();
  const {token} = await context.params;
  return respondWithBooking(() => listSlots(token, dependencies));
}

export async function POST(request: NextRequest, context: RouteContext) {
  const dependencies = bookingDependenciesOrNull();
  if (!dependencies) return notFoundResponse();
  const requestIp = requestIpFor(request);
  if (!requestIp) return NextResponse.json({error: "Invalid request", code: "invalid"}, {status: 400, headers: noStore});
  const {token} = await context.params;
  const body = await request.json().catch(() => null);
  return respondWithBooking(() => bookConsultation(token, body, requestIp, dependencies));
}

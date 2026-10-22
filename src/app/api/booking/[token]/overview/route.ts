import type {NextRequest} from "next/server";
import {bookingDependenciesOrNull, notFoundResponse, respondWithBooking} from "@/modules/booking/booking-http";
import {loadBookingOverview} from "@/modules/booking/booking-service";

type RouteContext = {params: Promise<{token: string}>};

/** Everything the booking page shows, as data, for the quote chat. */
export async function GET(_request: NextRequest, context: RouteContext) {
  const dependencies = bookingDependenciesOrNull();
  if (!dependencies) return notFoundResponse();
  const {token} = await context.params;
  return respondWithBooking(() => loadBookingOverview(token, dependencies));
}

import "server-only";
import {NextResponse} from "next/server";
import {parseServerEnv} from "@/lib/env/server";
import {trustedRequestIp} from "@/modules/roof-assessment/trusted-request-ip";
import {createBookingDependencies, resolveBookingConfiguration} from "./booking-runtime";
import {BookingRequestError, type BookingDependencies} from "./booking-service";

// Shared plumbing for the token-scoped booking API. Every response is
// no-store (the token is a capability) and errors carry a stable code the
// page can branch on, never internal detail.

export const noStore = {"cache-control": "no-store"};

export function notFoundResponse() {
  return NextResponse.json({error: "Not found", code: "not_found"}, {status: 404, headers: noStore});
}

export function bookingDependenciesOrNull(): BookingDependencies | null {
  const configuration = resolveBookingConfiguration();
  return configuration ? createBookingDependencies(configuration) : null;
}

export function requestIpFor(request: Request) {
  return trustedRequestIp(request.headers, parseServerEnv(process.env).DEPLOYMENT_ENV);
}

export async function respondWithBooking<T>(work: () => Promise<T>) {
  try {
    return NextResponse.json(await work(), {headers: noStore});
  } catch (error) {
    if (error instanceof BookingRequestError) {
      return NextResponse.json({error: error.message, code: error.code}, {status: error.status, headers: noStore});
    }
    console.error("booking_request_failed", {error: error instanceof Error ? error.message : "unknown"});
    return NextResponse.json(
      {error: "Online booking is temporarily unavailable", code: "unavailable"},
      {status: 503, headers: noStore},
    );
  }
}

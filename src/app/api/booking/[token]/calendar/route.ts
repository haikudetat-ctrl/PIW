import {NextResponse, type NextRequest} from "next/server";
import {createServiceClient} from "@/lib/supabase/service";
import {bookingDependenciesOrNull, noStore, notFoundResponse} from "@/modules/booking/booking-http";
import {BookingRequestError, loadBookingForCalendarFile} from "@/modules/booking/booking-service";
import {buildCalendarFile} from "@/modules/booking/calendar-file";
import {loadBrandName} from "@/modules/booking/supabase-calendar-sync-repository";

type RouteContext = {params: Promise<{token: string}>};

/** An .ics file for the homeowner's booked consultation. */
export async function GET(_request: NextRequest, context: RouteContext) {
  const dependencies = bookingDependenciesOrNull();
  if (!dependencies) return notFoundResponse();
  const {token} = await context.params;
  try {
    const {summary, settings} = await loadBookingForCalendarFile(token, dependencies);
    const file = buildCalendarFile({
      appointmentId: summary.appointmentId,
      title: settings.meetingTitle,
      startsAt: summary.startsAt,
      endsAt: summary.endsAt,
      meetingUrl: summary.meetingUrl,
      organizerName: await loadBrandName(createServiceClient(), settings.companyId),
      now: new Date(),
    });
    return new NextResponse(file, {
      headers: {
        ...noStore,
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": 'attachment; filename="video-consultation.ics"',
      },
    });
  } catch (error) {
    if (error instanceof BookingRequestError) {
      return NextResponse.json({error: error.message, code: error.code}, {status: error.status, headers: noStore});
    }
    return NextResponse.json({error: "Unavailable", code: "unavailable"}, {status: 503, headers: noStore});
  }
}

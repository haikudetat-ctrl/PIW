import {formatMeetingTime, formatMeetingTimeShort} from "./booking-format";

// Plain-text customer emails for virtual consultations. Short, warm, and
// specific: when it is, how to join, how to change it. No marketing.

export type BookingEmailKind = "confirmation" | "rescheduled" | "cancelled" | "reminder_day" | "reminder_hour";

export type BookingEmailContext = {
  firstName: string;
  brandName: string;
  startsAt: string;
  timezone: string;
  durationMinutes: number;
  meetingUrl: string | null;
  manageUrl: string | null;
  supportPhone: string | null;
  repName: string | null;
};

export type ComposedBookingEmail = {subject: string; text: string};

function joinLine(context: BookingEmailContext) {
  return context.meetingUrl
    ? `Join on Google Meet: ${context.meetingUrl}`
    : "Your Google Meet link is in the calendar invite we sent separately.";
}

function changeLine(context: BookingEmailContext) {
  if (context.manageUrl && context.supportPhone) {
    return `Need a different time? You can move or cancel it here: ${context.manageUrl}\nOr call us at ${context.supportPhone}.`;
  }
  if (context.manageUrl) return `Need a different time? You can move or cancel it here: ${context.manageUrl}`;
  if (context.supportPhone) return `Need a different time? Call us at ${context.supportPhone}.`;
  return null;
}

function signOff(context: BookingEmailContext) {
  return `Talk soon,\n${context.brandName}`;
}

function compose(paragraphs: Array<string | null>) {
  return paragraphs.filter((paragraph): paragraph is string => Boolean(paragraph)).join("\n\n");
}

export function composeBookingEmail(kind: BookingEmailKind, context: BookingEmailContext): ComposedBookingEmail {
  const when = formatMeetingTime(context.startsAt, context.timezone);
  const short = formatMeetingTimeShort(context.startsAt, context.timezone);
  const greeting = `Hi ${context.firstName},`;
  const withWhom = context.repName ? ` with ${context.repName}` : "";

  switch (kind) {
    case "confirmation":
      return {
        subject: `You're booked: video consultation ${short}`,
        text: compose([
          greeting,
          `Thanks for making time. Your ${context.durationMinutes}-minute video consultation${withWhom} is set for ${when}.`,
          joinLine(context),
          "It helps to have a few phone photos of anything you've noticed on the roof or ceilings, and any recent quotes you'd like a second opinion on. If you don't have those, that's completely fine.",
          changeLine(context),
          signOff(context),
        ]),
      };
    case "rescheduled":
      return {
        subject: `New time: video consultation ${short}`,
        text: compose([
          greeting,
          `No problem, we've moved your video consultation${withWhom} to ${when}.`,
          joinLine(context),
          changeLine(context),
          signOff(context),
        ]),
      };
    case "cancelled":
      return {
        subject: "Your video consultation is cancelled",
        text: compose([
          greeting,
          `Your video consultation for ${when} is cancelled. Nothing else is needed from you.`,
          context.manageUrl
            ? `If you'd like to pick another time, you can book here whenever it suits you: ${context.manageUrl}`
            : null,
          context.supportPhone ? `Questions in the meantime? Call us at ${context.supportPhone}.` : null,
          signOff(context),
        ]),
      };
    case "reminder_day":
      return {
        subject: `Tomorrow: video consultation ${short}`,
        text: compose([
          greeting,
          `A quick reminder that your video consultation${withWhom} is tomorrow, ${when}.`,
          joinLine(context),
          changeLine(context),
          signOff(context),
        ]),
      };
    case "reminder_hour":
      return {
        subject: `Starting soon: video consultation ${short}`,
        text: compose([
          greeting,
          `Your video consultation${withWhom} starts in about an hour, at ${when}.`,
          joinLine(context),
          context.supportPhone ? `Running late or need to switch to a phone call? Call us at ${context.supportPhone}.` : null,
          signOff(context),
        ]),
      };
  }
}

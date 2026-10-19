import {composeBookingEmail, type BookingEmailKind} from "./booking-emails";

// Decides whether a lifecycle email is still true when it is about to go out,
// then sends it. Reminders and confirmations are pinned to the revision that
// triggered them, so a consultation moved after the reminder was scheduled
// never gets a reminder for its old time.

export type BookingEmailState = {
  appointmentId: string;
  status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
  revision: number;
  scheduledAt: string;
  durationMinutes: number;
  attendeeEmail: string | null;
  customerName: string;
  meetingUrl: string | null;
  manageUrl: string | null;
  timezone: string;
  supportPhone: string | null;
  brandName: string;
  repName: string | null;
};

export type BookingEmailDependencies = {
  load(appointmentId: string): Promise<BookingEmailState | null>;
  send(input: {to: string; fromName: string; subject: string; text: string; idempotencyKey: string}): Promise<void>;
  now(): Date;
};

export type BookingEmailOutcome =
  | {outcome: "sent"}
  | {outcome: "skipped"; reason: "missing" | "stale" | "no_recipient" | "past"};

export function bookingEmailIsCurrent(kind: BookingEmailKind, state: BookingEmailState, expectedRevision: number, now: Date) {
  if (kind === "cancelled") return state.status === "cancelled" && state.revision === expectedRevision;
  const active = state.status === "scheduled" || state.status === "confirmed";
  return active && state.revision === expectedRevision && new Date(state.scheduledAt).getTime() > now.getTime();
}

export async function sendBookingEmail(
  input: {kind: BookingEmailKind; appointmentId: string; revision: number},
  dependencies: BookingEmailDependencies,
): Promise<BookingEmailOutcome> {
  const state = await dependencies.load(input.appointmentId);
  if (!state) return {outcome: "skipped", reason: "missing"};
  if (!state.attendeeEmail) return {outcome: "skipped", reason: "no_recipient"};
  if (!bookingEmailIsCurrent(input.kind, state, input.revision, dependencies.now())) {
    const moved = state.revision !== input.revision || input.kind === "cancelled";
    return {outcome: "skipped", reason: moved ? "stale" : "past"};
  }

  const email = composeBookingEmail(input.kind, {
    firstName: state.customerName.trim().split(/\s+/)[0] || "there",
    brandName: state.brandName,
    startsAt: state.scheduledAt,
    timezone: state.timezone,
    durationMinutes: state.durationMinutes,
    meetingUrl: state.meetingUrl,
    manageUrl: state.manageUrl,
    supportPhone: state.supportPhone,
    repName: state.repName,
  });
  await dependencies.send({
    to: state.attendeeEmail,
    fromName: state.brandName,
    subject: email.subject,
    text: email.text,
    idempotencyKey: `virtual-consultation:${input.appointmentId}:${input.kind}:${input.revision}`,
  });
  return {outcome: "sent"};
}

/** When each reminder goes out, or null when there is not enough lead time for it. */
export function reminderTimes(scheduledAt: string, bookedAt: Date) {
  const start = new Date(scheduledAt).getTime();
  const dayBefore = start - 24 * 60 * 60_000;
  const hourBefore = start - 60 * 60_000;
  return {
    // A day-before reminder only makes sense if the booking was made well before that point.
    dayBefore: dayBefore - bookedAt.getTime() >= 60 * 60_000 ? new Date(dayBefore) : null,
    hourBefore: hourBefore - bookedAt.getTime() >= 15 * 60_000 ? new Date(hourBefore) : null,
  };
}

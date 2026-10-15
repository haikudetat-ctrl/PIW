import type { LeadStage } from "@/modules/leads/change-lead-stage";

// Rules for booking an inspection and for what a missed one sets in motion.
// Pure so the server actions stay thin and the rules are testable.

export const COMPANY_TIME_ZONE = "America/New_York";

export type AppointmentStatus = "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";

// Statuses a booked appointment can be moved to from the lead page.
export const APPOINTMENT_OUTCOMES = ["confirmed", "completed", "no_show", "cancelled"] as const;
export type AppointmentOutcome = (typeof APPOINTMENT_OUTCOMES)[number];

export function isOpenAppointment(status: AppointmentStatus): boolean {
  return status === "scheduled" || status === "confirmed";
}

// Booking moves an early-stage lead to "Appointment set"; a lead already past
// that (estimating, proposal sent, won, lost) keeps its stage.
export function stageAfterBooking(current: LeadStage): LeadStage | null {
  return current === "new" || current === "contacting" || current === "nurture" ? "appointment_set" : null;
}

// A no-show or cancellation puts an "Appointment set" lead back to
// "Contacting" so it shows up as needing a call again.
export function stageAfterMissed(current: LeadStage): LeadStage | null {
  return current === "appointment_set" ? "contacting" : null;
}

export function isMissed(status: AppointmentStatus): boolean {
  return status === "no_show" || status === "cancelled";
}

export const REBOOK_TASK_TITLE = "Rebook no-show";
export const REBOOK_CANCELLED_TASK_TITLE = "Rebook cancelled inspection";

export function rebookTask(input: {
  appointmentId: string;
  status: "no_show" | "cancelled";
  scheduledAt: string;
  leadName: string;
  leadPhone: string;
}) {
  const when = formatAppointmentTime(input.scheduledAt);
  const missed = input.status === "no_show" ? "was a no-show" : "was cancelled";
  return {
    title: input.status === "no_show" ? REBOOK_TASK_TITLE : REBOOK_CANCELLED_TASK_TITLE,
    description: `The ${when} inspection ${missed}. Call ${input.leadName} at ${input.leadPhone} to rebook.`,
    sourceKey: `rebook:appointment:${input.appointmentId}`,
  };
}

// Open rebook tasks a new booking closes out.
export function isRebookTaskTitle(title: string): boolean {
  return title === REBOOK_TASK_TITLE || title === REBOOK_CANCELLED_TASK_TITLE;
}

export function formatAppointmentTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: COMPANY_TIME_ZONE,
  });
}

function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  const wallClock = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return wallClock - instant;
}

// An <input type="datetime-local"> value ("2026-10-20T14:30") is wall-clock
// time with no zone. The server runs in UTC, so read it as company time.
export function companyLocalToIso(value: string, timeZone = COMPANY_TIME_ZONE): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(asUtc);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59) return null;

  // Two passes settle the offset on either side of a DST change.
  let instant = asUtc - zoneOffsetMs(asUtc, timeZone);
  instant = asUtc - zoneOffsetMs(instant, timeZone);
  return new Date(instant).toISOString();
}

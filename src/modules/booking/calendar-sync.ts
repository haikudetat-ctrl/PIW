import {calendarEventIdFor, type CalendarAttendee, type CalendarEventInput, type CalendarEventResult} from "./google-calendar";

// Reconciles one appointment to Google Calendar. The sync is state-based:
// every trigger (booked, moved, cancelled, rep assigned, manual retry) reads
// the appointment as it is now and makes the event match, so duplicate or
// out-of-order deliveries converge on the same result. The result is written
// back only if the appointment's revision has not moved on in the meantime.

export type SyncAppointment = {
  id: string;
  companyId: string;
  status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
  meetingType: "in_person" | "virtual" | null;
  scheduledAt: string;
  durationMinutes: number;
  revision: number;
  customerName: string;
  attendeeEmail: string | null;
  propertyAddress: string | null;
  customerNotes: string | null;
  calendarEventId: string | null;
  rep: {name: string; email: string | null} | null;
  settings: {
    googleCalendarId: string | null;
    timezone: string;
    meetingTitle: string;
    sendCalendarInvites: boolean;
    supportPhone: string | null;
  };
  brandName: string;
};

export interface CalendarSyncRepository {
  load(appointmentId: string): Promise<SyncAppointment | null>;
  recordSynced(input: {appointmentId: string; revision: number; eventId: string | null; meetingUrl: string | null}): Promise<boolean>;
  recordFailed(input: {appointmentId: string; revision: number; error: string}): Promise<void>;
  recordNotConfigured(input: {appointmentId: string; revision: number}): Promise<void>;
}

export interface CalendarWriter {
  upsertEvent(calendarId: string, input: CalendarEventInput, knownEventId: string | null): Promise<CalendarEventResult>;
  getEvent(calendarId: string, eventId: string): Promise<CalendarEventResult | null>;
  cancelEvent(calendarId: string, eventId: string, sendUpdates: "all" | "none"): Promise<void>;
}

export type CalendarSyncPlan =
  | {action: "upsert"}
  | {action: "cancel"; eventId: string}
  | {action: "skip"; reason: "not_virtual" | "finished" | "missing"};

export function planCalendarSync(appointment: SyncAppointment | null): CalendarSyncPlan {
  if (!appointment) return {action: "skip", reason: "missing"};
  if (appointment.meetingType !== "virtual") return {action: "skip", reason: "not_virtual"};
  if (appointment.status === "cancelled") {
    // Even without a recorded ID, an insert may have reached Google before a
    // failure; cancelling the derived ID is harmless when nothing is there.
    return {action: "cancel", eventId: appointment.calendarEventId ?? calendarEventIdFor(appointment.id)};
  }
  if (appointment.status === "completed" || appointment.status === "no_show") {
    return {action: "skip", reason: "finished"};
  }
  return {action: "upsert"};
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

/** Event copy is customer-safe: the homeowner sees it in their own calendar. */
export function buildCalendarEvent(appointment: SyncAppointment): CalendarEventInput {
  const start = new Date(appointment.scheduledAt);
  const attendees: CalendarAttendee[] = [];
  if (appointment.attendeeEmail) {
    attendees.push({email: appointment.attendeeEmail, displayName: appointment.customerName});
  }
  if (appointment.rep?.email) {
    attendees.push({email: appointment.rep.email, displayName: appointment.rep.name});
  }
  const lines = [
    `Hi ${firstName(appointment.customerName)}, this is your video consultation with ${appointment.brandName}.`,
    "Join from your phone or computer with the Google Meet link in this invite. Nothing to install on a computer.",
  ];
  if (appointment.rep) lines.push(`You'll be meeting with ${appointment.rep.name}.`);
  if (appointment.propertyAddress) lines.push(`Property: ${appointment.propertyAddress}`);
  if (appointment.customerNotes) lines.push(`What you'd like to cover: ${appointment.customerNotes}`);
  lines.push(
    appointment.settings.supportPhone
      ? `Need a different time? Use the link in your confirmation email, or call us at ${appointment.settings.supportPhone}.`
      : "Need a different time? Use the link in your confirmation email.",
  );

  return {
    eventId: calendarEventIdFor(appointment.id),
    appointmentId: appointment.id,
    summary: `${appointment.settings.meetingTitle}: ${appointment.customerName} and ${appointment.brandName}`,
    description: lines.join("\n\n"),
    start,
    end: new Date(start.getTime() + appointment.durationMinutes * 60_000),
    timeZone: appointment.settings.timezone,
    attendees,
    sendUpdates: appointment.settings.sendCalendarInvites ? "all" : "none",
  };
}

export type CalendarSyncOutcome =
  | {outcome: "synced"; meetingUrl: string | null; recorded: boolean}
  | {outcome: "cancelled"; recorded: boolean}
  | {outcome: "skipped"; reason: string}
  | {outcome: "not_configured"};

export async function runCalendarSync(
  appointmentId: string,
  dependencies: {
    repository: CalendarSyncRepository;
    calendar: CalendarWriter | null;
    waitForConference?: () => Promise<void>;
  },
): Promise<CalendarSyncOutcome> {
  const appointment = await dependencies.repository.load(appointmentId);
  const plan = planCalendarSync(appointment);
  if (plan.action === "skip" || !appointment) {
    return {outcome: "skipped", reason: plan.action === "skip" ? plan.reason : "missing"};
  }

  const calendarId = appointment.settings.googleCalendarId;
  if (!dependencies.calendar || !calendarId) {
    await dependencies.repository.recordNotConfigured({appointmentId, revision: appointment.revision});
    return {outcome: "not_configured"};
  }

  try {
    if (plan.action === "cancel") {
      await dependencies.calendar.cancelEvent(calendarId, plan.eventId, appointment.settings.sendCalendarInvites ? "all" : "none");
      const recorded = await dependencies.repository.recordSynced({
        appointmentId,
        revision: appointment.revision,
        eventId: plan.eventId,
        meetingUrl: null,
      });
      return {outcome: "cancelled", recorded};
    }

    let result = await dependencies.calendar.upsertEvent(calendarId, buildCalendarEvent(appointment), appointment.calendarEventId);
    if (!result.meetingUrl && result.conferencePending) {
      await dependencies.waitForConference?.();
      result = (await dependencies.calendar.getEvent(calendarId, result.eventId)) ?? result;
    }
    const recorded = await dependencies.repository.recordSynced({
      appointmentId,
      revision: appointment.revision,
      eventId: result.eventId,
      meetingUrl: result.meetingUrl,
    });
    return {outcome: "synced", meetingUrl: result.meetingUrl, recorded};
  } catch (error) {
    const message = error instanceof Error ? error.message : "Calendar sync failed";
    await dependencies.repository.recordFailed({appointmentId, revision: appointment.revision, error: message.slice(0, 500)});
    throw error;
  }
}

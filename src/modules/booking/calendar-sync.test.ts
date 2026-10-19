import {describe, expect, test, vi} from "vitest";
import {buildCalendarEvent, planCalendarSync, runCalendarSync, type CalendarSyncRepository, type CalendarWriter, type SyncAppointment} from "./calendar-sync";

const appointmentId = "11111111-1111-4111-8111-111111111111";

const appointment: SyncAppointment = {
  id: appointmentId,
  companyId: "22222222-2222-4222-8222-222222222222",
  status: "scheduled",
  meetingType: "virtual",
  scheduledAt: "2026-10-21T18:00:00.000Z",
  durationMinutes: 30,
  revision: 2,
  customerName: "Jordan Rivera",
  attendeeEmail: "jordan@example.com",
  propertyAddress: "1 Book St, Cherry Hill, NJ 08002",
  customerNotes: "Hail damage on the back slope",
  calendarEventId: null,
  rep: null,
  settings: {
    googleCalendarId: "consults@group.calendar.google.com",
    timezone: "America/New_York",
    meetingTitle: "Virtual roof consultation",
    sendCalendarInvites: true,
    supportPhone: "(856) 835-6022",
  },
  brandName: "AllSeason Solar & Roofing",
};

function repository(current: SyncAppointment | null = appointment): CalendarSyncRepository {
  return {
    load: vi.fn(async () => current),
    recordSynced: vi.fn(async () => true),
    recordFailed: vi.fn(async () => undefined),
    recordNotConfigured: vi.fn(async () => undefined),
  };
}

function calendar(overrides: Partial<CalendarWriter> = {}): CalendarWriter {
  return {
    upsertEvent: vi.fn(async () => ({eventId: "rake1111", meetingUrl: "https://meet.google.com/abc", conferencePending: false})),
    getEvent: vi.fn(async () => ({eventId: "rake1111", meetingUrl: "https://meet.google.com/late", conferencePending: false})),
    cancelEvent: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("planCalendarSync", () => {
  test("only touches virtual consultations", () => {
    expect(planCalendarSync({...appointment, meetingType: "in_person"})).toEqual({action: "skip", reason: "not_virtual"});
    expect(planCalendarSync(null)).toEqual({action: "skip", reason: "missing"});
  });

  test("cancels the recorded event, or the derived ID when none was recorded", () => {
    expect(planCalendarSync({...appointment, status: "cancelled", calendarEventId: "rake1111"})).toEqual({action: "cancel", eventId: "rake1111"});
    expect(planCalendarSync({...appointment, status: "cancelled"})).toEqual({action: "cancel", eventId: "rake11111111111141118111111111111111"});
  });

  test("leaves finished meetings alone", () => {
    expect(planCalendarSync({...appointment, status: "completed"})).toEqual({action: "skip", reason: "finished"});
  });
});

describe("buildCalendarEvent", () => {
  test("invites the homeowner and, once assigned, the rep", () => {
    const event = buildCalendarEvent({...appointment, rep: {name: "Alex Morgan", email: "alex@allseason.example"}});
    expect(event.attendees).toEqual([
      {email: "jordan@example.com", displayName: "Jordan Rivera"},
      {email: "alex@allseason.example", displayName: "Alex Morgan"},
    ]);
    expect(event.description).toContain("You'll be meeting with Alex Morgan.");
    expect(event.end.toISOString()).toBe("2026-10-21T18:30:00.000Z");
  });

  test("keeps the copy customer-safe and free of em dashes", () => {
    const event = buildCalendarEvent(appointment);
    expect(event.summary).toBe("Virtual roof consultation: Jordan Rivera and AllSeason Solar & Roofing");
    expect(event.description).toContain("Hail damage on the back slope");
    expect(event.description).not.toMatch(/\/leads\/|—/);
    expect(event.sendUpdates).toBe("all");
  });
});

describe("runCalendarSync", () => {
  test("creates the event and records the Meet link against the revision it read", async () => {
    const repo = repository();
    const writer = calendar();
    expect(await runCalendarSync(appointmentId, {repository: repo, calendar: writer}))
      .toEqual({outcome: "synced", meetingUrl: "https://meet.google.com/abc", recorded: true});
    expect(writer.upsertEvent).toHaveBeenCalledWith("consults@group.calendar.google.com", expect.objectContaining({appointmentId}), null);
    expect(repo.recordSynced).toHaveBeenCalledWith({appointmentId, revision: 2, eventId: "rake1111", meetingUrl: "https://meet.google.com/abc"});
  });

  test("waits once for a Meet link Google is still creating", async () => {
    const writer = calendar({upsertEvent: vi.fn(async () => ({eventId: "rake1111", meetingUrl: null, conferencePending: true}))});
    const waitForConference = vi.fn(async () => undefined);
    const result = await runCalendarSync(appointmentId, {repository: repository(), calendar: writer, waitForConference});
    expect(waitForConference).toHaveBeenCalledOnce();
    expect(result).toMatchObject({meetingUrl: "https://meet.google.com/late"});
  });

  test("cancels the Google event for a cancelled consultation", async () => {
    const writer = calendar();
    const repo = repository({...appointment, status: "cancelled", calendarEventId: "rake1111"});
    expect(await runCalendarSync(appointmentId, {repository: repo, calendar: writer})).toEqual({outcome: "cancelled", recorded: true});
    expect(writer.cancelEvent).toHaveBeenCalledWith("consults@group.calendar.google.com", "rake1111", "all");
  });

  test("records a failure and rethrows so the job retries", async () => {
    const repo = repository();
    const writer = calendar({upsertEvent: vi.fn(async () => { throw new Error("Google Calendar insert failed with 403"); })});
    await expect(runCalendarSync(appointmentId, {repository: repo, calendar: writer})).rejects.toThrow("403");
    expect(repo.recordFailed).toHaveBeenCalledWith({appointmentId, revision: 2, error: "Google Calendar insert failed with 403"});
  });

  test("marks the appointment when no calendar is configured", async () => {
    const repo = repository();
    expect(await runCalendarSync(appointmentId, {repository: repo, calendar: null})).toEqual({outcome: "not_configured"});
    expect(repo.recordNotConfigured).toHaveBeenCalledWith({appointmentId, revision: 2});
  });
});

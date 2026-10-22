import {describe, expect, test, vi} from "vitest";
import {
  BookingRateLimitError,
  BookingRequestError,
  bookConsultation,
  cancelConsultation,
  loadBookingPage,
  maskEmail,
  rescheduleConsultation,
  type ActiveBooking,
  type BookingDependencies,
  type BookingRepository,
  type CompanyBookingSettings,
} from "./booking-service";

const companyId = "22222222-2222-4222-8222-222222222222";
const leadId = "33333333-3333-4333-8333-333333333333";
const linkId = "44444444-4444-4444-8444-444444444444";
const appointmentId = "55555555-5555-4555-8555-555555555555";
const now = new Date("2026-10-19T12:00:00.000Z"); // Monday 8:00 AM Eastern

const settings: CompanyBookingSettings = {
  companyId,
  isEnabled: true,
  timezone: "America/New_York",
  meetingTitle: "Virtual roof consultation",
  meetingDurationMinutes: 30,
  slotIntervalMinutes: 30,
  bufferMinutes: 0,
  minimumNoticeMinutes: 120,
  bookingHorizonDays: 7,
  concurrentCapacity: 1,
  googleCalendarId: "consults@group.calendar.google.com",
  sendCalendarInvites: true,
  supportPhone: "(866) 835-6022",
};

const booked: ActiveBooking = {
  id: appointmentId,
  scheduledAt: "2026-10-20T14:00:00.000Z",
  durationMinutes: 30,
  meetingUrl: "https://meet.google.com/abc-defg-hij",
  calendarSyncStatus: "synced",
  attendeeEmail: "jordan@example.com",
  revision: 1,
};

const bookedEvent = {
  id: "66666666-6666-4666-8666-666666666666",
  name: "appointments/virtual.booked" as const,
  schemaVersion: 1 as const,
  correlationId: appointmentId,
  leadId,
  occurredAt: now.toISOString(),
  idempotencyKey: `appointments/virtual.booked:${appointmentId}:1`,
  data: {appointmentId, revision: 1},
};

function repository(overrides: Partial<BookingRepository> = {}): BookingRepository {
  return {
    findLink: vi.fn(async () => ({id: linkId, companyId, leadId, expiresAt: "2026-11-18T12:00:00.000Z", revokedAt: null})),
    touchLink: vi.fn(async () => undefined),
    loadLead: vi.fn(async () => ({name: "Jordan Rivera", email: "jordan@example.com"})),
    loadSettings: vi.fn(async () => settings),
    loadWindows: vi.fn(async () => [1, 2, 3, 4, 5].map((weekday) => ({weekday, startMinute: 540, endMinute: 720}))),
    loadBlackouts: vi.fn(async () => []),
    loadBookedIntervals: vi.fn(async () => []),
    findActiveBooking: vi.fn(async () => null),
    book: vi.fn(async () => ({outcome: "booked", problem: null, appointmentId, event: bookedEvent})),
    reschedule: vi.fn(async () => ({outcome: "rescheduled", problem: null, appointmentId, event: null})),
    cancel: vi.fn(async () => ({outcome: "cancelled", problem: null, appointmentId, event: null})),
    ...overrides,
  };
}

function dependencies(repo = repository(), overrides: Partial<BookingDependencies> = {}): BookingDependencies {
  return {
    repository: repo,
    calendar: {listBusy: vi.fn(async () => [])},
    verifyToken: (token) => (token === "good-token" ? linkId : null),
    publish: vi.fn(async () => undefined),
    now: () => now,
    ...overrides,
  };
}

describe("maskEmail", () => {
  test("keeps the first letter and the domain", () => {
    expect(maskEmail(" Jordan@Example.com ")).toBe("j•••@example.com");
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail("no-at-sign")).toBeNull();
  });
});

describe("loadBookingPage", () => {
  test("treats a forged or unknown token as not found without touching the database", async () => {
    const repo = repository();
    expect(await loadBookingPage("forged", dependencies(repo))).toEqual({kind: "invalid"});
    expect(repo.findLink).not.toHaveBeenCalled();
  });

  test("offers slots with only a first name and a masked email", async () => {
    const page = await loadBookingPage("good-token", dependencies());
    expect(page.kind).toBe("open");
    if (page.kind !== "open") return;
    expect(page.firstName).toBe("Jordan");
    expect(page.inviteEmail).toBe("j•••@example.com");
    expect(page.days.find((day) => day.date === "2026-10-20")?.slots).toHaveLength(6);
    expect(JSON.stringify(page)).not.toMatch(/jordan@example\.com|Rivera/);
  });

  test("shows the booking with its Meet link once the calendar has it", async () => {
    const page = await loadBookingPage("good-token", dependencies(repository({findActiveBooking: vi.fn(async () => booked)})));
    expect(page.kind).toBe("booked");
    if (page.kind !== "booked") return;
    expect(page.booking).toMatchObject({meetingUrl: booked.meetingUrl, calendarReady: true, canChange: true});
  });

  test("withholds the Meet link until the calendar sync succeeds", async () => {
    const pending = {...booked, calendarSyncStatus: "pending" as const};
    const page = await loadBookingPage("good-token", dependencies(repository({findActiveBooking: vi.fn(async () => pending)})));
    expect(page.kind === "booked" && page.booking).toMatchObject({meetingUrl: null, calendarReady: false});
  });

  test("reports expired links and offers the support phone", async () => {
    const repo = repository({findLink: vi.fn(async () => ({id: linkId, companyId, leadId, expiresAt: "2026-10-01T00:00:00.000Z", revokedAt: null}))});
    expect(await loadBookingPage("good-token", dependencies(repo))).toEqual({kind: "expired", supportPhone: "(866) 835-6022"});
  });

  test("fails closed when the shared calendar cannot be read", async () => {
    const page = await loadBookingPage("good-token", dependencies(repository(), {
      calendar: {listBusy: vi.fn(async () => { throw new Error("403"); })},
    }));
    expect(page).toEqual({kind: "unavailable", supportPhone: "(866) 835-6022", reason: "calendar"});
  });

  test("is unavailable while the company has booking switched off", async () => {
    const repo = repository({loadSettings: vi.fn(async () => ({...settings, isEnabled: false}))});
    expect(await loadBookingPage("good-token", dependencies(repo))).toMatchObject({kind: "unavailable", reason: "disabled"});
  });
});

describe("bookConsultation", () => {
  test("books a proposed slot and publishes the queued event", async () => {
    const repo = repository();
    let calls = 0;
    repo.findActiveBooking = vi.fn(async () => (calls++ === 0 ? null : booked));
    const deps = dependencies(repo);
    const summary = await bookConsultation("good-token", {startsAt: "2026-10-20T10:00:00-04:00", notes: " Leak over the porch "}, "203.0.113.10", deps);
    expect(repo.book).toHaveBeenCalledWith({
      linkId,
      startsAt: "2026-10-20T14:00:00.000Z",
      attendeeEmail: null,
      notes: "Leak over the porch",
      requestIp: "203.0.113.10",
    });
    expect(deps.publish).toHaveBeenCalledWith(bookedEvent, companyId);
    expect(summary).toMatchObject({appointmentId, startsAt: "2026-10-20T14:00:00.000Z", inviteEmail: "j•••@example.com"});
  });

  test("refuses a time the slot engine did not propose before reaching the database", async () => {
    const repo = repository();
    await expect(bookConsultation("good-token", {startsAt: "2026-10-20T10:10:00-04:00"}, "203.0.113.10", dependencies(repo)))
      .rejects.toMatchObject({status: 409, code: "slot_unavailable"});
    expect(repo.book).not.toHaveBeenCalled();
  });

  test("turns a lost race in the database into the same friendly conflict", async () => {
    const repo = repository({book: vi.fn(async () => ({outcome: "unavailable", problem: "full", appointmentId: null, event: null}))});
    await expect(bookConsultation("good-token", {startsAt: "2026-10-20T14:00:00.000Z"}, "203.0.113.10", dependencies(repo)))
      .rejects.toMatchObject({status: 409, code: "slot_unavailable"});
  });

  test("validates the request body strictly", async () => {
    await expect(bookConsultation("good-token", {startsAt: "tomorrow"}, "203.0.113.10", dependencies()))
      .rejects.toMatchObject({status: 400});
    await expect(bookConsultation("good-token", {startsAt: "2026-10-20T14:00:00.000Z", leadId}, "203.0.113.10", dependencies()))
      .rejects.toMatchObject({status: 400});
    await expect(bookConsultation("good-token", {startsAt: "2026-10-20T14:00:00.000Z", attendeeEmail: "nope"}, "203.0.113.10", dependencies()))
      .rejects.toMatchObject({status: 400});
  });

  test("maps the database rate limit to 429", async () => {
    const repo = repository({book: vi.fn(async () => { throw new BookingRateLimitError(); })});
    await expect(bookConsultation("good-token", {startsAt: "2026-10-20T14:00:00.000Z"}, "203.0.113.10", dependencies(repo)))
      .rejects.toMatchObject({status: 429, code: "rate_limited"});
  });

  test("still succeeds when the immediate publish fails, because the outbox has the event", async () => {
    const repo = repository();
    let calls = 0;
    repo.findActiveBooking = vi.fn(async () => (calls++ === 0 ? null : booked));
    const logError = vi.fn();
    const deps = dependencies(repo, {publish: vi.fn(async () => { throw new Error("inngest down"); }), logError});
    await expect(bookConsultation("good-token", {startsAt: "2026-10-20T14:00:00.000Z"}, "203.0.113.10", deps)).resolves.toMatchObject({appointmentId});
    expect(logError).toHaveBeenCalledWith("booking_event_publish_deferred", expect.anything());
  });
});

describe("reschedule and cancel", () => {
  test("lets the current booking's own slot stay available while moving it", async () => {
    const repo = repository({findActiveBooking: vi.fn(async () => booked)});
    await rescheduleConsultation("good-token", {startsAt: "2026-10-21T14:00:00.000Z"}, "203.0.113.10", dependencies(repo));
    expect(repo.loadBookedIntervals).toHaveBeenCalledWith(companyId, expect.any(Date), expect.any(Date), appointmentId);
    expect(repo.reschedule).toHaveBeenCalledWith({linkId, startsAt: "2026-10-21T14:00:00.000Z", requestIp: "203.0.113.10"});
  });

  test("explains a reschedule limit", async () => {
    const repo = repository({
      findActiveBooking: vi.fn(async () => booked),
      reschedule: vi.fn(async () => ({outcome: "limit_reached", problem: null, appointmentId, event: null})),
    });
    await expect(rescheduleConsultation("good-token", {startsAt: "2026-10-21T14:00:00.000Z"}, "203.0.113.10", dependencies(repo)))
      .rejects.toMatchObject({status: 409, code: "limit_reached"});
  });

  test("cancels and reports when there is nothing to cancel", async () => {
    await expect(cancelConsultation("good-token", "203.0.113.10", dependencies())).resolves.toEqual({cancelled: true});
    const repo = repository({cancel: vi.fn(async () => ({outcome: "not_found", problem: null, appointmentId: null, event: null}))});
    await expect(cancelConsultation("good-token", "203.0.113.10", dependencies(repo))).rejects.toBeInstanceOf(BookingRequestError);
  });
});

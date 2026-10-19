import {describe, expect, test, vi} from "vitest";
import {bookingEmailIsCurrent, reminderTimes, sendBookingEmail, type BookingEmailState} from "./send-booking-email";

const appointmentId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-10-19T12:00:00.000Z");
const state: BookingEmailState = {
  appointmentId,
  status: "scheduled",
  revision: 1,
  scheduledAt: "2026-10-21T14:00:00.000Z",
  durationMinutes: 30,
  attendeeEmail: "jordan@example.com",
  customerName: "Jordan Rivera",
  meetingUrl: "https://meet.google.com/abc",
  manageUrl: "https://estimate.example.com/book/token",
  timezone: "America/New_York",
  supportPhone: null,
  brandName: "AllSeason Solar & Roofing",
  repName: null,
};

describe("bookingEmailIsCurrent", () => {
  test("drops reminders for a consultation that moved or was cancelled", () => {
    expect(bookingEmailIsCurrent("reminder_day", state, 1, now)).toBe(true);
    expect(bookingEmailIsCurrent("reminder_day", {...state, revision: 2}, 1, now)).toBe(false);
    expect(bookingEmailIsCurrent("reminder_day", {...state, status: "cancelled"}, 1, now)).toBe(false);
    expect(bookingEmailIsCurrent("reminder_hour", state, 1, new Date("2026-10-21T14:05:00.000Z"))).toBe(false);
  });

  test("sends a cancellation only while the consultation is still cancelled", () => {
    expect(bookingEmailIsCurrent("cancelled", {...state, status: "cancelled", revision: 3}, 3, now)).toBe(true);
    expect(bookingEmailIsCurrent("cancelled", {...state, status: "scheduled", revision: 4}, 3, now)).toBe(false);
  });
});

describe("sendBookingEmail", () => {
  test("sends with a per-revision idempotency key", async () => {
    const send = vi.fn(async () => undefined);
    const result = await sendBookingEmail({kind: "confirmation", appointmentId, revision: 1}, {load: async () => state, send, now: () => now});
    expect(result).toEqual({outcome: "sent"});
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: "jordan@example.com",
      fromName: "AllSeason Solar & Roofing",
      idempotencyKey: `virtual-consultation:${appointmentId}:confirmation:1`,
    }));
  });

  test("skips stale emails without sending", async () => {
    const send = vi.fn(async () => undefined);
    const result = await sendBookingEmail({kind: "confirmation", appointmentId, revision: 1}, {load: async () => ({...state, revision: 2}), send, now: () => now});
    expect(result).toEqual({outcome: "skipped", reason: "stale"});
    expect(send).not.toHaveBeenCalled();
  });
});

describe("reminderTimes", () => {
  test("schedules both reminders when booked days ahead", () => {
    expect(reminderTimes(state.scheduledAt, now)).toEqual({
      dayBefore: new Date("2026-10-20T14:00:00.000Z"),
      hourBefore: new Date("2026-10-21T13:00:00.000Z"),
    });
  });

  test("skips the day-before reminder for a same-day booking", () => {
    expect(reminderTimes("2026-10-19T18:00:00.000Z", now)).toEqual({dayBefore: null, hourBefore: new Date("2026-10-19T17:00:00.000Z")});
  });
});

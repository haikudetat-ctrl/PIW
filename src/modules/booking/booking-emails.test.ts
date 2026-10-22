import {describe, expect, test} from "vitest";
import {composeBookingEmail, type BookingEmailContext, type BookingEmailKind} from "./booking-emails";
import {buildCalendarFile} from "./calendar-file";
import {formatClockTime, formatMeetingTime, timeZoneAbbreviation} from "./booking-format";

const context: BookingEmailContext = {
  firstName: "Jordan",
  brandName: "AllSeason Solar & Roofing",
  startsAt: "2026-10-20T14:00:00.000Z",
  timezone: "America/New_York",
  durationMinutes: 30,
  meetingUrl: "https://meet.google.com/abc-defg-hij",
  manageUrl: "https://estimate.example.com/book/token",
  supportPhone: "(866) 835-6022",
  repName: null,
};

describe("booking time formatting", () => {
  test("renders the company's local time with its abbreviation", () => {
    expect(formatMeetingTime(context.startsAt, context.timezone)).toBe("Tuesday, October 20 at 10:00 AM EDT");
    expect(formatMeetingTime("2026-12-01T15:30:00.000Z", context.timezone)).toBe("Tuesday, December 1 at 10:30 AM EST");
    expect(formatClockTime(context.startsAt, context.timezone)).toBe("10:00 AM");
    expect(timeZoneAbbreviation(context.startsAt, context.timezone)).toBe("EDT");
  });
});

describe("composeBookingEmail", () => {
  const kinds: BookingEmailKind[] = ["confirmation", "rescheduled", "cancelled", "reminder_day", "reminder_hour"];

  test.each(kinds)("%s greets by first name, signs off as the company, and uses no em dashes", (kind) => {
    const email = composeBookingEmail(kind, context);
    expect(email.text.startsWith("Hi Jordan,")).toBe(true);
    expect(email.text).toContain("AllSeason Solar & Roofing");
    expect(`${email.subject}\n${email.text}`).not.toContain("—");
  });

  test("the confirmation says when, how to join, and how to change it", () => {
    const email = composeBookingEmail("confirmation", context);
    expect(email.subject).toBe("You're booked: video consultation Tue, Oct 20, 10:00 AM");
    expect(email.text).toContain("Tuesday, October 20 at 10:00 AM EDT");
    expect(email.text).toContain("Join on Google Meet: https://meet.google.com/abc-defg-hij");
    expect(email.text).toContain("https://estimate.example.com/book/token");
    expect(email.text).toContain("(866) 835-6022");
  });

  test("points to the calendar invite while the Meet link is still being created", () => {
    expect(composeBookingEmail("confirmation", {...context, meetingUrl: null}).text)
      .toContain("Your Google Meet link is in the calendar invite we sent separately.");
  });

  test("names the rep once one is assigned", () => {
    expect(composeBookingEmail("reminder_day", {...context, repName: "Alex Morgan"}).text)
      .toContain("your video consultation with Alex Morgan is tomorrow");
  });

  test("the cancellation offers a way back without pressure", () => {
    const email = composeBookingEmail("cancelled", context);
    expect(email.text).toContain("Nothing else is needed from you.");
    expect(email.text).toContain("whenever it suits you");
  });
});

describe("buildCalendarFile", () => {
  test("produces a single UTC event with an escaped summary and a reminder", () => {
    const file = buildCalendarFile({
      appointmentId: "11111111-1111-4111-8111-111111111111",
      title: "Virtual roof consultation",
      startsAt: "2026-10-20T14:00:00.000Z",
      endsAt: "2026-10-20T14:30:00.000Z",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      organizerName: "AllSeason Solar, Roofing",
      now: new Date("2026-10-19T12:00:00.000Z"),
    });
    expect(file).toContain("DTSTART:20261020T140000Z\r\n");
    expect(file).toContain("DTEND:20261020T143000Z\r\n");
    expect(file).toContain("SUMMARY:Virtual roof consultation with AllSeason Solar\\, Roofing\r\n");
    expect(file).toContain("UID:11111111-1111-4111-8111-111111111111@rake-booking\r\n");
    expect(file).toContain("TRIGGER:-PT15M");
    expect(file.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75)).toBe(true);
  });
});

describe("formatDayRange", () => {
  test("shows a single day or an inclusive range for whole-day blackouts", async () => {
    const {formatDayRange} = await import("./booking-format");
    expect(formatDayRange("2026-11-26T05:00:00.000Z", "2026-11-27T05:00:00.000Z", "America/New_York")).toBe("Thu, Nov 26");
    expect(formatDayRange("2026-11-26T05:00:00.000Z", "2026-11-28T05:00:00.000Z", "America/New_York")).toBe("Thu, Nov 26 to Fri, Nov 27");
  });
});

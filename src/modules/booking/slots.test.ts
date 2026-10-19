import {describe, expect, test} from "vitest";
import {computeAvailableSlots, isProposedSlot, type BookingRules, type SlotEngineInput, type WeeklyWindow} from "./slots";

const rules: BookingRules = {
  timezone: "America/New_York",
  meetingDurationMinutes: 30,
  slotIntervalMinutes: 30,
  bufferMinutes: 0,
  minimumNoticeMinutes: 120,
  bookingHorizonDays: 7,
  concurrentCapacity: 1,
};

// Monday 2026-10-19, 8:00 AM Eastern.
const now = new Date("2026-10-19T12:00:00.000Z");
const weekdays: WeeklyWindow[] = [1, 2, 3, 4, 5].map((weekday) => ({weekday, startMinute: 9 * 60, endMinute: 12 * 60}));

function input(overrides: Partial<SlotEngineInput> = {}): SlotEngineInput {
  return {rules, windows: weekdays, blackouts: [], booked: [], calendarBusy: [], now, ...overrides};
}

function times(days: ReturnType<typeof computeAvailableSlots>, date: string) {
  return days.find((day) => day.date === date)?.slots.map((slot) => slot.startsAt) ?? [];
}

describe("computeAvailableSlots", () => {
  test("lists aligned slots inside weekly hours that finish before the window closes", () => {
    const tuesday = times(computeAvailableSlots(input()), "2026-10-20");
    expect(tuesday).toHaveLength(6);
    expect(tuesday[0]).toBe("2026-10-20T13:00:00.000Z");
    expect(tuesday.at(-1)).toBe("2026-10-20T15:30:00.000Z");
  });

  test("covers today through the horizon and leaves closed days empty", () => {
    const days = computeAvailableSlots(input());
    expect(days[0].date).toBe("2026-10-19");
    expect(days.at(-1)?.date).toBe("2026-10-26");
    expect(times(days, "2026-10-24")).toEqual([]);
  });

  test("respects minimum notice on the first day", () => {
    const monday = times(computeAvailableSlots(input()), "2026-10-19");
    expect(monday[0]).toBe("2026-10-19T14:00:00.000Z");
  });

  test("drops slots that overlap a blackout", () => {
    const days = computeAvailableSlots(input({
      blackouts: [{start: new Date("2026-10-20T13:00:00.000Z"), end: new Date("2026-10-20T14:00:00.000Z")}],
    }));
    expect(times(days, "2026-10-20")[0]).toBe("2026-10-20T14:00:00.000Z");
  });

  test("keeps the buffer around booked meetings and busy calendar time", () => {
    const booked = [{start: new Date("2026-10-20T14:00:00.000Z"), end: new Date("2026-10-20T14:30:00.000Z")}];
    const withBuffer = computeAvailableSlots(input({rules: {...rules, bufferMinutes: 15}, booked}));
    expect(times(withBuffer, "2026-10-20")).toEqual([
      "2026-10-20T13:00:00.000Z",
      "2026-10-20T15:00:00.000Z",
      "2026-10-20T15:30:00.000Z",
    ]);

    const busy = computeAvailableSlots(input({calendarBusy: booked}));
    expect(times(busy, "2026-10-20")).not.toContain("2026-10-20T14:00:00.000Z");
    expect(times(busy, "2026-10-20")).toContain("2026-10-20T14:30:00.000Z");
  });

  test("lets capacity absorb overlapping bookings but not shared calendar blocks", () => {
    const meeting = {start: new Date("2026-10-20T14:00:00.000Z"), end: new Date("2026-10-20T14:30:00.000Z")};
    const twoSeats = {...rules, concurrentCapacity: 2};
    expect(times(computeAvailableSlots(input({rules: twoSeats, booked: [meeting]})), "2026-10-20"))
      .toContain("2026-10-20T14:00:00.000Z");
    expect(times(computeAvailableSlots(input({rules: twoSeats, booked: [meeting, meeting]})), "2026-10-20"))
      .not.toContain("2026-10-20T14:00:00.000Z");
    expect(times(computeAvailableSlots(input({rules: twoSeats, calendarBusy: [meeting]})), "2026-10-20"))
      .not.toContain("2026-10-20T14:00:00.000Z");
  });

  test("keeps local hours across the fall-back transition", () => {
    const sunday = computeAvailableSlots(input({
      now: new Date("2026-10-30T12:00:00.000Z"),
      windows: [{weekday: 0, startMinute: 9 * 60, endMinute: 10 * 60}],
    }));
    expect(times(sunday, "2026-11-01")).toEqual(["2026-11-01T14:00:00.000Z", "2026-11-01T14:30:00.000Z"]);
  });

  test("offers both occurrences of the repeated hour on the fall-back night, like Postgres", () => {
    const night = computeAvailableSlots(input({
      now: new Date("2026-10-30T12:00:00.000Z"),
      windows: [{weekday: 0, startMinute: 30, endMinute: 210}],
    }));
    expect(times(night, "2026-11-01")).toEqual([
      "2026-11-01T04:30:00.000Z",
      "2026-11-01T05:00:00.000Z",
      "2026-11-01T05:30:00.000Z",
      "2026-11-01T06:00:00.000Z",
      "2026-11-01T06:30:00.000Z",
      "2026-11-01T07:00:00.000Z",
      "2026-11-01T07:30:00.000Z",
      "2026-11-01T08:00:00.000Z",
    ]);
  });

  test("never proposes a wall time the spring-forward gap skips", () => {
    const night = computeAvailableSlots(input({
      now: new Date("2026-03-06T12:00:00.000Z"),
      windows: [{weekday: 0, startMinute: 60, endMinute: 4 * 60}],
    }));
    expect(times(night, "2026-03-08")).toEqual([
      "2026-03-08T06:00:00.000Z",
      "2026-03-08T06:30:00.000Z",
      "2026-03-08T07:00:00.000Z",
      "2026-03-08T07:30:00.000Z",
    ]);
  });

  test("recognizes a proposed slot regardless of ISO formatting", () => {
    const days = computeAvailableSlots(input());
    expect(isProposedSlot(days, "2026-10-20T09:00:00-04:00")).toBe(true);
    expect(isProposedSlot(days, "2026-10-20T09:10:00-04:00")).toBe(false);
  });
});

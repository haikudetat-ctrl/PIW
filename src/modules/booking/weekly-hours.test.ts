import {describe, expect, test} from "vitest";
import {parseWeeklyHours, toClock, WeeklyHoursError} from "./weekly-hours";

function form(values: Record<string, string>) {
  return {get: (name: string) => values[name] ?? null};
}

describe("parseWeeklyHours", () => {
  test("reads only the open days, in minutes", () => {
    expect(parseWeeklyHours(form({
      "day-1-open": "on", "day-1-start": "09:00", "day-1-end": "17:30",
      "day-2-start": "09:00", "day-2-end": "17:00",
      "day-6-open": "on", "day-6-start": "20:00", "day-6-end": "00:00",
    }))).toEqual([
      {weekday: 1, startMinute: 540, endMinute: 1050},
      {weekday: 6, startMinute: 1200, endMinute: 1440},
    ]);
  });

  test("rejects a day that ends before it starts or has no times", () => {
    expect(() => parseWeeklyHours(form({"day-1-open": "on", "day-1-start": "17:00", "day-1-end": "09:00"}))).toThrow(WeeklyHoursError);
    expect(() => parseWeeklyHours(form({"day-1-open": "on"}))).toThrow(WeeklyHoursError);
  });

  test("formats minutes back to clock values", () => {
    expect(toClock(540)).toBe("09:00");
    expect(toClock(1440)).toBe("00:00");
  });
});

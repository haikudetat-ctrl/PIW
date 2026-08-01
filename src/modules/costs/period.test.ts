import { describe, expect, it } from "vitest";
import { calendarMonthPeriod, costSlotKey } from "./period";

describe("cost calendar periods", () => {
  it("uses the New York calendar month and schedule slot", () => {
    const now = new Date("2026-08-15T13:00:00.000Z");
    expect(calendarMonthPeriod(now)).toMatchObject({
      start: "2026-08-01",
      endExclusive: "2026-09-01",
      daysInMonth: 31,
      timezone: "America/New_York",
    });
    expect(costSlotKey(now)).toBe("2026-08-15T09");
  });

  it("crosses a UTC month boundary without changing the Eastern month early", () => {
    expect(calendarMonthPeriod(new Date("2026-09-01T02:00:00.000Z")).start).toBe("2026-08-01");
  });
});

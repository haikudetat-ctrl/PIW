import {describe, expect, test} from "vitest";
import {
  addDays,
  wallTimeToInstant,
  weekdayOfDateKey,
  zonedDateKey,
  zonedMinuteOfDay,
  zonedParts,
} from "./zoned-time";

const EASTERN = "America/New_York";

describe("wallTimeToInstant", () => {
  test("uses daylight time in summer and standard time in winter", () => {
    expect(wallTimeToInstant("2026-07-15", 9 * 60, EASTERN)?.toISOString()).toBe("2026-07-15T13:00:00.000Z");
    expect(wallTimeToInstant("2026-12-15", 9 * 60, EASTERN)?.toISOString()).toBe("2026-12-15T14:00:00.000Z");
  });

  test("handles the spring-forward day around the gap", () => {
    expect(wallTimeToInstant("2026-03-08", 60 + 30, EASTERN)?.toISOString()).toBe("2026-03-08T06:30:00.000Z");
    expect(wallTimeToInstant("2026-03-08", 2 * 60 + 30, EASTERN)).toBeNull();
    expect(wallTimeToInstant("2026-03-08", 3 * 60, EASTERN)?.toISOString()).toBe("2026-03-08T07:00:00.000Z");
    expect(wallTimeToInstant("2026-03-08", 9 * 60, EASTERN)?.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });

  test("picks the first occurrence of a repeated fall-back time", () => {
    expect(wallTimeToInstant("2026-11-01", 60 + 30, EASTERN)?.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(wallTimeToInstant("2026-11-01", 9 * 60, EASTERN)?.toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  test("round-trips through zoned parts", () => {
    const instant = wallTimeToInstant("2026-10-21", 14 * 60, EASTERN)!;
    expect(zonedParts(instant, EASTERN)).toMatchObject({year: 2026, month: 10, day: 21, hour: 14, minute: 0, weekday: 3});
    expect(zonedMinuteOfDay(instant, EASTERN)).toBe(14 * 60);
    expect(zonedDateKey(instant, EASTERN)).toBe("2026-10-21");
  });
});

describe("date keys", () => {
  test("adds days across month and year boundaries", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  test("returns the weekday with Sunday as zero", () => {
    expect(weekdayOfDateKey("2026-10-18")).toBe(0);
    expect(weekdayOfDateKey("2026-10-19")).toBe(1);
  });

  test("uses the local date, not the UTC date, late in the evening", () => {
    expect(zonedDateKey(new Date("2026-10-20T02:30:00.000Z"), EASTERN)).toBe("2026-10-19");
  });
});

describe("wallTimeToInstants", () => {
  test("returns both occurrences of a repeated fall-back time and none in the gap", async () => {
    const {wallTimeToInstants} = await import("./zoned-time");
    expect(wallTimeToInstants("2026-11-01", 90, "America/New_York").map((date) => date.toISOString()))
      .toEqual(["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]);
    expect(wallTimeToInstants("2026-03-08", 150, "America/New_York")).toEqual([]);
    expect(wallTimeToInstants("2026-10-20", 600, "America/New_York").map((date) => date.toISOString()))
      .toEqual(["2026-10-20T14:00:00.000Z"]);
  });
});

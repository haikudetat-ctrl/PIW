import { expect, test } from "vitest";
import {
  countSegments,
  fillTemplate,
  isQuietHours,
  mapTwilioStatus,
  optKeyword,
  shouldApplyStatus,
  toUsE164,
  unfilledFields,
} from "./rules";

test("segments follow GSM-7 and UCS-2 limits", () => {
  expect(countSegments("a".repeat(160))).toMatchObject({ encoding: "GSM-7", segments: 1 });
  expect(countSegments("a".repeat(161))).toMatchObject({ encoding: "GSM-7", segments: 2, perSegment: 153 });
  // Extension characters count twice.
  expect(countSegments("€".repeat(80))).toMatchObject({ encoding: "GSM-7", length: 160, segments: 1 });
  expect(countSegments("Roof looks great 👍")).toMatchObject({ encoding: "UCS-2", segments: 1 });
  expect(countSegments("é".repeat(10) + "’".repeat(61))).toMatchObject({ encoding: "UCS-2", segments: 2 });
});

test("quiet hours use New York time and wrap past midnight", () => {
  // 9:30pm and 7:30am EDT are quiet; 8:00am and noon are not.
  expect(isQuietHours(new Date("2026-10-14T01:30:00Z"), 21, 8)).toBe(true);
  expect(isQuietHours(new Date("2026-10-13T11:30:00Z"), 21, 8)).toBe(true);
  expect(isQuietHours(new Date("2026-10-13T12:00:00Z"), 21, 8)).toBe(false);
  expect(isQuietHours(new Date("2026-10-13T16:00:00Z"), 21, 8)).toBe(false);
  expect(isQuietHours(new Date("2026-10-13T16:00:00Z"), 12, 13)).toBe(true);
  expect(isQuietHours(new Date("2026-10-13T16:00:00Z"), 0, 0)).toBe(false);
});

test("opt-out keywords are whole-message and case-insensitive", () => {
  expect(optKeyword(" stop ")).toBe("stop");
  expect(optKeyword("Unsubscribe.")).toBe("stop");
  expect(optKeyword("START")).toBe("start");
  expect(optKeyword("help")).toBe("help");
  expect(optKeyword("please stop by tomorrow")).toBeNull();
});

test("Twilio statuses map onto Rake's and never move backwards", () => {
  expect(mapTwilioStatus("accepted")).toBe("queued");
  expect(mapTwilioStatus("read")).toBe("delivered");
  expect(mapTwilioStatus("canceled")).toBe("failed");
  expect(mapTwilioStatus("receiving")).toBeNull();
  expect(shouldApplyStatus("queued", "delivered")).toBe(true);
  expect(shouldApplyStatus("delivered", "sent")).toBe(false);
  expect(shouldApplyStatus("sent", "undelivered")).toBe(true);
});

test("templates fill known fields and leave unknown ones visible", () => {
  const body = fillTemplate("Hi {first_name}, it's {rep_name} from {company_name}.", {
    first_name: "Maria",
    rep_name: "",
    company_name: "All Season",
  });
  expect(body).toBe("Hi Maria, it's {rep_name} from All Season.");
  expect(unfilledFields(body)).toEqual(["rep_name"]);
});

test("only US numbers become E.164", () => {
  expect(toUsE164("(856) 555-0142")).toBe("+18565550142");
  expect(toUsE164("1-856-555-0142")).toBe("+18565550142");
  expect(toUsE164("+18565550142")).toBe("+18565550142");
  expect(toUsE164("555-0142")).toBeNull();
  expect(toUsE164("+442071234567")).toBeNull();
  expect(toUsE164(null)).toBeNull();
});

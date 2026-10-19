import {describe, expect, test} from "vitest";
import {normalizeCalendarId} from "./calendar-id";

const id = "c_6086847a84413d6b1cc19d7ec7dc143bd63c04c37127779d7af3cd7d94971c22@group.calendar.google.com";

describe("normalizeCalendarId", () => {
  test("keeps a plain calendar ID or a user's address", () => {
    expect(normalizeCalendarId(id)).toBe(id);
    expect(normalizeCalendarId("scheduling@allseason.example")).toBe("scheduling@allseason.example");
  });

  test("drops a mailto link and spaces a phone adds when copying", () => {
    expect(normalizeCalendarId(`mailto:${id}`)).toBe(id);
    expect(normalizeCalendarId(`  MAILTO:${id} `)).toBe(id);
  });

  test("takes the ID out of the calendar's public or embed URL", () => {
    const encoded = id.replace("@", "%40");
    expect(normalizeCalendarId(`https://calendar.google.com/calendar/embed?src=${encoded}&ctz=America%2FNew_York`)).toBe(id);
    expect(normalizeCalendarId(encoded)).toBe(id);
  });

  test("rejects anything that is not a calendar ID", () => {
    expect(normalizeCalendarId("primary")).toBeNull();
    expect(normalizeCalendarId("Virtual consultations")).toBeNull();
    expect(normalizeCalendarId("https://calendar.google.com/calendar/u/0/r")).toBeNull();
    expect(normalizeCalendarId("mailto:")).toBeNull();
  });
});

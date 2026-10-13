import { expect, test } from "vitest";
import {
  buildRespondNow,
  formatDue,
  formatToday,
  formatWaiting,
  greeting,
  groupTasks,
  startOfDay,
  startOfMonth,
  waitingTone,
} from "./my-day";

// 8:30am in New York (EDT).
const NOW = new Date("2026-10-13T12:30:00.000Z");

test("the day follows New York time", () => {
  expect(greeting(NOW)).toBe("Good morning");
  expect(greeting(new Date("2026-10-13T19:00:00.000Z"))).toBe("Good afternoon");
  expect(greeting(new Date("2026-10-14T01:00:00.000Z"))).toBe("Good evening");
  expect(formatToday(NOW)).toBe("Tuesday, October 13");
  expect(startOfDay(NOW).toISOString()).toBe("2026-10-13T04:00:00.000Z");
  expect(startOfMonth(NOW).toISOString()).toBe("2026-10-01T04:00:00.000Z");
  expect(startOfMonth(new Date("2026-12-15T12:00:00.000Z")).toISOString()).toBe("2026-12-01T05:00:00.000Z");
});

test("speed to lead turns late after 5 minutes and cold after an hour", () => {
  expect(waitingTone("2026-10-13T12:27:00.000Z", NOW)).toBe("ok");
  expect(waitingTone("2026-10-13T12:00:00.000Z", NOW)).toBe("late");
  expect(waitingTone("2026-10-13T10:00:00.000Z", NOW)).toBe("cold");
  expect(formatWaiting("2026-10-13T12:00:00.000Z", NOW)).toBe("30m");
  expect(formatWaiting("2026-10-11T12:00:00.000Z", NOW)).toBe("2d");
});

test("respond now mixes Rake and JobNimbus leads, newest first", () => {
  const items = buildRespondNow(
    [
      {
        id: "lead-1",
        name: "Maria Alvarez",
        phone: "+16095550101",
        submitted_address: "14 Linden Ave",
        source_system: "piw_intake",
        created_at: "2026-10-13T12:00:00.000Z",
        estimate: "$14.2k–$21.3k",
      },
    ],
    [
      {
        jnid: "jn-1",
        number: "3729",
        name: null,
        phone: null,
        address: "106 Mount Vernon Drive, Cinnaminson",
        source: "RC",
        created_at: "2026-10-13T12:20:00.000Z",
      },
    ],
    6,
  );
  expect(items.map((item) => [item.name, item.href, item.detail])).toEqual([
    ["Job #3729", "/jobs/jn-1", "RC · 106 Mount Vernon Drive, Cinnaminson"],
    ["Maria Alvarez", "/leads/lead-1", "Website · 14 Linden Ave"],
  ]);
});

test("tasks group into overdue, today and coming up", () => {
  const task = (id: string, due_at: string | null) => ({
    id,
    title: id,
    due_at,
    lead_id: "lead-1",
    lead_name: "Maria Alvarez",
    lead_stage: "new",
  });
  const groups = groupTasks(
    [
      task("later-today", "2026-10-13T20:00:00.000Z"),
      task("no-date", null),
      task("yesterday", "2026-10-12T15:00:00.000Z"),
      task("earlier-today", "2026-10-13T11:00:00.000Z"),
      task("tomorrow", "2026-10-14T15:00:00.000Z"),
    ],
    NOW,
  );
  expect(groups.overdue.map((row) => row.id)).toEqual(["yesterday", "earlier-today"]);
  expect(groups.dueToday.map((row) => row.id)).toEqual(["later-today"]);
  expect(groups.upcoming.map((row) => row.id)).toEqual(["tomorrow", "no-date"]);
  expect(formatDue("2026-10-12T15:00:00.000Z", NOW)).toBe("Yesterday");
  expect(formatDue("2026-10-13T11:00:00.000Z", NOW)).toBe("Today");
  expect(formatDue("2026-10-13T20:00:00.000Z", NOW)).toBe("4:00 PM");
  expect(formatDue("2026-10-09T15:00:00.000Z", NOW)).toBe("4d late");
});

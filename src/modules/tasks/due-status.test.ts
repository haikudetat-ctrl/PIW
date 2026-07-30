import { expect, test } from "vitest";
import { dueStatus } from "./due-status";

const now = new Date("2026-07-29T12:00:00.000Z");

test("an open task past its due date is overdue", () => {
  expect(dueStatus({ dueAt: "2026-07-28T12:00:00.000Z", status: "open" }, now)).toBe("overdue");
});

test("an open task before its due date is upcoming", () => {
  expect(dueStatus({ dueAt: "2026-07-30T12:00:00.000Z", status: "open" }, now)).toBe("upcoming");
});

test("a completed task has no due status", () => {
  expect(dueStatus({ dueAt: "2026-07-28T12:00:00.000Z", status: "complete" }, now)).toBe("none");
});

test("a task without a due date has no due status", () => {
  expect(dueStatus({ dueAt: null, status: "open" }, now)).toBe("none");
});

import { expect, test } from "vitest";
import { taskInputSchema } from "./schema";

test("requires a nonempty title", () => {
  expect(() => taskInputSchema.parse({ title: "" })).toThrow();
  expect(taskInputSchema.parse({ title: "Call homeowner" })).toEqual({
    title: "Call homeowner",
    description: undefined,
    dueAt: undefined,
    assignedTo: undefined,
  });
});

test("treats an empty dueAt the same as absent, matching an untouched form field", () => {
  expect(
    taskInputSchema.parse({ title: "Call homeowner", dueAt: "" }),
  ).toEqual({
    title: "Call homeowner",
    description: undefined,
    dueAt: undefined,
    assignedTo: undefined,
  });
});

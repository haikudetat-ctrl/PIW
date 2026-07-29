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

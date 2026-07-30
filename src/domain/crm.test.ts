import { expect, test } from "vitest";
import {
  interactionTypeSchema,
  leadStageSchema,
  notificationTypeSchema,
  taskStatusSchema,
} from "./crm";

test("lead stage is the eight-stage commercial pipeline", () => {
  expect(leadStageSchema.options).toEqual([
    "new",
    "contacting",
    "appointment_set",
    "estimating",
    "proposal_sent",
    "won",
    "lost",
    "nurture",
  ]);
});

test("interaction type is explicit", () => {
  expect(interactionTypeSchema.options).toEqual([
    "call",
    "email",
    "text",
    "site_visit",
    "note",
  ]);
});

test("task status is explicit", () => {
  expect(taskStatusSchema.options).toEqual(["open", "complete", "cancelled"]);
});

test("notification type is explicit", () => {
  expect(notificationTypeSchema.options).toEqual([
    "lead_submitted",
    "review_task_created",
    "pipeline_stuck",
    "pipeline_failed",
  ]);
});

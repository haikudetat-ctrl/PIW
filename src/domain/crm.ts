import { z } from "zod";

export const leadStageSchema = z.enum([
  "new",
  "contacting",
  "appointment_set",
  "estimating",
  "proposal_sent",
  "won",
  "lost",
  "nurture",
]);

export const interactionTypeSchema = z.enum([
  "call",
  "email",
  "text",
  "site_visit",
  "note",
]);

export const taskStatusSchema = z.enum(["open", "complete", "cancelled"]);

export const notificationTypeSchema = z.enum([
  "lead_submitted",
  "review_task_created",
  "pipeline_stuck",
  "pipeline_failed",
]);

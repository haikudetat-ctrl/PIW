import { z } from "zod";

export const pipelineStatusSchema = z.enum([
  "received",
  "validating",
  "enriching",
  "analyzing",
  "scoring",
  "estimating",
  "complete",
  "partial",
  "review_required",
  "failed",
]);

export const workerStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "partial",
  "review_required",
  "failed",
]);

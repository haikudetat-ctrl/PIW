import { expect, test } from "vitest";
import { buildActivityTimeline } from "./activity-timeline";

test("merges stage history and interactions in descending time order", () => {
  const timeline = buildActivityTimeline(
    [{ changed_at: "2026-07-29T10:00:00.000Z", from_stage: null, to_stage: "new" }],
    [{ occurred_at: "2026-07-29T12:00:00.000Z", type: "call", summary: "Left a voicemail" }],
  );

  expect(timeline).toEqual([
    { kind: "interaction", occurredAt: "2026-07-29T12:00:00.000Z", interactionType: "call", summary: "Left a voicemail" },
    { kind: "stage_change", occurredAt: "2026-07-29T10:00:00.000Z", fromStage: null, toStage: "new" },
  ]);
});

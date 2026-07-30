import { expect, test } from "vitest";
import { stuckSinceIso, summarizePipelineTotals } from "./pipeline-totals";

test("zero-fills every stage and counts leads by stage", () => {
  const totals = summarizePipelineTotals([{ stage: "new" }, { stage: "new" }, { stage: "won" }]);

  expect(totals).toEqual({
    new: 2,
    contacting: 0,
    appointment_set: 0,
    estimating: 0,
    proposal_sent: 0,
    won: 1,
    lost: 0,
    nurture: 0,
  });
});

test("computes an ISO timestamp N minutes before the given instant", () => {
  expect(stuckSinceIso(15, new Date("2026-07-29T12:15:00.000Z"))).toBe(
    "2026-07-29T12:00:00.000Z",
  );
});

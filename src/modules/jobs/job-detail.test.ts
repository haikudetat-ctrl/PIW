import { expect, test } from "vitest";
import { boardStageFor, formatSyncAge, jobProgress, jobTitle, journeyEventLabel } from "./job-detail";

test("board stage follows the JobNimbus status mapping", () => {
  expect(boardStageFor("quoted", "Quoted")).toBe("proposal_sent");
  expect(boardStageFor("in_production", "Job Prep")).toBe("won");
  expect(boardStageFor("appointment_no_show", "No Show")).toBe("appointment_set");
  expect(boardStageFor(null, "Estimating")).toBe("estimating");
  expect(boardStageFor(null, "Lead")).toBe("new");
});

test("progress marks steps before the current status done, dated by the earliest journey event", () => {
  const steps = jobProgress("quoted", [
    { stage: "handoff", occurred_at: "2026-09-02T12:00:00Z" },
    { stage: "lead_received", occurred_at: "2026-09-01T12:00:00Z" },
    { stage: "quoted", occurred_at: "2026-09-05T12:00:00Z" },
  ]);
  expect(steps.map((step) => [step.key, step.state, step.date])).toEqual([
    ["lead", "done", "2026-09-01T12:00:00Z"],
    ["appointment", "done", null],
    ["quoted", "current", "2026-09-05T12:00:00Z"],
    ["sold", "upcoming", null],
    ["in_production", "upcoming", null],
    ["completed", "upcoming", null],
  ]);
});

test("an unmapped status starts the tracker at Lead", () => {
  expect(jobProgress(null, [])[0]).toMatchObject({ key: "lead", state: "current" });
});

test("titles, labels and sync age read plainly", () => {
  expect(jobTitle({ job_type: " Roof replacement ", number: "1042" })).toBe("Roof replacement");
  expect(jobTitle({ job_type: null, number: "1042" })).toBe("Job #1042");
  expect(journeyEventLabel("handoff")).toBe("Created in JobNimbus");
  expect(journeyEventLabel("mystery_step")).toBe("mystery step");
  const now = new Date("2026-10-13T12:00:00Z");
  expect(formatSyncAge("2026-10-13T11:58:00Z", now)).toBe("2m ago");
  expect(formatSyncAge("2026-10-13T09:00:00Z", now)).toBe("3h ago");
});

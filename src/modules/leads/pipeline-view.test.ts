import { describe, expect, test } from "vitest";
import {
  buildPipelineCards,
  classifyDue,
  formatAge,
  formatCompactCurrency,
  summarizePipeline,
  type PipelineLeadRow,
} from "./pipeline-view";

// 10:00 AM in New Jersey (EDT, UTC-4).
const NOW = new Date("2026-10-10T14:00:00.000Z");

function lead(overrides: Partial<PipelineLeadRow> = {}): PipelineLeadRow {
  return {
    id: "lead-1",
    name: "Maria Alvarez",
    submitted_address: "14 Linden Ave, Haddonfield, NJ",
    stage: "new",
    created_at: "2026-10-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("classifyDue", () => {
  test("past due times are overdue", () => {
    expect(classifyDue("2026-10-10T13:00:00.000Z", NOW)).toBe("overdue");
  });

  test("later the same New Jersey day is today, even after UTC midnight", () => {
    // 11:30 PM EDT on Oct 10 is already Oct 11 in UTC.
    expect(classifyDue("2026-10-11T03:30:00.000Z", NOW)).toBe("today");
  });

  test("future days are upcoming and missing dates are unscheduled", () => {
    expect(classifyDue("2026-10-11T14:00:00.000Z", NOW)).toBe("upcoming");
    expect(classifyDue(null, NOW)).toBe("unscheduled");
  });
});

test("formatAge uses the largest whole unit", () => {
  expect(formatAge("2026-10-10T13:22:00.000Z", NOW)).toBe("38m");
  expect(formatAge("2026-10-10T09:00:00.000Z", NOW)).toBe("5h");
  expect(formatAge("2026-10-07T14:00:00.000Z", NOW)).toBe("3d");
});

test("formatCompactCurrency abbreviates thousands and millions", () => {
  expect(formatCompactCurrency(1_420_000)).toBe("$14.2k");
  expect(formatCompactCurrency(124_000_000)).toBe("$1.24M");
  expect(formatCompactCurrency(45_000)).toBe("$450");
});

test("buildPipelineCards joins the ready estimate and the earliest-due open task", () => {
  const [card] = buildPipelineCards(
    [lead()],
    [
      { lead_id: "lead-1", status: "failed", range_low_cents: null, range_high_cents: null, roof_squares: null },
      { lead_id: "lead-1", status: "ready", range_low_cents: 1_420_000, range_high_cents: 2_130_000, roof_squares: "28.4" },
    ],
    [
      { lead_id: "lead-1", title: "No date", due_at: null, status: "open" },
      { lead_id: "lead-1", title: "Done already", due_at: "2026-10-09T12:00:00.000Z", status: "complete" },
      { lead_id: "lead-1", title: "Call back", due_at: "2026-10-10T18:00:00.000Z", status: "open" },
      { lead_id: "lead-1", title: "Later", due_at: "2026-10-12T18:00:00.000Z", status: "open" },
    ],
    NOW,
  );

  expect(card.estimate).toEqual({ kind: "ready", lowCents: 1_420_000, highCents: 2_130_000, squares: 28.4 });
  expect(card.nextStep).toEqual({ title: "Call back", due: "today", dueAt: "2026-10-10T18:00:00.000Z" });
  expect(card.ageLabel).toBe("2h");
});

test("buildPipelineCards reports pending, unavailable and missing estimates", () => {
  const cards = buildPipelineCards(
    [lead({ id: "a" }), lead({ id: "b" }), lead({ id: "c" })],
    [
      { lead_id: "a", status: "pending", range_low_cents: null, range_high_cents: null, roof_squares: null },
      { lead_id: "b", status: "no_coverage", range_low_cents: null, range_high_cents: null, roof_squares: null },
    ],
    [],
    NOW,
  );
  expect(cards.map((card) => card.estimate.kind)).toEqual(["pending", "unavailable", "none"]);
  expect(cards[0].nextStep).toBeNull();
});

test("summarizePipeline counts only open stages", () => {
  const cards = buildPipelineCards(
    [
      lead({ id: "a", stage: "new" }),
      lead({ id: "b", stage: "estimating" }),
      lead({ id: "c", stage: "won" }),
    ],
    [
      { lead_id: "a", status: "ready", range_low_cents: 100_000, range_high_cents: 200_000, roof_squares: 2 },
      { lead_id: "b", status: "ready", range_low_cents: 300_000, range_high_cents: 400_000, roof_squares: 6 },
      { lead_id: "c", status: "ready", range_low_cents: 900_000, range_high_cents: 900_000, roof_squares: 9 },
    ],
    [
      { lead_id: "a", title: "Call", due_at: "2026-10-10T13:00:00.000Z", status: "open" },
      { lead_id: "b", title: "Visit", due_at: "2026-10-10T20:00:00.000Z", status: "open" },
      { lead_id: "c", title: "Thank-you card", due_at: "2026-10-10T13:00:00.000Z", status: "open" },
    ],
    NOW,
  );

  expect(summarizePipeline(cards)).toEqual({
    openLeads: 2,
    openValueLowCents: 400_000,
    openValueHighCents: 600_000,
    estimatesReadyUncontacted: 1,
    dueToday: 1,
    overdue: 1,
  });
});

import { describe, expect, it } from "vitest";
import {
  CENSUS_JOB_FIELDS,
  accuracySummary,
  fieldFill,
  formatShare,
  funnelReportSchema,
  funnelSteps,
  parseReportRange,
  periodChange,
} from "./reports";

const NOW = new Date("2026-10-14T12:00:00Z");

describe("report range", () => {
  it("defaults to the last 90 days", () => {
    const range = parseReportRange(undefined, NOW);
    expect(range.key).toBe("90");
    expect(range.label).toBe("Last 90 days");
    expect(range.from.toISOString()).toBe("2026-07-16T12:00:00.000Z");
    expect(range.to).toBe(NOW);
  });

  it("accepts the listed ranges and ignores anything else", () => {
    expect(parseReportRange("365", NOW).label).toBe("Last 12 months");
    expect(parseReportRange(["30", "90"], NOW).key).toBe("30");
    expect(parseReportRange("all", NOW).from.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(parseReportRange("7", NOW).key).toBe("90");
  });
});

describe("funnel", () => {
  it("reads the database payload and shows each step against the one before", () => {
    const report = funnelReportSchema.parse({
      leads: 1994,
      prior_leads: 527,
      steps: [
        { key: "lead", customers: 1994 },
        { key: "appointment", customers: 1756 },
        { key: "quoted", customers: 1731 },
        { key: "sold", customers: 163 },
        { key: "completed", customers: 0 },
      ],
      lost: 11,
      sold_jobs: 152,
      revenue: "2148953.64",
      median_days: { lead_to_quoted: 0.002, quoted_to_sold: 7.28, sold_to_completed: null },
      sources: [{ source: "RC", leads: 553, quoted: 417, sold: 29, revenue: 487137 }],
    });
    expect(report.revenue).toBe(2148953.64);
    const steps = funnelSteps(report.steps);
    expect(steps[0].ofPrevious).toBeNull();
    expect(formatShare(steps[3].ofPrevious)).toBe("9%");
    expect(steps[4].ofPrevious).toBe(0);
  });

  it("compares with the prior period only when it had leads", () => {
    expect(periodChange(1994, 527)).toBeCloseTo(2.784, 3);
    expect(periodChange(12, 0)).toBeNull();
    expect(formatShare(null)).toBe("—");
  });
});

describe("measurement accuracy", () => {
  it("measures Google Solar against Roofr", () => {
    const summary = accuracySummary([
      { lead_id: "a", lead_name: "A", job_jnid: "j1", estimate_squares: 22, roofr_squares: 20 },
      { lead_id: "b", lead_name: "B", job_jnid: "j2", estimate_squares: 19, roofr_squares: 20 },
      { lead_id: "c", lead_name: "C", job_jnid: "j3", estimate_squares: 30, roofr_squares: 20 },
    ]);
    expect(summary.sampleSize).toBe(3);
    expect(summary.medianAbsolutePercentError).toBeCloseTo(0.1, 6);
    expect(summary.withinTenPercent).toBeCloseTo(2 / 3, 6);
    expect(summary.medianSignedPercentError).toBeCloseTo(0.1, 6);
  });

  it("claims nothing without pairs", () => {
    expect(accuracySummary([])).toEqual({
      sampleSize: 0,
      medianAbsolutePercentError: null,
      withinTenPercent: null,
      medianSignedPercentError: null,
    });
  });
});

describe("census", () => {
  it("reports fill rates and the change since the previous census", () => {
    const fill = fieldFill(
      CENSUS_JOB_FIELDS,
      { total: 200, counts: { address_line1: 190, shingle_line: 100 } },
      { total: 100, counts: { address_line1: 90, shingle_line: 60 } },
    );
    expect(fill.find((field) => field.key === "address_line1")).toMatchObject({ rate: 0.95, change: expect.closeTo(0.05, 6) });
    expect(fill.find((field) => field.key === "shingle_line")).toMatchObject({ rate: 0.5, change: expect.closeTo(-0.1, 6) });
    expect(fill.find((field) => field.key === "zip")).toMatchObject({ rate: 0, change: 0 });
  });

  it("has no rate without jobs and no change without a previous census", () => {
    const [first] = fieldFill(CENSUS_JOB_FIELDS, { total: 0, counts: {} }, null);
    expect(first).toMatchObject({ rate: null, change: null });
  });
});

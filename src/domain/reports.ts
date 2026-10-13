import { z } from "zod";

// Reports read three database functions (report_funnel, report_jobs,
// report_measurements) and the JobNimbus census. These schemas pin the JSON
// they return, and the helpers below turn it into what the pages show.

const count = z.coerce.number().int().nonnegative();
const money = z.coerce.number();

export const reportRangeKeys = ["30", "90", "365", "all"] as const;
export type ReportRangeKey = (typeof reportRangeKeys)[number];

const RANGE_LABEL: Record<ReportRangeKey, string> = {
  "30": "Last 30 days",
  "90": "Last 90 days",
  "365": "Last 12 months",
  all: "All time",
};

// JobNimbus history in PIW starts mid-2025; "all" reaches well before it.
const ALL_TIME_FROM = new Date("2020-01-01T00:00:00Z");

export type ReportRange = { key: ReportRangeKey; label: string; from: Date; to: Date };

export function parseReportRange(value: string | string[] | undefined, now: Date): ReportRange {
  const raw = Array.isArray(value) ? value[0] : value;
  const key = (reportRangeKeys as readonly string[]).includes(raw ?? "") ? (raw as ReportRangeKey) : "90";
  const to = now;
  const from = key === "all" ? ALL_TIME_FROM : new Date(now.getTime() - Number(key) * 24 * 60 * 60 * 1_000);
  return { key, label: RANGE_LABEL[key], from, to };
}

export function rangeLabel(key: ReportRangeKey): string {
  return RANGE_LABEL[key];
}

export const funnelReportSchema = z.object({
  leads: count,
  prior_leads: count,
  steps: z.array(z.object({ key: z.enum(["lead", "appointment", "quoted", "sold", "completed"]), customers: count })),
  lost: count,
  sold_jobs: count,
  revenue: money,
  median_days: z.object({
    lead_to_quoted: z.number().nullable(),
    quoted_to_sold: z.number().nullable(),
    sold_to_completed: z.number().nullable(),
  }),
  sources: z.array(z.object({ source: z.string(), leads: count, quoted: count, sold: count, revenue: money })),
});
export type FunnelReport = z.infer<typeof funnelReportSchema>;

export const jobsReportSchema = z.object({
  jobs: count,
  quoted: count,
  sold: count,
  revenue: money,
  measured: count,
  monthly: z.array(z.object({ month: z.string(), jobs: count, sold: count, revenue: money })),
  reps: z.array(z.object({ rep: z.string(), jobs: count, quoted: count, sold: count, revenue: money })),
  shingle_lines: z.array(z.object({ label: z.string(), jobs: count, revenue: money })),
  job_types: z.array(z.object({ label: z.string(), jobs: count })),
  record_types: z.array(z.object({ label: z.string(), jobs: count })),
  territory: z.array(z.object({ city: z.string(), jobs: count, sold: count, measured: count })),
});
export type JobsReport = z.infer<typeof jobsReportSchema>;

export const measurementsReportSchema = z.object({
  estimates: z.record(z.string(), count),
  roofr: z.record(z.string(), count),
  pairs: z.array(
    z.object({
      lead_id: z.string(),
      lead_name: z.string(),
      job_jnid: z.string(),
      estimate_squares: z.coerce.number().positive(),
      roofr_squares: z.coerce.number().positive(),
    }),
  ),
});
export type MeasurementsReport = z.infer<typeof measurementsReportSchema>;

export const censusRowSchema = z.object({
  captured_at: z.string(),
  jobs: count,
  contacts: count,
  job_field_counts: z.record(z.string(), count),
  contact_field_counts: z.record(z.string(), count),
  unmapped_statuses: z.array(z.object({ status: z.string(), jobs: count })),
});
export type CensusRow = z.infer<typeof censusRowSchema>;

// Share of `part` in `whole`, or null when there is no denominator.
export function share(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export function formatShare(value: number | null, digits = 0): string {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

// Change against the prior period, or null when the prior period was empty.
export function periodChange(current: number, prior: number): number | null {
  return prior > 0 ? (current - prior) / prior : null;
}

export type FunnelStep = { key: string; customers: number; ofPrevious: number | null };

export function funnelSteps(steps: FunnelReport["steps"]): FunnelStep[] {
  return steps.map((step, index) => ({
    key: step.key,
    customers: step.customers,
    ofPrevious: index === 0 ? null : share(step.customers, steps[index - 1].customers),
  }));
}

export type AccuracySummary = {
  sampleSize: number;
  medianAbsolutePercentError: number | null;
  withinTenPercent: number | null;
  // Positive when Google Solar reads larger than Roofr.
  medianSignedPercentError: number | null;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Roofr is the measured truth; Google Solar is the estimate being checked.
export function accuracySummary(pairs: MeasurementsReport["pairs"]): AccuracySummary {
  const signed = pairs.map((pair) => (pair.estimate_squares - pair.roofr_squares) / pair.roofr_squares);
  const absolute = signed.map(Math.abs);
  return {
    sampleSize: pairs.length,
    medianAbsolutePercentError: median(absolute),
    withinTenPercent: share(absolute.filter((error) => error <= 0.1).length, absolute.length),
    medianSignedPercentError: median(signed),
  };
}

// Below this many pairs the accuracy read is directional only (roof-quote used
// the same floor).
export const ACCURACY_MIN_SAMPLE = 10;

export const CENSUS_JOB_FIELDS = [
  { key: "address_line1", label: "Street address" },
  { key: "city", label: "City" },
  { key: "zip", label: "ZIP" },
  { key: "status_name", label: "Status" },
  { key: "sales_rep_name", label: "Sales rep" },
  { key: "shingle_line", label: "Shingle line" },
  { key: "job_type", label: "Job type" },
  { key: "approved_total", label: "Approved total" },
] as const;

export const CENSUS_CONTACT_FIELDS = [
  { key: "phone_normalized", label: "Phone" },
  { key: "email_normalized", label: "Email" },
  { key: "address_line1", label: "Street address" },
  { key: "source_name", label: "Lead source" },
] as const;

export type FieldFill = { key: string; label: string; rate: number | null; change: number | null };

// Fill rate per field in the latest census, and the change in points against
// the previous one. A field can be fully filled and still mapped wrong, which
// is why unmapped statuses are reported next to it.
export function fieldFill(
  fields: readonly { key: string; label: string }[],
  latest: { total: number; counts: Record<string, number> },
  previous: { total: number; counts: Record<string, number> } | null,
): FieldFill[] {
  return fields.map((field) => {
    const rate = share(latest.counts[field.key] ?? 0, latest.total);
    const prior = previous ? share(previous.counts[field.key] ?? 0, previous.total) : null;
    return {
      key: field.key,
      label: field.label,
      rate,
      change: rate !== null && prior !== null ? rate - prior : null,
    };
  });
}

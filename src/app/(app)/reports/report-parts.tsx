import Link from "next/link";
import type { ReactNode } from "react";
import { createServerClient } from "@/lib/supabase/server";
import { formatShare, reportRangeKeys, rangeLabel, share, type ReportRange, type ReportRangeKey } from "@/domain/reports";

// Shared pieces of the Reports pages, following the Figma "Reports — Funnel"
// frame: segmented tabs beside the title, a range control on the right, KPI
// tiles, and single-hue bars with values in text colour.

export const REPORT_TABS = [
  { key: "funnel", label: "Funnel", href: "/reports" },
  { key: "revenue", label: "Revenue", href: "/reports/revenue" },
  { key: "reps", label: "Reps", href: "/reports/reps" },
  { key: "production", label: "Production", href: "/reports/production" },
  { key: "accuracy", label: "Accuracy", href: "/reports/accuracy" },
  { key: "quality", label: "Data quality", href: "/reports/quality" },
] as const;

export type ReportTab = (typeof REPORT_TABS)[number]["key"];

function withRange(href: string, range: ReportRangeKey) {
  return range === "90" ? href : `${href}?range=${range}`;
}

export function ReportsHeader({
  active,
  range,
  showRange = true,
}: {
  active: ReportTab;
  range: ReportRangeKey;
  // Accuracy and data quality describe the current state, not a period.
  showRange?: boolean;
}) {
  const activeTab = REPORT_TABS.find((tab) => tab.key === active)!;
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-[28px] font-bold tracking-tight text-ink">Reports</h1>
        <nav aria-label="Reports" className="flex flex-wrap gap-0.5 rounded-lg bg-surface-muted p-0.5">
          {REPORT_TABS.map((tab) => (
            <Link
              key={tab.key}
              href={withRange(tab.href, range)}
              aria-current={tab.key === active ? "page" : undefined}
              className={`rounded-md px-3 py-1 text-[13px] font-medium ${
                tab.key === active ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
      {showRange ? (
        <nav aria-label="Date range" className="flex flex-wrap gap-0.5 rounded-lg border border-border-strong bg-surface p-0.5">
          {reportRangeKeys.map((key) => (
            <Link
              key={key}
              href={withRange(activeTab.href, key)}
              aria-current={key === range ? "true" : undefined}
              className={`rounded-md px-2.5 py-1 text-[13px] font-medium ${
                key === range ? "bg-fill-selected text-tint" : "text-ink-muted hover:text-ink"
              }`}
            >
              {rangeLabel(key)}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

export function Panel({
  title,
  detail,
  right,
  children,
}: {
  title: string;
  detail?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="min-w-0 rounded-2xl bg-surface p-5 shadow-card">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
          {detail ? <p className="mt-0.5 text-xs text-ink-subtle">{detail}</p> : null}
        </div>
        {right ? <div className="text-xs text-ink-subtle">{right}</div> : null}
      </div>
      {children}
    </section>
  );
}

// One labelled horizontal bar. `fraction` is the bar length (0–1).
export function BarRow({
  label,
  value,
  fraction,
  note,
  noteTone = "muted",
}: {
  label: string;
  value: string;
  fraction: number;
  note?: string;
  noteTone?: "muted" | "warning";
}) {
  const width = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className="grid grid-cols-[minmax(6rem,9rem)_1fr_auto] items-center gap-3 py-1.5 sm:grid-cols-[minmax(6rem,9rem)_1fr_4.5rem_7.5rem]">
      <dt className="truncate text-[13px] text-ink">{label}</dt>
      <div className="h-5 rounded bg-surface-muted" aria-hidden>
        {width > 0 ? <div className="h-5 rounded bg-accent" style={{ width: `${width}%` }} /> : null}
      </div>
      <dd className="text-right text-[13px] font-semibold text-ink tabular-nums">{value}</dd>
      <dd className={`hidden text-xs sm:block ${noteTone === "warning" ? "text-warning" : "text-ink-subtle"}`}>
        {note ?? ""}
      </dd>
    </div>
  );
}

// Share of each row in the total, as bars.
export function MixList({ rows, total }: { rows: { label: string; jobs: number }[]; total: number }) {
  if (rows.length === 0) return <EmptyNote>No jobs in this period.</EmptyNote>;
  return (
    <dl>
      {rows.map((row) => (
        <BarRow
          key={row.label}
          label={row.label}
          value={row.jobs.toLocaleString()}
          fraction={total > 0 ? row.jobs / total : 0}
          note={formatShare(share(row.jobs, total))}
        />
      ))}
    </dl>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-subtle">{children}</p>;
}

export const tableClasses = {
  wrap: "-mx-5 overflow-x-auto",
  table: "w-full min-w-[36rem] text-[13px]",
  head: "border-b border-border text-left text-xs text-ink-subtle",
  th: "px-5 py-2 font-medium",
  num: "px-5 py-2 text-right font-medium tabular-nums",
  row: "border-b border-border last:border-b-0",
  cell: "px-5 py-2.5 text-ink",
  cellNum: "px-5 py-2.5 text-right text-ink tabular-nums",
};

export function formatDollars(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 10_000) return `$${Math.round(value / 1_000)}k`;
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function formatDays(days: number | null): string {
  if (days === null) return "—";
  if (days < 1) return `${Math.round(days * 24)} h`;
  return `${days.toFixed(1)} d`;
}

export async function callReport(name: "report_funnel" | "report_jobs", range: ReportRange): Promise<unknown>;
export async function callReport(name: "report_measurements"): Promise<unknown>;
export async function callReport(
  name: "report_funnel" | "report_jobs" | "report_measurements",
  range?: ReportRange,
): Promise<unknown> {
  const supabase = await createServerClient();
  const { data, error } =
    name === "report_measurements"
      ? await supabase.rpc(name)
      : await supabase.rpc(name, { p_from: range!.from.toISOString(), p_to: range!.to.toISOString() });
  if (error) throw new Error(`Failed to load ${name.replace("report_", "")} report`);
  return data;
}

import { formatDollars } from "./report-parts";

// Revenue per month as single-hue columns. Each column carries its own hover
// tooltip; the table beside it on the page is the accessible view.
export function MonthlyRevenueChart({
  months,
}: {
  months: { month: string; jobs: number; sold: number; revenue: number }[];
}) {
  const max = Math.max(1, ...months.map((month) => month.revenue));
  return (
    <figure aria-label="Revenue sold per month" className="flex flex-col gap-2">
      <div className="flex h-44 items-end gap-0.5 border-b border-border">
        {months.map((month) => (
          <div key={month.month} className="group relative flex h-full flex-1 flex-col justify-end">
            <div
              className="rounded-t bg-accent transition-opacity group-hover:opacity-80"
              style={{ height: `${(month.revenue / max) * 100}%`, minHeight: month.revenue > 0 ? 2 : 0 }}
            />
            <div
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-lg bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap text-ink shadow-card group-hover:block"
            >
              <span className="font-semibold">{formatMonth(month.month)}</span> · {formatDollars(month.revenue)} ·{" "}
              {month.sold} sold of {month.jobs}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-0.5 text-[11px] text-ink-subtle">
        {months.map((month, index) => (
          <span key={month.month} className="flex-1 text-center">
            {index % Math.ceil(months.length / 12) === 0 ? formatMonth(month.month, true) : ""}
          </span>
        ))}
      </div>
    </figure>
  );
}

export function formatMonth(month: string, short = false): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1, 15));
  return date.toLocaleDateString("en-US", {
    month: "short",
    year: short ? "2-digit" : "numeric",
    timeZone: "UTC",
  });
}

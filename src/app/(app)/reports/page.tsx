import { StatTile } from "@/components/ui/stat-tile";
import {
  formatShare,
  funnelReportSchema,
  funnelSteps,
  parseReportRange,
  periodChange,
  share,
} from "@/domain/reports";
import { BarRow, EmptyNote, Panel, ReportsHeader, callReport, formatDays, formatDollars, tableClasses } from "./report-parts";

const STEP_LABEL: Record<string, string> = {
  lead: "Leads",
  appointment: "Appointment set",
  quoted: "Quoted",
  sold: "Sold",
  completed: "Completed",
};

const STAGE_TIMES = [
  { key: "lead_to_quoted", label: "Lead → quoted" },
  { key: "quoted_to_sold", label: "Quoted → sold" },
  { key: "sold_to_completed", label: "Sold → completed" },
] as const;

export default async function FunnelReportPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const range = parseReportRange((await searchParams).range, new Date());
  const report = funnelReportSchema.parse(await callReport("report_funnel", range));
  const steps = funnelSteps(report.steps);
  const quoted = report.steps.find((step) => step.key === "quoted")?.customers ?? 0;
  const sold = report.steps.find((step) => step.key === "sold")?.customers ?? 0;
  const change = periodChange(report.leads, report.prior_leads);
  const closeRate = share(sold, quoted);
  const maxDays = Math.max(1, ...STAGE_TIMES.map((time) => report.median_days[time.key] ?? 0));

  return (
    <main className="flex flex-col gap-5">
      <ReportsHeader active="funnel" range={range.key} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile
          label="Leads"
          value={report.leads.toLocaleString()}
          detail={change === null ? `${range.label}` : `${change >= 0 ? "+" : ""}${formatShare(change)} vs prior period`}
          tone={change === null ? "default" : change >= 0 ? "success" : "danger"}
        />
        <StatTile label="Quoted → sold" value={formatShare(closeRate)} detail={`${sold.toLocaleString()} of ${quoted.toLocaleString()} quoted`} />
        <StatTile
          label="Avg. contract"
          value={report.sold_jobs > 0 ? formatDollars(report.revenue / report.sold_jobs) : "—"}
          detail="Approved JobNimbus totals"
        />
        <StatTile label="Revenue sold" value={formatDollars(report.revenue)} detail={`${report.sold_jobs.toLocaleString()} jobs`} />
        <StatTile label="Lost" value={report.lost.toLocaleString()} detail="Lost before a sale" />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title="Stage funnel"
          detail={`Customers who first came in during the period (${range.label.toLowerCase()}), by the furthest stage they reached`}
        >
          {report.leads === 0 ? (
            <EmptyNote>No customers came in during this period.</EmptyNote>
          ) : (
            <dl>
              {steps.map((step) => (
                <BarRow
                  key={step.key}
                  label={STEP_LABEL[step.key] ?? step.key}
                  value={step.customers.toLocaleString()}
                  fraction={step.customers / Math.max(1, report.leads)}
                  note={step.ofPrevious === null ? undefined : `${formatShare(step.ofPrevious)} of previous`}
                  noteTone={step.ofPrevious !== null && step.ofPrevious < 0.5 ? "warning" : "muted"}
                />
              ))}
            </dl>
          )}
        </Panel>

        <Panel title="Median time between stages" detail="Days, from exact JobNimbus status times">
          <dl className="flex flex-col gap-3">
            {STAGE_TIMES.map((time) => {
              const days = report.median_days[time.key];
              return (
                <div key={time.key}>
                  <div className="flex items-baseline justify-between text-[13px]">
                    <dt className="text-ink">{time.label}</dt>
                    <dd className="font-semibold text-ink tabular-nums">{formatDays(days)}</dd>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-surface-muted" aria-hidden>
                    {days !== null ? (
                      <div className="h-1.5 rounded-full bg-accent" style={{ width: `${(days / maxDays) * 100}%` }} />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </dl>
        </Panel>
      </div>

      <Panel title="Lead sources" detail="First-touch source of each customer who came in during the period">
        {report.sources.length === 0 ? (
          <EmptyNote>No sources recorded for this period.</EmptyNote>
        ) : (
          <div className={tableClasses.wrap}>
            <table className={tableClasses.table}>
              <thead className={tableClasses.head}>
                <tr>
                  <th scope="col" className={tableClasses.th}>Source</th>
                  <th scope="col" className={tableClasses.num}>Leads</th>
                  <th scope="col" className={tableClasses.num}>Quoted</th>
                  <th scope="col" className={tableClasses.num}>Sold</th>
                  <th scope="col" className={tableClasses.num}>Close rate</th>
                  <th scope="col" className={tableClasses.num}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {report.sources.map((source) => (
                  <tr key={source.source} className={tableClasses.row}>
                    <th scope="row" className={`${tableClasses.cell} font-medium`}>{source.source}</th>
                    <td className={tableClasses.cellNum}>{source.leads.toLocaleString()}</td>
                    <td className={tableClasses.cellNum}>{source.quoted.toLocaleString()}</td>
                    <td className={tableClasses.cellNum}>{source.sold.toLocaleString()}</td>
                    <td className={tableClasses.cellNum}>{formatShare(share(source.sold, source.quoted))}</td>
                    <td className={tableClasses.cellNum}>{formatDollars(source.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </main>
  );
}

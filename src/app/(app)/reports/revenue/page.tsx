import { StatTile } from "@/components/ui/stat-tile";
import { formatShare, jobsReportSchema, parseReportRange, share } from "@/domain/reports";
import { MonthlyRevenueChart, formatMonth } from "../monthly-chart";
import { BarRow, EmptyNote, MixList, Panel, ReportsHeader, callReport, formatDollars, tableClasses } from "../report-parts";

export default async function RevenueReportPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const range = parseReportRange((await searchParams).range, new Date());
  const report = jobsReportSchema.parse(await callReport("report_jobs", range));
  const maxLineJobs = Math.max(1, ...report.shingle_lines.map((line) => line.jobs));

  return (
    <main className="flex flex-col gap-5">
      <ReportsHeader active="revenue" range={range.key} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Revenue sold" value={formatDollars(report.revenue)} detail={`${report.sold.toLocaleString()} jobs`} />
        <StatTile label="Jobs created" value={report.jobs.toLocaleString()} detail={range.label} />
        <StatTile
          label="Quoted → sold"
          value={formatShare(share(report.sold, report.quoted))}
          detail={`${report.sold.toLocaleString()} of ${report.quoted.toLocaleString()} quoted`}
        />
        <StatTile
          label="Avg. contract"
          value={report.sold > 0 ? formatDollars(report.revenue / report.sold) : "—"}
          detail="Approved JobNimbus totals"
        />
      </div>

      <Panel
        title="Revenue sold per month"
        detail="JobNimbus jobs by creation month that have reached Sold. Revenue is the approved total."
      >
        {report.monthly.length === 0 ? (
          <EmptyNote>No JobNimbus jobs were created in this period.</EmptyNote>
        ) : (
          <>
            <MonthlyRevenueChart months={report.monthly} />
            <details className="mt-4">
              <summary className="cursor-pointer text-[13px] font-medium text-tint">Show as table</summary>
              <div className={`${tableClasses.wrap} mt-2`}>
                <table className={tableClasses.table}>
                  <thead className={tableClasses.head}>
                    <tr>
                      <th scope="col" className={tableClasses.th}>Month</th>
                      <th scope="col" className={tableClasses.num}>Jobs created</th>
                      <th scope="col" className={tableClasses.num}>Sold</th>
                      <th scope="col" className={tableClasses.num}>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.monthly.map((month) => (
                      <tr key={month.month} className={tableClasses.row}>
                        <th scope="row" className={`${tableClasses.cell} font-medium`}>{formatMonth(month.month)}</th>
                        <td className={tableClasses.cellNum}>{month.jobs.toLocaleString()}</td>
                        <td className={tableClasses.cellNum}>{month.sold.toLocaleString()}</td>
                        <td className={tableClasses.cellNum}>{formatDollars(month.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Sold by shingle line" detail="Jobs sold and their revenue">
          {report.shingle_lines.length === 0 ? (
            <EmptyNote>No jobs sold in this period.</EmptyNote>
          ) : (
            <dl>
              {report.shingle_lines.map((line) => (
                <BarRow
                  key={line.label}
                  label={line.label}
                  value={line.jobs.toLocaleString()}
                  fraction={line.jobs / maxLineJobs}
                  note={formatDollars(line.revenue)}
                />
              ))}
            </dl>
          )}
        </Panel>
        <Panel title="Job mix" detail="All jobs created in the period">
          <MixList rows={report.job_types} total={report.jobs} />
          <h3 className="mt-4 mb-1 text-xs font-medium text-ink-subtle">Record types</h3>
          <MixList rows={report.record_types} total={report.jobs} />
        </Panel>
      </div>
    </main>
  );
}

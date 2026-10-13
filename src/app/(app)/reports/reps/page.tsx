import { formatShare, jobsReportSchema, parseReportRange, share } from "@/domain/reports";
import { EmptyNote, Panel, ReportsHeader, callReport, formatDollars, tableClasses } from "../report-parts";

export default async function RepsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const range = parseReportRange((await searchParams).range, new Date());
  const report = jobsReportSchema.parse(await callReport("report_jobs", range));
  const maxRevenue = Math.max(1, ...report.reps.map((rep) => rep.revenue));

  return (
    <main className="flex flex-col gap-5">
      <ReportsHeader active="reps" range={range.key} />
      <Panel
        title="Sales reps"
        detail="JobNimbus jobs created in the period, by the sales rep on the job"
        right={`${report.reps.length.toLocaleString()} reps`}
      >
        {report.reps.length === 0 ? (
          <EmptyNote>No JobNimbus jobs were created in this period.</EmptyNote>
        ) : (
          <div className={tableClasses.wrap}>
            <table className={tableClasses.table}>
              <thead className={tableClasses.head}>
                <tr>
                  <th scope="col" className={tableClasses.th}>Rep</th>
                  <th scope="col" className={tableClasses.num}>Jobs</th>
                  <th scope="col" className={tableClasses.num}>Quoted</th>
                  <th scope="col" className={tableClasses.num}>Sold</th>
                  <th scope="col" className={tableClasses.num}>Close rate</th>
                  <th scope="col" className={tableClasses.num}>Avg. contract</th>
                  <th scope="col" className={tableClasses.num}>Revenue</th>
                  <th scope="col" className={`${tableClasses.th} w-40`}><span className="sr-only">Revenue bar</span></th>
                </tr>
              </thead>
              <tbody>
                {report.reps.map((rep) => (
                  <tr key={rep.rep} className={tableClasses.row}>
                    <th scope="row" className={`${tableClasses.cell} font-medium`}>{rep.rep}</th>
                    <td className={tableClasses.cellNum}>{rep.jobs.toLocaleString()}</td>
                    <td className={tableClasses.cellNum}>{rep.quoted.toLocaleString()}</td>
                    <td className={tableClasses.cellNum}>{rep.sold.toLocaleString()}</td>
                    <td className={tableClasses.cellNum}>{formatShare(share(rep.sold, rep.quoted))}</td>
                    <td className={tableClasses.cellNum}>{rep.sold > 0 ? formatDollars(rep.revenue / rep.sold) : "—"}</td>
                    <td className={tableClasses.cellNum}>{formatDollars(rep.revenue)}</td>
                    <td className={tableClasses.cell} aria-hidden>
                      <div className="h-2 rounded-full bg-surface-muted">
                        {rep.revenue > 0 ? (
                          <div className="h-2 rounded-full bg-accent" style={{ width: `${(rep.revenue / maxRevenue) * 100}%` }} />
                        ) : null}
                      </div>
                    </td>
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

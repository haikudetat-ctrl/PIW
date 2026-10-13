import { StatTile } from "@/components/ui/stat-tile";
import { formatShare, jobsReportSchema, parseReportRange, share } from "@/domain/reports";
import { EmptyNote, MixList, Panel, ReportsHeader, callReport, tableClasses } from "../report-parts";

export default async function ProductionReportPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const range = parseReportRange((await searchParams).range, new Date());
  const report = jobsReportSchema.parse(await callReport("report_jobs", range));
  const soldLines = report.shingle_lines.map((line) => ({ label: line.label, jobs: line.jobs }));

  return (
    <main className="flex flex-col gap-5">
      <ReportsHeader active="production" range={range.key} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Jobs created" value={report.jobs.toLocaleString()} detail={range.label} />
        <StatTile label="Jobs sold" value={report.sold.toLocaleString()} detail={`${formatShare(share(report.sold, report.jobs))} of jobs`} />
        <StatTile
          label="Roofr measured"
          value={report.measured.toLocaleString()}
          detail={`${formatShare(share(report.measured, report.jobs), 1)} of jobs`}
        />
        <StatTile
          label="Without a measurement"
          value={(report.jobs - report.measured).toLocaleString()}
          detail="No readable Roofr report"
          tone={report.jobs - report.measured > 0 ? "warning" : "default"}
        />
      </div>

      <Panel title="Territory" detail="The 25 towns with the most jobs created in the period" right={`${report.territory.length} towns`}>
        {report.territory.length === 0 ? (
          <EmptyNote>No JobNimbus jobs were created in this period.</EmptyNote>
        ) : (
          <div className={tableClasses.wrap}>
            <table className={tableClasses.table}>
              <thead className={tableClasses.head}>
                <tr>
                  <th scope="col" className={tableClasses.th}>Town or city</th>
                  <th scope="col" className={tableClasses.num}>Jobs</th>
                  <th scope="col" className={tableClasses.num}>Sold</th>
                  <th scope="col" className={tableClasses.num}>Roofr measured</th>
                  <th scope="col" className={tableClasses.num}>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {report.territory.map((town) => (
                  <tr key={town.city} className={tableClasses.row}>
                    <th scope="row" className={`${tableClasses.cell} font-medium`}>{town.city}</th>
                    <td className={tableClasses.cellNum}>{town.jobs.toLocaleString()}</td>
                    <td className={tableClasses.cellNum}>{town.sold.toLocaleString()}</td>
                    <td className={tableClasses.cellNum}>{town.measured.toLocaleString()}</td>
                    <td className={tableClasses.cellNum}>{formatShare(share(town.measured, town.jobs), 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Shingle lines sold" detail="Jobs sold in the period">
          <MixList rows={soldLines} total={report.sold} />
        </Panel>
        <Panel title="Job types" detail="All jobs created">
          <MixList rows={report.job_types} total={report.jobs} />
        </Panel>
        <Panel title="Record types" detail="All jobs created">
          <MixList rows={report.record_types} total={report.jobs} />
        </Panel>
      </div>
    </main>
  );
}

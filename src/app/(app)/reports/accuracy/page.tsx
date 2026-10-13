import Link from "next/link";
import { StatTile } from "@/components/ui/stat-tile";
import {
  ACCURACY_MIN_SAMPLE,
  accuracySummary,
  formatShare,
  measurementsReportSchema,
  parseReportRange,
} from "@/domain/reports";
import { humanize } from "@/lib/format";
import { EmptyNote, Panel, ReportsHeader, callReport, tableClasses } from "../report-parts";

function StatusList({ counts, empty }: { counts: Record<string, number>; empty: string }) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return <EmptyNote>{empty}</EmptyNote>;
  return (
    <dl className="flex flex-col">
      {rows.map(([status, total]) => (
        <div key={status} className="flex items-baseline justify-between border-b border-border py-2 text-[13px] last:border-b-0">
          <dt className="text-ink-muted">{humanize(status)}</dt>
          <dd className="font-semibold text-ink tabular-nums">{total.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function AccuracyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const range = parseReportRange((await searchParams).range, new Date());
  const report = measurementsReportSchema.parse(await callReport("report_measurements"));
  const summary = accuracySummary(report.pairs);
  const sparse = summary.sampleSize < ACCURACY_MIN_SAMPLE;
  const bias = summary.medianSignedPercentError;

  return (
    <main className="flex flex-col gap-5">
      <ReportsHeader active="accuracy" range={range.key} showRange={false} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Matched roofs"
          value={summary.sampleSize.toLocaleString()}
          detail={sparse ? `Below ${ACCURACY_MIN_SAMPLE}: directional only` : "Enough for an operational read"}
          tone={sparse ? "warning" : "success"}
        />
        <StatTile label="Median error" value={formatShare(summary.medianAbsolutePercentError, 1)} detail="Google Solar vs Roofr" />
        <StatTile label="Within 10%" value={formatShare(summary.withinTenPercent)} detail="Of matched roofs" />
        <StatTile
          label="Bias"
          value={bias === null ? "—" : `${bias >= 0 ? "+" : ""}${formatShare(bias, 1)}`}
          detail={bias === null ? "No matched roofs" : bias >= 0 ? "Google reads larger" : "Google reads smaller"}
        />
      </div>

      <Panel
        title="Google Solar vs Roofr"
        detail="A lead's preliminary Google Solar estimate against the Roofr report on the same customer's JobNimbus job"
      >
        {report.pairs.length === 0 ? (
          <EmptyNote>
            No lead has both a Google Solar estimate and a Roofr report yet. Pairs appear once a lead that got an
            estimate becomes a JobNimbus job with a Roofr report; nothing is inferred before then.
          </EmptyNote>
        ) : (
          <div className={tableClasses.wrap}>
            <table className={tableClasses.table}>
              <thead className={tableClasses.head}>
                <tr>
                  <th scope="col" className={tableClasses.th}>Lead</th>
                  <th scope="col" className={tableClasses.num}>Google Solar</th>
                  <th scope="col" className={tableClasses.num}>Roofr</th>
                  <th scope="col" className={tableClasses.num}>Difference</th>
                </tr>
              </thead>
              <tbody>
                {report.pairs.map((pair) => {
                  const difference = (pair.estimate_squares - pair.roofr_squares) / pair.roofr_squares;
                  return (
                    <tr key={`${pair.lead_id}-${pair.job_jnid}`} className={tableClasses.row}>
                      <th scope="row" className={`${tableClasses.cell} font-medium`}>
                        <Link href={`/leads/${pair.lead_id}`} className="text-tint hover:underline">{pair.lead_name}</Link>
                      </th>
                      <td className={tableClasses.cellNum}>{pair.estimate_squares.toFixed(1)} sq</td>
                      <td className={tableClasses.cellNum}>{pair.roofr_squares.toFixed(1)} sq</td>
                      <td className={tableClasses.cellNum}>
                        {difference >= 0 ? "+" : ""}
                        {formatShare(difference, 1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Google Solar estimates" detail="Preliminary estimates on leads, by status">
          <StatusList counts={report.estimates} empty="No estimates yet." />
        </Panel>
        <Panel title="Roofr reports" detail="Roofr PDFs read from JobNimbus, by outcome">
          <StatusList counts={report.roofr} empty="No Roofr reports read yet." />
        </Panel>
      </div>
    </main>
  );
}

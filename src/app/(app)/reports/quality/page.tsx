import { Badge } from "@/components/ui/badge";
import {
  CENSUS_CONTACT_FIELDS,
  CENSUS_JOB_FIELDS,
  censusRowSchema,
  fieldFill,
  formatShare,
  parseReportRange,
  type FieldFill,
} from "@/domain/reports";
import { createServerClient } from "@/lib/supabase/server";
import { formatDateTime, humanize } from "@/lib/format";
import { EmptyNote, Panel, ReportsHeader, tableClasses } from "../report-parts";

function FillTable({ rows }: { rows: FieldFill[] }) {
  return (
    <dl className="flex flex-col">
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[1fr_4rem_5rem] items-baseline gap-3 border-b border-border py-2 text-[13px] last:border-b-0">
          <dt className="text-ink-muted">{row.label}</dt>
          <dd className="text-right font-semibold text-ink tabular-nums">{formatShare(row.rate, 1)}</dd>
          <dd
            className={`text-right text-xs tabular-nums ${
              row.change !== null && row.change < -0.005 ? "text-danger" : "text-ink-subtle"
            }`}
          >
            {row.change === null ? "" : `${row.change >= 0 ? "+" : "−"}${(Math.abs(row.change) * 100).toFixed(1)} pts`}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default async function DataQualityReportPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const range = parseReportRange((await searchParams).range, new Date());
  const supabase = await createServerClient();
  const [{ data: census, error: censusError }, { data: runs }] = await Promise.all([
    supabase
      .from("jobnimbus_census")
      .select("captured_at, jobs, contacts, job_field_counts, contact_field_counts, unmapped_statuses")
      .order("captured_at", { ascending: false })
      .limit(2),
    // Company admins only (row level security); managers see no runs.
    supabase
      .from("jobnimbus_sync_runs")
      .select("id, record_type, mode, status, records_seen, records_changed, started_at, error")
      .order("started_at", { ascending: false })
      .limit(8),
  ]);
  if (censusError) throw new Error("Failed to load the JobNimbus census");

  const [latest, previous] = (census ?? []).map((row) => censusRowSchema.parse(row));

  return (
    <main className="flex flex-col gap-5">
      <ReportsHeader active="quality" range={range.key} showRange={false} />

      {!latest ? (
        <Panel title="JobNimbus census">
          <EmptyNote>The first census is taken after the next JobNimbus sync.</EmptyNote>
        </Panel>
      ) : (
        <>
          <p className="text-[13px] text-ink-subtle">
            Census of {latest.jobs.toLocaleString()} jobs and {latest.contacts.toLocaleString()} contacts, taken{" "}
            {formatDateTime(latest.captured_at)}
            {previous ? ` · changes are against ${formatDateTime(previous.captured_at)}` : ""}.
          </p>
          <div className="grid gap-5 lg:grid-cols-3">
            <Panel title="Job fields" detail="Jobs with the field filled">
              <FillTable
                rows={fieldFill(
                  CENSUS_JOB_FIELDS,
                  { total: latest.jobs, counts: latest.job_field_counts },
                  previous ? { total: previous.jobs, counts: previous.job_field_counts } : null,
                )}
              />
            </Panel>
            <Panel title="Contact fields" detail="Contacts with the field filled">
              <FillTable
                rows={fieldFill(
                  CENSUS_CONTACT_FIELDS,
                  { total: latest.contacts, counts: latest.contact_field_counts },
                  previous ? { total: previous.contacts, counts: previous.contact_field_counts } : null,
                )}
              />
            </Panel>
            <Panel
              title="Unmapped statuses"
              detail="JobNimbus statuses with no pipeline stage. Their jobs count only as handed off in the funnel."
              right={<Badge tone={latest.unmapped_statuses.length > 0 ? "warning" : "success"}>{latest.unmapped_statuses.length}</Badge>}
            >
              {latest.unmapped_statuses.length === 0 ? (
                <EmptyNote>Every status maps to a stage.</EmptyNote>
              ) : (
                <dl className="flex flex-col">
                  {latest.unmapped_statuses.map((status) => (
                    <div key={status.status} className="flex items-baseline justify-between border-b border-border py-2 text-[13px] last:border-b-0">
                      <dt className="text-ink">{status.status}</dt>
                      <dd className="text-ink-muted tabular-nums">{status.jobs.toLocaleString()} jobs</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Panel>
          </div>
        </>
      )}

      {runs && runs.length > 0 ? (
        <Panel title="Recent JobNimbus syncs">
          <div className={tableClasses.wrap}>
            <table className={tableClasses.table}>
              <thead className={tableClasses.head}>
                <tr>
                  <th scope="col" className={tableClasses.th}>Started</th>
                  <th scope="col" className={tableClasses.th}>Records</th>
                  <th scope="col" className={tableClasses.th}>Status</th>
                  <th scope="col" className={tableClasses.num}>Seen</th>
                  <th scope="col" className={tableClasses.num}>Changed</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className={tableClasses.row}>
                    <td className={tableClasses.cell}>{formatDateTime(run.started_at)}</td>
                    <td className={tableClasses.cell}>
                      {humanize(run.record_type)} · {humanize(run.mode)}
                    </td>
                    <td className={tableClasses.cell}>
                      <Badge tone={run.status === "ok" ? "success" : run.status === "running" ? "info" : "danger"}>
                        {humanize(run.status)}
                      </Badge>
                    </td>
                    <td className={tableClasses.cellNum}>{run.records_seen.toLocaleString()}</td>
                    <td className={tableClasses.cellNum}>{run.records_changed.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </main>
  );
}

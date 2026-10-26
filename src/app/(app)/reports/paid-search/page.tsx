import Link from "next/link";
import { StatTile } from "@/components/ui/stat-tile";
import {
  costPer,
  eventLabel,
  LEAD_FLAGS,
  MATCH_TYPE_LABEL,
  paidSearchReportSchema,
  type PaidSearchReport,
} from "@/domain/paid-search";
import { formatShare, parseReportRange, share } from "@/domain/reports";
import { createServerClient } from "@/lib/supabase/server";
import { EmptyNote, Panel, ReportsHeader, formatDollars, tableClasses } from "../report-parts";
import { flagPaidLead } from "./actions";

type RpcClient = {rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: unknown}>};

async function loadReport(from: Date, to: Date): Promise<PaidSearchReport> {
  const supabase = (await createServerClient()) as unknown as RpcClient;
  const {data, error} = await supabase.rpc("report_paid_search", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) throw new Error("Failed to load paid search report");
  return paidSearchReportSchema.parse(data);
}

function money(value: number | null) {
  return value === null ? "—" : formatDollars(value);
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {month: "short", day: "numeric", timeZone: "America/New_York"});
}

export default async function PaidSearchReportPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const range = parseReportRange((await searchParams).range, new Date());
  const report = await loadReport(range.from, range.to);
  const cpl = costPer(report.spend, report.leads);
  const costPerQualified = costPer(report.spend, report.qualified);
  const costPerAppointment = costPer(report.spend, report.appointments_set);
  const cac = costPer(report.spend, report.sold);
  const arrivalRate = share(report.arrivals, report.clicks);

  return (
    <main className="flex flex-col gap-5">
      <ReportsHeader active="paid-search" range={range.key} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="Google Ads spend" value={formatDollars(report.spend)} detail={`${report.clicks.toLocaleString()} clicks`} />
        <StatTile label="Leads" value={report.leads.toLocaleString()} detail={`${money(cpl)} per lead`} />
        <StatTile label="Qualified" value={report.qualified.toLocaleString()} detail={`${money(costPerQualified)} each`} />
        <StatTile label="Appointments set" value={report.appointments_set.toLocaleString()} detail={`${money(costPerAppointment)} each`} />
        <StatTile label="Sold" value={report.sold.toLocaleString()} detail={cac === null ? "No sales yet" : `${formatDollars(cac)} CAC`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Click to arrival" detail="Clicks Google reported vs. visits the site logged with a Google click ID">
          <p className="text-2xl font-semibold text-ink tabular-nums">{formatShare(arrivalRate)}</p>
          <p className="mt-1 text-xs text-ink-subtle">
            {report.arrivals.toLocaleString()} arrivals from {report.clicks.toLocaleString()} clicks. Below about 80% usually means a redirect or a page that drops the click ID.
          </p>
        </Panel>
        <Panel title="Revenue sold" detail="Approved JobNimbus totals on Google-attributed jobs">
          <p className="text-2xl font-semibold text-ink tabular-nums">{formatDollars(report.revenue)}</p>
          <p className="mt-1 text-xs text-ink-subtle">
            {report.spend > 0 && report.revenue > 0 ? `${(report.revenue / report.spend).toFixed(1)}x return on ad spend` : "Return on spend appears once a job sells."}
          </p>
        </Panel>
        <Panel title="Data freshness" detail="Spend imports daily at 6:20am ET">
          <p className="text-sm text-ink">
            {report.last_spend_import_at
              ? `Last import ${new Date(report.last_spend_import_at).toLocaleString("en-US", {timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short"})}`
              : "Spend has not been imported yet."}
          </p>
          <p className="mt-1 text-xs text-ink-subtle">{report.flagged.toLocaleString()} lead(s) in this range marked as junk.</p>
        </Panel>
      </div>

      <Panel title="By keyword" detail="Spend from Google Ads, outcomes from PIW. Leads join on ad group and keyword ID.">
        {report.keywords.length === 0 ? (
          <EmptyNote>No keyword spend or Google leads in this period.</EmptyNote>
        ) : (
          <div className={tableClasses.wrap}>
            <table className={tableClasses.table}>
              <thead className={tableClasses.head}>
                <tr>
                  <th scope="col" className={tableClasses.th}>Keyword</th>
                  <th scope="col" className={tableClasses.th}>Ad group</th>
                  <th scope="col" className={tableClasses.num}>Spend</th>
                  <th scope="col" className={tableClasses.num}>Clicks</th>
                  <th scope="col" className={tableClasses.num}>Leads</th>
                  <th scope="col" className={tableClasses.num}>Qualified</th>
                  <th scope="col" className={tableClasses.num}>Appts</th>
                  <th scope="col" className={tableClasses.num}>Sold</th>
                  <th scope="col" className={tableClasses.num}>Cost / qualified</th>
                </tr>
              </thead>
              <tbody>
                {report.keywords.map((row) => (
                  <tr key={`${row.ad_group_id}-${row.criterion_id}-${row.keyword_text}`} className={tableClasses.row}>
                    <th scope="row" className={`${tableClasses.cell} font-medium`}>
                      {row.keyword_text ?? "Unknown keyword"}
                      {row.match_type ? <span className="ml-1.5 text-xs text-ink-subtle">{MATCH_TYPE_LABEL[row.match_type] ?? row.match_type}</span> : null}
                    </th>
                    <td className={tableClasses.cell}>{row.ad_group_name ?? row.ad_group_id ?? "—"}</td>
                    <td className={tableClasses.cellNum}>{formatDollars(row.cost)}</td>
                    <td className={tableClasses.cellNum}>{row.clicks.toLocaleString()}</td>
                    <td className={tableClasses.cellNum}>{row.leads.toLocaleString()}</td>
                    <td className={tableClasses.cellNum}>{row.qualified.toLocaleString()}</td>
                    <td className={tableClasses.cellNum}>{row.appointments.toLocaleString()}</td>
                    <td className={tableClasses.cellNum}>{row.sold.toLocaleString()}</td>
                    <td className={tableClasses.cellNum}>{money(costPer(row.cost, row.qualified))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="By day" detail="Spend, logged arrivals and leads">
          {report.daily.every((day) => day.spend === 0 && day.leads === 0) ? (
            <EmptyNote>No Google Ads activity in this period.</EmptyNote>
          ) : (
            <div className={tableClasses.wrap}>
              <table className={tableClasses.table}>
                <thead className={tableClasses.head}>
                  <tr>
                    <th scope="col" className={tableClasses.th}>Day</th>
                    <th scope="col" className={tableClasses.num}>Spend</th>
                    <th scope="col" className={tableClasses.num}>Clicks</th>
                    <th scope="col" className={tableClasses.num}>Arrivals</th>
                    <th scope="col" className={tableClasses.num}>Leads</th>
                  </tr>
                </thead>
                <tbody>
                  {[...report.daily].reverse().filter((day) => day.spend > 0 || day.leads > 0 || day.arrivals > 0).map((day) => (
                    <tr key={day.date} className={tableClasses.row}>
                      <th scope="row" className={`${tableClasses.cell} font-medium`}>{shortDate(`${day.date}T12:00:00Z`)}</th>
                      <td className={tableClasses.cellNum}>{formatDollars(day.spend)}</td>
                      <td className={tableClasses.cellNum}>{day.clicks.toLocaleString()}</td>
                      <td className={tableClasses.cellNum}>{day.arrivals.toLocaleString()}</td>
                      <td className={tableClasses.cellNum}>{day.leads.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Conversion uploads" detail="What PIW sent to Google Ads, by stage">
          {report.deliveries.length === 0 ? (
            <EmptyNote>Nothing queued for Google Ads yet.</EmptyNote>
          ) : (
            <div className={tableClasses.wrap}>
              <table className={tableClasses.table}>
                <thead className={tableClasses.head}>
                  <tr>
                    <th scope="col" className={tableClasses.th}>Stage</th>
                    <th scope="col" className={tableClasses.th}>Status</th>
                    <th scope="col" className={tableClasses.num}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {report.deliveries.map((row) => (
                    <tr key={`${row.event_name}-${row.status}`} className={tableClasses.row}>
                      <th scope="row" className={`${tableClasses.cell} font-medium`}>{eventLabel(row.event_name)}</th>
                      <td className={`${tableClasses.cell} ${row.status === "permanent_failed" ? "text-danger" : ""}`}>{row.status.replace(/_/g, " ")}</td>
                      <td className={tableClasses.cellNum}>{row.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Recent Google leads" detail="Mark junk leads so Google stops optimizing toward them">
        {report.recent_leads.length === 0 ? (
          <EmptyNote>No Google leads in this period.</EmptyNote>
        ) : (
          <div className={tableClasses.wrap}>
            <table className={tableClasses.table}>
              <thead className={tableClasses.head}>
                <tr>
                  <th scope="col" className={tableClasses.th}>Lead</th>
                  <th scope="col" className={tableClasses.th}>Keyword</th>
                  <th scope="col" className={tableClasses.th}>Stage</th>
                  <th scope="col" className={tableClasses.th}>Quality</th>
                </tr>
              </thead>
              <tbody>
                {report.recent_leads.map((lead) => (
                  <tr key={lead.lead_id} className={tableClasses.row}>
                    <th scope="row" className={`${tableClasses.cell} font-medium`}>
                      <Link href={`/leads/${lead.lead_id}`} className="text-tint hover:underline">{shortDate(lead.created_at)}</Link>
                      {lead.click_id_type ? null : <span className="ml-1.5 text-xs text-warning">no click ID</span>}
                    </th>
                    <td className={tableClasses.cell}>{lead.google_keyword ?? "—"}</td>
                    <td className={tableClasses.cell}>
                      {lead.sold ? "Sold" : lead.appointment_set ? "Appointment set" : lead.qualified ? "Qualified" : "Lead"}
                    </td>
                    <td className={tableClasses.cell}>
                      <form action={flagPaidLead} className="flex items-center gap-2">
                        <input type="hidden" name="lead_id" value={lead.lead_id} />
                        <label className="sr-only" htmlFor={`flag-${lead.lead_id}`}>Lead quality</label>
                        <select
                          id={`flag-${lead.lead_id}`}
                          name="flag"
                          defaultValue={lead.flag ?? "clear"}
                          className="rounded-md border border-border-strong bg-surface px-2 py-1 text-[13px]"
                        >
                          <option value="clear">Good lead</option>
                          {LEAD_FLAGS.map((flag) => <option key={flag.value} value={flag.value}>{flag.label}</option>)}
                        </select>
                        <button type="submit" className="rounded-md px-2 py-1 text-[13px] font-medium text-tint hover:bg-fill-selected">Save</button>
                      </form>
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

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { humanize } from "@/lib/format";
import { createServerClient } from "@/lib/supabase/server";
import { summarizeFunnel } from "@/modules/access-route/funnel";

const FUNNEL_STAGES = ["source", "contacted", "appointment", "sold", "job"] as const;

function formatTimestamp(value: string | null) {
  if (!value) return "Not yet run";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

export default async function AccessRoutePage() {
  const supabase = await createServerClient();
  const [{ data: routes }, { data: blindSpots }, { data: syncRuns }] = await Promise.all([
    supabase.from("reconciled_lead_routes").select("*"),
    supabase.from("jobnimbus_reengagement_blind_spots").select("*")
      .order("appointment_at", { ascending: false }).limit(20),
    supabase.from("integration_sync_runs").select("source_system, outcome, started_at, records_written, error_category")
      .order("started_at", { ascending: false }).limit(30),
  ]);
  const funnel = summarizeFunnel(routes ?? []);
  const latestRuns = ["leadconduit", "leadmaster", "jobnimbus"].map((system) => ({
    system,
    run: syncRuns?.find((candidate) => candidate.source_system === system),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-accent">Owner / marketing overview</p>
          <h1 className="text-2xl font-bold text-ink">Lead-to-job access route</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-subtle">
            Read-only visibility across LeadConduit, LeadMaster, and JobNimbus. Raw vendor states remain separate until their mappings are confirmed.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          {latestRuns.map(({ system }) => (
            <Link key={system} href={`/access-route/${system}`} className="font-medium text-accent hover:underline">
              {humanize(system)}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {FUNNEL_STAGES.map((stage) => (
          <StatTile key={stage} value={funnel.total[stage]} label={humanize(stage)} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card title="Funnel by source" ariaLabel="Funnel by lead source">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="pb-2 font-medium">Source</th>
                  {FUNNEL_STAGES.map((stage) => <th key={stage} className="pb-2 text-right font-medium">{stage}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {funnel.bySource.map(({ sourceName, counts }) => (
                  <tr key={sourceName}>
                    <th className="py-3 font-medium text-ink">{sourceName}</th>
                    {FUNNEL_STAGES.map((stage) => <td key={stage} className="py-3 text-right tabular-nums text-ink-muted">{counts[stage]}</td>)}
                  </tr>
                ))}
                {!funnel.bySource.length ? (
                  <tr><td colSpan={6} className="py-6 text-center text-ink-subtle">No read-only records ingested yet.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Ingestion health" ariaLabel="Read-only ingestion health">
          <ul className="divide-y divide-border">
            {latestRuns.map(({ system, run }) => (
              <li key={system} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div>
                  <Link href={`/access-route/${system}`} className="font-medium text-accent hover:underline">{humanize(system)}</Link>
                  <p className="text-xs text-ink-subtle">{formatTimestamp(run?.started_at ?? null)}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-semibold ${run?.outcome === "failed" ? "text-danger" : "text-ink"}`}>{run?.outcome ?? "not configured"}</p>
                  <p className="text-xs text-ink-subtle">{run?.records_written ?? 0} records</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="No-show and cancellation blind spot" ariaLabel="No-show and cancellation blind spot">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <p className="text-sm text-ink-muted">Appointments with no automated re-engagement recorded.</p>
          <span className="text-2xl font-bold text-danger">{blindSpots?.length ?? 0}</span>
        </div>
        <ul className="divide-y divide-border">
          {(blindSpots ?? []).map((item) => (
            <li key={item.job_id} className="grid gap-1 py-3 first:pt-0 md:grid-cols-[1fr_1.5fr_auto] md:items-center md:gap-4">
              <div>
                <p className="font-medium text-ink">{item.display_name ?? `Contact ${item.contact_id ?? "unknown"}`}</p>
                <p className="text-xs text-ink-subtle">Job {item.job_id}</p>
              </div>
              <p className="text-sm font-medium text-danger">{item.dashboard_state}</p>
              <p className="text-sm text-ink-subtle">{formatTimestamp(item.appointment_at)}</p>
            </li>
          ))}
          {!blindSpots?.length ? <li className="py-4 text-sm text-ink-subtle">No blind-spot records are currently visible.</li> : null}
        </ul>
      </Card>
    </div>
  );
}

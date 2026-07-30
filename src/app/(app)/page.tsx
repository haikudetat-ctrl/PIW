import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { stuckSinceIso, summarizePipelineTotals } from "@/modules/dashboard/pipeline-totals";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { humanize } from "@/lib/format";
import { FoundationDiagnostics } from "./foundation-diagnostics";

const STUCK_THRESHOLD_MINUTES = 15;

export default async function DashboardPage() {
  const supabase = await createServerClient();

  const [
    { data: leadRows },
    { data: newLeads },
    { data: stuckRuns },
    { count: reviewCount },
  ] = await Promise.all([
    supabase.from("leads").select("stage"),
    supabase
      .from("leads")
      .select("id, name, submitted_address, created_at")
      .eq("stage", "new")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("pipeline_runs")
      .select("id, started_at, status")
      .neq("status", "complete")
      .lt("started_at", stuckSinceIso(STUCK_THRESHOLD_MINUTES)),
    supabase
      .from("review_tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
  ]);

  const pipelineTotals = summarizePipelineTotals(leadRows ?? []);
  const totalLeads = Object.values(pipelineTotals).reduce((sum, n) => sum + n, 0);
  const maxStageCount = Math.max(1, ...Object.values(pipelineTotals));
  const reviewOpen = reviewCount ?? 0;
  const stuckCount = (stuckRuns ?? []).length;

  return (
    <main className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-ink-subtle">
          PIW · New Jersey residential roofing
        </p>
        <h1 className="text-2xl font-bold text-ink">
          Property Intelligence Worker
        </h1>
        <p className="mt-1 text-sm text-success">Foundation online</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile value={totalLeads} label="Total leads" />
        <StatTile
          value={(newLeads ?? []).length}
          label="New leads"
          tone={(newLeads ?? []).length > 0 ? "warning" : "default"}
        />
        <StatTile
          value={reviewOpen}
          label="Awaiting review"
          tone={reviewOpen > 0 ? "warning" : "default"}
        />
        <StatTile
          value={stuckCount}
          label="Stuck enrichments"
          tone={stuckCount > 0 ? "danger" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="New leads" ariaLabel="New leads">
          <ul className="flex flex-col divide-y divide-border">
            {(newLeads ?? []).map((lead) => (
              <li key={lead.id} className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <Link
                  href={`/leads/${lead.id}`}
                  className="font-medium text-accent hover:underline"
                >
                  {lead.name}
                </Link>
                <span className="truncate text-sm text-ink-subtle">
                  {lead.submitted_address}
                </span>
              </li>
            ))}
            {(newLeads ?? []).length === 0 ? (
              <li className="py-2.5 text-sm text-ink-subtle">No new leads</li>
            ) : null}
          </ul>
        </Card>

        <Card
          title="Pipeline totals"
          ariaLabel="Pipeline totals"
          right={
            <Link href="/pipeline" className="font-medium text-accent hover:underline">
              View pipeline board
            </Link>
          }
        >
          <dl className="flex flex-col gap-2.5">
            {Object.entries(pipelineTotals).map(([stage, count]) => (
              <div key={stage} className="grid grid-cols-[7rem_1fr_1.5rem] items-center gap-3">
                <dt className="text-sm text-ink-muted">{humanize(stage)}</dt>
                <div className="h-1.5 rounded-full bg-surface-muted">
                  <div
                    className="h-1.5 rounded-full bg-accent"
                    style={{ width: `${(count / maxStageCount) * 100}%` }}
                  />
                </div>
                <dd className="text-right text-sm font-semibold text-ink">{count}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card
          title="Review queue"
          ariaLabel="Review queue"
          right={
            <Link href="/review" className="font-medium text-accent hover:underline">
              Open review queue
            </Link>
          }
        >
          <p className={`text-sm ${reviewOpen > 0 ? "font-semibold text-warning" : "text-ink-muted"}`}>
            {reviewOpen} items awaiting review
          </p>
        </Card>

        <Card title="Stuck enrichments" ariaLabel="Stuck enrichments">
          <p className={`text-sm ${stuckCount > 0 ? "font-semibold text-danger" : "text-ink-muted"}`}>
            {stuckCount} pipeline runs stuck for over {STUCK_THRESHOLD_MINUTES} minutes
          </p>
        </Card>
      </div>

      <FoundationDiagnostics />
    </main>
  );
}

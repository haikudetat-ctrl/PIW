import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { stuckSinceIso, summarizePipelineTotals } from "@/modules/dashboard/pipeline-totals";
import { FoundationDiagnostics } from "./foundation-diagnostics";

const STUCK_THRESHOLD_MINUTES = 15;

export default async function DashboardPage() {
  const supabase = await createServerClient();

  const [{ data: leadRows }, { data: newLeads }, { data: stuckRuns }] = await Promise.all([
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
  ]);

  const pipelineTotals = summarizePipelineTotals(leadRows ?? []);

  return (
    <main>
      <p>PIW · New Jersey residential roofing</p>
      <h1>Property Intelligence Worker</h1>
      <p>Foundation online</p>

      <section aria-label="New leads">
        <h2>New leads</h2>
        <ul>
          {(newLeads ?? []).map((lead) => (
            <li key={lead.id}>
              <Link href={`/leads/${lead.id}`}>{lead.name}</Link> — {lead.submitted_address}
            </li>
          ))}
          {(newLeads ?? []).length === 0 ? <li>No new leads</li> : null}
        </ul>
      </section>

      <section aria-label="Pipeline totals">
        <h2>Pipeline totals</h2>
        <dl>
          {Object.entries(pipelineTotals).map(([stage, count]) => (
            <div key={stage}>
              <dt>{stage}</dt>
              <dd>{count}</dd>
            </div>
          ))}
        </dl>
        <Link href="/pipeline">View pipeline board</Link>
      </section>

      <section aria-label="Review queue">
        <h2>Review queue</h2>
        <p>0 items awaiting review</p>
      </section>

      <section aria-label="Stuck enrichments">
        <h2>Stuck enrichments</h2>
        <p>
          {(stuckRuns ?? []).length} pipeline runs stuck for over {STUCK_THRESHOLD_MINUTES} minutes
        </p>
      </section>

      <FoundationDiagnostics />
    </main>
  );
}

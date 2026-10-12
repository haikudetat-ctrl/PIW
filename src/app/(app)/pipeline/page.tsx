import Link from "next/link";
import { StatTile } from "@/components/ui/stat-tile";
import { Icon } from "@/components/ui/icons";
import { primaryButtonClasses } from "@/components/ui/form";
import { createServerClient } from "@/lib/supabase/server";
import { leadStages, type LeadStage } from "@/modules/leads/change-lead-stage";
import {
  buildPipelineCards,
  formatCompactCurrency,
  isOpenStage,
  summarizePipeline,
  type PipelineEstimateRow,
  type PipelineLeadRow,
  type PipelineTaskRow,
} from "@/modules/leads/pipeline-view";
import { PipelineBoard } from "./pipeline-board";
import { PipelineList, type ListFilter } from "./pipeline-list";
import { ViewSwitcher } from "./pipeline-parts";

function parseFilter(stage: string | string[] | undefined): ListFilter {
  return typeof stage === "string" && (leadStages as readonly string[]).includes(stage)
    ? (stage as LeadStage)
    : "open";
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; stage?: string | string[] }>;
}) {
  const params = await searchParams;
  const view = params.view === "list" ? "list" : "board";

  const supabase = await createServerClient();
  const [{ data: leads }, { data: estimates }, { data: tasks }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, name, submitted_address, stage, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("roof_estimates")
      .select("lead_id, status, range_low_cents, range_high_cents, roof_squares"),
    supabase.from("tasks").select("lead_id, title, due_at, status").eq("status", "open"),
  ]);

  const cards = buildPipelineCards(
    (leads ?? []) as PipelineLeadRow[],
    (estimates ?? []) as PipelineEstimateRow[],
    (tasks ?? []) as PipelineTaskRow[],
    new Date(),
  );
  const summary = summarizePipeline(cards);
  const filter = parseFilter(params.stage);
  const listCards =
    filter === "open" ? cards.filter((card) => isOpenStage(card.stage)) : cards.filter((card) => card.stage === filter);

  return (
    <main className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[28px] font-bold tracking-tight text-ink">Pipeline</h1>
        <ViewSwitcher view={view} />
        <Link href="/leads/new" className={`${primaryButtonClasses} ml-auto`}>
          <Icon name="plus" /> New lead
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Open pipeline"
          value={
            summary.openValueHighCents > 0
              ? `${formatCompactCurrency(summary.openValueLowCents)}–${formatCompactCurrency(summary.openValueHighCents)}`
              : "—"
          }
          detail={`${summary.openLeads} open leads`}
        />
        <StatTile
          label="Estimates ready"
          value={summary.estimatesReadyUncontacted}
          detail={summary.estimatesReadyUncontacted > 0 ? "Still in New — call now" : "All contacted"}
          tone={summary.estimatesReadyUncontacted > 0 ? "warning" : "default"}
        />
        <StatTile
          label="Due today"
          value={summary.dueToday}
          detail="Open tasks on open leads"
          tone={summary.dueToday > 0 ? "warning" : "default"}
        />
        <StatTile
          label="Overdue"
          value={summary.overdue}
          detail={summary.overdue > 0 ? "Past their due time" : "Nothing overdue"}
          tone={summary.overdue > 0 ? "danger" : "success"}
        />
      </div>

      {view === "list" ? <PipelineList cards={listCards} filter={filter} /> : <PipelineBoard cards={cards} />}
    </main>
  );
}

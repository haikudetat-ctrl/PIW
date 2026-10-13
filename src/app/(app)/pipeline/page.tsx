import Link from "next/link";
import { StatTile } from "@/components/ui/stat-tile";
import { Icon } from "@/components/ui/icons";
import { primaryButtonClasses } from "@/components/ui/form";
import { createServerClient } from "@/lib/supabase/server";
import { leadStages, type LeadStage } from "@/modules/leads/change-lead-stage";
import {
  buildJobCards,
  jobStageTotals,
  jobnimbusPipelineSchema,
  linkedLeadStatuses,
  type JobnimbusPipeline,
} from "@/modules/leads/jobnimbus-pipeline";
import {
  OPEN_STAGES,
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

// JobNimbus cards per board column; the list shows more for one stage.
const BOARD_JOBS_PER_STAGE = 25;
const LIST_JOBS_PER_STAGE = 200;

async function loadJobnimbus(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  stage: LeadStage | null,
  limit: number,
): Promise<JobnimbusPipeline | null> {
  const { data, error } = await supabase.rpc("pipeline_jobnimbus", {
    p_limit: limit,
    ...(stage ? { p_stage: stage } : {}),
  });
  // The leads still render if the JobNimbus side is unavailable.
  if (error) return null;
  const parsed = jobnimbusPipelineSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; stage?: string | string[] }>;
}) {
  const params = await searchParams;
  const view = params.view === "list" ? "list" : "board";

  const filter = parseFilter(params.stage);
  const listStage = view === "list" && filter !== "open" ? filter : null;

  const supabase = await createServerClient();
  const [{ data: leads }, { data: estimates }, { data: tasks }, jobnimbus] = await Promise.all([
    supabase
      .from("leads")
      .select("id, name, submitted_address, stage, created_at")
      // Test and verification leads stay in the database but off the board.
      .eq("is_test", false)
      .order("created_at", { ascending: false }),
    supabase
      .from("roof_estimates")
      .select("lead_id, status, range_low_cents, range_high_cents, roof_squares"),
    supabase.from("tasks").select("lead_id, title, due_at, status").eq("status", "open"),
    loadJobnimbus(supabase, listStage, view === "list" ? LIST_JOBS_PER_STAGE : BOARD_JOBS_PER_STAGE),
  ]);

  const now = new Date();
  const cards = buildPipelineCards(
    (leads ?? []) as PipelineLeadRow[],
    (estimates ?? []) as PipelineEstimateRow[],
    (tasks ?? []) as PipelineTaskRow[],
    now,
    jobnimbus ? linkedLeadStatuses(jobnimbus) : undefined,
  );
  const summary = summarizePipeline(cards);
  const jobs = jobnimbus ? buildJobCards(jobnimbus, now) : [];
  const jobTotals = jobnimbus ? jobStageTotals(jobnimbus) : {};
  const openJobs = OPEN_STAGES.reduce((sum, stage) => sum + (jobTotals[stage]?.jobs ?? 0), 0);
  const openJobValueCents = OPEN_STAGES.reduce((sum, stage) => sum + (jobTotals[stage]?.valueCents ?? 0), 0);
  const openLowCents = summary.openValueLowCents + openJobValueCents;
  const openHighCents = summary.openValueHighCents + openJobValueCents;

  const listCards =
    filter === "open" ? cards.filter((card) => isOpenStage(card.stage)) : cards.filter((card) => card.stage === filter);
  const listJobs = jobs.filter((job) => (filter === "open" ? isOpenStage(job.stage) : job.stage === filter));
  const listJobTotal = filter === "open" ? openJobs : (jobTotals[filter]?.jobs ?? 0);

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
            openHighCents <= 0
              ? "—"
              : openLowCents === openHighCents
                ? formatCompactCurrency(openHighCents)
                : `${formatCompactCurrency(openLowCents)}–${formatCompactCurrency(openHighCents)}`
          }
          detail={
            jobnimbus
              ? `${summary.openLeads} open leads · ${openJobs.toLocaleString()} JobNimbus jobs`
              : `${summary.openLeads} open leads`
          }
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

      <p className="-mt-2 text-xs text-ink-subtle">
        {jobnimbus
          ? `Includes JobNimbus jobs with activity since ${new Date(jobnimbus.since).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              timeZone: "America/New_York",
            })}, synced hourly. JobNimbus cards open the job in JobNimbus.`
          : "JobNimbus jobs are unavailable right now; showing Rake leads only."}
      </p>

      {view === "list" ? (
        <PipelineList
          cards={listCards}
          filter={filter}
          jobs={listJobs}
          moreJobs={Math.max(0, listJobTotal - listJobs.length)}
        />
      ) : (
        <PipelineBoard cards={cards} jobs={jobs} jobTotals={jobTotals} />
      )}
    </main>
  );
}

import type { LeadStage } from "@/modules/leads/change-lead-stage";

export const OPEN_STAGES = [
  "new",
  "contacting",
  "appointment_set",
  "estimating",
  "proposal_sent",
] as const satisfies readonly LeadStage[];

export const CLOSED_STAGES = ["won", "lost", "nurture"] as const satisfies readonly LeadStage[];

// Day boundaries ("due today") follow the company's local calendar, not the
// server's UTC clock.
const COMPANY_TIME_ZONE = "America/New_York";

export type PipelineLeadRow = {
  id: string;
  name: string;
  submitted_address: string;
  stage: LeadStage;
  created_at: string;
};

export type PipelineEstimateRow = {
  lead_id: string;
  status: string;
  range_low_cents: number | null;
  range_high_cents: number | null;
  roof_squares: number | string | null;
};

export type PipelineTaskRow = {
  lead_id: string;
  title: string;
  due_at: string | null;
  status: "open" | "complete" | "cancelled";
};

export type CardEstimate =
  | { kind: "ready"; lowCents: number; highCents: number; squares: number | null }
  | { kind: "pending" }
  | { kind: "unavailable" }
  | { kind: "none" };

export type NextStepDue = "overdue" | "today" | "upcoming" | "unscheduled";

export type PipelineCard = {
  id: string;
  name: string;
  address: string;
  stage: LeadStage;
  estimate: CardEstimate;
  nextStep: { title: string; due: NextStepDue; dueAt: string | null } | null;
  ageLabel: string;
};

function dayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: COMPANY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function classifyDue(dueAt: string | null, now: Date): NextStepDue {
  if (!dueAt) return "unscheduled";
  const due = new Date(dueAt);
  if (due.getTime() < now.getTime()) return "overdue";
  return dayKey(due) === dayKey(now) ? "today" : "upcoming";
}

export function formatAge(createdAt: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatCompactCurrency(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(2)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`;
  return `$${Math.round(dollars)}`;
}

function toEstimate(row: PipelineEstimateRow | undefined): CardEstimate {
  if (!row) return { kind: "none" };
  if (row.status === "ready" && row.range_low_cents !== null && row.range_high_cents !== null) {
    const squares = row.roof_squares === null ? null : Number(row.roof_squares);
    return {
      kind: "ready",
      lowCents: row.range_low_cents,
      highCents: row.range_high_cents,
      squares: Number.isFinite(squares) ? squares : null,
    };
  }
  if (row.status === "pending") return { kind: "pending" };
  return { kind: "unavailable" };
}

// Earliest-due open task first; tasks without a due date sort last.
function pickNextTask(tasks: PipelineTaskRow[]): PipelineTaskRow | undefined {
  return tasks
    .filter((task) => task.status === "open")
    .sort((a, b) => {
      if (a.due_at === b.due_at) return 0;
      if (a.due_at === null) return 1;
      if (b.due_at === null) return -1;
      return a.due_at.localeCompare(b.due_at);
    })[0];
}

export function buildPipelineCards(
  leads: PipelineLeadRow[],
  estimates: PipelineEstimateRow[],
  tasks: PipelineTaskRow[],
  now: Date,
): PipelineCard[] {
  const estimateByLead = new Map<string, PipelineEstimateRow>();
  for (const row of estimates) {
    // Prefer a ready estimate when a lead has more than one row.
    const current = estimateByLead.get(row.lead_id);
    if (!current || (current.status !== "ready" && row.status === "ready")) {
      estimateByLead.set(row.lead_id, row);
    }
  }
  const tasksByLead = new Map<string, PipelineTaskRow[]>();
  for (const task of tasks) {
    const list = tasksByLead.get(task.lead_id) ?? [];
    list.push(task);
    tasksByLead.set(task.lead_id, list);
  }

  return leads.map((lead) => {
    const next = pickNextTask(tasksByLead.get(lead.id) ?? []);
    return {
      id: lead.id,
      name: lead.name,
      address: lead.submitted_address,
      stage: lead.stage,
      estimate: toEstimate(estimateByLead.get(lead.id)),
      nextStep: next
        ? { title: next.title, due: classifyDue(next.due_at, now), dueAt: next.due_at }
        : null,
      ageLabel: formatAge(lead.created_at, now),
    };
  });
}

export function isOpenStage(stage: LeadStage): boolean {
  return (OPEN_STAGES as readonly LeadStage[]).includes(stage);
}

export type PipelineSummary = {
  openLeads: number;
  openValueLowCents: number;
  openValueHighCents: number;
  estimatesReadyUncontacted: number;
  dueToday: number;
  overdue: number;
};

export function summarizePipeline(cards: PipelineCard[]): PipelineSummary {
  const summary: PipelineSummary = {
    openLeads: 0,
    openValueLowCents: 0,
    openValueHighCents: 0,
    estimatesReadyUncontacted: 0,
    dueToday: 0,
    overdue: 0,
  };
  for (const card of cards) {
    if (!isOpenStage(card.stage)) continue;
    summary.openLeads += 1;
    if (card.estimate.kind === "ready") {
      summary.openValueLowCents += card.estimate.lowCents;
      summary.openValueHighCents += card.estimate.highCents;
      if (card.stage === "new") summary.estimatesReadyUncontacted += 1;
    }
    if (card.nextStep?.due === "today") summary.dueToday += 1;
    if (card.nextStep?.due === "overdue") summary.overdue += 1;
  }
  return summary;
}

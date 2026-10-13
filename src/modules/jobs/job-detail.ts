import type { LeadStage } from "@/modules/leads/change-lead-stage";

// Customer-journey stages, as jobnimbus_status_stages and the journey events
// name them.
export type JourneyStage =
  | "lead_received"
  | "handoff"
  | "contacted"
  | "appointment_set"
  | "appointment_ran"
  | "appointment_no_show"
  | "quoted"
  | "sold"
  | "in_production"
  | "completed"
  | "lost"
  | (string & {});

// The same mapping pipeline_jobnimbus() uses to place a job on the board.
export function boardStageFor(statusStage: string | null, statusName: string | null): LeadStage {
  if (statusStage === "appointment_set" || statusStage === "appointment_no_show") return "appointment_set";
  if (statusStage === "quoted") return "proposal_sent";
  if (statusStage === "sold" || statusStage === "in_production" || statusStage === "completed") return "won";
  if (statusStage === "lost") return "lost";
  if (statusName === "Estimating") return "estimating";
  return "new";
}

export const PROGRESS_STEPS = [
  { key: "lead", label: "Lead", stages: ["lead_received", "handoff", "contacted"] },
  { key: "appointment", label: "Appointment", stages: ["appointment_set", "appointment_ran", "appointment_no_show"] },
  { key: "quoted", label: "Quoted", stages: ["quoted"] },
  { key: "sold", label: "Signed", stages: ["sold"] },
  { key: "in_production", label: "In production", stages: ["in_production"] },
  { key: "completed", label: "Completed", stages: ["completed"] },
] as const;

export type ProgressStep = {
  key: (typeof PROGRESS_STEPS)[number]["key"];
  label: string;
  state: "done" | "current" | "upcoming";
  date: string | null;
};

function stepIndex(stage: string | null): number {
  if (!stage) return 0;
  const index = PROGRESS_STEPS.findIndex((step) => (step.stages as readonly string[]).includes(stage));
  return index === -1 ? 0 : index;
}

// Where the job is now comes from its JobNimbus status; dates come from the
// customer journey, earliest event per step.
export function jobProgress(
  statusStage: string | null,
  events: { stage: string; occurred_at: string }[],
): ProgressStep[] {
  const current = stepIndex(statusStage);
  return PROGRESS_STEPS.map((step, index) => {
    const dates = events
      .filter((event) => (step.stages as readonly string[]).includes(event.stage))
      .map((event) => event.occurred_at)
      .sort();
    const state = index < current ? "done" : index === current ? "current" : "upcoming";
    return { key: step.key, label: step.label, state, date: dates[0] ?? null };
  });
}

const EVENT_LABEL: Record<string, string> = {
  lead_received: "Lead received",
  ap_intake: "Lead taken in",
  ap_delivered: "Lead delivered",
  ap_filtered: "Lead filtered",
  contacted: "Contacted",
  appointment_set: "Appointment set",
  appointment_ran: "Appointment ran",
  appointment_no_show: "No show",
  handoff: "Created in JobNimbus",
  quoted: "Quoted",
  sold: "Contract signed",
  in_production: "In production",
  completed: "Job completed",
  lost: "Lost",
};

export function journeyEventLabel(stage: string): string {
  return EVENT_LABEL[stage] ?? stage.replaceAll("_", " ");
}

export function jobTitle(job: { job_type: string | null; number: string | null }): string {
  const type = job.job_type?.trim();
  if (type) return type;
  return job.number ? `Job #${job.number}` : "JobNimbus job";
}

export function formatSyncAge(projectedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(projectedAt).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

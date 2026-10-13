import { z } from "zod";
import { leadStages, type LeadStage } from "@/modules/leads/change-lead-stage";
import { formatAge } from "@/modules/leads/pipeline-view";

// JobNimbus is the system of record for its jobs: the board opens Rake's
// read-only job page, which links on to the job in JobNimbus, and offers no
// stage moves.
export const JOBNIMBUS_JOB_URL = "https://app.jobnimbus.com/job/";

const stage = z.enum(leadStages);
const optionalNumber = z.coerce.number().nullable();

export const jobnimbusPipelineSchema = z.object({
  since: z.string(),
  stages: z.array(z.object({ stage, jobs: z.coerce.number().int().nonnegative(), value: z.coerce.number() })),
  jobs: z.array(
    z.object({
      jnid: z.string(),
      number: z.string().nullable(),
      name: z.string().nullable(),
      address: z.string().nullable(),
      status_name: z.string().nullable(),
      stage,
      sales_rep_name: z.string().nullable(),
      value: optionalNumber,
      roofr_squares: optionalNumber,
      activity_at: z.string().nullable(),
    }),
  ),
  linked_leads: z.array(z.object({ lead_id: z.string(), jnid: z.string(), status_name: z.string().nullable() })),
});

export type JobnimbusPipeline = z.infer<typeof jobnimbusPipelineSchema>;

export type JobCard = {
  jnid: string;
  title: string;
  address: string | null;
  stage: LeadStage;
  status: string | null;
  rep: string | null;
  valueCents: number | null;
  squares: number | null;
  ageLabel: string | null;
  href: string;
};

export type JobStageTotals = Partial<Record<LeadStage, { jobs: number; valueCents: number }>>;

function positiveCents(dollars: number | null): number | null {
  return dollars !== null && dollars > 0 ? Math.round(dollars * 100) : null;
}

export function buildJobCards(payload: JobnimbusPipeline, now: Date): JobCard[] {
  return payload.jobs.map((job) => ({
    jnid: job.jnid,
    title: job.name?.trim() || (job.number ? `Job #${job.number}` : "JobNimbus job"),
    address: job.address,
    stage: job.stage,
    status: job.status_name,
    rep: job.sales_rep_name,
    valueCents: positiveCents(job.value),
    squares: job.roofr_squares,
    ageLabel: job.activity_at ? formatAge(job.activity_at, now) : null,
    href: `/jobs/${encodeURIComponent(job.jnid)}`,
  }));
}

export function jobStageTotals(payload: JobnimbusPipeline): JobStageTotals {
  const totals: JobStageTotals = {};
  for (const row of payload.stages) {
    totals[row.stage] = { jobs: row.jobs, valueCents: positiveCents(row.value) ?? 0 };
  }
  return totals;
}

// The JobNimbus status of each PIW lead whose customer also has a JobNimbus job.
export function linkedLeadStatuses(payload: JobnimbusPipeline): Map<string, string> {
  const statuses = new Map<string, string>();
  for (const link of payload.linked_leads) {
    if (!statuses.has(link.lead_id)) statuses.set(link.lead_id, link.status_name ?? "In JobNimbus");
  }
  return statuses;
}

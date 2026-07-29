import { leadStageSchema } from "@/domain/crm";

export type PipelineTotals = Record<(typeof leadStageSchema)["options"][number], number>;

export function summarizePipelineTotals(rows: { stage: string }[]): PipelineTotals {
  const totals = Object.fromEntries(
    leadStageSchema.options.map((stage) => [stage, 0]),
  ) as PipelineTotals;

  for (const row of rows) {
    const stage = leadStageSchema.parse(row.stage);
    totals[stage] += 1;
  }

  return totals;
}

export function stuckSinceIso(thresholdMinutes: number, now: Date = new Date()): string {
  return new Date(now.getTime() - thresholdMinutes * 60_000).toISOString();
}

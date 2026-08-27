import { z } from "zod";
import { inngest } from "@/inngest/client";
import { createServiceClient } from "@/lib/supabase/service";

const abandonedRowSchema = z.object({
  assessment_id: z.uuid(),
}).strict();

export interface AssessmentAbandonmentRepository {
  abandonBatch(input: {batchSize: number}): Promise<{assessmentId: string}[]>;
}

export class SupabaseAssessmentAbandonmentRepository
implements AssessmentAbandonmentRepository {
  constructor(private readonly service = createServiceClient()) {}

  async abandonBatch({batchSize}: {batchSize: number}) {
    const {data, error} = await this.service.rpc("abandon_inactive_roof_assessments", {
      p_batch_size: batchSize,
    });
    if (error) throw new Error("Assessment abandonment persistence failed");
    return z.array(abandonedRowSchema).parse(data ?? []).map((row) => ({
      assessmentId: row.assessment_id,
    }));
  }
}

export async function abandonInactiveAssessments(
  repository: AssessmentAbandonmentRepository,
  batchSize = 100,
) {
  const boundedBatchSize = Math.max(1, Math.min(500, Math.trunc(batchSize)));
  const abandoned = await repository.abandonBatch({batchSize: boundedBatchSize});
  return {abandoned: abandoned.length};
}

type RunPage = (
  id: string,
  operation: () => Promise<{abandoned: number}>,
) => Promise<{abandoned: number}>;

export async function drainInactiveAssessments(
  repository: AssessmentAbandonmentRepository,
  runPage: RunPage,
  options: {batchSize?: number; maxPages?: number} = {},
) {
  const batchSize = Math.max(1, Math.min(500, Math.trunc(options.batchSize ?? 500)));
  const maxPages = Math.max(1, Math.min(20, Math.trunc(options.maxPages ?? 10)));
  let abandoned = 0;
  let pages = 0;
  let lastPageWasFull = false;

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await runPage(`abandon-page-${page}`, () =>
      abandonInactiveAssessments(repository, batchSize));
    abandoned += result.abandoned;
    pages = page;
    lastPageWasFull = result.abandoned === batchSize;
    if (!lastPageWasFull) break;
  }

  return {abandoned, pages, maxPagesReached: pages === maxPages && lastPageWasFull};
}

type InngestLike = Pick<typeof inngest, "createFunction">;

export function createAssessmentAbandonmentWorker(
  client: InngestLike,
  repository?: AssessmentAbandonmentRepository,
) {
  return client.createFunction(
    {id: "assessment-abandonment-worker", triggers: {cron: "0 * * * *"}},
    async ({step}) => drainInactiveAssessments(
      repository ?? new SupabaseAssessmentAbandonmentRepository(),
      (id, operation) => step.run(id, operation),
    ),
  );
}

export const assessmentAbandonmentWorker = createAssessmentAbandonmentWorker(inngest);

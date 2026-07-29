import "server-only";
import { diagnosticRequested, inngest } from "@/inngest/client";
import { createServiceClient } from "@/lib/supabase/service";

export type WorkerRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "review_required"
  | "failed";

export type WorkerRunRecord = {
  id: string;
  status: WorkerRunStatus;
};

export interface WorkerRunRepository {
  upsertQueued(input: {
    pipelineRunId: string;
    workerType: string;
    workerVersion: number;
    idempotencyKey: string;
  }): Promise<WorkerRunRecord>;
  markCompleted(workerRunId: string): Promise<void>;
}

type DiagnosticRequestedEvent = {
  id: string;
  pipelineRunId: string;
};

export async function processDiagnosticEventData(
  event: DiagnosticRequestedEvent,
  repository: WorkerRunRepository,
) {
  const idempotencyKey = `diagnostic:${event.pipelineRunId}`;
  const workerRun = await repository.upsertQueued({
    pipelineRunId: event.pipelineRunId,
    workerType: "diagnostic",
    workerVersion: 1,
    idempotencyKey,
  });

  if (workerRun.status !== "completed") {
    await repository.markCompleted(workerRun.id);
  }

  return { workerRunId: workerRun.id, status: "completed" as const };
}

class SupabaseWorkerRunRepository implements WorkerRunRepository {
  private readonly client = createServiceClient();

  async upsertQueued(input: {
    pipelineRunId: string;
    workerType: string;
    workerVersion: number;
    idempotencyKey: string;
  }): Promise<WorkerRunRecord> {
    const { data: inserted, error: insertError } = await this.client
      .from("worker_runs")
      .insert({
        pipeline_run_id: input.pipelineRunId,
        worker_type: input.workerType,
        worker_version: input.workerVersion,
        idempotency_key: input.idempotencyKey,
        status: "queued",
        started_at: new Date().toISOString(),
      })
      .select("id, status")
      .single();

    if (!insertError && inserted) {
      return { id: inserted.id, status: inserted.status };
    }

    const { data: existing, error: selectError } = await this.client
      .from("worker_runs")
      .select("id, status")
      .eq("idempotency_key", input.idempotencyKey)
      .single();

    if (selectError || !existing) {
      throw new Error("Failed to record worker run start");
    }
    return { id: existing.id, status: existing.status };
  }

  async markCompleted(workerRunId: string): Promise<void> {
    await this.client
      .from("worker_runs")
      .update({ status: "completed", finished_at: new Date().toISOString() })
      .eq("id", workerRunId)
      .neq("status", "completed");
  }
}

export const processDiagnosticEvent = inngest.createFunction(
  { id: "process-diagnostic-event", triggers: { event: diagnosticRequested } },
  async ({ event, step }) => {
    const repository = new SupabaseWorkerRunRepository();

    const workerRun = await step.run("record-worker-start", () =>
      repository.upsertQueued({
        pipelineRunId: event.data.pipelineRunId,
        workerType: "diagnostic",
        workerVersion: 1,
        idempotencyKey: `diagnostic:${event.data.pipelineRunId}`,
      }),
    );

    await step.run("record-worker-completion", async () => {
      if (workerRun.status !== "completed") {
        await repository.markCompleted(workerRun.id);
      }
    });

    return { ok: true, eventId: event.data.id };
  },
);

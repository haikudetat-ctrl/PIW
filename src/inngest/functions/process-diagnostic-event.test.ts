import { expect, test } from "vitest";
import {
  processDiagnosticEventData,
  type WorkerRunRecord,
  type WorkerRunRepository,
} from "./process-diagnostic-event";

class FakeWorkerRunRepository implements WorkerRunRepository {
  private readonly runsByIdempotencyKey = new Map<string, WorkerRunRecord>();
  private nextId = 1;
  completions = 0;

  async upsertQueued(input: { idempotencyKey: string }): Promise<WorkerRunRecord> {
    const existing = this.runsByIdempotencyKey.get(input.idempotencyKey);
    if (existing) return existing;
    const record: WorkerRunRecord = { id: String(this.nextId++), status: "queued" };
    this.runsByIdempotencyKey.set(input.idempotencyKey, record);
    return record;
  }

  async markCompleted(workerRunId: string): Promise<void> {
    this.completions += 1;
    for (const record of this.runsByIdempotencyKey.values()) {
      if (record.id === workerRunId) record.status = "completed";
    }
  }

  get runCount() {
    return this.runsByIdempotencyKey.size;
  }
}

test("duplicate delivery completes the worker run exactly once", async () => {
  const repository = new FakeWorkerRunRepository();
  const event = {
    id: "44444444-4444-4444-8444-444444444444",
    pipelineRunId: "22222222-2222-4222-8222-222222222222",
  };

  await processDiagnosticEventData(event, repository);
  await processDiagnosticEventData(event, repository);

  expect(repository.runCount).toBe(1);
  expect(repository.completions).toBe(1);
});

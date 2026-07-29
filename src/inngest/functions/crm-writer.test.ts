import { expect, test } from "vitest";
import { writeCrmProjection, type CrmWriterRepository, type WorkerRunRecord } from "./crm-writer";

class FakeCrmWriterRepository implements CrmWriterRepository {
  private readonly runsByIdempotencyKey = new Map<string, WorkerRunRecord>();
  private readonly initialStageLeadIds = new Set<string>();
  private readonly notificationCorrelationIds = new Set<string>();
  private readonly addressValidationCorrelationIds = new Set<string>();
  private nextId = 1;
  completions = 0;
  pipelineRunCompletions = 0;

  async upsertWorkerRunQueued(input: { idempotencyKey: string }): Promise<WorkerRunRecord> {
    const existing = this.runsByIdempotencyKey.get(input.idempotencyKey);
    if (existing) return existing;
    const record: WorkerRunRecord = { id: String(this.nextId++), status: "queued" };
    this.runsByIdempotencyKey.set(input.idempotencyKey, record);
    return record;
  }

  async markWorkerRunCompleted(workerRunId: string): Promise<void> {
    this.completions += 1;
    for (const record of this.runsByIdempotencyKey.values()) {
      if (record.id === workerRunId) record.status = "completed";
    }
  }

  async recordInitialStageHistory(leadId: string): Promise<void> {
    this.initialStageLeadIds.add(leadId);
  }

  async createLeadSubmittedNotification(input: { correlationId: string }): Promise<void> {
    this.notificationCorrelationIds.add(input.correlationId);
  }

  async completePipelineRun(): Promise<void> {
    this.pipelineRunCompletions += 1;
  }

  async publishAddressValidationRequested(input: { correlationId: string }): Promise<void> {
    this.addressValidationCorrelationIds.add(input.correlationId);
  }

  get stageHistoryCount() {
    return this.initialStageLeadIds.size;
  }
  get notificationCount() {
    return this.notificationCorrelationIds.size;
  }
  get addressValidationPublishCount() {
    return this.addressValidationCorrelationIds.size;
  }
}

test("duplicate delivery publishes address validation exactly once and never completes the pipeline itself", async () => {
  const repository = new FakeCrmWriterRepository();
  const event = {
    id: "44444444-4444-4444-8444-444444444444",
    pipelineRunId: "22222222-2222-4222-8222-222222222222",
    correlationId: "11111111-1111-4111-8111-111111111111",
    leadId: "66666666-6666-4666-8666-666666666666",
    propertyId: "77777777-7777-4777-8777-777777777777",
    submittedAddress: "12 Birch St, Trenton, NJ",
  };

  await writeCrmProjection(event, repository);
  await writeCrmProjection(event, repository);

  expect(repository.stageHistoryCount).toBe(1);
  expect(repository.notificationCount).toBe(1);
  expect(repository.addressValidationPublishCount).toBe(1);
  expect(repository.pipelineRunCompletions).toBe(0);
  expect(repository.completions).toBe(1);
});

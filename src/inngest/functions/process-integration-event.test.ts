import { expect, test } from "vitest";
import {
  processIntegrationEventData,
  type IntegrationEventRepository,
} from "./process-integration-event";

class FakeIntegrationEventRepository implements IntegrationEventRepository {
  processedIds: string[] = [];

  async markProcessed(integrationEventId: string): Promise<void> {
    this.processedIds.push(integrationEventId);
  }
}

test("marks the integration event processed", async () => {
  const repository = new FakeIntegrationEventRepository();

  const result = await processIntegrationEventData(
    { integrationEventId: "44444444-4444-4444-8444-444444444444" },
    repository,
  );

  expect(result).toEqual({
    ok: true,
    integrationEventId: "44444444-4444-4444-8444-444444444444",
  });
  expect(repository.processedIds).toEqual(["44444444-4444-4444-8444-444444444444"]);
});

test("redelivery marks processed exactly once per delivery, idempotently on the DB side", async () => {
  const repository = new FakeIntegrationEventRepository();
  const event = { integrationEventId: "44444444-4444-4444-8444-444444444444" };

  await processIntegrationEventData(event, repository);
  await processIntegrationEventData(event, repository);

  expect(repository.processedIds).toEqual([
    "44444444-4444-4444-8444-444444444444",
    "44444444-4444-4444-8444-444444444444",
  ]);
});

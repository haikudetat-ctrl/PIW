import { expect, test } from "vitest";
import { createEventEnvelope } from "@/domain/events";
import { InMemoryOutboxRepository } from "./outbox-repository";

test("enqueue is idempotent by event id and idempotency key", async () => {
  const repository = new InMemoryOutboxRepository();
  const event = createEventEnvelope({
    name: "system/diagnostic.requested",
    correlationId: "11111111-1111-4111-8111-111111111111",
    pipelineRunId: "22222222-2222-4222-8222-222222222222",
    data: { requestedBy: "33333333-3333-4333-8333-333333333333" },
    id: "44444444-4444-4444-8444-444444444444",
  });

  await repository.enqueue(event, "00000000-0000-4000-8000-000000000001");
  await repository.enqueue(event, "00000000-0000-4000-8000-000000000001");

  expect(repository.events).toHaveLength(1);
});

import { describe, expect, test } from "vitest";
import { createEventEnvelope, eventEnvelopeSchema } from "./events";

describe("domain event envelope", () => {
  test("creates a versioned event with causal metadata", () => {
    const event = createEventEnvelope({
      name: "system/diagnostic.requested",
      correlationId: "11111111-1111-4111-8111-111111111111",
      pipelineRunId: "22222222-2222-4222-8222-222222222222",
      data: { requestedBy: "33333333-3333-4333-8333-333333333333" },
      now: new Date("2026-07-29T12:00:00.000Z"),
      id: "44444444-4444-4444-8444-444444444444",
    });

    expect(eventEnvelopeSchema.parse(event)).toMatchObject({
      id: "44444444-4444-4444-8444-444444444444",
      name: "system/diagnostic.requested",
      schemaVersion: 1,
      correlationId: "11111111-1111-4111-8111-111111111111",
    });
  });

  test("rejects unknown events", () => {
    expect(() =>
      eventEnvelopeSchema.parse({
        id: crypto.randomUUID(),
        name: "weather/completed",
        schemaVersion: 1,
        correlationId: crypto.randomUUID(),
        pipelineRunId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        data: {},
      }),
    ).toThrow();
  });
});

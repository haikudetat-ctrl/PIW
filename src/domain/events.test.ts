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

describe("roof assessment lifecycle events", () => {
  const assessmentId = "77777777-7777-4777-8777-777777777777";

  test.each([
    ["roof/assessment.started", {assessmentId, entryPoint: "main-home", presentationKey: "all-season-main"}],
    ["roof/assessment.high_intent", {assessmentId, intent: 3, urgency: 0}],
    ["roof/assessment.abandoned", {assessmentId}],
    ["roof/assessment.resumed", {assessmentId}],
    ["roof/assessment.completed", {assessmentId, recommendation: "professional_inspection"}],
    ["roof/assessment.result_viewed", {assessmentId}],
    ["roof/assessment.consultation_requested", {
      assessmentId,
      consultationRequestId: "88888888-8888-4888-8888-888888888888",
      contactMethod: "call",
      callWindow: "morning",
    }],
  ] as const)("creates sparse %s events idempotent by assessment", (name, data) => {
    const event = createEventEnvelope({
      name,
      correlationId: assessmentId,
      pipelineRunId: "22222222-2222-4222-8222-222222222222",
      leadId: "55555555-5555-4555-8555-555555555555",
      propertyId: "66666666-6666-4666-8666-666666666666",
      data,
      now: new Date("2026-08-26T13:00:00.000Z"),
      id: "99999999-9999-4999-8999-999999999999",
    } as Parameters<typeof createEventEnvelope>[0]);

    expect(eventEnvelopeSchema.parse(event)).toMatchObject({
      name,
      idempotencyKey: `${name}:${assessmentId}`,
      data,
    });
    expect(event.data).not.toHaveProperty("phone");
    expect(event.data).not.toHaveProperty("email");
    expect(event.data).not.toHaveProperty("responses");
  });
});

describe("crm/lead.submitted event", () => {
  test("creates a versioned lead-submitted event", () => {
    const event = createEventEnvelope({
      name: "crm/lead.submitted",
      correlationId: "11111111-1111-4111-8111-111111111111",
      pipelineRunId: "22222222-2222-4222-8222-222222222222",
      leadId: "55555555-5555-4555-8555-555555555555",
      propertyId: "66666666-6666-4666-8666-666666666666",
      data: {
        leadId: "55555555-5555-4555-8555-555555555555",
        propertyId: "66666666-6666-4666-8666-666666666666",
        name: "Jordan Rivera",
        phone: "555-010-1000",
        email: "jordan@example.com",
        submittedAddress: "12 Birch St, Trenton, NJ",
        serviceRequested: "roofing",
      },
    });

    expect(eventEnvelopeSchema.parse(event)).toMatchObject({
      name: "crm/lead.submitted",
      schemaVersion: 1,
      leadId: "55555555-5555-4555-8555-555555555555",
      propertyId: "66666666-6666-4666-8666-666666666666",
    });
  });

  test.each(["solar", "both"] as const)(
    "accepts %s as the requested service",
    (serviceRequested) => {
      const event = createEventEnvelope({
        name: "crm/lead.submitted",
        correlationId: "11111111-1111-4111-8111-111111111111",
        pipelineRunId: "22222222-2222-4222-8222-222222222222",
        leadId: "55555555-5555-4555-8555-555555555555",
        propertyId: "66666666-6666-4666-8666-666666666666",
        data: {
          leadId: "55555555-5555-4555-8555-555555555555",
          propertyId: "66666666-6666-4666-8666-666666666666",
          name: "Jordan Rivera",
          phone: "555-010-1000",
          email: "jordan@example.com",
          submittedAddress: "12 Birch St, Trenton, NJ",
          serviceRequested,
        },
      });

      expect(eventEnvelopeSchema.parse(event).data).toMatchObject({ serviceRequested });
    },
  );
});

describe("appointments/rep.assigned event", () => {
  test("keys an assignment event by appointment and rep without a pipeline run", () => {
    const event = createEventEnvelope({
      name: "appointments/rep.assigned",
      correlationId: "11111111-1111-4111-8111-111111111111",
      leadId: "22222222-2222-4222-8222-222222222222",
      data: {
        appointmentId: "33333333-3333-4333-8333-333333333333",
        repId: "44444444-4444-4444-8444-444444444444",
      },
      now: new Date("2026-07-30T12:00:00.000Z"),
      id: "55555555-5555-4555-8555-555555555555",
    });

    expect(eventEnvelopeSchema.parse(event)).toMatchObject({
      name: "appointments/rep.assigned",
      leadId: "22222222-2222-4222-8222-222222222222",
      idempotencyKey:
        "appointments/rep.assigned:33333333-3333-4333-8333-333333333333:44444444-4444-4444-8444-444444444444",
    });
    expect("pipelineRunId" in event).toBe(false);
  });
});

describe("property/address.validation_requested event", () => {
  test("defaults attempt to 1 with an attempt-suffixed idempotency key", () => {
    const event = createEventEnvelope({
      name: "property/address.validation_requested",
      correlationId: "11111111-1111-4111-8111-111111111111",
      pipelineRunId: "22222222-2222-4222-8222-222222222222",
      leadId: "55555555-5555-4555-8555-555555555555",
      propertyId: "66666666-6666-4666-8666-666666666666",
      data: {
        leadId: "55555555-5555-4555-8555-555555555555",
        propertyId: "66666666-6666-4666-8666-666666666666",
        submittedAddress: "12 Birch St, Trenton, NJ",
      },
    });

    expect(eventEnvelopeSchema.parse(event)).toMatchObject({
      name: "property/address.validation_requested",
      data: { attempt: 1 },
      idempotencyKey:
        "property/address.validation_requested:22222222-2222-4222-8222-222222222222:1",
    });
  });

  test("a retried attempt produces a distinct idempotency key", () => {
    const event = createEventEnvelope({
      name: "property/address.validation_requested",
      correlationId: "11111111-1111-4111-8111-111111111111",
      pipelineRunId: "22222222-2222-4222-8222-222222222222",
      leadId: "55555555-5555-4555-8555-555555555555",
      propertyId: "66666666-6666-4666-8666-666666666666",
      data: {
        leadId: "55555555-5555-4555-8555-555555555555",
        propertyId: "66666666-6666-4666-8666-666666666666",
        submittedAddress: "12 Birch St, Trenton, NJ",
        attempt: 2,
      },
    });

    expect(event.idempotencyKey).toBe(
      "property/address.validation_requested:22222222-2222-4222-8222-222222222222:2",
    );
  });
});

describe("property/discovery_requested event", () => {
  test("creates a versioned discovery-requested event", () => {
    const event = createEventEnvelope({
      name: "property/discovery_requested",
      correlationId: "11111111-1111-4111-8111-111111111111",
      pipelineRunId: "22222222-2222-4222-8222-222222222222",
      leadId: "55555555-5555-4555-8555-555555555555",
      propertyId: "66666666-6666-4666-8666-666666666666",
      data: {
        leadId: "55555555-5555-4555-8555-555555555555",
        propertyId: "66666666-6666-4666-8666-666666666666",
        canonicalAddress: "12 BIRCH ST, TRENTON, NJ, 08611",
        latitude: 40.22,
        longitude: -74.76,
        attempt: 1,
      },
    });

    expect(eventEnvelopeSchema.parse(event)).toMatchObject({
      name: "property/discovery_requested",
      idempotencyKey:
        "property/discovery_requested:22222222-2222-4222-8222-222222222222:1",
    });
  });
});

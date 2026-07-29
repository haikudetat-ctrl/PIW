import { z } from "zod";
import { uuidSchema } from "./ids";

export const diagnosticRequestedDataSchema = z.object({
  requestedBy: uuidSchema,
});

const diagnosticRequestedSchema = z.object({
  id: uuidSchema,
  name: z.literal("system/diagnostic.requested"),
  schemaVersion: z.literal(1),
  correlationId: uuidSchema,
  causationEventId: uuidSchema.optional(),
  leadId: uuidSchema.optional(),
  propertyId: uuidSchema.optional(),
  pipelineRunId: uuidSchema,
  occurredAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1),
  data: diagnosticRequestedDataSchema,
});

export const eventEnvelopeSchema = z.discriminatedUnion("name", [
  diagnosticRequestedSchema,
]);

export type DomainEvent = z.infer<typeof eventEnvelopeSchema>;

type DiagnosticEventInput = {
  name: "system/diagnostic.requested";
  correlationId: string;
  pipelineRunId: string;
  data: z.infer<typeof diagnosticRequestedDataSchema>;
  now?: Date;
  id?: string;
};

export function createEventEnvelope(input: DiagnosticEventInput): DomainEvent {
  const id = input.id ?? crypto.randomUUID();
  return eventEnvelopeSchema.parse({
    ...input,
    id,
    schemaVersion: 1,
    occurredAt: (input.now ?? new Date()).toISOString(),
    idempotencyKey: `${input.name}:${input.pipelineRunId}`,
  });
}

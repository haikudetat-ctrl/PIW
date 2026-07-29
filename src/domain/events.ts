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

export const leadSubmittedDataSchema = z.object({
  leadId: uuidSchema,
  propertyId: uuidSchema,
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.email(),
  submittedAddress: z.string().min(1),
  serviceRequested: z.literal("roofing"),
  notes: z.string().optional(),
});

const leadSubmittedSchema = z.object({
  id: uuidSchema,
  name: z.literal("crm/lead.submitted"),
  schemaVersion: z.literal(1),
  correlationId: uuidSchema,
  causationEventId: uuidSchema.optional(),
  leadId: uuidSchema,
  propertyId: uuidSchema,
  pipelineRunId: uuidSchema,
  occurredAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1),
  data: leadSubmittedDataSchema,
});

export const eventEnvelopeSchema = z.discriminatedUnion("name", [
  diagnosticRequestedSchema,
  leadSubmittedSchema,
]);

export type DomainEvent = z.infer<typeof eventEnvelopeSchema>;

type EventInput =
  | {
      name: "system/diagnostic.requested";
      correlationId: string;
      pipelineRunId: string;
      causationEventId?: string;
      data: z.infer<typeof diagnosticRequestedDataSchema>;
      now?: Date;
      id?: string;
    }
  | {
      name: "crm/lead.submitted";
      correlationId: string;
      pipelineRunId: string;
      leadId: string;
      propertyId: string;
      causationEventId?: string;
      data: z.infer<typeof leadSubmittedDataSchema>;
      now?: Date;
      id?: string;
    };

export function createEventEnvelope(input: EventInput): DomainEvent {
  const id = input.id ?? crypto.randomUUID();
  return eventEnvelopeSchema.parse({
    ...input,
    id,
    schemaVersion: 1,
    occurredAt: (input.now ?? new Date()).toISOString(),
    idempotencyKey: `${input.name}:${input.pipelineRunId}`,
  });
}

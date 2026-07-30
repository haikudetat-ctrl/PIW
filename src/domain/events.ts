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

export const addressValidationRequestedDataSchema = z.object({
  leadId: uuidSchema,
  propertyId: uuidSchema,
  submittedAddress: z.string().min(1),
  attempt: z.number().int().positive().default(1),
});

export const propertyDiscoveryRequestedDataSchema = z.object({
  leadId: uuidSchema,
  propertyId: uuidSchema,
  canonicalAddress: z.string().min(1),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  attempt: z.number().int().positive().default(1),
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

const addressValidationRequestedSchema = z.object({
  id: uuidSchema,
  name: z.literal("property/address.validation_requested"),
  schemaVersion: z.literal(1),
  correlationId: uuidSchema,
  causationEventId: uuidSchema.optional(),
  leadId: uuidSchema,
  propertyId: uuidSchema,
  pipelineRunId: uuidSchema,
  occurredAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1),
  data: addressValidationRequestedDataSchema,
});

const propertyDiscoveryRequestedSchema = z.object({
  id: uuidSchema,
  name: z.literal("property/discovery_requested"),
  schemaVersion: z.literal(1),
  correlationId: uuidSchema,
  causationEventId: uuidSchema.optional(),
  leadId: uuidSchema,
  propertyId: uuidSchema,
  pipelineRunId: uuidSchema,
  occurredAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1),
  data: propertyDiscoveryRequestedDataSchema,
});

export const eventEnvelopeSchema = z.discriminatedUnion("name", [
  diagnosticRequestedSchema,
  leadSubmittedSchema,
  addressValidationRequestedSchema,
  propertyDiscoveryRequestedSchema,
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
    }
  | {
      name: "property/address.validation_requested";
      correlationId: string;
      pipelineRunId: string;
      leadId: string;
      propertyId: string;
      causationEventId?: string;
      data: z.input<typeof addressValidationRequestedDataSchema>;
      now?: Date;
      id?: string;
    }
  | {
      name: "property/discovery_requested";
      correlationId: string;
      pipelineRunId: string;
      leadId: string;
      propertyId: string;
      causationEventId?: string;
      data: z.input<typeof propertyDiscoveryRequestedDataSchema>;
      now?: Date;
      id?: string;
    };

const ATTEMPT_AWARE_EVENT_NAMES = new Set([
  "property/address.validation_requested",
  "property/discovery_requested",
]);

export function createEventEnvelope(input: EventInput): DomainEvent {
  const id = input.id ?? crypto.randomUUID();
  const attempt = ATTEMPT_AWARE_EVENT_NAMES.has(input.name)
    ? (input.data as { attempt?: number }).attempt ?? 1
    : undefined;
  const idempotencyKey = attempt
    ? `${input.name}:${input.pipelineRunId}:${attempt}`
    : `${input.name}:${input.pipelineRunId}`;

  return eventEnvelopeSchema.parse({
    ...input,
    id,
    schemaVersion: 1,
    occurredAt: (input.now ?? new Date()).toISOString(),
    idempotencyKey,
  });
}

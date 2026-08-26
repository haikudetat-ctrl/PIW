import { z } from "zod";
import {
  roofAssessmentEntryPoints,
  roofAssessmentPresentationKeys,
} from "@/config/roof-assessment";
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
  googlePlaceId: z.string().min(1).optional(),
  serviceRequested: z.literal("roofing"),
  notes: z.string().optional(),
});

export const addressValidationRequestedDataSchema = z.object({
  leadId: uuidSchema,
  propertyId: uuidSchema,
  submittedAddress: z.string().min(1),
  googlePlaceId: z.string().min(1).optional(),
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

// Raised after a vendor webhook delivery is durably recorded in
// integration_events, ahead of (and independent from) any lead or pipeline
// existing yet — that's why leadId/propertyId/pipelineRunId are optional
// here, unlike every other event.
export const integrationEventReceivedDataSchema = z.object({
  integrationEventId: uuidSchema,
  sourceSystem: z.string().min(1),
  eventType: z.string().min(1),
});

export const appointmentRepAssignedDataSchema = z.object({
  appointmentId: uuidSchema,
  repId: uuidSchema,
});

const assessmentIdDataSchema = z.object({assessmentId: uuidSchema}).strict();
export const roofAssessmentStartedDataSchema = assessmentIdDataSchema.extend({
  entryPoint: z.enum(roofAssessmentEntryPoints as [string, ...string[]]),
  presentationKey: z.enum(roofAssessmentPresentationKeys),
}).strict();
export const roofAssessmentHighIntentDataSchema = assessmentIdDataSchema.extend({
  intent: z.number().int().nonnegative(),
  urgency: z.number().int().nonnegative(),
}).strict();
export const roofAssessmentCompletedDataSchema = assessmentIdDataSchema.extend({
  recommendation: z.enum([
    "monitor_or_repair",
    "professional_inspection",
    "replacement_may_make_sense",
  ]),
}).strict();
export const roofAssessmentConsultationRequestedDataSchema = assessmentIdDataSchema.extend({
  consultationRequestId: uuidSchema,
  contactMethod: z.enum(["call", "text", "email"]),
  callWindow: z.enum(["asap", "morning", "midday", "afternoon", "evening"]).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.contactMethod === "call" && !value.callWindow) {
    context.addIssue({code: "custom", path: ["callWindow"], message: "Call window is required"});
  }
  if (value.contactMethod !== "call" && value.callWindow) {
    context.addIssue({code: "custom", path: ["callWindow"], message: "Call window is call-only"});
  }
});

const assessmentEnvelopeFields = {
  id: uuidSchema,
  schemaVersion: z.literal(1),
  correlationId: uuidSchema,
  causationEventId: uuidSchema.optional(),
  leadId: uuidSchema,
  propertyId: uuidSchema,
  pipelineRunId: uuidSchema,
  occurredAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1),
};

function assessmentEventSchema<TName extends string, TData extends z.ZodType>(
  name: TName,
  data: TData,
) {
  return z.object({...assessmentEnvelopeFields, name: z.literal(name), data});
}

const roofAssessmentStartedSchema = assessmentEventSchema(
  "roof/assessment.started",
  roofAssessmentStartedDataSchema,
);
const roofAssessmentHighIntentSchema = assessmentEventSchema(
  "roof/assessment.high_intent",
  roofAssessmentHighIntentDataSchema,
);
const roofAssessmentAbandonedSchema = assessmentEventSchema(
  "roof/assessment.abandoned",
  assessmentIdDataSchema,
);
const roofAssessmentResumedSchema = assessmentEventSchema(
  "roof/assessment.resumed",
  assessmentIdDataSchema,
);
const roofAssessmentCompletedSchema = assessmentEventSchema(
  "roof/assessment.completed",
  roofAssessmentCompletedDataSchema,
);
const roofAssessmentResultViewedSchema = assessmentEventSchema(
  "roof/assessment.result_viewed",
  assessmentIdDataSchema,
);
const roofAssessmentConsultationRequestedSchema = assessmentEventSchema(
  "roof/assessment.consultation_requested",
  roofAssessmentConsultationRequestedDataSchema,
);

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

const integrationEventReceivedSchema = z.object({
  id: uuidSchema,
  name: z.literal("integration/event.received"),
  schemaVersion: z.literal(1),
  correlationId: uuidSchema,
  causationEventId: uuidSchema.optional(),
  leadId: uuidSchema.optional(),
  propertyId: uuidSchema.optional(),
  pipelineRunId: uuidSchema.optional(),
  occurredAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1),
  data: integrationEventReceivedDataSchema,
});

const appointmentRepAssignedSchema = z.object({
  id: uuidSchema,
  name: z.literal("appointments/rep.assigned"),
  schemaVersion: z.literal(1),
  correlationId: uuidSchema,
  causationEventId: uuidSchema.optional(),
  leadId: uuidSchema,
  occurredAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1),
  data: appointmentRepAssignedDataSchema,
});

export const eventEnvelopeSchema = z.discriminatedUnion("name", [
  diagnosticRequestedSchema,
  leadSubmittedSchema,
  addressValidationRequestedSchema,
  propertyDiscoveryRequestedSchema,
  integrationEventReceivedSchema,
  appointmentRepAssignedSchema,
  roofAssessmentStartedSchema,
  roofAssessmentHighIntentSchema,
  roofAssessmentAbandonedSchema,
  roofAssessmentResumedSchema,
  roofAssessmentCompletedSchema,
  roofAssessmentResultViewedSchema,
  roofAssessmentConsultationRequestedSchema,
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
    }
  | {
      name: "integration/event.received";
      correlationId: string;
      pipelineRunId?: string;
      leadId?: string;
      propertyId?: string;
      causationEventId?: string;
      data: z.infer<typeof integrationEventReceivedDataSchema>;
      now?: Date;
      id?: string;
    }
  | {
      name: "appointments/rep.assigned";
      correlationId: string;
      leadId: string;
      causationEventId?: string;
      data: z.infer<typeof appointmentRepAssignedDataSchema>;
      now?: Date;
      id?: string;
    }
  | {
      name: "roof/assessment.started";
      correlationId: string;
      pipelineRunId: string;
      leadId: string;
      propertyId: string;
      causationEventId?: string;
      data: z.infer<typeof roofAssessmentStartedDataSchema>;
      now?: Date;
      id?: string;
    }
  | {
      name: "roof/assessment.high_intent";
      correlationId: string;
      pipelineRunId: string;
      leadId: string;
      propertyId: string;
      causationEventId?: string;
      data: z.infer<typeof roofAssessmentHighIntentDataSchema>;
      now?: Date;
      id?: string;
    }
  | {
      name:
        | "roof/assessment.abandoned"
        | "roof/assessment.resumed"
        | "roof/assessment.result_viewed";
      correlationId: string;
      pipelineRunId: string;
      leadId: string;
      propertyId: string;
      causationEventId?: string;
      data: z.infer<typeof assessmentIdDataSchema>;
      now?: Date;
      id?: string;
    }
  | {
      name: "roof/assessment.completed";
      correlationId: string;
      pipelineRunId: string;
      leadId: string;
      propertyId: string;
      causationEventId?: string;
      data: z.infer<typeof roofAssessmentCompletedDataSchema>;
      now?: Date;
      id?: string;
    }
  | {
      name: "roof/assessment.consultation_requested";
      correlationId: string;
      pipelineRunId: string;
      leadId: string;
      propertyId: string;
      causationEventId?: string;
      data: z.infer<typeof roofAssessmentConsultationRequestedDataSchema>;
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
  // integration/event.received has no pipeline run yet (it precedes lead
  // creation), so it keys on the integration event id instead.
  let idempotencyKey: string;
  if (input.name === "integration/event.received") {
    idempotencyKey = `${input.name}:${input.data.integrationEventId}`;
  } else if (input.name === "appointments/rep.assigned") {
    idempotencyKey = `${input.name}:${input.data.appointmentId}:${input.data.repId}`;
  } else if (input.name.startsWith("roof/assessment.")) {
    idempotencyKey = `${input.name}:${(input.data as {assessmentId: string}).assessmentId}`;
  } else if (attempt) {
    idempotencyKey = `${input.name}:${input.pipelineRunId}:${attempt}`;
  } else {
    idempotencyKey = `${input.name}:${input.pipelineRunId}`;
  }

  return eventEnvelopeSchema.parse({
    ...input,
    id,
    schemaVersion: 1,
    occurredAt: (input.now ?? new Date()).toISOString(),
    idempotencyKey,
  });
}

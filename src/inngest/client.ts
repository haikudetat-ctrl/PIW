import { Inngest, eventType, staticSchema } from "inngest";
import type { DomainEvent } from "@/domain/events";

type DiagnosticRequestedData = Extract<
  DomainEvent,
  { name: "system/diagnostic.requested" }
>;
type LeadSubmittedData = Extract<DomainEvent, { name: "crm/lead.submitted" }>;
type AddressValidationRequestedData = Extract<
  DomainEvent,
  { name: "property/address.validation_requested" }
>;
type PropertyDiscoveryRequestedData = Extract<
  DomainEvent,
  { name: "property/discovery_requested" }
>;
type IntegrationEventReceivedData = Extract<
  DomainEvent,
  { name: "integration/event.received" }
>;
type AppointmentRepAssignedData = Extract<
  DomainEvent,
  { name: "appointments/rep.assigned" }
>;

export const diagnosticRequested = eventType("system/diagnostic.requested", {
  schema: staticSchema<DiagnosticRequestedData>(),
});

export const leadSubmitted = eventType("crm/lead.submitted", {
  schema: staticSchema<LeadSubmittedData>(),
});

export const addressValidationRequested = eventType(
  "property/address.validation_requested",
  {
    schema: staticSchema<AddressValidationRequestedData>(),
  },
);

export const propertyDiscoveryRequested = eventType("property/discovery_requested", {
  schema: staticSchema<PropertyDiscoveryRequestedData>(),
});

export const integrationEventReceived = eventType("integration/event.received", {
  schema: staticSchema<IntegrationEventReceivedData>(),
});

export const appointmentRepAssigned = eventType("appointments/rep.assigned", {
  schema: staticSchema<AppointmentRepAssignedData>(),
});

export const inngest = new Inngest({
  id: "property-intelligence-worker",
});

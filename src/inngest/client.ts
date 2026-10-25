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
type LeadDistributionRequestedData = Extract<
  DomainEvent,
  { name: "lead/distribution.requested" }
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

type VirtualConsultationBookedData = Extract<
  DomainEvent,
  { name: "appointments/virtual.booked" }
>;
type VirtualConsultationRescheduledData = Extract<
  DomainEvent,
  { name: "appointments/virtual.rescheduled" }
>;
type VirtualConsultationCancelledData = Extract<
  DomainEvent,
  { name: "appointments/virtual.cancelled" }
>;

export const virtualConsultationBooked = eventType("appointments/virtual.booked", {
  schema: staticSchema<VirtualConsultationBookedData>(),
});

export const virtualConsultationRescheduled = eventType("appointments/virtual.rescheduled", {
  schema: staticSchema<VirtualConsultationRescheduledData>(),
});

export const virtualConsultationCancelled = eventType("appointments/virtual.cancelled", {
  schema: staticSchema<VirtualConsultationCancelledData>(),
});

/**
 * Staff asked PIW to re-run the calendar sync for one appointment. The
 * appointment ID sits under `data` like the domain envelopes, so the sync's
 * per-appointment concurrency key reads the same path for every trigger.
 */
export const virtualConsultationSyncRequested = eventType("appointments/virtual.sync_requested", {
  schema: staticSchema<{companyId: string; data: {appointmentId: string}}>(),
});

export const metaDeliveryRequested = eventType("marketing/meta.delivery.requested", {
  schema: staticSchema<{deliveryId: string}>(),
});

export const googleAdsConversionRequested = eventType("marketing/google_ads.conversion.requested", {
  schema: staticSchema<{deliveryId: string}>(),
});

export const propertyPreviewMeasurementRequested = eventType("property/preview_measurement_requested", {
  schema: staticSchema<{companyId: string; previewId: string}>(),
});

export const propertyPreviewReportRequested = eventType("property/preview_report_requested", {
  schema: staticSchema<{companyId: string; previewId: string}>(),
});

export const leadDistributionRequested = eventType("lead/distribution.requested", {
  schema: staticSchema<LeadDistributionRequestedData>(),
});

export const leadDistributionDeliveryRequested = eventType("lead/distribution.delivery.requested", {
  schema: staticSchema<{
    deliveryId: string;
    destination: "activeprospect_existing" | "activeprospect_secondary" | "internal_email";
  }>(),
});

export const inngest = new Inngest({
  id: "property-intelligence-worker",
});

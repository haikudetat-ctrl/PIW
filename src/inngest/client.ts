import { Inngest, eventType, staticSchema } from "inngest";
import type { DomainEvent } from "@/domain/events";

type DiagnosticRequestedData = Extract<
  DomainEvent,
  { name: "system/diagnostic.requested" }
>;
type LeadSubmittedData = Extract<DomainEvent, { name: "crm/lead.submitted" }>;

export const diagnosticRequested = eventType("system/diagnostic.requested", {
  schema: staticSchema<DiagnosticRequestedData>(),
});

export const leadSubmitted = eventType("crm/lead.submitted", {
  schema: staticSchema<LeadSubmittedData>(),
});

export const inngest = new Inngest({
  id: "property-intelligence-worker",
});

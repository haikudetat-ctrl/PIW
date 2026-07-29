import { Inngest, eventType, staticSchema } from "inngest";
import type { DomainEvent } from "@/domain/events";

type DiagnosticRequestedData = Extract<
  DomainEvent,
  { name: "system/diagnostic.requested" }
>;

export const diagnosticRequested = eventType("system/diagnostic.requested", {
  schema: staticSchema<DiagnosticRequestedData>(),
});

export const inngest = new Inngest({
  id: "property-intelligence-worker",
});

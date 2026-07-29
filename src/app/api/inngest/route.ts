import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { publishOutbox } from "@/inngest/functions/publish-outbox";
import { processDiagnosticEvent } from "@/inngest/functions/process-diagnostic-event";
import { crmWriter } from "@/inngest/functions/crm-writer";
import { addressValidationWorker } from "@/inngest/functions/address-validation-worker";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [publishOutbox, processDiagnosticEvent, crmWriter, addressValidationWorker],
});

import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { publishOutbox } from "@/inngest/functions/publish-outbox";
import { processDiagnosticEvent } from "@/inngest/functions/process-diagnostic-event";
import { crmWriter } from "@/inngest/functions/crm-writer";
import { addressValidationWorker } from "@/inngest/functions/address-validation-worker";
import { roofEstimateWorker } from "@/inngest/functions/roof-estimate-worker";
import { processIntegrationEvent } from "@/inngest/functions/process-integration-event";
import { repIntroSender } from "@/inngest/functions/rep-intro-sender";
import { estimateDeliverySender } from "@/inngest/functions/estimate-delivery-sender";
import { contextDialerSlackSender } from "@/inngest/functions/context-dialer-slack-sender";
import { costIntelligenceDigest } from "@/inngest/functions/cost-intelligence-digest";
import { accessRouteReadSync } from "@/inngest/functions/access-route-read-sync";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    publishOutbox,
    processDiagnosticEvent,
    crmWriter,
    addressValidationWorker,
    roofEstimateWorker,
    processIntegrationEvent,
    repIntroSender,
    estimateDeliverySender,
    contextDialerSlackSender,
    costIntelligenceDigest,
    accessRouteReadSync,
  ],
});

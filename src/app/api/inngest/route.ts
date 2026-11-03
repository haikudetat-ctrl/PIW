import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { publishOutbox } from "@/inngest/functions/publish-outbox";
import { processDiagnosticEvent } from "@/inngest/functions/process-diagnostic-event";
import { crmWriter } from "@/inngest/functions/crm-writer";
import { addressValidationWorker } from "@/inngest/functions/address-validation-worker";
import { roofEstimateWorker } from "@/inngest/functions/roof-estimate-worker";
import { propertyPreviewMeasurementWorker } from "@/inngest/functions/property-preview-measurement-worker";
import {
  previewReportReminders,
  previewReportSender,
  propertyPreviewExpiry,
} from "@/inngest/functions/preview-report-sender";
import { processIntegrationEvent } from "@/inngest/functions/process-integration-event";
import { repIntroSender } from "@/inngest/functions/rep-intro-sender";
import { estimateDeliverySender } from "@/inngest/functions/estimate-delivery-sender";
import { contextDialerSlackSender } from "@/inngest/functions/context-dialer-slack-sender";
import { costIntelligenceDigest } from "@/inngest/functions/cost-intelligence-digest";
import { accessRouteReadSync } from "@/inngest/functions/access-route-read-sync";
import { assessmentAbandonmentWorker } from "@/inngest/functions/assessment-abandonment-worker";
import { metaConversionSender } from "@/inngest/functions/meta-conversion-sender";
import { metaConversionSweeper } from "@/inngest/functions/meta-conversion-sweeper";
import {
  clickIdRetention,
  googleAdsConversionScheduler,
  googleAdsConversionSender,
  googleAdsSpendImport,
  paidSearchAlerts,
} from "@/inngest/functions/google-ads";
import {
  activeProspectExistingLeadSender,
  activeProspectSecondaryLeadSender,
  internalLeadEmailSender,
  recoveredLeadDistributionSender,
} from "@/inngest/functions/lead-distribution-sender";
import {leadDistributionSweeper} from "@/inngest/functions/lead-distribution-sweeper";
import { jobNimbusWarehouseSync } from "@/inngest/functions/jobnimbus-warehouse-sync";
import { leadConduitContactRetention } from "@/inngest/functions/leadconduit-contact-retention";
import { setterCallbackSla } from "@/inngest/functions/setter-callback-sla";
import { customerJourneyRefresh } from "@/inngest/functions/customer-journey-refresh";
import {
  bookingMaintenance,
  virtualConsultationCalendarSync,
  virtualConsultationEmails,
  virtualConsultationReminders,
} from "@/inngest/functions/virtual-consultation-worker";

import {approvedSmsWorker} from "@/inngest/functions/approved-sms-worker";
import { onlyWhen, scheduleGates } from "@/inngest/schedule-gates";

export const maxDuration = 300;

// Scheduled functions whose feature is switched off are not served, so
// Inngest stops scheduling (and billing) runs that would do nothing. Turning
// the feature on takes effect on the next deploy, which re-registers them.
const environment = process.env;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    publishOutbox,
    processDiagnosticEvent,
    crmWriter,
    addressValidationWorker,
    roofEstimateWorker,
    propertyPreviewMeasurementWorker,
    previewReportSender,
    previewReportReminders,
    propertyPreviewExpiry,
    processIntegrationEvent,
    repIntroSender,
    ...onlyWhen(scheduleGates.estimateDeliverySender(environment), estimateDeliverySender),
    contextDialerSlackSender,
    costIntelligenceDigest,
    ...onlyWhen(scheduleGates.accessRouteReadSync(environment), accessRouteReadSync),
    assessmentAbandonmentWorker,
    metaConversionSender,
    metaConversionSweeper,
    googleAdsConversionScheduler,
    googleAdsConversionSender,
    googleAdsSpendImport,
    paidSearchAlerts,
    clickIdRetention,
    activeProspectExistingLeadSender,
    activeProspectSecondaryLeadSender,
    internalLeadEmailSender,
    recoveredLeadDistributionSender,
    leadDistributionSweeper,
    jobNimbusWarehouseSync,
    leadConduitContactRetention,
    customerJourneyRefresh,
    virtualConsultationCalendarSync,
    virtualConsultationEmails,
    virtualConsultationReminders,
    bookingMaintenance,
    ...onlyWhen(scheduleGates.setterCallbackSla(environment), setterCallbackSla),
    ...onlyWhen(scheduleGates.approvedBookingSms(environment), approvedSmsWorker),
  ],
});

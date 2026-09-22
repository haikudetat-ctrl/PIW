import "server-only";
import {
  inngest,
  leadDistributionDeliveryRequested,
  leadDistributionRequested,
} from "@/inngest/client";
import {parseServerEnv, resolveLeadDistributionConfiguration} from "@/lib/env/server";
import {
  LeadConduitSubmissionClient,
  ResendLeadNotificationClient,
} from "@/modules/leads/lead-distribution-clients";
import {
  SupabaseLeadDistributionRepository,
  type LeadDistributionDestination,
} from "@/modules/leads/lead-distribution-repository";
import {sendLeadDistributionDelivery} from "@/modules/leads/send-lead-distribution-delivery";
import type {DomainEvent} from "@/domain/events";

export {
  LeadDistributionRetryableError,
  sendLeadDistributionDelivery,
} from "@/modules/leads/send-lead-distribution-delivery";

function runtimeConfiguration() {
  return resolveLeadDistributionConfiguration(parseServerEnv(process.env));
}

export function deliveryIdFromLeadDistributionEvent(
  event: Extract<DomainEvent, {name: "lead/distribution.requested"}>,
  destination: LeadDistributionDestination,
) {
  switch (destination) {
    case "activeprospect_existing":
      return event.data.activeProspectExistingDeliveryId;
    case "activeprospect_secondary":
      return event.data.activeProspectSecondaryDeliveryId;
    case "internal_email":
      return event.data.internalEmailDeliveryId;
  }
}

function activeProspectSender(
  destination: "activeprospect_existing" | "activeprospect_secondary",
) {
  return inngest.createFunction(
    {id: `${destination}-lead-sender`, name: `${destination} lead sender`, retries: 3, triggers: {event: leadDistributionRequested}},
    async ({event, step}) => step.run(`submit-lead-to-${destination}`, async () => {
      const configuration = runtimeConfiguration();
      const deliveryId = deliveryIdFromLeadDistributionEvent(event.data, destination);
      if (!configuration.activeProspect) return {outcome: "disabled" as const, deliveryId};
      return sendLeadDistributionDelivery({
        deliveryId,
        repository: new SupabaseLeadDistributionRepository(),
        client: new LeadConduitSubmissionClient(),
        expectedDestination: destination,
        companyId: configuration.companyId!,
      });
    }),
  );
}

export const activeProspectExistingLeadSender = activeProspectSender("activeprospect_existing");
export const activeProspectSecondaryLeadSender = activeProspectSender("activeprospect_secondary");

export const internalLeadEmailSender = inngest.createFunction(
  {id: "internal-lead-email-sender", name: "Internal lead email sender", retries: 3, triggers: {event: leadDistributionRequested}},
  async ({event, step}) => step.run("email-lead-to-all-season", async () => {
    const configuration = runtimeConfiguration();
    const deliveryId = deliveryIdFromLeadDistributionEvent(event.data, "internal_email");
    if (!configuration.internalEmail) return {outcome: "disabled" as const, deliveryId};
    return sendLeadDistributionDelivery({
      deliveryId,
      repository: new SupabaseLeadDistributionRepository(),
      client: new ResendLeadNotificationClient(configuration.internalEmail),
      expectedDestination: "internal_email",
      companyId: configuration.companyId!,
    });
  }),
);

export const recoveredLeadDistributionSender = inngest.createFunction(
  {id: "recovered-lead-distribution-sender", name: "Recovered lead distribution sender", retries: 3, triggers: {event: leadDistributionDeliveryRequested}},
  async ({event, step}) => step.run("send-recovered-lead-delivery", async () => {
    const configuration = runtimeConfiguration();
    const {deliveryId, destination} = event.data;
    const repository = new SupabaseLeadDistributionRepository();
    if (destination === "internal_email") {
      if (!configuration.internalEmail) return {outcome: "disabled" as const, deliveryId};
      return sendLeadDistributionDelivery({deliveryId, repository, client: new ResendLeadNotificationClient(configuration.internalEmail), expectedDestination: destination, companyId: configuration.companyId!});
    }
    if (!configuration.activeProspect) return {outcome: "disabled" as const, deliveryId};
    return sendLeadDistributionDelivery({deliveryId, repository, client: new LeadConduitSubmissionClient(), expectedDestination: destination, companyId: configuration.companyId!});
  }),
);

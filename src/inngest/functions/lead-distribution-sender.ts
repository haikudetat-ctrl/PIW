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
  type ClaimedLeadDistribution,
  type LeadDistributionCompletion,
  type LeadDistributionDestination,
} from "@/modules/leads/lead-distribution-repository";
import type {LeadConduitResult, MetaDistributionLead, MetaLeadSource} from "@/modules/leads/meta-lead-distribution";

export interface LeadDistributionRepository {
  claim(deliveryId: string, companyId: string): Promise<ClaimedLeadDistribution | null>;
  complete(claimed: ClaimedLeadDistribution, result: LeadConduitResult): Promise<LeadDistributionCompletion>;
}

export interface LeadDistributionClient {
  send(lead: MetaDistributionLead, source: MetaLeadSource): Promise<LeadConduitResult>;
}

export class LeadDistributionRetryableError extends Error {
  constructor(deliveryId: string) {
    super(`Lead distribution delivery requires retry: ${deliveryId}`);
    this.name = "LeadDistributionRetryableError";
  }
}

export async function sendLeadDistributionDelivery({
  deliveryId,
  repository,
  client,
  expectedDestination,
  companyId,
}: {
  deliveryId: string;
  repository: LeadDistributionRepository;
  client: LeadDistributionClient;
  expectedDestination?: LeadDistributionDestination;
  companyId: string;
}) {
  const claimed = await repository.claim(deliveryId, companyId);
  if (!claimed) return {outcome: "noop" as const, deliveryId};
  if (expectedDestination && claimed.destination !== expectedDestination) {
    throw new Error(`Lead distribution destination mismatch: ${deliveryId}`);
  }

  const result = await client.send(claimed.lead, claimed.sourceLabel);
  const outcome = await repository.complete(claimed, result);
  if (result.status === "retryable_failed" && outcome === "retryable_failed") {
    throw new LeadDistributionRetryableError(deliveryId);
  }
  return {outcome, deliveryId};
}

function runtimeConfiguration() {
  return resolveLeadDistributionConfiguration(parseServerEnv(process.env));
}

export const activeProspectLeadSender = inngest.createFunction(
  {id: "activeprospect-lead-sender", name: "ActiveProspect lead sender", retries: 3, triggers: {event: leadDistributionRequested}},
  async ({event, step}) => step.run("submit-lead-to-activeprospect", async () => {
    const configuration = runtimeConfiguration();
    const deliveryId = event.data.activeProspectDeliveryId;
    if (!configuration.activeProspect) return {outcome: "disabled" as const, deliveryId};
    return sendLeadDistributionDelivery({
      deliveryId,
      repository: new SupabaseLeadDistributionRepository(),
      client: new LeadConduitSubmissionClient(),
      expectedDestination: "activeprospect",
      companyId: configuration.companyId!,
    });
  }),
);

export const internalLeadEmailSender = inngest.createFunction(
  {id: "internal-lead-email-sender", name: "Internal lead email sender", retries: 3, triggers: {event: leadDistributionRequested}},
  async ({event, step}) => step.run("email-lead-to-all-season", async () => {
    const configuration = runtimeConfiguration();
    const deliveryId = event.data.internalEmailDeliveryId;
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
    const deliveryId = event.data.deliveryId;
    const repository = new SupabaseLeadDistributionRepository();
    if (event.data.destination === "activeprospect") {
      if (!configuration.activeProspect) return {outcome: "disabled" as const, deliveryId};
      return sendLeadDistributionDelivery({deliveryId, repository, client: new LeadConduitSubmissionClient(), expectedDestination: "activeprospect", companyId: configuration.companyId!});
    }
    if (!configuration.internalEmail) return {outcome: "disabled" as const, deliveryId};
    return sendLeadDistributionDelivery({deliveryId, repository, client: new ResendLeadNotificationClient(configuration.internalEmail), expectedDestination: "internal_email", companyId: configuration.companyId!});
  }),
);

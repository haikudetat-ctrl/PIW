import "server-only";
import type {LeadConduitResult, MetaDistributionLead, MetaLeadSource} from "./meta-lead-distribution";
import type {
  ClaimedLeadDistribution,
  LeadDistributionCompletion,
  LeadDistributionDestination,
} from "./lead-distribution-repository";

export interface LeadDistributionRepository {
  claim(deliveryId: string, companyId: string): Promise<ClaimedLeadDistribution | null>;
  complete(
    claimed: ClaimedLeadDistribution,
    result: LeadConduitResult,
  ): Promise<LeadDistributionCompletion>;
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

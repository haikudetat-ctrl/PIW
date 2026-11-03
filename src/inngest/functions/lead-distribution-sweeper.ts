import "server-only";
import {inngest} from "@/inngest/client";
import {SupabaseLeadDistributionRepository} from "@/modules/leads/lead-distribution-repository";
import {parseServerEnv, resolveLeadDistributionConfiguration} from "@/lib/env/server";

const BATCH_SIZE = 100;

export const leadDistributionSweeper = inngest.createFunction(
  {id: "lead-distribution-sweeper", name: "Lead distribution recovery sweep", triggers: {cron: "*/5 * * * *"}},
  // No step.run: Inngest bills each step as its own execution, and a single
  // step adds nothing over the function's own retries.
  async () => {
    const configuration = resolveLeadDistributionConfiguration(parseServerEnv(process.env));
    if (!configuration.companyId || (!configuration.activeProspect && !configuration.internalEmail)) {
      return {republished: 0};
    }
    const pending = await new SupabaseLeadDistributionRepository().listPending(configuration.companyId, BATCH_SIZE);
    if (!pending.length) return {republished: 0};
    await inngest.send(pending.map((delivery) => ({
      name: "lead/distribution.delivery.requested" as const,
      data: {deliveryId: delivery.deliveryId, destination: delivery.destination},
    })));
    return {republished: pending.length};
  },
);

import "server-only";
import { inngest } from "@/inngest/client";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CostIntelligenceRepository } from "@/modules/costs/repository";
import { runCostIntelligence } from "@/modules/costs/run";

export const costIntelligenceDigest = inngest.createFunction(
  {
    id: "all-season-cost-intelligence-digest",
    name: "All Season cost intelligence digest",
    triggers: { cron: "TZ=America/New_York 0 9,21 * * *" },
    retries: 3,
  },
  async ({ step }) => step.run("collect-and-send-cost-digest", async () => {
    const environment = parseServerEnv(process.env);
    if (!environment.COST_INTELLIGENCE_ENABLED) return { enabled: false };
    const repository = new CostIntelligenceRepository(createServiceClient());
    return runCostIntelligence({ environment, repository });
  }),
);

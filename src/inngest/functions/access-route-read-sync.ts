import "server-only";
import { inngest } from "@/inngest/client";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { SupabaseAccessRouteRepository } from "@/modules/access-route/repository";
import { runAccessRouteSync } from "@/modules/access-route/run";

export const accessRouteReadSync = inngest.createFunction(
  {
    id: "all-season-access-route-read-sync",
    name: "All Season access route read-only sync",
    triggers: { cron: "TZ=America/New_York */30 * * * *" },
    retries: 2,
  },
  async ({ step }) => step.run("pull-read-only-vendor-records", async () => {
    const environment = parseServerEnv(process.env);
    const repository = new SupabaseAccessRouteRepository(createServiceClient());
    return runAccessRouteSync({ environment, repository });
  }),
);

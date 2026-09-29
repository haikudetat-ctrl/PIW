import "server-only";
import { inngest } from "@/inngest/client";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { listJourneyCompanies, refreshCustomerJourney } from "@/modules/journey/refresh";

export const customerJourneyRefresh = inngest.createFunction(
  {
    id: "customer-journey-refresh",
    name: "Customer journey refresh",
    // Minute 47: after the JobNimbus warehouse sync at minute 17 has landed.
    triggers: { cron: "TZ=America/New_York 47 * * * *" },
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    const companies = await step.run("list-journey-companies", () =>
      listJourneyCompanies(createServiceClient(), parseServerEnv(process.env).ACCESS_ROUTE_COMPANY_ID));

    const failures: string[] = [];
    for (const companyId of companies) {
      try {
        await step.run(`refresh-${companyId}`, () => refreshCustomerJourney(createServiceClient(), companyId));
      } catch {
        failures.push(companyId);
      }
    }
    return { companies: companies.length, failures };
  },
);

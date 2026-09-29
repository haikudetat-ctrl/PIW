import "server-only";
import { inngest } from "@/inngest/client";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  WAREHOUSE_RECORD_TYPES,
  createWarehouseDependencies,
  syncCompanyRecordType,
} from "@/modules/jobnimbus/run";

export const jobNimbusWarehouseSync = inngest.createFunction(
  {
    id: "jobnimbus-warehouse-sync",
    name: "JobNimbus warehouse sync",
    // Minute 17 keeps this off the top of the hour and away from the
    // access-route read schedule.
    triggers: { cron: "TZ=America/New_York 17 * * * *" },
    // One run at a time: JobNimbus has no published rate limit and returns
    // 429s under concurrent load.
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    const companies = await step.run("list-enabled-companies", async () => {
      if (!parseServerEnv(process.env).INTEGRATIONS_JOBNIMBUS_SYNC_ENABLED) return [];
      return createWarehouseDependencies(createServiceClient(), process.env).listEnabledCompanies();
    });

    const failures: string[] = [];
    for (const companyId of companies) {
      for (const recordType of WAREHOUSE_RECORD_TYPES) {
        try {
          await step.run(`sync-${companyId}-${recordType}`, () =>
            syncCompanyRecordType(
              { companyId, recordType },
              createWarehouseDependencies(createServiceClient(), process.env),
            ));
        } catch {
          // One company or record type failing must not stop the others. The
          // failure is already recorded in jobnimbus_sync_runs.
          failures.push(`${companyId}:${recordType}`);
        }
      }
    }
    return { companies: companies.length, failures };
  },
);

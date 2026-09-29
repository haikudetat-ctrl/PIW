import "server-only";
import { inngest } from "@/inngest/client";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { redactExpiredLeadConduitContacts } from "@/modules/access-route/leadconduit-retention";

// The LeadConduit receiver binds every checkpoint to ACCESS_ROUTE_COMPANY_ID,
// so that is the only company holding checkpoint contact details.
export const leadConduitContactRetention = inngest.createFunction(
  {
    id: "leadconduit-contact-retention",
    name: "LeadConduit contact retention",
    triggers: { cron: "TZ=America/New_York 7 3 * * *" },
    retries: 2,
  },
  async ({ step }) => step.run("redact-expired-contacts", async () => {
    const companyId = parseServerEnv(process.env).ACCESS_ROUTE_COMPANY_ID;
    if (!companyId) return { redacted: 0, skipped: "no company bound" };
    return { redacted: await redactExpiredLeadConduitContacts(createServiceClient(), companyId) };
  }),
);

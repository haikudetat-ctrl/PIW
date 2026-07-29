import "server-only";
import { inngest } from "@/inngest/client";
import { createServiceClient } from "@/lib/supabase/service";
import { SupabaseOutboxRepository } from "@/modules/events/supabase-outbox-repository";
import { publishPendingEvents } from "@/modules/events/publish-pending-events";

export const publishOutbox = inngest.createFunction(
  { id: "publish-outbox", triggers: { cron: "* * * * *" } },
  async ({ step }) =>
    step.run("claim-and-publish", async () => {
      const repository = new SupabaseOutboxRepository(createServiceClient());
      return publishPendingEvents({
        repository,
        send: async (event) => {
          await inngest.send(event);
        },
        claimedBy: "publish-outbox",
      });
    }),
);

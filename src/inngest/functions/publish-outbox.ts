import "server-only";
import { inngest } from "@/inngest/client";
import { createServiceClient } from "@/lib/supabase/service";
import { SupabaseOutboxRepository } from "@/modules/events/supabase-outbox-repository";
import { publishPendingEvents } from "@/modules/events/publish-pending-events";

// No step.run: Inngest bills each step as its own execution, and a single
// step adds nothing over the function's own retries. This runs every minute,
// so the wrapper alone doubled its cost.
export const publishOutbox = inngest.createFunction(
  { id: "publish-outbox", triggers: { cron: "* * * * *" } },
  async () => {
    const repository = new SupabaseOutboxRepository(createServiceClient());
    return publishPendingEvents({
      repository,
      send: async (event) => {
        await inngest.send(event);
      },
      claimedBy: "publish-outbox",
    });
  },
);

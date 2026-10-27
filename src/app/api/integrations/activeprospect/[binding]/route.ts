import {NextResponse} from "next/server";
import {createServiceClient} from "@/lib/supabase/service";
import {resolveIntakeBinding} from "@/modules/activeprospect/config";
import {handleActiveProspectIntake} from "@/modules/activeprospect/intake-http";
import {acceptActiveProspectIntake} from "@/modules/activeprospect/repository";
import {enqueueAndPublishEvent} from "@/modules/events/enqueue-and-publish-event";
import {SupabaseOutboxRepository} from "@/modules/events/supabase-outbox-repository";
import {inngest} from "@/inngest/client";

export const runtime = "nodejs";

export async function POST(request: Request, {params}: {params: Promise<{binding: string}>}) {
  const {binding} = await params;
  const result = await handleActiveProspectIntake(request, binding, {
    getBinding: resolveIntakeBinding,
    accept: (configured, payload) => acceptActiveProspectIntake(createServiceClient(), configured, payload),
    publish: (event, companyId) => enqueueAndPublishEvent({
      repository: new SupabaseOutboxRepository(createServiceClient()), event, companyId,
      eventAlreadyPersisted: true, send: (outbound) => inngest.send(outbound),
      // No upstream exception text, contact evidence or authorization in logs.
      info: () => undefined, warn: () => undefined,
    }),
    now: () => new Date(),
  });
  return NextResponse.json(result.body, {status: result.status, headers: {"cache-control": "no-store"}});
}

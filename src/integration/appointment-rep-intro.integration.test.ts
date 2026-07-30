import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";
import { createEventEnvelope, eventEnvelopeSchema } from "@/domain/events";
import {
  buildRepIntroPlan,
  queueRepIntroPlan,
  SupabaseRepIntroSenderRepository,
} from "@/inngest/functions/rep-intro-sender";
import type { Database } from "@/lib/database.types";
import { SupabaseOutboxRepository } from "@/modules/events/supabase-outbox-repository";

const runIntegration = process.env.RUN_SUPABASE_INTEGRATION === "1";

type OperationResult = {
  error: { message: string } | null;
};

async function requireSuccess<T extends OperationResult>(
  operation: PromiseLike<T>,
): Promise<T> {
  const result = await operation;
  if (result.error) throw new Error(result.error.message);
  return result;
}

describe.runIf(runIntegration)("appointment rep intro queue", () => {
  test(
    "persists the assignment event and a ready-to-send humanized message",
    async () => {
      const localStatus = JSON.parse(
        execFileSync("npx", ["supabase", "status", "-o", "json"], {
          cwd: process.cwd(),
          encoding: "utf8",
        }),
      ) as { API_URL: string; SERVICE_ROLE_KEY: string };
      const client = createClient<Database>(
        localStatus.API_URL,
        localStatus.SERVICE_ROLE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );

      const companyId = crypto.randomUUID();
      const leadId = crypto.randomUUID();
      const repId = crypto.randomUUID();
      const appointmentId = crypto.randomUUID();
      const correlationId = crypto.randomUUID();
      const event = createEventEnvelope({
        name: "appointments/rep.assigned",
        correlationId,
        leadId,
        data: { appointmentId, repId },
        now: new Date("2026-07-30T12:00:00.000Z"),
      });

      try {
        await requireSuccess(
          client.from("companies").insert({ id: companyId, name: "Rep intro integration" }),
        );
        await requireSuccess(
          client.from("leads").insert({
            id: leadId,
            company_id: companyId,
            name: "Jordan Rivera",
            phone: "555-010-5000",
            email: "rep-intro@example.com",
            submitted_address: "24 Spruce St, Hamilton, NJ",
          }),
        );
        await requireSuccess(
          client.from("reps").insert({
            id: repId,
            company_id: companyId,
            name: "Alex Morgan",
            bio: "Alex has helped New Jersey homeowners for 12 years.",
            credentials: "HAAG Certified",
            community_connection: "Volunteers in Mercer County",
          }),
        );
        await requireSuccess(
          client.from("appointments").insert({
            id: appointmentId,
            company_id: companyId,
            lead_id: leadId,
            rep_id: repId,
            scheduled_at: "2026-08-02T16:00:00.000Z",
            duration_minutes: 60,
          }),
        );

        await new SupabaseOutboxRepository(client).enqueue(event, companyId);

        const repository = new SupabaseRepIntroSenderRepository(client);
        const plan = await buildRepIntroPlan(
          { appointmentId, repId },
          repository,
          new Date("2026-07-30T12:00:00.000Z"),
        );
        await queueRepIntroPlan(plan, event, repository);

        const { data: persistedEvent } = await requireSuccess(
          client
            .from("domain_events")
            .select("id, pipeline_run_id, payload")
            .eq("id", event.id)
            .single(),
        );
        expect(eventEnvelopeSchema.parse(persistedEvent?.payload)).toMatchObject({
          name: "appointments/rep.assigned",
          data: { appointmentId, repId },
        });
        expect(persistedEvent?.pipeline_run_id).toBeNull();

        const { data: outboxRow } = await requireSuccess(
          client.from("event_outbox").select("event_id").eq("event_id", event.id).single(),
        );
        expect(outboxRow?.event_id).toBe(event.id);

        const { data: intro } = await requireSuccess(
          client
            .from("appointment_rep_intros")
            .select("status, composed_subject, composed_body, scheduled_for")
            .eq("appointment_id", appointmentId)
            .single(),
        );
        expect(intro).toMatchObject({
          status: "queued",
          composed_subject: "Meet Alex Morgan, your All Season representative",
          scheduled_for: "2026-08-01T16:00:00+00:00",
        });
        expect(intro?.composed_body).toContain("HAAG Certified");
        expect(intro?.composed_body).toContain("Volunteers in Mercer County");
      } finally {
        await client.from("audit_log").delete().eq("company_id", companyId);
        await client
          .from("appointment_rep_intros")
          .delete()
          .eq("company_id", companyId);
        await client.from("domain_events").delete().eq("company_id", companyId);
        await client.from("appointments").delete().eq("company_id", companyId);
        await client.from("reps").delete().eq("company_id", companyId);
        await client.from("leads").delete().eq("company_id", companyId);
        await client.from("companies").delete().eq("id", companyId);
      }
    },
    20_000,
  );
});

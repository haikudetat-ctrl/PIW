import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";
import { eventEnvelopeSchema } from "@/domain/events";
import type { Database } from "@/lib/database.types";

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

describe.runIf(runIntegration)("atomic review retry outbox", () => {
  test(
    "persists address and discovery payloads accepted by the domain event schema",
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
      const addressPropertyId = crypto.randomUUID();
      const discoveryPropertyId = crypto.randomUUID();
      const addressLeadId = crypto.randomUUID();
      const discoveryLeadId = crypto.randomUUID();
      const addressPipelineId = crypto.randomUUID();
      const discoveryPipelineId = crypto.randomUUID();
      const addressReviewId = crypto.randomUUID();
      const discoveryReviewId = crypto.randomUUID();
      const discoveryWorkerId = crypto.randomUUID();

      try {
        await requireSuccess(
          client
            .from("companies")
            .insert({ id: companyId, name: "Retry payload integration" }),
        );
        await requireSuccess(
          client.from("properties").insert([
            {
              id: addressPropertyId,
              company_id: companyId,
              resolution_status: "review_required",
            },
            {
              id: discoveryPropertyId,
              company_id: companyId,
              resolution_status: "review_required",
            },
          ]),
        );
        await requireSuccess(
          client.from("leads").insert([
            {
              id: addressLeadId,
              company_id: companyId,
              property_id: addressPropertyId,
              name: "Address Retry",
              phone: "555-0101",
              email: "address-retry@example.com",
              submitted_address: "12 Birch Street, Trenton, NJ",
            },
            {
              id: discoveryLeadId,
              company_id: companyId,
              property_id: discoveryPropertyId,
              name: "Discovery Retry",
              phone: "555-0102",
              email: "discovery-retry@example.com",
              submitted_address: "14 Birch Street, Trenton, NJ",
            },
          ]),
        );
        await requireSuccess(
          client.from("pipeline_runs").insert([
            {
              id: addressPipelineId,
              company_id: companyId,
              lead_id: addressLeadId,
              property_id: addressPropertyId,
              correlation_id: crypto.randomUUID(),
              pipeline_version: 1,
              status: "review_required",
            },
            {
              id: discoveryPipelineId,
              company_id: companyId,
              lead_id: discoveryLeadId,
              property_id: discoveryPropertyId,
              correlation_id: crypto.randomUUID(),
              pipeline_version: 1,
              status: "review_required",
            },
          ]),
        );
        await requireSuccess(
          client.from("worker_runs").insert({
            id: discoveryWorkerId,
            pipeline_run_id: discoveryPipelineId,
            worker_type: "address-validation",
            worker_version: 1,
            idempotency_key: `retry-payload-integration:${discoveryPipelineId}`,
            status: "completed",
          }),
        );
        await requireSuccess(
          client.from("property_addresses").insert({
            company_id: companyId,
            property_id: discoveryPropertyId,
            worker_run_id: discoveryWorkerId,
            submitted_address: "14 Birch Street, Trenton, NJ",
            canonical_address: "14 Birch St, Trenton, NJ 08608",
            latitude: 40.2206,
            longitude: -74.7699,
            state_code: "NJ",
            match_method: "exact_single_match",
            confidence: 100,
          }),
        );
        await requireSuccess(
          client.from("review_tasks").insert([
            {
              id: addressReviewId,
              company_id: companyId,
              pipeline_run_id: addressPipelineId,
              lead_id: addressLeadId,
              property_id: addressPropertyId,
              reason: "low_address_confidence",
              triggering_event_name:
                "property/address.validation_requested",
            },
            {
              id: discoveryReviewId,
              company_id: companyId,
              pipeline_run_id: discoveryPipelineId,
              lead_id: discoveryLeadId,
              property_id: discoveryPropertyId,
              reason: "multiple_parcels",
              triggering_event_name: "property/discovery_requested",
            },
          ]),
        );

        await requireSuccess(
          client.rpc("resolve_review_task", {
            p_company_id: companyId,
            p_review_task_id: addressReviewId,
            p_action: "retry",
            p_admin_id: null as unknown as string,
            p_selected_candidate_index: null as unknown as number,
            p_notes: "address integration retry",
          }),
        );
        await requireSuccess(
          client.rpc("resolve_review_task", {
            p_company_id: companyId,
            p_review_task_id: discoveryReviewId,
            p_action: "retry",
            p_admin_id: null as unknown as string,
            p_selected_candidate_index: null as unknown as number,
            p_notes: "discovery integration retry",
          }),
        );

        const { data: persistedEvents } = await requireSuccess(
          client
            .from("domain_events")
            .select("id, payload")
            .eq("company_id", companyId)
            .order("event_name"),
        );
        expect(persistedEvents).toHaveLength(2);

        const parsedEvents = (persistedEvents ?? []).map((row) =>
          eventEnvelopeSchema.parse(row.payload),
        );
        expect(parsedEvents.map((event) => event.name).sort()).toEqual([
          "property/address.validation_requested",
          "property/discovery_requested",
        ]);
        for (const event of parsedEvents) {
          expect(event.occurredAt).toMatch(/Z$/);
          if (
            event.name !== "property/address.validation_requested" &&
            event.name !== "property/discovery_requested"
          ) {
            throw new Error(`Unexpected retry event ${event.name}`);
          }
          expect(event.data.attempt).toBe(2);
        }

        const { data: outboxRows } = await requireSuccess(
          client
            .from("event_outbox")
            .select("event_id")
            .in(
              "event_id",
              (persistedEvents ?? []).map((event) => event.id),
            ),
        );
        expect(outboxRows).toHaveLength(2);
      } finally {
        await client.from("audit_log").delete().eq("company_id", companyId);
        await client.from("review_tasks").delete().eq("company_id", companyId);
        await client
          .from("property_addresses")
          .delete()
          .eq("company_id", companyId);
        await client
          .from("worker_runs")
          .delete()
          .in("pipeline_run_id", [addressPipelineId, discoveryPipelineId]);
        await client.from("domain_events").delete().eq("company_id", companyId);
        await client
          .from("pipeline_runs")
          .delete()
          .eq("company_id", companyId);
        await client.from("leads").delete().eq("company_id", companyId);
        await client.from("properties").delete().eq("company_id", companyId);
        await client.from("companies").delete().eq("id", companyId);
      }
    },
    20_000,
  );
});

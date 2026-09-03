import {execFileSync} from "node:child_process";
import {createClient} from "@supabase/supabase-js";
import {describe, expect, test} from "vitest";
import {eventEnvelopeSchema} from "@/domain/events";
import type {Database} from "@/lib/database.types";
import {SupabaseLeadDistributionRepository} from "@/modules/leads/lead-distribution-repository";

const runIntegration = process.env.RUN_SUPABASE_INTEGRATION === "1";

describe.runIf(runIntegration)("Meta lead distribution persistence", () => {
  test("creates a publishable event and claims each destination from canonical lead data", async () => {
    const localStatus = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], {
      cwd: process.cwd(), encoding: "utf8",
    })) as {API_URL: string; SERVICE_ROLE_KEY: string};
    const client = createClient<Database>(localStatus.API_URL, localStatus.SERVICE_ROLE_KEY, {
      auth: {persistSession: false, autoRefreshToken: false},
    });
    const companyId = crypto.randomUUID();
    const propertyId = crypto.randomUUID();
    const leadId = crypto.randomUUID();
    const pipelineRunId = crypto.randomUUID();

    expect((await client.from("companies").insert({id: companyId, name: "Distribution Integration"})).error).toBeNull();
    expect((await client.from("properties").insert({id: propertyId, company_id: companyId, canonical_address: "123 Main Street, Newark, NJ 07102"})).error).toBeNull();
    expect((await client.from("leads").insert({
      id: leadId, company_id: companyId, property_id: propertyId,
      name: "Jordan Rivera", phone: "+12015550100", email: "jordan@example.com",
      submitted_address: "123 Main Street, Newark, NJ 07102", source_system: "canonical-roof-assessment",
      source_submitted_at: "2026-09-03T12:00:00.000Z", utm_source: "meta", utm_campaign: "AS | Campaign 1",
    })).error).toBeNull();
    expect((await client.from("pipeline_runs").insert({
      id: pipelineRunId, company_id: companyId, property_id: propertyId, lead_id: leadId,
      correlation_id: crypto.randomUUID(), pipeline_version: 2,
    })).error).toBeNull();

    const eventResult = await client.from("domain_events").select("payload")
      .eq("event_name", "lead/distribution.requested").eq("pipeline_run_id", pipelineRunId).single();
    expect(eventResult.error).toBeNull();
    const event = eventEnvelopeSchema.parse(eventResult.data?.payload);
    expect(event).toMatchObject({name: "lead/distribution.requested", leadId, data: {sourceLabel: "Meta70"}});

    const deliveryResult = await client.from("lead_distribution_deliveries").select("id,destination")
      .eq("lead_id", leadId).eq("destination", "activeprospect").single();
    expect(deliveryResult.error).toBeNull();
    const repository = new SupabaseLeadDistributionRepository(
      client as unknown as ConstructorParameters<typeof SupabaseLeadDistributionRepository>[0],
      () => new Date("2099-09-03T13:00:00.000Z"),
    );
    const claimed = await repository.claim(deliveryResult.data!.id, companyId);
    expect(claimed).toMatchObject({destination: "activeprospect", sourceLabel: "Meta70", lead: {id: leadId, email: "jordan@example.com"}});
  });
});

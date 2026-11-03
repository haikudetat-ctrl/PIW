import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import { SupabaseRoofEstimateWorkerRepository } from "./roof-estimate-worker";

type Row = Record<string, unknown>;

// Just enough of the Supabase query builder for queueDeliveries: the
// estimate token lookup, the tenant host lookup, and the delivery upsert.
function fakeClient() {
  const upserts: Row[][] = [];
  const results: Record<string, unknown> = {
    roof_estimates: { data: { public_token: "public-token" }, error: null },
    company_public_hosts: { data: null, error: null },
  };
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "not", "order", "limit"]) {
      builder[method] = () => builder;
    }
    builder.single = async () => results[table];
    builder.maybeSingle = async () => results[table];
    builder.upsert = async (rows: Row[]) => {
      upserts.push(rows);
      return { error: null };
    };
    return builder;
  };
  return { client: { from } as unknown as SupabaseClient<Database>, upserts };
}

const input = {
  estimateId: "estimate-1",
  companyId: "company-1",
  leadId: "lead-1",
  name: "Pat",
  phone: "+16095550100",
  email: "pat@example.com",
  status: "no_coverage" as const,
};

describe("queueDeliveries", () => {
  beforeEach(() => {
    // The required server keys, as the integration script sets them.
    vi.stubEnv("DEPLOYMENT_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "local-publishable-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "local-service-role-key");
    vi.stubEnv("INNGEST_EVENT_KEY", "local-event-key");
    vi.stubEnv("INNGEST_SIGNING_KEY", "local-signing-key");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "piw.example.test");
    vi.stubEnv("ESTIMATE_DELIVERY_SHARED_SECRET", "fake-shared-secret");
    vi.stubEnv("ESTIMATE_SMS_WEBHOOK_URL", "");
    vi.stubEnv("ESTIMATE_EMAIL_WEBHOOK_URL", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("records a channel without a webhook as failed instead of queueing it", async () => {
    vi.stubEnv("ESTIMATE_EMAIL_WEBHOOK_URL", "https://email.example.test");
    const { client, upserts } = fakeClient();

    await new SupabaseRoofEstimateWorkerRepository(client).queueDeliveries(input);

    const byChannel = Object.fromEntries(upserts[0].map((row) => [row.channel, row]));
    expect(byChannel.sms).toMatchObject({
      status: "failed",
      failure_reason: "SMS delivery webhook is not configured",
    });
    expect(byChannel.email).not.toHaveProperty("status");
    expect(byChannel.email).not.toHaveProperty("failure_reason");
  });

  it("leaves both channels queued when both webhooks are configured", async () => {
    vi.stubEnv("ESTIMATE_SMS_WEBHOOK_URL", "https://sms.example.test");
    vi.stubEnv("ESTIMATE_EMAIL_WEBHOOK_URL", "https://email.example.test");
    const { client, upserts } = fakeClient();

    await new SupabaseRoofEstimateWorkerRepository(client).queueDeliveries(input);

    for (const row of upserts[0]) expect(row).not.toHaveProperty("status");
  });
});

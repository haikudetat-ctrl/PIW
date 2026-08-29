import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import { inngest } from "@/inngest/client";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import type {Database} from "@/lib/database.types";

export type ContextDialerDelivery = {
  id: string;
  companyId: string;
  pipelineRunId: string;
  leadId: string;
  estimateId: string | null;
  attemptCount: number;
};

export type ContextDialerSummary = {
  leadId: string;
  name: string;
  phone: string;
  email: string;
  canonicalAddress: string;
  source: string;
  estimateStatus: string | null;
  rangeLowCents: number | null;
  rangeHighCents: number | null;
  roofSquares: number | null;
};

export interface ContextDialerSlackRepository {
  listQueued(limit: number): Promise<ContextDialerDelivery[]>;
  loadSummary(delivery: ContextDialerDelivery): Promise<ContextDialerSummary>;
  markSent(delivery: ContextDialerDelivery): Promise<void>;
  markFailed(delivery: ContextDialerDelivery, reason: string): Promise<void>;
}

type SlackConfig = {
  webhookUrl?: string;
  baseUrl?: string;
};

type ContextDialerUrlEnvironment = {
  CONTEXT_DIALER_BASE_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_URL?: string;
};

function asHttpsUrl(value?: string) {
  if (!value) return undefined;
  const candidate = value.includes("://") ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (
      url.hostname === "docs.slack.dev" ||
      url.hostname === "slack.com" ||
      url.hostname.endsWith(".slack.com")
    ) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function resolveContextDialerBaseUrl(
  environment: ContextDialerUrlEnvironment,
) {
  return (
    asHttpsUrl(environment.VERCEL_PROJECT_PRODUCTION_URL) ??
    asHttpsUrl(environment.CONTEXT_DIALER_BASE_URL) ??
    asHttpsUrl(environment.VERCEL_URL)
  );
}

function escapeSlack(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function money(cents: number | null) {
  if (cents === null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function buildContextDialerSlackPayload(
  summary: ContextDialerSummary,
  baseUrl: string,
) {
  const dialerUrl = new URL(`/leads/${summary.leadId}/dialer`, baseUrl).toString();
  const range =
    summary.rangeLowCents !== null && summary.rangeHighCents !== null
      ? `${money(summary.rangeLowCents)}–${money(summary.rangeHighCents)}`
      : humanizeStatus(summary.estimateStatus ?? "pending");
  const roof = summary.roofSquares === null ? "Pending" : `${summary.roofSquares.toFixed(1)} squares`;
  return {
    text: `New roof lead ready for context dialing: ${summary.name}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "New roof lead ready for context dialing" },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${escapeSlack(summary.name)}*\n${escapeSlack(summary.canonicalAddress)}`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Phone*\n${escapeSlack(summary.phone)}` },
          { type: "mrkdwn", text: `*Email*\n${escapeSlack(summary.email)}` },
          { type: "mrkdwn", text: `*Estimate*\n${escapeSlack(range)}` },
          { type: "mrkdwn", text: `*Roof*\n${escapeSlack(roof)}` },
          { type: "mrkdwn", text: `*Source*\n${escapeSlack(summary.source)}` },
          {
            type: "mrkdwn",
            text: `*Estimate status*\n${escapeSlack(humanizeStatus(summary.estimateStatus ?? "pending"))}`,
          },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open Context Dialer" },
            style: "primary",
            url: dialerUrl,
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Preliminary estimate only · verify measurements and conditions before quoting",
          },
        ],
      },
    ],
  };
}

function humanizeStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function sendQueuedContextDialers(
  repository: ContextDialerSlackRepository,
  config: SlackConfig,
  fetcher: typeof fetch = fetch,
) {
  const deliveries = await repository.listQueued(25);
  const results = [];
  for (const delivery of deliveries) {
    try {
      if (!config.webhookUrl || !config.baseUrl) {
        await repository.markFailed(
          delivery,
          "Slack Context Dialer webhook and base URL are not configured",
        );
        results.push({ id: delivery.id, outcome: "not_configured" as const });
        continue;
      }
      const summary = await repository.loadSummary(delivery);
      const response = await fetcher(config.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildContextDialerSlackPayload(summary, config.baseUrl)),
      });
      if (!response.ok) throw new Error(`Slack returned HTTP ${response.status}`);
      await repository.markSent(delivery);
      results.push({ id: delivery.id, outcome: "sent" as const });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Slack delivery failed";
      await repository.markFailed(delivery, reason.slice(0, 500));
      results.push({ id: delivery.id, outcome: "failed" as const });
    }
  }
  return results;
}

export class SupabaseContextDialerSlackRepository implements ContextDialerSlackRepository {
  constructor(private readonly client: SupabaseClient<Database> = createServiceClient()) {}

  async listQueued(limit: number) {
    const { data, error } = await this.client
      .from("context_dialer_deliveries")
      .select("id, company_id, pipeline_run_id, lead_id, estimate_id, attempt_count")
      .eq("status", "queued")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for")
      .limit(limit);
    if (error) throw new Error("Failed to load queued Context Dialer deliveries");
    return (data ?? []).map((row) => ({
      id: row.id,
      companyId: row.company_id,
      pipelineRunId: row.pipeline_run_id,
      leadId: row.lead_id,
      estimateId: row.estimate_id,
      attemptCount: row.attempt_count,
    }));
  }

  async loadSummary(delivery: ContextDialerDelivery) {
    const [{ data: lead, error: leadError }, { data: estimate, error: estimateError }] =
      await Promise.all([
        this.client
          .from("leads")
          .select("id, name, phone, email, submitted_address, campaign, original_lead_source, source_system, properties(canonical_address)")
          .eq("id", delivery.leadId)
          .eq("company_id", delivery.companyId)
          .single(),
        delivery.estimateId
          ? this.client
              .from("roof_estimates")
              .select("status, range_low_cents, range_high_cents, roof_squares")
              .eq("id", delivery.estimateId)
              .eq("company_id", delivery.companyId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
    if (leadError || !lead || estimateError) {
      throw new Error("Failed to load Context Dialer summary");
    }
    return {
      leadId: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      canonicalAddress: lead.properties?.canonical_address ?? lead.submitted_address,
      source: lead.campaign ?? lead.original_lead_source ?? lead.source_system ?? "Direct",
      estimateStatus: estimate?.status ?? null,
      rangeLowCents: estimate?.range_low_cents ?? null,
      rangeHighCents: estimate?.range_high_cents ?? null,
      roofSquares: estimate?.roof_squares === null || estimate?.roof_squares === undefined
        ? null
        : Number(estimate.roof_squares),
    };
  }

  async markSent(delivery: ContextDialerDelivery) {
    const now = new Date().toISOString();
    const { error } = await this.client
      .from("context_dialer_deliveries")
      .update({
        status: "sent",
        attempt_count: delivery.attemptCount + 1,
        sent_at: now,
        failure_reason: null,
        updated_at: now,
      })
      .eq("id", delivery.id)
      .eq("status", "queued");
    if (error) throw new Error("Failed to mark Context Dialer sent");
  }

  async markFailed(delivery: ContextDialerDelivery, reason: string) {
    const { error } = await this.client
      .from("context_dialer_deliveries")
      .update({
        status: "failed",
        attempt_count: delivery.attemptCount + 1,
        failure_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", delivery.id)
      .eq("status", "queued");
    if (error) throw new Error("Failed to mark Context Dialer failed");
  }
}

export const contextDialerSlackSender = inngest.createFunction(
  { id: "context-dialer-slack-sender", triggers: { cron: "* * * * *" } },
  async ({ step }) =>
    step.run("send-context-dialer-slack", async () => {
      const environment = parseServerEnv(process.env);
      return sendQueuedContextDialers(new SupabaseContextDialerSlackRepository(), {
        webhookUrl: environment.SLACK_CONTEXT_DIALER_WEBHOOK_URL,
        baseUrl: resolveContextDialerBaseUrl(environment),
      });
    }),
);

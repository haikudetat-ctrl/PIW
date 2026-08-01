import type { ServerEnv } from "@/lib/env/server";
import type { CostRepository } from "./repository";
import type { CollectorResult, CostCollector } from "./contracts";
import { calendarMonthPeriod, costSlotKey } from "./period";
import { parseResourceMap, parseSupabaseCostConfig, usdToMicros } from "./config";
import { collectApplicationUsage } from "./application-usage";
import { collectVercelCosts } from "./collectors/vercel";
import { collectDigitalOceanCosts } from "./collectors/digitalocean";
import { collectGoogleCloudCosts } from "./collectors/google-cloud";
import { collectSupabaseCosts } from "./collectors/supabase";
import { buildCostSummary } from "./summary";
import { sendCostDigestToSlack } from "./slack";

export async function runCostIntelligence(input: {
  environment: ServerEnv;
  repository: CostRepository;
  now?: Date;
  collectors?: CostCollector[];
  fetcher?: typeof fetch;
}) {
  const now = input.now ?? new Date();
  const period = calendarMonthPeriod(now);
  const run = await input.repository.beginRun({
    slotKey: costSlotKey(now),
    scheduledFor: now.toISOString(),
    periodStart: period.start,
  });
  if (run.duplicate) return { duplicate: true, runId: run.id };

  const resourceMap = parseResourceMap(input.environment.COST_RESOURCE_MAP_JSON);
  const fetcher = input.fetcher ?? fetch;
  const collectors = input.collectors ?? [
    (costPeriod) => collectVercelCosts(costPeriod, {
      token: input.environment.VERCEL_API_TOKEN,
      teamId: input.environment.VERCEL_TEAM_ID,
      resourceMap,
    }, fetcher),
    (costPeriod) => collectSupabaseCosts(costPeriod, parseSupabaseCostConfig(input.environment.SUPABASE_COST_CONFIG_JSON)),
    (costPeriod) => collectGoogleCloudCosts(costPeriod, {
      serviceAccountJson: input.environment.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON,
      billingProjectId: input.environment.GOOGLE_CLOUD_BILLING_PROJECT_ID,
      billingTable: input.environment.GOOGLE_CLOUD_BILLING_TABLE,
      resourceMap,
    }, fetcher),
    (costPeriod) => collectDigitalOceanCosts(costPeriod, { token: input.environment.DIGITALOCEAN_TOKEN, resourceMap }, fetcher),
  ];

  const settled = await Promise.allSettled(collectors.map((collector) => collector(period)));
  const results: CollectorResult[] = settled.map((result, index) => result.status === "fulfilled" ? result.value : ({
    provider: (["vercel", "supabase", "google_cloud", "digitalocean"] as const)[index] ?? "application",
    status: "failed",
    items: [],
    warnings: [result.reason instanceof Error ? result.reason.message : "Collector failed"],
    collectedAt: now.toISOString(),
  }));
  try {
    results.push(collectApplicationUsage(period, await input.repository.loadApplicationUsage(period.start)));
  } catch (error) {
    results.push({ provider: "application", status: "failed", items: [], warnings: [error instanceof Error ? error.message : "Application usage collection failed"], collectedAt: now.toISOString() });
  }

  await input.repository.saveItems(run.id, results.flatMap((result) => result.items));
  await input.repository.finishRun(run.id, results);
  const summary = buildCostSummary(period, usdToMicros(input.environment.COST_MONTHLY_BUDGET_USD), results);
  if (!input.environment.SLACK_COST_DIGEST_WEBHOOK_URL) {
    await input.repository.markSlack(run.id, "not_configured");
  } else {
    try {
      await sendCostDigestToSlack(input.environment.SLACK_COST_DIGEST_WEBHOOK_URL, summary, fetcher);
      await input.repository.markSlack(run.id, "sent");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Slack delivery failed";
      await input.repository.markSlack(run.id, "failed", reason);
      throw error;
    }
  }
  return { duplicate: false, runId: run.id, summary };
}

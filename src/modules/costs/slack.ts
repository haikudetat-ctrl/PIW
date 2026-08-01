import type { CostDigestSummary } from "./summary";
import { requireOk } from "./http";

function usd(micros: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(micros / 1_000_000);
}

function percent(value: number) {
  return `${value.toFixed(1)}%`;
}

function providerName(value: string) {
  return value.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

export function buildCostDigestSlackPayload(summary: CostDigestSummary, generatedAt = new Date()) {
  const month = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" }).format(generatedAt);
  const state = summary.forecastMicros > summary.budgetMicros ? "Overrun risk" : "On track";
  const providerLines = summary.providers.length
    ? summary.providers.map((provider) => `• *${providerName(provider.provider)}:* ${usd(provider.currentMicros)} MTD → ${usd(provider.forecastMicros)} forecast _(${provider.confidence})_`).join("\n")
    : "• No provider cost data collected yet";
  const apiLines = summary.apiUsage.length
    ? summary.apiUsage.slice(0, 8).map((api) => `• *${api.name}:* ${api.used.toLocaleString()}${api.limit ? ` / ${api.limit.toLocaleString()} (${percent(api.percent ?? 0)})` : " calls"}`).join("\n")
    : "• No application API usage recorded yet";
  const warningLines = summary.warnings.length
    ? summary.warnings.slice(0, 6).map((warning) => `• ${warning}`).join("\n")
    : "• All configured collectors completed";
  return {
    text: `All Season cost pulse: ${usd(summary.currentMicros)} of ${usd(summary.budgetMicros)}; ${usd(summary.forecastMicros)} forecast (${state})`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: `All Season Cost Pulse · ${month}` } },
      { type: "section", fields: [
        { type: "mrkdwn", text: `*Month to date*\n${usd(summary.currentMicros)} · ${percent(summary.budgetUsedPercent)}` },
        { type: "mrkdwn", text: `*Month-end forecast*\n${usd(summary.forecastMicros)} · ${percent(summary.forecastPercent)}` },
        { type: "mrkdwn", text: `*Budget remaining*\n${usd(summary.remainingMicros)}` },
        { type: "mrkdwn", text: `*Safe daily spend*\n${usd(summary.safeDailyMicros)}` },
      ] },
      { type: "section", text: { type: "mrkdwn", text: `*Provider breakdown*\n${providerLines}` } },
      { type: "section", text: { type: "mrkdwn", text: `*API calls vs limits*\n${apiLines}` } },
      { type: "section", text: { type: "mrkdwn", text: `*Collector notes*\n${warningLines}` } },
      { type: "context", elements: [{ type: "mrkdwn", text: `Calendar month · $1,500 north star · Generated ${generatedAt.toLocaleString("en-US", { timeZone: "America/New_York" })} ET · Actual, metered, and estimated costs remain labeled separately.` }] },
    ],
  };
}

export async function sendCostDigestToSlack(
  webhookUrl: string,
  summary: CostDigestSummary,
  fetcher: typeof fetch = fetch,
) {
  await requireOk(await fetcher(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildCostDigestSlackPayload(summary)),
  }), "Slack");
}

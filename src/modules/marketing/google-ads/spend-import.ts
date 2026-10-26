import "server-only";
import { z } from "zod";
import type { GoogleAdsClient } from "./client";

/**
 * Daily Google Ads cost by campaign (every dollar) and by keyword (search
 * spend breakdown). Re-imports a trailing window because Google restates
 * recent days as invalid clicks are credited back.
 */

export const SPEND_LOOKBACK_DAYS = 7;

const campaignRowSchema = z.object({
  campaign: z.object({id: z.string(), name: z.string().optional()}),
  segments: z.object({date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}),
  metrics: z.object({
    costMicros: z.union([z.string(), z.number()]).optional(),
    clicks: z.union([z.string(), z.number()]).optional(),
    impressions: z.union([z.string(), z.number()]).optional(),
    conversions: z.union([z.string(), z.number()]).optional(),
  }).optional(),
});

const keywordRowSchema = campaignRowSchema.extend({
  adGroup: z.object({id: z.string(), name: z.string().optional()}),
  adGroupCriterion: z.object({
    criterionId: z.string(),
    keyword: z.object({text: z.string().optional(), matchType: z.string().optional()}).optional(),
  }),
});

export type SpendRow = {
  company_id: string;
  platform: "google_ads";
  spend_date: string;
  grain: "campaign" | "keyword";
  campaign_id: string;
  campaign_name: string | null;
  ad_group_id: string;
  ad_group_name: string | null;
  criterion_id: string;
  keyword_text: string | null;
  match_type: string | null;
  cost_micros: number;
  clicks: number;
  impressions: number;
  platform_conversions: number;
  currency_code: string;
  imported_at: string;
};

function count(value: string | number | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function decimal(value: string | number | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 10_000) / 10_000 : 0;
}

/** GAQL date literals in the account's reporting window. */
export function spendWindow(now: Date, days = SPEND_LOOKBACK_DAYS) {
  // Google reports in the account time zone; America/New_York for AllSeason.
  const today = new Intl.DateTimeFormat("en-CA", {timeZone: "America/New_York"}).format(now);
  const end = new Date(`${today}T12:00:00Z`);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return {from: start.toISOString().slice(0, 10), to: today};
}

export function campaignQuery(from: string, to: string) {
  return [
    "SELECT campaign.id, campaign.name, segments.date,",
    "metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions",
    "FROM campaign",
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
  ].join(" ");
}

export function keywordQuery(from: string, to: string) {
  return [
    "SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,",
    "ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,",
    "segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions",
    "FROM keyword_view",
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
  ].join(" ");
}

export function toSpendRows(input: {
  companyId: string;
  currencyCode: string;
  campaignRows: unknown[];
  keywordRows: unknown[];
  importedAt: string;
}): SpendRow[] {
  const rows: SpendRow[] = [];
  for (const raw of input.campaignRows) {
    const parsed = campaignRowSchema.safeParse(raw);
    if (!parsed.success || !/^\d{1,20}$/.test(parsed.data.campaign.id)) continue;
    const row = parsed.data;
    rows.push({
      company_id: input.companyId,
      platform: "google_ads",
      spend_date: row.segments.date,
      grain: "campaign",
      campaign_id: row.campaign.id,
      campaign_name: row.campaign.name?.slice(0, 300) ?? null,
      ad_group_id: "",
      ad_group_name: null,
      criterion_id: "",
      keyword_text: null,
      match_type: null,
      cost_micros: count(row.metrics?.costMicros),
      clicks: count(row.metrics?.clicks),
      impressions: count(row.metrics?.impressions),
      platform_conversions: decimal(row.metrics?.conversions),
      currency_code: input.currencyCode,
      imported_at: input.importedAt,
    });
  }
  for (const raw of input.keywordRows) {
    const parsed = keywordRowSchema.safeParse(raw);
    if (
      !parsed.success
      || !/^\d{1,20}$/.test(parsed.data.campaign.id)
      || !/^\d{1,20}$/.test(parsed.data.adGroup.id)
      || !/^\d{1,20}$/.test(parsed.data.adGroupCriterion.criterionId)
    ) continue;
    const row = parsed.data;
    rows.push({
      company_id: input.companyId,
      platform: "google_ads",
      spend_date: row.segments.date,
      grain: "keyword",
      campaign_id: row.campaign.id,
      campaign_name: row.campaign.name?.slice(0, 300) ?? null,
      ad_group_id: row.adGroup.id,
      ad_group_name: row.adGroup.name?.slice(0, 300) ?? null,
      criterion_id: row.adGroupCriterion.criterionId,
      keyword_text: row.adGroupCriterion.keyword?.text?.slice(0, 300) ?? null,
      match_type: row.adGroupCriterion.keyword?.matchType?.slice(0, 30) ?? null,
      cost_micros: count(row.metrics?.costMicros),
      clicks: count(row.metrics?.clicks),
      impressions: count(row.metrics?.impressions),
      platform_conversions: decimal(row.metrics?.conversions),
      currency_code: input.currencyCode,
      imported_at: input.importedAt,
    });
  }
  return rows;
}

type SpendStore = {
  startRun(input: {companyId: string; from: string; to: string}): Promise<string>;
  finishRun(runId: string, input: {status: "succeeded" | "failed"; rowsUpserted: number | null; errorCategory: string | null}): Promise<void>;
  upsertSpend(rows: SpendRow[]): Promise<void>;
};

export async function importGoogleAdsSpend(input: {
  companyId: string;
  customerId: string;
  loginCustomerId: string | null;
  currencyCode: string;
  client: Pick<GoogleAdsClient, "search">;
  store: SpendStore;
  now: Date;
}) {
  const {from, to} = spendWindow(input.now);
  const runId = await input.store.startRun({companyId: input.companyId, from, to});
  const [campaigns, keywords] = await Promise.all([
    input.client.search({customerId: input.customerId, loginCustomerId: input.loginCustomerId, query: campaignQuery(from, to)}),
    input.client.search({customerId: input.customerId, loginCustomerId: input.loginCustomerId, query: keywordQuery(from, to)}),
  ]);
  if (!campaigns.ok || !keywords.ok) {
    const errorCategory = !campaigns.ok ? campaigns.errorCategory : !keywords.ok ? keywords.errorCategory : "unknown";
    await input.store.finishRun(runId, {status: "failed", rowsUpserted: null, errorCategory});
    return {ok: false as const, errorCategory};
  }
  const rows = toSpendRows({
    companyId: input.companyId,
    currencyCode: input.currencyCode,
    campaignRows: campaigns.rows,
    keywordRows: keywords.rows,
    importedAt: input.now.toISOString(),
  });
  try {
    await input.store.upsertSpend(rows);
  } catch {
    await input.store.finishRun(runId, {status: "failed", rowsUpserted: null, errorCategory: "upsert_failed"});
    return {ok: false as const, errorCategory: "upsert_failed"};
  }
  await input.store.finishRun(runId, {status: "succeeded", rowsUpserted: rows.length, errorCategory: null});
  return {ok: true as const, rows: rows.length, from, to};
}

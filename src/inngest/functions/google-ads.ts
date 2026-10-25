import "server-only";
import { googleAdsConversionRequested, inngest } from "@/inngest/client";
import { parseServerEnv, resolveGoogleAdsConfiguration } from "@/lib/env/server";
import { evaluatePaidSearchHealth, healthSchema, postSlackAlert, slackAlertText } from "@/modules/marketing/google-ads/alerts";
import { GoogleAdsClient } from "@/modules/marketing/google-ads/client";
import { SupabaseGoogleAdsRepository } from "@/modules/marketing/google-ads/repository";
import { sendGoogleAdsConversion, sendGoogleAdsRetractions } from "@/modules/marketing/google-ads/sender";
import { importGoogleAdsSpend } from "@/modules/marketing/google-ads/spend-import";
import { SupabaseGoogleAdsStore } from "@/modules/marketing/google-ads/supabase-store";

/**
 * Google Search Ads jobs.
 *   scheduler (every 15 min): qualify and queue conversions, fan out due
 *     uploads, send retractions.
 *   sender (per delivery): one upload; the ledger owns retries.
 *   spend import (daily, 6:20am ET): trailing 7 days of cost.
 *   alerts (hourly): Slack, at most once per alert per day.
 *   retention (monthly): null click IDs older than 13 months.
 * Every job is a no-op until company_google_ads_settings has a row.
 */

const DUE_BATCH = 100;

function googleClient(): GoogleAdsClient | null {
  try {
    const configuration = resolveGoogleAdsConfiguration(parseServerEnv(process.env));
    return configuration ? new GoogleAdsClient(configuration) : null;
  } catch {
    return null;
  }
}

export const googleAdsConversionScheduler = inngest.createFunction(
  {id: "google-ads-conversion-scheduler", name: "Google Ads conversion scheduler", triggers: {cron: "*/15 * * * *"}},
  async ({step}) => {
    const companies = await step.run("list-companies", () => new SupabaseGoogleAdsStore().listCompanies());
    const repository = new SupabaseGoogleAdsRepository();
    for (const company of companies) {
      await step.run(`enqueue-${company.company_id}`, () => repository.enqueue(company.company_id));
    }
    const due = await step.run("list-due", () => repository.listDue(DUE_BATCH));
    if (due.length) {
      await step.sendEvent("fan-out", due.map((deliveryId) => ({
        name: "marketing/google_ads.conversion.requested" as const,
        data: {deliveryId},
      })));
    }
    const retractions = await step.run("retractions", () =>
      sendGoogleAdsRetractions({repository, client: googleClient(), now: () => new Date()}),
    );
    return {companies: companies.length, due: due.length, ...retractions};
  },
);

export const googleAdsConversionSender = inngest.createFunction(
  {
    id: "google-ads-conversion-sender",
    name: "Google Ads conversion sender",
    retries: 2,
    // Stay well under Google's per-account upload limits.
    concurrency: {limit: 5},
    triggers: {event: googleAdsConversionRequested},
  },
  async ({event, step}) => step.run("send", () =>
    sendGoogleAdsConversion(event.data.deliveryId, {
      repository: new SupabaseGoogleAdsRepository(),
      client: googleClient(),
    }),
  ),
);

export const googleAdsSpendImport = inngest.createFunction(
  {id: "google-ads-spend-import", name: "Google Ads spend import", triggers: {cron: "TZ=America/New_York 20 6 * * *"}},
  async ({step}) => {
    const client = googleClient();
    if (!client) return {skipped: "google_ads_not_configured"};
    const store = new SupabaseGoogleAdsStore();
    const companies = (await step.run("list-companies", () => store.listCompanies()))
      .filter((company) => company.spend_import_enabled);
    const results = [];
    for (const company of companies) {
      results.push(await step.run(`import-${company.company_id}`, () => importGoogleAdsSpend({
        companyId: company.company_id,
        customerId: company.customer_id,
        loginCustomerId: company.login_customer_id,
        currencyCode: company.currency_code,
        client,
        store,
        now: new Date(),
      })));
    }
    return {companies: companies.length, results};
  },
);

export const paidSearchAlerts = inngest.createFunction(
  {id: "paid-search-alerts", name: "Paid search alerts", triggers: {cron: "TZ=America/New_York 5 * * * *"}},
  async ({step}) => {
    let webhookUrl: string | undefined;
    try {
      webhookUrl = parseServerEnv(process.env).SLACK_PAID_MEDIA_ALERTS_WEBHOOK_URL;
    } catch {
      webhookUrl = undefined;
    }
    const store = new SupabaseGoogleAdsStore();
    const repository = new SupabaseGoogleAdsRepository();
    const companies = await step.run("list-companies", () => store.listCompanies());
    let delivered = 0;
    for (const company of companies) {
      delivered += await step.run(`check-${company.company_id}`, async () => {
        const now = new Date();
        const health = healthSchema.safeParse(await repository.health(company.company_id));
        if (!health.success) return 0;
        const date = new Intl.DateTimeFormat("en-CA", {timeZone: "America/New_York"}).format(now);
        let sent = 0;
        for (const alert of evaluatePaidSearchHealth(health.data, now)) {
          const isNew = await store.recordAlert({companyId: company.company_id, key: alert.key, date, severity: alert.severity, message: alert.message});
          if (!isNew || !webhookUrl) continue;
          if (await postSlackAlert(webhookUrl, slackAlertText(company.companyName, alert))) {
            await store.markAlertDelivered({companyId: company.company_id, key: alert.key, date});
            sent += 1;
          }
        }
        return sent;
      });
    }
    return {companies: companies.length, delivered};
  },
);

export const clickIdRetention = inngest.createFunction(
  {id: "click-id-retention", name: "Click ID retention", triggers: {cron: "TZ=America/New_York 30 3 1 * *"}},
  async ({step}) => step.run("purge", () => new SupabaseGoogleAdsRepository().purgeExpiredClickIds()),
);

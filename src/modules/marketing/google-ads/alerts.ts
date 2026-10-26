import "server-only";
import { z } from "zod";

/**
 * Paid search health checks, evaluated hourly from paid_search_health().
 * Each alert fires at most once per company per day (paid_media_alerts).
 */

export const healthSchema = z.object({
  spend_48h_usd: z.coerce.number(),
  google_leads_48h: z.coerce.number(),
  clicks_yesterday: z.coerce.number(),
  google_arrivals_yesterday: z.coerce.number(),
  month_to_date_spend_usd: z.coerce.number(),
  monthly_budget_usd: z.coerce.number().nullable(),
  day_of_month: z.coerce.number(),
  days_in_month: z.coerce.number(),
  uploads_permanent_failed_24h: z.coerce.number(),
  uploads_retrying_over_6h: z.coerce.number(),
  retractions_failed: z.coerce.number(),
  last_spend_import_succeeded_at: z.string().nullable(),
  spend_import_enabled: z.boolean(),
});

export type PaidSearchHealth = z.infer<typeof healthSchema>;

export type PaidMediaAlert = {
  key: string;
  severity: "info" | "warning" | "critical";
  message: string;
};

/** Thresholds, kept together so they are easy to tune. */
export const ALERT_THRESHOLDS = {
  /** Spend with no Google leads at all. */
  spendWithoutLeadsUsd: 150,
  /** Clicks vs. logged arrivals; below this many clicks the ratio is noise. */
  minClicksForReconciliation: 20,
  maxClickArrivalGap: 0.2,
  /** Projected month-end spend vs. budget. */
  overspendRatio: 1.1,
  underspendRatio: 0.7,
  /** Ignore pacing in the first days of a month. */
  pacingFromDay: 5,
  staleImportHours: 36,
} as const;

function usd(value: number) {
  return new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", maximumFractionDigits: 0}).format(value);
}

export function evaluatePaidSearchHealth(health: PaidSearchHealth, now: Date): PaidMediaAlert[] {
  const alerts: PaidMediaAlert[] = [];
  const t = ALERT_THRESHOLDS;

  if (health.spend_48h_usd >= t.spendWithoutLeadsUsd && health.google_leads_48h === 0) {
    alerts.push({
      key: "spend_without_leads",
      severity: "critical",
      message: `Google Ads spent ${usd(health.spend_48h_usd)} in the last 48 hours with no Google leads. Check the landing pages, the estimate form, and click ID capture.`,
    });
  }

  if (health.clicks_yesterday >= t.minClicksForReconciliation) {
    const gap = 1 - health.google_arrivals_yesterday / health.clicks_yesterday;
    if (gap > t.maxClickArrivalGap) {
      alerts.push({
        key: "click_arrival_gap",
        severity: "warning",
        message: `Yesterday Google reported ${health.clicks_yesterday} clicks but the site logged ${health.google_arrivals_yesterday} arrivals with a Google click ID (${Math.round(gap * 100)}% gap). Check final URLs, redirects, and that auto-tagging is on.`,
      });
    }
  }

  if (health.monthly_budget_usd && health.day_of_month >= t.pacingFromDay) {
    const projected = (health.month_to_date_spend_usd / health.day_of_month) * health.days_in_month;
    const ratio = projected / health.monthly_budget_usd;
    if (ratio > t.overspendRatio) {
      alerts.push({
        key: "budget_overpacing",
        severity: "warning",
        message: `Google Ads is on pace for ${usd(projected)} this month against a ${usd(health.monthly_budget_usd)} budget.`,
      });
    } else if (ratio < t.underspendRatio) {
      alerts.push({
        key: "budget_underpacing",
        severity: "info",
        message: `Google Ads is on pace for ${usd(projected)} this month against a ${usd(health.monthly_budget_usd)} budget. Budget may be limited by bids or low search volume.`,
      });
    }
  }

  if (health.uploads_permanent_failed_24h > 0) {
    alerts.push({
      key: "conversion_upload_failed",
      severity: "critical",
      message: `${health.uploads_permanent_failed_24h} Google Ads conversion upload(s) failed permanently in the last 24 hours. See the paid search report for the error.`,
    });
  }
  if (health.uploads_retrying_over_6h > 0) {
    alerts.push({
      key: "conversion_upload_retrying",
      severity: "warning",
      message: `${health.uploads_retrying_over_6h} Google Ads conversion upload(s) have been retrying for over 6 hours.`,
    });
  }
  if (health.retractions_failed > 0) {
    alerts.push({
      key: "conversion_retraction_failed",
      severity: "warning",
      message: `${health.retractions_failed} Google Ads retraction(s) failed. Retract them by hand in Google Ads.`,
    });
  }

  if (health.spend_import_enabled) {
    const last = health.last_spend_import_succeeded_at ? Date.parse(health.last_spend_import_succeeded_at) : null;
    if (!last || now.getTime() - last > t.staleImportHours * 3_600_000) {
      alerts.push({
        key: "spend_import_stale",
        severity: "warning",
        message: `Google Ads spend has not imported in over ${t.staleImportHours} hours. Cost per lead on the dashboard is out of date.`,
      });
    }
  }

  return alerts;
}

export function slackAlertText(companyName: string, alert: PaidMediaAlert) {
  const label = alert.severity === "critical" ? "Action needed" : alert.severity === "warning" ? "Heads up" : "FYI";
  return `*${label}: ${companyName} paid search*\n${alert.message}`;
}

/** Slack incoming webhook; failures are reported, never thrown into the job. */
export async function postSlackAlert(webhookUrl: string, text: string, fetchImpl: typeof fetch = fetch) {
  try {
    const url = new URL(webhookUrl);
    if (url.protocol !== "https:" || url.hostname !== "hooks.slack.com") return false;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({text}),
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

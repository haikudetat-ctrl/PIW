import { createSign } from "node:crypto";
import type { CollectorResult, CostPeriod, ResourceMap } from "../contracts";
import { allocationFor } from "../contracts";
import { requireOk } from "../http";

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

function base64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

async function accessToken(serviceAccount: ServiceAccount, fetcher: typeof fetch) {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token";
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/bigquery.readonly",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(serviceAccount.private_key, "base64url");
  const response = await requireOk(await fetcher(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  }), "Google OAuth");
  return (await response.json() as { access_token: string }).access_token;
}

type BigQueryResponse = {
  jobComplete?: boolean;
  schema?: { fields?: Array<{ name: string }> };
  rows?: Array<{ f: Array<{ v: string | null }> }>;
};

export async function collectGoogleCloudCosts(
  period: CostPeriod,
  config: { serviceAccountJson?: string; billingProjectId?: string; billingTable?: string; resourceMap: ResourceMap },
  fetcher: typeof fetch = fetch,
): Promise<CollectorResult> {
  const collectedAt = new Date().toISOString();
  if (!config.serviceAccountJson || !config.billingProjectId || !config.billingTable) {
    return { provider: "google_cloud", status: "not_configured", items: [], warnings: ["Google Cloud billing export credentials/project/table not configured"], collectedAt };
  }
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_$-]+$/.test(config.billingTable)) {
    return { provider: "google_cloud", status: "failed", items: [], warnings: ["Google billing table must be project.dataset.table"], collectedAt };
  }
  try {
    const serviceAccount = JSON.parse(config.serviceAccountJson) as ServiceAccount;
    const token = await accessToken(serviceAccount, fetcher);
    const query = `
      select
        coalesce(project.id, 'shared') as resource_key,
        coalesce(project.name, project.id, 'Shared Google Cloud') as resource_name,
        coalesce(service.description, 'Unknown Google service') as service,
        sum(cost + coalesce((select sum(credit.amount) from unnest(credits) credit), 0)) as net_cost
      from \`${config.billingTable}\`
      where date(usage_start_time, @timezone) >= @period_start
        and date(usage_start_time, @timezone) < @period_end
      group by resource_key, resource_name, service
      order by net_cost desc`;
    const response = await requireOk(await fetcher(`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(config.billingProjectId)}/queries`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        query,
        useLegacySql: false,
        timeoutMs: 15_000,
        parameterMode: "NAMED",
        queryParameters: [
          { name: "timezone", parameterType: { type: "STRING" }, parameterValue: { value: period.timezone } },
          { name: "period_start", parameterType: { type: "DATE" }, parameterValue: { value: period.start } },
          { name: "period_end", parameterType: { type: "DATE" }, parameterValue: { value: period.endExclusive } },
        ],
      }),
    }), "Google BigQuery");
    const result = await response.json() as BigQueryResponse;
    if (result.jobComplete === false) throw new Error("Google BigQuery cost query exceeded the synchronous timeout");
    const fields = result.schema?.fields?.map((field) => field.name) ?? [];
    const records = (result.rows ?? []).map((row) => Object.fromEntries(row.f.map((cell, index) => [fields[index], cell.v])));
    const trackedKeys = Object.keys(config.resourceMap).filter((key) => key.startsWith("google_cloud:"));
    const scopedRecords = records.filter((record) => {
      const resourceKey = String(record.resource_key ?? "shared");
      return resourceKey === "shared" || !trackedKeys.length || trackedKeys.includes(`google_cloud:${resourceKey}`);
    });
    const excluded = records.length - scopedRecords.length;
    return {
      provider: "google_cloud",
      status: "completed",
      warnings: excluded ? [`${excluded} Google Cloud cost rows for untracked projects were excluded`] : [],
      collectedAt,
      items: scopedRecords.map((record, index) => {
        const resourceKey = String(record.resource_key ?? "shared");
        const allocation = allocationFor(config.resourceMap, "google_cloud", resourceKey);
        return {
          provider: "google_cloud" as const,
          sourceKey: `${resourceKey}:${record.service ?? index}`,
          resourceKey,
          service: String(record.service ?? "Unknown Google service"),
          ...allocation,
          costKind: "actual" as const,
          confidence: "invoice" as const,
          amountMicros: Math.round(Number(record.net_cost ?? 0) * 1_000_000),
          sourceTimestamp: collectedAt,
          sourceUrl: "https://cloud.google.com/billing/docs/how-to/export-data-bigquery",
          metadata: { resourceName: record.resource_name ?? resourceKey },
        };
      }),
    };
  } catch (error) {
    return { provider: "google_cloud", status: "failed", items: [], warnings: [error instanceof Error ? error.message : "Google Cloud collection failed"], collectedAt };
  }
}

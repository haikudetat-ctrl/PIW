import type { CollectorResult, CostPeriod, ResourceMap } from "../contracts";
import { allocationFor } from "../contracts";
import { requireOk } from "../http";

type InvoiceSummary = {
  amount?: string;
  updated_at?: string;
  invoice_uuid?: string;
  billing_period?: string;
};

type DropletList = {
  droplets?: Array<{
    id: number;
    name: string;
    status: string;
    created_at?: string;
    size?: { slug?: string; price_monthly?: number; price_hourly?: number };
  }>;
};

export async function collectDigitalOceanCosts(
  _period: CostPeriod,
  config: { token?: string; resourceMap?: ResourceMap },
  fetcher: typeof fetch = fetch,
): Promise<CollectorResult> {
  const collectedAt = new Date().toISOString();
  if (!config.token) {
    return { provider: "digitalocean", status: "not_configured", items: [], warnings: ["DigitalOcean billing-read token not configured"], collectedAt };
  }
  try {
    const headers = { authorization: `Bearer ${config.token}` };
    const [invoiceResponse, dropletResponse] = await Promise.all([
      fetcher("https://api.digitalocean.com/v2/customers/my/invoices/preview/summary", { headers }),
      fetcher("https://api.digitalocean.com/v2/droplets?per_page=200", { headers }),
    ]);
    const invoice = await (await requireOk(invoiceResponse, "DigitalOcean")).json() as InvoiceSummary;
    const droplets = await (await requireOk(dropletResponse, "DigitalOcean")).json() as DropletList;
    const trackedKeys = Object.keys(config.resourceMap ?? {}).filter((key) => key.startsWith("digitalocean:"));
    const activeDroplets = (droplets.droplets ?? []).filter((droplet) =>
      droplet.status === "active" && (!trackedKeys.length || trackedKeys.includes(`digitalocean:${droplet.id}`)),
    );
    return {
      provider: "digitalocean",
      status: "completed",
      warnings: trackedKeys.length && activeDroplets.length < (droplets.droplets ?? []).filter((droplet) => droplet.status === "active").length
        ? ["Untracked DigitalOcean droplets were excluded from All Season committed cost"] : [],
      collectedAt,
      items: [{
        provider: "digitalocean",
        sourceKey: `invoice-preview:${invoice.invoice_uuid ?? invoice.billing_period ?? collectedAt.slice(0, 10)}`,
        service: "DigitalOcean invoice preview",
        environment: "shared",
        allocationBucket: "shared_platform",
        costKind: "actual",
        confidence: "invoice",
        amountMicros: Math.round(Number(invoice.amount ?? 0) * 1_000_000),
        sourceTimestamp: invoice.updated_at ?? collectedAt,
        sourceUrl: "https://docs.digitalocean.com/platform/billing/reference/api/",
        metadata: { invoiceUuid: invoice.invoice_uuid ?? "preview", billingPeriod: invoice.billing_period ?? null },
      }, ...activeDroplets.map((droplet) => ({
        provider: "digitalocean" as const,
        sourceKey: `droplet:${droplet.id}`,
        resourceKey: String(droplet.id),
        service: `${droplet.name} compute`,
        ...allocationFor(config.resourceMap ?? {}, "digitalocean", String(droplet.id)),
        costKind: "committed" as const,
        confidence: "rate_card" as const,
        amountMicros: Math.round((droplet.size?.price_monthly ?? 0) * 1_000_000),
        sourceTimestamp: droplet.created_at ?? collectedAt,
        sourceUrl: "https://www.digitalocean.com/pricing/droplets",
        metadata: { dropletId: droplet.id, size: droplet.size?.slug ?? null, hourlyUsd: droplet.size?.price_hourly ?? null },
      }))],
    };
  } catch (error) {
    return { provider: "digitalocean", status: "failed", items: [], warnings: [error instanceof Error ? error.message : "DigitalOcean collection failed"], collectedAt };
  }
}

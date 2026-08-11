import type { JsonRecord, LeadConduitProbeResult } from "./contracts";
import { asArray, asRecord, readString } from "./normalize";
import { basicAuth, categoryForStatus, getJson, VendorReadError } from "./http";

const PAGE_LIMIT = 500;
const MAX_PAGES = 25;
const LEADCONDUIT_MAX_PAGE_LIMIT = 1000;

function endpoint(baseUrl: string, path: string): URL {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

async function offsetPages(input: {
  vendor: string;
  baseUrl: string;
  path: string;
  headers?: HeadersInit;
  query?: Record<string, string>;
  pageLimit?: number;
  maxPages?: number;
  fetcher?: typeof fetch;
}): Promise<JsonRecord[]> {
  const all: JsonRecord[] = [];
  const pageLimit = input.pageLimit ?? PAGE_LIMIT;
  const maxPages = input.maxPages ?? MAX_PAGES;
  for (let page = 0; page < maxPages; page += 1) {
    const url = endpoint(input.baseUrl, input.path);
    Object.entries(input.query ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));
    url.searchParams.set("limit", String(pageLimit));
    url.searchParams.set("offset", String(page * pageLimit));
    const rows = asArray(await getJson({
      vendor: input.vendor,
      url,
      headers: input.headers,
      fetcher: input.fetcher,
    }));
    all.push(...rows);
    if (rows.length < pageLimit) break;
  }
  return all;
}

export class LeadConduitReadClient {
  constructor(private readonly config: {
    apiKey: string;
    baseUrl?: string;
    fetcher?: typeof fetch;
  }) {}

  private get headers(): HeadersInit {
    return { Authorization: basicAuth("API", this.config.apiKey) };
  }

  async #flows(): Promise<JsonRecord[]> {
    const url = endpoint(this.config.baseUrl ?? "https://app.leadconduit.com", "/flows");
    return asArray(await getJson({
      vendor: "leadconduit",
      url,
      headers: this.headers,
      fetcher: this.config.fetcher,
    }));
  }

  async eventsPage(input: {
    flowId: string;
    start?: string;
    afterId?: string | null;
    limit: number;
  }): Promise<{ rows: JsonRecord[]; cursor: string | null; hasMore: boolean }> {
    const start = input.start?.trim();
    const afterId = input.afterId?.trim();
    if (Boolean(start) === Boolean(afterId)) {
      throw new VendorReadError("leadconduit", "invalid_response", "LeadConduit events require exactly one cursor selector");
    }
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > LEADCONDUIT_MAX_PAGE_LIMIT) {
      throw new VendorReadError("leadconduit", "invalid_response", "LeadConduit event page limit must be between 1 and 1000");
    }

    const url = endpoint(this.config.baseUrl ?? "https://app.leadconduit.com", "/events");
    url.searchParams.set("sort", "asc");
    url.searchParams.set("limit", String(input.limit));
    url.searchParams.set("rules", JSON.stringify([{ lhv: "flow.id", op: "is equal to", rhv: input.flowId }]));
    if (start) url.searchParams.set("start", start);
    if (afterId) url.searchParams.set("after_id", afterId);

    const rows = asArray(await getJson({
      vendor: "leadconduit",
      url,
      headers: this.headers,
      fetcher: this.config.fetcher,
    })).slice(0, input.limit);
    if (rows.some((row) => leadConduitEventFlowId(row) !== input.flowId)) {
      throw new VendorReadError("leadconduit", "invalid_response", "LeadConduit event page contained an untrusted flow");
    }
    const cursor = readString(rows.at(-1) ?? {}, "id");
    return { rows, cursor, hasMore: rows.length === input.limit && cursor !== null };
  }

  async sourceMeta(flowId: string, sourceId: string): Promise<JsonRecord> {
    return this.recordAt(`/flows/${encodeURIComponent(flowId)}/sources/${encodeURIComponent(sourceId)}/meta`);
  }

  async eventDetail(eventId: string): Promise<JsonRecord> {
    return this.recordAt(`/events/${encodeURIComponent(eventId)}`);
  }

  async probe(input: { approvedFlows: ReadonlyMap<string, string> }): Promise<LeadConduitProbeResult> {
    const configured = [...input.approvedFlows.entries()];
    let visibleFlowCount = 0;
    let approvedFlows: LeadConduitProbeResult["approvedFlows"] = [];
    let missingFlowNames = configured.map(([, flowName]) => flowName);

    try {
      const flows = await this.#flows();
      visibleFlowCount = flows.length;
      const visibleFlowIds = new Set(flows.map((flow) => readString(flow, "id")).filter((flowId): flowId is string => flowId !== null));
      missingFlowNames = configured.filter(([flowId]) => !visibleFlowIds.has(flowId)).map(([, flowName]) => flowName);
      approvedFlows = await Promise.all(configured
        .filter(([flowId]) => visibleFlowIds.has(flowId))
        .map(async ([flowId, flowName]) => {
          const flow = flows.find((candidate) => readString(candidate, "id") === flowId)!;
          const sourceIds = leadConduitSourceIds(flow);
          const metadata = await Promise.all(sourceIds.map((sourceId) => this.sourceMeta(flowId, sourceId)));
          return {
            flowId,
            flowName,
            sourceCount: sourceIds.length,
            fieldNames: [...new Set(metadata.flatMap(leadConduitFieldNames))].sort(),
          };
        }));
      return { ok: true, status: 200, visibleFlowCount, approvedFlows, missingFlowNames };
    } catch (error) {
      const vendorError = error instanceof VendorReadError ? error : null;
      return {
        ok: false,
        status: vendorError?.status ?? 0,
        visibleFlowCount,
        approvedFlows,
        missingFlowNames,
        errorCategory: vendorError?.category ?? "upstream",
      };
    }
  }

  private async recordAt(path: string): Promise<JsonRecord> {
    const value = await getJson({
      vendor: "leadconduit",
      url: endpoint(this.config.baseUrl ?? "https://app.leadconduit.com", path),
      headers: this.headers,
      fetcher: this.config.fetcher,
    });
    const record = asRecord(value);
    if (!record) throw new VendorReadError("leadconduit", "invalid_response", "LeadConduit returned an invalid record");
    return record;
  }
}

function leadConduitEventFlowId(record: JsonRecord): string | null {
  return readString(record, "flow_id", "flow.id") ?? readString(asRecord(record.vars) ?? {}, "flow.id");
}

function leadConduitSourceIds(flow: JsonRecord): string[] {
  if (!Array.isArray(flow.sources)) return [];
  return flow.sources.flatMap((source) => {
    if (typeof source === "string" && source.trim()) return [source.trim()];
    const sourceId = readString(asRecord(source) ?? {}, "id", "source_id");
    return sourceId ? [sourceId] : [];
  });
}

function leadConduitFieldNames(metadata: JsonRecord): string[] {
  if (!Array.isArray(metadata.fields)) return [];
  return metadata.fields.flatMap((field) => {
    if (typeof field === "string" && field.trim()) return [field.trim()];
    const name = readString(asRecord(field) ?? {}, "name", "label", "id");
    return name ? [name] : [];
  });
}

export class LeadMasterReadClient {
  constructor(private readonly config: {
    accessToken: string;
    baseUrl?: string;
    lookbackMinutes: number;
    fetcher?: typeof fetch;
  }) {}

  private async pages(path: string): Promise<JsonRecord[]> {
    return offsetPages({
      vendor: "leadmaster",
      baseUrl: this.config.baseUrl ?? "https://devwebapi.leadmaster.com",
      path,
      query: {
        minutes: String(this.config.lookbackMinutes),
        access_token: this.config.accessToken,
      },
      fetcher: this.config.fetcher,
    });
  }

  leads(): Promise<JsonRecord[]> {
    return this.pages("/api/LMWebAPI/GetLastUpdatedLeadWithPaging");
  }

  opportunities(): Promise<JsonRecord[]> {
    return this.pages("/api/LMWebAPI/GetLastUpdatedOpportunitiesWithPaging");
  }

  async customFields(): Promise<JsonRecord[]> {
    const url = endpoint(
      this.config.baseUrl ?? "https://devwebapi.leadmaster.com",
      "/api/LMWebAPI/GetCustomFields",
    );
    url.searchParams.set("access_token", this.config.accessToken);
    return asArray(await getJson({ vendor: "leadmaster", url, fetcher: this.config.fetcher }));
  }
}

export class JobNimbusReadClient {
  constructor(private readonly config: {
    apiKey: string;
    baseUrl?: string;
    contactsPath?: string;
    jobsPath?: string;
    pageLimit?: number;
    maxPages?: number;
    fetcher?: typeof fetch;
  }) {}

  private async pages(path: string): Promise<JsonRecord[]> {
    const all: JsonRecord[] = [];
    const pageLimit = this.config.pageLimit ?? PAGE_LIMIT;
    const maxPages = this.config.maxPages ?? MAX_PAGES;

    for (let page = 0; page < maxPages; page += 1) {
      const url = endpoint(this.config.baseUrl ?? "https://app.jobnimbus.com", path);
      url.searchParams.set("size", String(pageLimit));
      url.searchParams.set("from", String(page * pageLimit));
      const rows = asArray(await getJson({
        vendor: "jobnimbus",
        url,
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        fetcher: this.config.fetcher,
      }));
      all.push(...rows.slice(0, pageLimit));
      if (rows.length < pageLimit) break;
    }

    return all.slice(0, pageLimit * maxPages);
  }

  contacts(): Promise<JsonRecord[]> {
    return this.pages(this.config.contactsPath ?? "/api1/contacts");
  }

  jobs(): Promise<JsonRecord[]> {
    return this.pages(this.config.jobsPath ?? "/api1/jobs");
  }

  private async probeResource(
    resource: "contacts" | "jobs",
    path: string,
  ): Promise<JobNimbusProbeResult> {
    const url = endpoint(this.config.baseUrl ?? "https://app.jobnimbus.com", path);
    url.searchParams.set("size", "1");
    url.searchParams.set("from", "0");
    const fetcher = this.config.fetcher ?? fetch;

    try {
      const response = await fetcher(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        cache: "no-store",
      });
      if (!response.ok) {
        return {
          resource,
          ok: false,
          status: response.status,
          recordCount: 0,
          fieldNames: [],
          errorCategory: categoryForStatus(response.status),
        };
      }

      try {
        const rows = asArray(await response.json());
        return {
          resource,
          ok: true,
          status: response.status,
          recordCount: rows.length,
          fieldNames: Object.keys(rows[0] ?? {}).sort(),
        };
      } catch {
        return {
          resource,
          ok: false,
          status: response.status,
          recordCount: 0,
          fieldNames: [],
          errorCategory: "invalid_response",
        };
      }
    } catch {
      return {
        resource,
        ok: false,
        status: 0,
        recordCount: 0,
        fieldNames: [],
        errorCategory: "upstream",
      };
    }
  }

  async probe(): Promise<{ contacts: JobNimbusProbeResult; jobs: JobNimbusProbeResult }> {
    const [contacts, jobs] = await Promise.all([
      this.probeResource("contacts", this.config.contactsPath ?? "/api1/contacts"),
      this.probeResource("jobs", this.config.jobsPath ?? "/api1/jobs"),
    ]);
    return { contacts, jobs };
  }
}

export type JobNimbusProbeResult = {
  resource: "contacts" | "jobs";
  ok: boolean;
  status: number;
  recordCount: number;
  fieldNames: string[];
  errorCategory?: "authentication" | "authorization" | "rate_limit" | "upstream" | "invalid_response";
};

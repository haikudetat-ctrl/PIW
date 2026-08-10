import type { JsonRecord } from "./contracts";
import { asArray } from "./normalize";
import { basicAuth, getJson } from "./http";

const PAGE_LIMIT = 500;
const MAX_PAGES = 25;

function endpoint(baseUrl: string, path: string): URL {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

async function offsetPages(input: {
  vendor: string;
  baseUrl: string;
  path: string;
  headers?: HeadersInit;
  query?: Record<string, string>;
  fetcher?: typeof fetch;
}): Promise<JsonRecord[]> {
  const all: JsonRecord[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = endpoint(input.baseUrl, input.path);
    Object.entries(input.query ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));
    url.searchParams.set("limit", String(PAGE_LIMIT));
    url.searchParams.set("offset", String(page * PAGE_LIMIT));
    const rows = asArray(await getJson({
      vendor: input.vendor,
      url,
      headers: input.headers,
      fetcher: input.fetcher,
    }));
    all.push(...rows);
    if (rows.length < PAGE_LIMIT) break;
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

  async flows(): Promise<JsonRecord[]> {
    const url = endpoint(this.config.baseUrl ?? "https://app.leadconduit.com", "/flows");
    return asArray(await getJson({
      vendor: "leadconduit",
      url,
      headers: this.headers,
      fetcher: this.config.fetcher,
    }));
  }

  async events(input: { start: string; afterId?: string | null }): Promise<{ rows: JsonRecord[]; cursor: string | null }> {
    const all: JsonRecord[] = [];
    let afterId = input.afterId ?? null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = endpoint(this.config.baseUrl ?? "https://app.leadconduit.com", "/events");
      url.searchParams.set("start", input.start);
      url.searchParams.set("sort", "asc");
      url.searchParams.set("limit", "1000");
      if (afterId) url.searchParams.set("after_id", afterId);
      const rows = asArray(await getJson({
        vendor: "leadconduit",
        url,
        headers: this.headers,
        fetcher: this.config.fetcher,
      }));
      all.push(...rows);
      const lastId = rows.at(-1)?.id;
      afterId = typeof lastId === "string" ? lastId : afterId;
      if (rows.length < 1000) break;
    }
    return { rows: all, cursor: afterId };
  }
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
    fetcher?: typeof fetch;
  }) {}

  private pages(path: string): Promise<JsonRecord[]> {
    return offsetPages({
      vendor: "jobnimbus",
      baseUrl: this.config.baseUrl ?? "https://api.jobnimbus.com",
      path,
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      fetcher: this.config.fetcher,
    });
  }

  contacts(): Promise<JsonRecord[]> {
    return this.pages(this.config.contactsPath ?? "/api1/contacts");
  }

  jobs(): Promise<JsonRecord[]> {
    return this.pages(this.config.jobsPath ?? "/api1/jobs");
  }
}

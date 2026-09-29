const DEFAULT_BASE_URL = "https://app.jobnimbus.com/api1";
const MAX_OFFSET_WINDOW = 10_000;

export type JobNimbusRecordType =
  | "job"
  | "contact"
  | "estimate"
  | "file"
  | "workorder"
  | "task";

export type JobNimbusRecord = Record<string, unknown> & { jnid: string };

export type JobNimbusErrorCode =
  | "http"
  | "network"
  | "invalid_envelope"
  | "filter_contract"
  | "paging_limit";

export type JobNimbusTelemetry = {
  apiCalls: number;
  transientErrorCount: number;
  rateLimitResponses: number;
};

export class JobNimbusProviderError extends Error {
  readonly terminal: boolean;
  readonly status?: number;
  readonly rateLimited: boolean;
  readonly code: JobNimbusErrorCode;
  readonly apiCalls: number;
  readonly transientErrorCount: number;
  readonly rateLimitResponses: number;

  constructor(
    message: string,
    options: {
      terminal: boolean;
      status?: number;
      rateLimited?: boolean;
      code: JobNimbusErrorCode;
      telemetry?: JobNimbusTelemetry;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "JobNimbusProviderError";
    this.terminal = options.terminal;
    this.status = options.status;
    this.rateLimited = options.rateLimited ?? false;
    this.code = options.code;
    this.apiCalls = options.telemetry?.apiCalls ?? 0;
    this.transientErrorCount = options.telemetry?.transientErrorCount ?? 0;
    this.rateLimitResponses = options.telemetry?.rateLimitResponses ?? 0;
  }
}

export type JobNimbusScanResult = JobNimbusTelemetry & {
  records: JobNimbusRecord[];
  unfilteredCount: number;
};

export type JobNimbusClientOptions = {
  apiKey: string;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  baseUrl?: string;
  paceMs?: number;
  retryCount?: number;
  retryBackoffMs?: number;
  pageSize?: number;
  timeoutMs?: number;
};

type RequestStats = JobNimbusTelemetry;

export type FullScanOptions = {
  windowStart?: Date | number;
  windowEnd?: Date | number;
};

export type FilterVerificationResult = JobNimbusTelemetry & {
  verified: true;
  unfilteredCount: number;
};

export type JobNimbusFileDownload = JobNimbusTelemetry & {
  bytes: Uint8Array;
  contentType: string | null;
};

export type JobNimbusPageOptions = {
  from?: number;
  size?: number;
};

export type JobNimbusPageResult = JobNimbusScanResult;

const PATHS: Record<JobNimbusRecordType, string> = {
  job: "jobs",
  contact: "contacts",
  estimate: "estimates",
  file: "files",
  workorder: "workorders",
  task: "tasks",
};

type VerifiedRangeFilter =
  | { field: "date_created"; gte: number; lt: number }
  | { field: "date_updated"; gte: number };

export class JobNimbusClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly pageSize: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly paceMs: number;
  private readonly retryCount: number;
  private readonly retryBackoffMs: number;
  private readonly timeoutMs: number;
  private requestTail: Promise<void> = Promise.resolve();
  private lastRequestStartedAt?: number;

  constructor(options: JobNimbusClientOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.pageSize = options.pageSize ?? 1_000;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.paceMs = options.paceMs ?? 350;
    this.retryCount = options.retryCount ?? 4;
    this.retryBackoffMs = options.retryBackoffMs ?? 350;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async fetchPage(
    recordType: JobNimbusRecordType,
    options: JobNimbusPageOptions = {},
  ): Promise<JobNimbusPageResult> {
    const stats = emptyStats();
    const from = options.from ?? 0;
    const page = await this.fetchCollectionPage(
      recordType,
      from,
      options.size ?? this.internalPageSize(from),
      stats,
    );

    return {
      records: page.records,
      unfilteredCount: page.count,
      ...stats,
    };
  }

  async verifyFutureCutoff(
    recordType: JobNimbusRecordType,
    cutoff?: number,
  ): Promise<FilterVerificationResult> {
    const stats = emptyStats();
    const nowSeconds = Math.floor(this.now() / 1_000);
    const cutoffSeconds = cutoff ?? nowSeconds + 365 * 86_400;
    if (!Number.isSafeInteger(cutoffSeconds) || cutoffSeconds <= nowSeconds) {
      throw new JobNimbusProviderError(
        "Filter verification requires a future integer epoch-second cutoff",
        { terminal: true, code: "filter_contract", telemetry: stats },
      );
    }
    const page = await this.fetchCollectionPage(
      recordType,
      0,
      this.internalPageSize(0),
      stats,
      {
        field: "date_updated",
        gte: cutoffSeconds,
      },
    );

    if (page.records.length !== 0) {
      throw new JobNimbusProviderError(
        "JobNimbus ignored the future date_updated filter",
        {
          terminal: true,
          status: 200,
          code: "filter_contract",
          telemetry: stats,
        },
      );
    }

    return {
      verified: true,
      unfilteredCount: page.count,
      ...stats,
    };
  }

  async fullScan(
    recordType: JobNimbusRecordType,
    options: FullScanOptions = {},
  ): Promise<JobNimbusScanResult> {
    const window = validateWindowBounds(options);
    const stats = emptyStats();
    const firstRequestSize = this.internalPageSize(0);
    const firstPage = await this.fetchCollectionPage(
      recordType,
      0,
      firstRequestSize,
      stats,
    );

    if (recordType !== "file" && firstPage.count < MAX_OFFSET_WINDOW) {
      const records = [...firstPage.records];
      let previousPageLength = firstPage.records.length;
      let previousRequestSize = firstRequestSize;
      for (let from = firstRequestSize; previousPageLength === previousRequestSize; ) {
        if (from >= MAX_OFFSET_WINDOW) throw pagingLimitError(stats);
        const requestSize = this.internalPageSize(from);
        const page = await this.fetchCollectionPage(
          recordType,
          from,
          requestSize,
          stats,
        );
        records.push(...page.records);
        previousPageLength = page.records.length;
        previousRequestSize = requestSize;
        from += requestSize;
      }
      return {
        records,
        unfilteredCount: firstPage.count,
        ...stats,
      };
    }

    if (!window) {
      throw new JobNimbusProviderError(
        "Window bounds are required for a windowed full scan",
        { terminal: true, code: "filter_contract", telemetry: stats },
      );
    }

    const records: JobNimbusRecord[] = [];
    const seenJnids = new Set<string>();
    const { start, end } = window;

    for (let lower = start; lower < end; lower = nextUtcMonth(lower)) {
      const upper = Math.min(nextUtcMonth(lower), end);

      for (let from = 0; ; ) {
        const requestSize = this.internalPageSize(from);
        const page = await this.fetchCollectionPage(recordType, from, requestSize, stats, {
          field: "date_created",
          gte: lower,
          lt: upper,
        });
        for (const record of page.records) {
          if (
            !Number.isSafeInteger(record.date_created) ||
            (record.date_created as number) < lower ||
            (record.date_created as number) >= upper
          ) {
            throw new JobNimbusProviderError(
              "JobNimbus returned a record outside the date_created window",
              {
                terminal: true,
                status: 200,
                code: "filter_contract",
                telemetry: stats,
              },
            );
          }
          if (seenJnids.has(record.jnid)) continue;
          seenJnids.add(record.jnid);
          records.push(record);
        }
        if (page.records.length < requestSize) break;
        from += requestSize;
        if (from >= MAX_OFFSET_WINDOW) throw pagingLimitError(stats);
      }
    }

    return {
      records,
      unfilteredCount: firstPage.count,
      ...stats,
    };
  }

  async incrementalScan(
    recordType: JobNimbusRecordType,
    cutoff: Date | number,
  ): Promise<JobNimbusScanResult> {
    const cutoffSeconds = toEpochSeconds(cutoff);
    const records: JobNimbusRecord[] = [];
    const stats = emptyStats();
    let unfilteredCount = 0;
    let isFirstPage = true;

    for (let from = 0; ; ) {
      const requestSize = this.internalPageSize(from);
      const page = await this.fetchCollectionPage(recordType, from, requestSize, stats, {
        field: "date_updated",
        gte: cutoffSeconds,
      });
      if (isFirstPage) {
        unfilteredCount = page.count;
        isFirstPage = false;
      }

      for (const record of page.records) {
        if (
          typeof record.date_updated !== "number" ||
          record.date_updated < cutoffSeconds
        ) {
          throw new JobNimbusProviderError(
            "JobNimbus returned a record outside the incremental cutoff",
            {
              terminal: true,
              status: 200,
              code: "filter_contract",
              telemetry: stats,
            },
          );
        }
        records.push(record);
      }

      if (page.records.length < requestSize) break;
      from += requestSize;
      if (from >= MAX_OFFSET_WINDOW) throw pagingLimitError(stats);
    }

    return {
      records,
      unfilteredCount,
      ...stats,
    };
  }

  async downloadFile(jnid: string): Promise<JobNimbusFileDownload> {
    const stats = emptyStats();
    const url = new URL(`${this.baseUrl}/files/${encodeURIComponent(jnid)}`);
    const { response, body } = await this.getWithRetry(
      url,
      { Accept: "*/*" },
      stats,
      (successfulResponse) => successfulResponse.arrayBuffer(),
    );

    return {
      bytes: new Uint8Array(body),
      contentType: response.headers.get("content-type"),
      ...stats,
    };
  }

  private internalPageSize(from: number): number {
    return Math.min(this.pageSize, MAX_OFFSET_WINDOW - from);
  }

  private async fetchCollectionPage(
    recordType: JobNimbusRecordType,
    from: number,
    size: number,
    stats: RequestStats,
    filter?: VerifiedRangeFilter,
  ): Promise<{ records: JobNimbusRecord[]; count: number }> {
    if (
      !Number.isSafeInteger(from) ||
      from < 0 ||
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      from + size > MAX_OFFSET_WINDOW
    ) {
      throw pagingLimitError(stats);
    }

    const path = PATHS[recordType];
    const url = new URL(`${this.baseUrl}/${path}`);
    url.searchParams.set("from", String(from));
    url.searchParams.set("size", String(size));
    if (filter) url.searchParams.set("filter", serializeRangeFilter(filter));

    const { response, body } = await this.getWithRetry(
      url,
      { Accept: "application/json" },
      stats,
      readJson,
    );
    const key = recordType === "file" ? "files" : "results";

    if (!isObject(body) || !Number.isSafeInteger(body.count) || (body.count as number) < 0) {
      throw invalidEnvelope(
        response.status,
        "JobNimbus metadata is missing a valid count",
        stats,
      );
    }
    const rows = body[key];
    if (!Array.isArray(rows)) {
      throw invalidEnvelope(
        response.status,
        `JobNimbus metadata is missing the ${key} array`,
        stats,
      );
    }
    for (const row of rows) {
      if (
        !isObject(row) ||
        typeof row.jnid !== "string" ||
        row.jnid.trim().length === 0
      ) {
        throw invalidEnvelope(
          response.status,
          "JobNimbus record is missing its jnid",
          stats,
        );
      }
    }

    return {
      records: rows as JobNimbusRecord[],
      count: body.count as number,
    };
  }

  private async getWithRetry<T>(
    url: URL,
    headers: Record<string, string>,
    stats: RequestStats,
    consume: (response: Response) => Promise<T>,
  ): Promise<{ response: Response; body: T }> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.serialFetch(url, headers);
        stats.apiCalls += 1;
      } catch (cause) {
        stats.apiCalls += 1;
        stats.transientErrorCount += 1;
        if (attempt < this.retryCount) {
          await this.sleep(this.retryBackoffMs * 2 ** attempt);
          continue;
        }
        const detail = cause instanceof Error ? `: ${cause.message}` : "";
        throw new JobNimbusProviderError(`JobNimbus network request failed${detail}`, {
          terminal: false,
          code: "network",
          telemetry: stats,
          cause,
        });
      }

      if (response.status === 429) stats.rateLimitResponses += 1;
      if (response.ok) {
        try {
          return { response, body: await consume(response) };
        } catch (cause) {
          if (cause instanceof JobNimbusProviderError) {
            throw withTelemetry(cause, stats);
          }
          stats.transientErrorCount += 1;
          if (attempt < this.retryCount) {
            await this.sleep(this.retryBackoffMs * 2 ** attempt);
            continue;
          }
          const detail = cause instanceof Error ? `: ${cause.message}` : "";
          throw new JobNimbusProviderError(
            `JobNimbus response body failed${detail}`,
            {
              terminal: false,
              status: response.status,
              code: "network",
              telemetry: stats,
              cause,
            },
          );
        }
      }

      const transient =
        response.status === 408 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500;
      if (transient) stats.transientErrorCount += 1;
      if (transient && attempt < this.retryCount) {
        await this.sleep(this.retryBackoffMs * 2 ** attempt);
        continue;
      }

      throw new JobNimbusProviderError(
        `JobNimbus request failed with HTTP ${response.status}`,
        {
          terminal: !transient,
          status: response.status,
          rateLimited: response.status === 429,
          code: "http",
          telemetry: stats,
        },
      );
    }
  }

  private async serialFetch(
    url: URL,
    headers: Record<string, string>,
  ): Promise<Response> {
    const previous = this.requestTail;
    let release: () => void = () => {};
    this.requestTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      if (this.lastRequestStartedAt !== undefined) {
        const remaining = this.paceMs - (this.now() - this.lastRequestStartedAt);
        if (remaining > 0) await this.sleep(remaining);
      }
      this.lastRequestStartedAt = this.now();
      return await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...headers,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } finally {
      release();
    }
  }
}

function emptyStats(): RequestStats {
  return { apiCalls: 0, transientErrorCount: 0, rateLimitResponses: 0 };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidEnvelope(
  status: number,
  message: string,
  telemetry: JobNimbusTelemetry = emptyStats(),
): JobNimbusProviderError {
  return new JobNimbusProviderError(message, {
    terminal: true,
    status,
    code: "invalid_envelope",
    telemetry,
  });
}

function withTelemetry(
  error: JobNimbusProviderError,
  telemetry: JobNimbusTelemetry,
): JobNimbusProviderError {
  return new JobNimbusProviderError(error.message, {
    terminal: error.terminal,
    status: error.status,
    rateLimited: error.rateLimited,
    code: error.code,
    telemetry,
    cause: error.cause,
  });
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    if (cause instanceof SyntaxError) {
      throw invalidEnvelope(response.status, "JobNimbus returned non-JSON metadata");
    }
    throw cause;
  }
}

function pagingLimitError(
  telemetry: JobNimbusTelemetry = emptyStats(),
): JobNimbusProviderError {
  return new JobNimbusProviderError(
    "JobNimbus pages require non-negative integer offsets and cannot cross 10,000",
    { terminal: true, code: "paging_limit", telemetry },
  );
}

function serializeRangeFilter(filter: VerifiedRangeFilter): string {
  const validLower = Number.isSafeInteger(filter.gte);
  const validUpper =
    filter.field === "date_updated" ||
    (Number.isSafeInteger(filter.lt) && filter.gte < filter.lt);
  if (!validLower || !validUpper) {
    throw new JobNimbusProviderError("JobNimbus filters require integer epoch bounds", {
      terminal: true,
      code: "filter_contract",
    });
  }

  const bounds =
    filter.field === "date_created"
      ? { gte: filter.gte, lt: filter.lt }
      : { gte: filter.gte };
  return JSON.stringify({ must: [{ range: { [filter.field]: bounds } }] });
}

function validateWindowBounds(
  options: FullScanOptions,
): { start: number; end: number } | undefined {
  if (options.windowStart === undefined && options.windowEnd === undefined) {
    return undefined;
  }
  const start =
    options.windowStart === undefined ? Number.NaN : toEpochSeconds(options.windowStart);
  const end =
    options.windowEnd === undefined ? Number.NaN : toEpochSeconds(options.windowEnd);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= end) {
    throw new JobNimbusProviderError(
      "Window bounds require increasing integer epoch seconds",
      { terminal: true, code: "filter_contract" },
    );
  }
  return { start, end };
}

function toEpochSeconds(value: Date | number): number {
  return value instanceof Date ? Math.floor(value.getTime() / 1_000) : value;
}

function nextUtcMonth(epochSeconds: number): number {
  const date = new Date(epochSeconds * 1_000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1_000;
}

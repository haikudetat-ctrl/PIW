// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  JobNimbusClient,
  JobNimbusProviderError,
} from "@/modules/jobnimbus/client";

type JsonRecord = Record<string, unknown> & { jnid: string };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("JobNimbusClient page fetching", () => {
  it("returns validated metadata rows with the unfiltered count and API-call count", async () => {
    // This catches hiding the provider's unfiltered envelope count or mapping a
    // non-file collection to the exceptional `files` envelope key.
    let requestedUrl: URL | undefined;
    let requestedInit: RequestInit | undefined;
    const fetchFixture: typeof fetch = async (input, init) => {
      requestedUrl = new URL(String(input));
      requestedInit = init;
      return jsonResponse({
        count: 6_300,
        results: [{ jnid: "contact-1" }, { jnid: "contact-2" }],
      });
    };
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: fetchFixture,
      paceMs: 0,
    });

    const result = await client.fetchPage("contact", { from: 0, size: 2 });

    expect(result.records.map((record) => record.jnid)).toEqual([
      "contact-1",
      "contact-2",
    ]);
    expect(result.unfilteredCount).toBe(6_300);
    expect(result.apiCalls).toBe(1);
    expect(result.rateLimitResponses).toBe(0);
    expect(requestedUrl?.pathname).toBe("/api1/contacts");
    expect(requestedUrl?.origin).toBe("https://app.jobnimbus.com");
    expect(new Headers(requestedInit?.headers).get("accept")).toBe("application/json");
  });

  it.each([
    ["job", "jobs", "results"],
    ["contact", "contacts", "results"],
    ["estimate", "estimates", "results"],
    ["file", "files", "files"],
    ["workorder", "workorders", "results"],
    ["task", "tasks", "results"],
  ] as const)("maps %s records to /%s with the %s envelope", async (type, path, key) => {
    // This catches a singular/plural endpoint typo or treating /files like the
    // otherwise-uniform collection endpoints.
    let pathname = "";
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async (input) => {
        pathname = new URL(String(input)).pathname;
        return jsonResponse({ count: 0, [key]: [] });
      },
      paceMs: 0,
    });

    await client.fetchPage(type);

    expect(pathname).toBe(`/api1/${path}`);
  });

  it("rejects a malformed collection envelope terminally", async () => {
    // This catches silently accepting a provider schema change, especially the
    // exceptional files/results envelope split.
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async () => jsonResponse({ count: 6_300, files: [] }),
      paceMs: 0,
    });

    const error = await client.fetchPage("contact").catch((caught) => caught);

    expect(error).toBeInstanceOf(JobNimbusProviderError);
    expect(error).toMatchObject({
      terminal: true,
      status: 200,
      rateLimited: false,
      code: "invalid_envelope",
    });
  });

  it("rejects a metadata record without a usable jnid", async () => {
    // This catches admitting a row that cannot participate in idempotent
    // ingestion or cross-window deduplication.
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async () => jsonResponse({ count: 1, results: [{ jnid: "   " }] }),
      paceMs: 0,
    });

    const error = await client.fetchPage("job").catch((caught) => caught);

    expect(error).toBeInstanceOf(JobNimbusProviderError);
    expect(error).toMatchObject({ terminal: true, code: "invalid_envelope" });
  });

  it("rejects a page that would cross the 10,000-record offset ceiling", async () => {
    // This catches relying on JobNimbus to reject an unsafe request after the
    // client has already spent an API call.
    let called = false;
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async () => {
        called = true;
        return jsonResponse({ count: 0, results: [] });
      },
      paceMs: 0,
    });

    const error = await client
      .fetchPage("job", { from: 9_001, size: 1_000 })
      .catch((caught) => caught);

    expect(called).toBe(false);
    expect(error).toBeInstanceOf(JobNimbusProviderError);
    expect(error).toMatchObject({ terminal: true, code: "paging_limit" });
  });

  it("does not expose arbitrary provider filters through public page fetching", async () => {
    // This catches allowing callers to send a bool wrapper or an unvalidated
    // range whose silently ignored results the client cannot verify.
    let requestedUrl: URL | undefined;
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async (input) => {
        requestedUrl = new URL(String(input));
        return jsonResponse({ count: 0, results: [] });
      },
      paceMs: 0,
    });

    await client.fetchPage("job", {
      from: 0,
      size: 10,
      filter: { bool: { must: [] } },
    } as never);

    expect(requestedUrl?.searchParams.has("filter")).toBe(false);
  });
});

describe("JobNimbusClient request pacing", () => {
  it("serializes concurrent callers and applies the default 350ms pace", async () => {
    // This catches per-scan-only serialization, which still allows two public
    // operations on one client to hit JobNimbus concurrently.
    let clock = 1_000;
    let inFlight = 0;
    let maxInFlight = 0;
    const delays: number[] = [];
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      now: () => clock,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
        clock += milliseconds;
      },
      fetch: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return jsonResponse({ count: 0, results: [] });
      },
    });

    await Promise.all([client.fetchPage("job"), client.fetchPage("contact")]);

    expect(maxInFlight).toBe(1);
    expect(delays).toEqual([350]);
  });
});

describe("JobNimbusClient full scans", () => {
  it("pages a below-ceiling unfiltered scan until the provider returns a short page", async () => {
    // This catches returning only the probe page for ordinary collections such
    // as the documented 2,506-job account.
    const offsets: number[] = [];
    const fetchFixture: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const from = Number(url.searchParams.get("from"));
      const size = Number(url.searchParams.get("size"));
      offsets.push(from);
      const returned = Math.max(0, Math.min(size, 2_506 - from));
      const results = Array.from({ length: returned }, (_, index) => ({
        jnid: `job-${from + index}`,
      }));
      return jsonResponse({ count: 2_506, results });
    };
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: fetchFixture,
      paceMs: 0,
      pageSize: 1_000,
    });

    const result = await client.fullScan("job");

    expect(result.records).toHaveLength(2_506);
    expect(result.apiCalls).toBe(3);
    expect(offsets).toEqual([0, 1_000, 2_000]);
  });

  it("caps internal pages at the remaining offset allowance", async () => {
    // This catches a pageSize such as 3,000 producing from=9,000&size=3,000
    // even though a safe final request can still retrieve the collection.
    const requests: Array<{ from: number; size: number }> = [];
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async (input) => {
        const url = new URL(String(input));
        const from = Number(url.searchParams.get("from"));
        const size = Number(url.searchParams.get("size"));
        requests.push({ from, size });
        const returned = Math.max(0, Math.min(size, 9_999 - from));
        return jsonResponse({
          count: 9_999,
          results: Array.from({ length: returned }, (_, index) => ({
            jnid: `job-${from + index}`,
          })),
        });
      },
      paceMs: 0,
      pageSize: 3_000,
    });

    const result = await client.fullScan("job");

    expect(result.records).toHaveLength(9_999);
    expect(requests).toEqual([
      { from: 0, size: 3_000 },
      { from: 3_000, size: 3_000 },
      { from: 6_000, size: 3_000 },
      { from: 9_000, size: 1_000 },
    ]);
  });

  it("pages the files envelope through monthly windows without crossing the offset ceiling", async () => {
    // This catches using `results` for /files, trusting the unfiltered count for
    // a filtered window, or issuing a request where from + size exceeds 10,000.
    const monthCounts = new Map([
      [Date.UTC(2026, 0, 1) / 1_000, 8_000],
      [Date.UTC(2026, 1, 1) / 1_000, 8_000],
      [Date.UTC(2026, 2, 1) / 1_000, 8_000],
      [Date.UTC(2026, 3, 1) / 1_000, 7_823],
    ]);
    const requests: URL[] = [];

    const fetchFixture: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url);

      const size = Number(url.searchParams.get("size"));
      const from = Number(url.searchParams.get("from"));
      const filter = url.searchParams.get("filter");

      if (!filter) {
        return jsonResponse({
          count: 31_823,
          files: [{ jnid: "unfiltered-probe", date_created: 0 }],
        });
      }

      const parsed = JSON.parse(filter) as {
        must: Array<{ range: { date_created: { gte: number; lt: number } } }>;
      };
      const lower = parsed.must[0].range.date_created.gte;
      const count = monthCounts.get(lower) ?? 0;
      const returned = Math.max(0, Math.min(size, count - from));
      const files: JsonRecord[] = Array.from({ length: returned }, (_, index) => ({
        jnid: `${lower}-${from + index}`,
        date_created: lower,
      }));

      return jsonResponse({ count: 31_823, files });
    };

    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: fetchFixture,
      sleep: async () => undefined,
      paceMs: 0,
      pageSize: 1_000,
    });

    const result = await client.fullScan("file", {
      windowStart: new Date("2026-01-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-01T00:00:00.000Z"),
    });

    expect(result.records).toHaveLength(31_823);
    expect(new Set(result.records.map((record) => record.jnid)).size).toBe(31_823);
    expect(result.unfilteredCount).toBe(31_823);
    expect(result.apiCalls).toBe(requests.length);
    expect(requests.every((url) => url.pathname === "/api1/files")).toBe(true);
    expect(
      requests.every(
        (url) =>
          Number(url.searchParams.get("from")) + Number(url.searchParams.get("size")) <=
          10_000,
      ),
    ).toBe(true);
  });

  it("deduplicates a boundary record by jnid across adjacent windows", async () => {
    // This catches concatenating otherwise-valid monthly pages without applying
    // the provider identity as the cross-window uniqueness key.
    const january = Date.UTC(2026, 0, 1) / 1_000;
    const february = Date.UTC(2026, 1, 1) / 1_000;
    const fetchFixture: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const filter = url.searchParams.get("filter");
      if (!filter) return jsonResponse({ count: 3, files: [{ jnid: "probe" }] });

      const lower = (
        JSON.parse(filter) as {
          must: Array<{ range: { date_created: { gte: number } } }>;
        }
      ).must[0].range.date_created.gte;
      const files =
        lower === january
          ? [
              { jnid: "jan-only", date_created: january },
              { jnid: "boundary", date_created: january },
            ]
          : lower === february
            ? [
                { jnid: "boundary", date_created: february },
                { jnid: "feb-only", date_created: february },
              ]
            : [];
      return jsonResponse({ count: 3, files });
    };
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: fetchFixture,
      paceMs: 0,
      pageSize: 10,
    });

    const result = await client.fullScan("file", {
      windowStart: january,
      windowEnd: Date.UTC(2026, 2, 1) / 1_000,
    });

    expect(result.records.map((record) => record.jnid)).toEqual([
      "jan-only",
      "boundary",
      "feb-only",
    ]);
  });

  it("uses calendar-month UTC boundaries when the configured start is mid-month", async () => {
    // This catches Date overflow (for example Jan 31 -> Mar 3) skipping an
    // entire monthly partition.
    const ranges: Array<{ gte: number; lt: number }> = [];
    const fetchFixture: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const filter = url.searchParams.get("filter");
      if (!filter) return jsonResponse({ count: 0, files: [] });
      const range = (
        JSON.parse(filter) as {
          must: Array<{ range: { date_created: { gte: number; lt: number } } }>;
        }
      ).must[0].range.date_created;
      ranges.push(range);
      return jsonResponse({ count: 0, files: [] });
    };
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: fetchFixture,
      paceMs: 0,
      pageSize: 10,
    });

    await client.fullScan("file", {
      windowStart: new Date("2026-01-31T12:00:00.000Z"),
      windowEnd: new Date("2026-04-01T00:00:00.000Z"),
    });

    expect(ranges).toEqual([
      {
        gte: Date.parse("2026-01-31T12:00:00.000Z") / 1_000,
        lt: Date.parse("2026-02-01T00:00:00.000Z") / 1_000,
      },
      {
        gte: Date.parse("2026-02-01T00:00:00.000Z") / 1_000,
        lt: Date.parse("2026-03-01T00:00:00.000Z") / 1_000,
      },
      {
        gte: Date.parse("2026-03-01T00:00:00.000Z") / 1_000,
        lt: Date.parse("2026-04-01T00:00:00.000Z") / 1_000,
      },
    ]);
  });

  it("rejects a window row whose date_created falls outside the requested bounds", async () => {
    // This catches an ignored date_created filter returning an unfiltered 200
    // page, which would otherwise make a windowed full scan look complete.
    const start = Date.UTC(2026, 0, 1) / 1_000;
    const end = Date.UTC(2026, 1, 1) / 1_000;
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async (input) => {
        const url = new URL(String(input));
        return url.searchParams.has("filter")
          ? jsonResponse({
              count: 1,
              files: [{ jnid: "outside", date_created: start - 1 }],
            })
          : jsonResponse({ count: 1, files: [{ jnid: "probe", date_created: start }] });
      },
      paceMs: 0,
      pageSize: 10,
    });

    const error = await client
      .fullScan("file", { windowStart: start, windowEnd: end })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(JobNimbusProviderError);
    expect(error).toMatchObject({
      terminal: true,
      status: 200,
      code: "filter_contract",
    });
  });

  it("rejects a window row with a non-numeric date_created", async () => {
    // This catches string timestamps passing JavaScript coercive comparisons
    // even though the provider contract requires epoch-second numbers.
    const start = Date.UTC(2026, 0, 1) / 1_000;
    const end = Date.UTC(2026, 1, 1) / 1_000;
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async (input) =>
        new URL(String(input)).searchParams.has("filter")
          ? jsonResponse({
              count: 1,
              files: [{ jnid: "string-date", date_created: String(start) }],
            })
          : jsonResponse({ count: 1, files: [{ jnid: "probe", date_created: start }] }),
      paceMs: 0,
      pageSize: 10,
    });

    const error = await client
      .fullScan("file", { windowStart: start, windowEnd: end })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(JobNimbusProviderError);
    expect(error).toMatchObject({ terminal: true, code: "filter_contract" });
  });

  it("rejects non-increasing integer epoch window bounds before fetching", async () => {
    // This catches an equal/reversed window silently returning an empty scan,
    // which could be mistaken for a reconciled provider collection.
    const start = Date.UTC(2026, 0, 1) / 1_000;
    let called = false;
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async () => {
        called = true;
        return jsonResponse({ count: 0, files: [] });
      },
      paceMs: 0,
    });

    const error = await client
      .fullScan("file", { windowStart: start, windowEnd: start })
      .catch((caught) => caught);

    expect(called).toBe(false);
    expect(error).toBeInstanceOf(JobNimbusProviderError);
    expect(error).toMatchObject({ terminal: true, code: "filter_contract" });
  });

  it("rejects fractional numeric window bounds before fetching", async () => {
    // This catches placing fractional seconds into a provider date filter.
    const start = Date.UTC(2026, 0, 1) / 1_000;
    let called = false;
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async () => {
        called = true;
        return jsonResponse({ count: 0, files: [] });
      },
      paceMs: 0,
    });

    const error = await client
      .fullScan("file", { windowStart: start + 0.5, windowEnd: start + 86_400 })
      .catch((caught) => caught);

    expect(called).toBe(false);
    expect(error).toBeInstanceOf(JobNimbusProviderError);
    expect(error).toMatchObject({ terminal: true, code: "filter_contract" });
  });
});

describe("JobNimbusClient filter verification", () => {
  it("verifies a future cutoff only when the provider returns zero rows", async () => {
    // This catches treating HTTP 200 as proof that JobNimbus understood the
    // filter even though the provider silently ignores unknown parameters.
    const fetchFixture: typeof fetch = async () =>
      jsonResponse({ count: 2_506, results: [] });
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: fetchFixture,
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      paceMs: 0,
    });

    await expect(client.verifyFutureCutoff("job")).resolves.toEqual({
      verified: true,
      unfilteredCount: 2_506,
      apiCalls: 1,
      transientErrorCount: 0,
      rateLimitResponses: 0,
    });
  });

  it("rejects an ignored future filter that returns a page", async () => {
    // This catches returning `verified: true` based on HTTP status alone.
    const fetchFixture: typeof fetch = async () =>
      jsonResponse({
        count: 2_506,
        results: [{ jnid: "old-1" }, { jnid: "old-2" }],
      });
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: fetchFixture,
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      paceMs: 0,
      pageSize: 2,
    });

    const error = await client.verifyFutureCutoff("job").catch((caught) => caught);

    expect(error).toBeInstanceOf(JobNimbusProviderError);
    expect(error).toMatchObject({
      terminal: true,
      status: 200,
      rateLimited: false,
      code: "filter_contract",
    });
  });

  it("rejects a cutoff that is not future relative to the injected clock", async () => {
    // This catches a caller accidentally using the verification method as an
    // ordinary cutoff check, where zero rows cannot prove ignored-filter safety.
    const now = Date.parse("2026-09-08T00:00:00.000Z");
    let called = false;
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      now: () => now,
      fetch: async () => {
        called = true;
        return jsonResponse({ count: 0, results: [] });
      },
      paceMs: 0,
    });

    const error = await client
      .verifyFutureCutoff("job", now / 1_000)
      .catch((caught) => caught);

    expect(called).toBe(false);
    expect(error).toBeInstanceOf(JobNimbusProviderError);
    expect(error).toMatchObject({ terminal: true, code: "filter_contract" });
  });

  it("caps the configured page size for a future-cutoff verification request", async () => {
    // This catches a large configured page size making the single verification
    // request violate the provider's offset ceiling.
    let requestedSize = 0;
    const now = Date.parse("2026-09-08T00:00:00.000Z");
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      now: () => now,
      fetch: async (input) => {
        requestedSize = Number(new URL(String(input)).searchParams.get("size"));
        return jsonResponse({ count: 0, results: [] });
      },
      paceMs: 0,
      pageSize: 12_000,
    });

    await client.verifyFutureCutoff("job");

    expect(requestedSize).toBe(10_000);
  });
});

describe("JobNimbusClient incremental scans", () => {
  it("throws a terminal filter-contract error when a result predates the cutoff", async () => {
    // This catches accepting a silently ignored date_updated filter during an
    // incremental scan, which would make a watermark unsafe to advance.
    const cutoff = Date.parse("2026-09-01T00:00:00.000Z") / 1_000;
    const fetchFixture: typeof fetch = async () =>
      jsonResponse({
        count: 2_506,
        results: [{ jnid: "too-old", date_updated: cutoff - 1 }],
      });
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: fetchFixture,
      paceMs: 0,
      pageSize: 100,
    });

    const error = await client.incrementalScan("job", cutoff).catch((caught) => caught);

    expect(error).toBeInstanceOf(JobNimbusProviderError);
    expect(error).toMatchObject({
      terminal: true,
      status: 200,
      rateLimited: false,
      code: "filter_contract",
    });
  });

  it("sends a bare must filter with a Date converted to epoch seconds", async () => {
    // This catches adding the rejected Elasticsearch `bool` wrapper or sending
    // JavaScript milliseconds in a provider filter that expects seconds.
    let requestedUrl: URL | undefined;
    const fetchFixture: typeof fetch = async (input) => {
      requestedUrl = new URL(String(input));
      return jsonResponse({
        count: 2_506,
        results: [{ jnid: "updated", date_updated: 1_788_825_600 }],
      });
    };
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: fetchFixture,
      paceMs: 0,
      pageSize: 10,
    });

    await client.incrementalScan("job", new Date("2026-09-08T00:00:00.000Z"));

    expect(requestedUrl?.searchParams.get("filter")).toBe(
      '{"must":[{"range":{"date_updated":{"gte":1788825600}}}]}',
    );
  });

  it("caps non-dividing incremental pages and stops on the actual request size", async () => {
    // This catches comparing a capped final page to configured pageSize rather
    // than the smaller size sent on the wire.
    const cutoff = 1_700_000_000;
    const requests: Array<{ from: number; size: number }> = [];
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async (input) => {
        const url = new URL(String(input));
        const from = Number(url.searchParams.get("from"));
        const size = Number(url.searchParams.get("size"));
        requests.push({ from, size });
        const returned = Math.max(0, Math.min(size, 9_999 - from));
        return jsonResponse({
          count: 31_823,
          results: Array.from({ length: returned }, (_, index) => ({
            jnid: `job-${from + index}`,
            date_updated: cutoff,
          })),
        });
      },
      paceMs: 0,
      pageSize: 3_000,
    });

    const result = await client.incrementalScan("job", cutoff);

    expect(result.records).toHaveLength(9_999);
    expect(requests.at(-1)).toEqual({ from: 9_000, size: 1_000 });
  });
});

describe("JobNimbusClient HTTP failures", () => {
  it("retries 429 responses with exponential backoff and reports rate-limit calls", async () => {
    // This catches dropping a transient page or counting only successful HTTP
    // calls, both of which would understate sync cost and lose records.
    let attempts = 0;
    const delays: number[] = [];
    const fetchFixture: typeof fetch = async () => {
      attempts += 1;
      return attempts < 3
        ? jsonResponse({ error: "slow down" }, 429)
        : jsonResponse({ count: 2_506, results: [] });
    };
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: fetchFixture,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
      paceMs: 0,
      retryBackoffMs: 100,
      retryCount: 4,
      pageSize: 100,
    });

    const result = await client.incrementalScan("job", 1_700_000_000);

    expect(result.apiCalls).toBe(3);
    expect(result.transientErrorCount).toBe(2);
    expect(result.rateLimitResponses).toBe(2);
    expect(result.unfilteredCount).toBe(2_506);
    expect(delays).toEqual([100, 200]);
  });

  it("does not retry a 404 and marks it terminal", async () => {
    // This catches treating every HTTP failure as retryable, which would waste
    // calls on unsupported provider endpoints.
    let attempts = 0;
    const fetchFixture: typeof fetch = async () => {
      attempts += 1;
      return jsonResponse({ error: "not found" }, 404);
    };
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: fetchFixture,
      sleep: async () => undefined,
      paceMs: 0,
      retryCount: 4,
    });

    const error = await client.incrementalScan("job", 1_700_000_000).catch((caught) => caught);

    expect(attempts).toBe(1);
    expect(error).toBeInstanceOf(JobNimbusProviderError);
    expect(error).toMatchObject({
      terminal: true,
      status: 404,
      rateLimited: false,
      code: "http",
      apiCalls: 1,
      transientErrorCount: 0,
      rateLimitResponses: 0,
    });
  });

  it.each([408, 425, 500, 503])("retries transient HTTP %i responses", async (status) => {
    // This catches narrowing retries to rate limits while dropping request
    // timeout, too-early, and provider outage responses.
    let attempts = 0;
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async () => {
        attempts += 1;
        return attempts === 1
          ? jsonResponse({ error: "transient" }, status)
          : jsonResponse({ count: 0, results: [] });
      },
      sleep: async () => undefined,
      paceMs: 0,
      retryCount: 1,
    });

    const result = await client.fetchPage("job");

    expect(attempts).toBe(2);
    expect(result.apiCalls).toBe(2);
    expect(result.transientErrorCount).toBe(1);
    expect(result.rateLimitResponses).toBe(0);
  });

  it("retries network and timeout failures", async () => {
    // This catches treating a rejected fetch promise differently from a
    // transient HTTP response.
    let attempts = 0;
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async () => {
        attempts += 1;
        if (attempts === 1) throw new DOMException("timed out", "AbortError");
        return jsonResponse({ count: 0, results: [] });
      },
      sleep: async () => undefined,
      paceMs: 0,
      retryCount: 1,
    });

    const result = await client.fetchPage("job");

    expect(attempts).toBe(2);
    expect(result.apiCalls).toBe(2);
    expect(result.transientErrorCount).toBe(1);
    expect(result.rateLimitResponses).toBe(0);
  });

  it("uses four retries by default before surfacing a non-terminal 5xx", async () => {
    // This catches interpreting `retryCount` as total attempts instead of the
    // documented number of retries after the first call.
    let attempts = 0;
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async () => {
        attempts += 1;
        return jsonResponse({ error: "unavailable" }, 503);
      },
      sleep: async () => undefined,
      paceMs: 0,
    });

    const error = await client.fetchPage("job").catch((caught) => caught);

    expect(attempts).toBe(5);
    expect(error).toBeInstanceOf(JobNimbusProviderError);
    expect(error).toMatchObject({
      terminal: false,
      status: 503,
      rateLimited: false,
      code: "http",
      apiCalls: 5,
      transientErrorCount: 5,
      rateLimitResponses: 0,
    });
  });

  it("reports every exhausted 429 attempt as transient and rate-limited", async () => {
    // This catches retaining only the final 429 on the typed error instead of
    // the full retry cost needed by sync_runs.
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async () => jsonResponse({ error: "slow down" }, 429),
      sleep: async () => undefined,
      paceMs: 0,
      retryCount: 2,
    });

    const error = await client.fetchPage("job").catch((caught) => caught);

    expect(error).toBeInstanceOf(JobNimbusProviderError);
    expect(error).toMatchObject({
      terminal: false,
      status: 429,
      rateLimited: true,
      code: "http",
      apiCalls: 3,
      transientErrorCount: 3,
      rateLimitResponses: 3,
    });
  });

  it("reports every exhausted network attempt on the typed error", async () => {
    // This catches losing rejected fetch/timeout attempts when no success
    // result exists to carry telemetry.
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async () => {
        throw new DOMException("timed out", "AbortError");
      },
      sleep: async () => undefined,
      paceMs: 0,
      retryCount: 1,
    });

    const error = await client.fetchPage("job").catch((caught) => caught);

    expect(error).toBeInstanceOf(JobNimbusProviderError);
    expect(error).toMatchObject({
      terminal: false,
      code: "network",
      apiCalls: 2,
      transientErrorCount: 2,
      rateLimitResponses: 0,
    });
  });

  it("retries a transient metadata body-stream failure", async () => {
    // This catches ending the retry boundary at response headers, leaving a
    // dropped 200 response body unrecoverable.
    let attempts = 0;
    const delays: number[] = [];
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async () => {
        attempts += 1;
        const response = jsonResponse({ count: 0, results: [] });
        if (attempts === 1) {
          response.json = async () => {
            throw new TypeError("terminated while reading body");
          };
        }
        return response;
      },
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
      paceMs: 0,
      retryBackoffMs: 50,
      retryCount: 1,
    });

    const result = await client.fetchPage("job");

    expect(attempts).toBe(2);
    expect(result.apiCalls).toBe(2);
    expect(result.transientErrorCount).toBe(1);
    expect(result.rateLimitResponses).toBe(0);
    expect(delays).toEqual([50]);
  });

  it("keeps invalid JSON terminal instead of retrying it as a stream failure", async () => {
    // This catches retrying a complete but malformed provider payload, which is
    // a schema/parse contract failure rather than a transient transport read.
    let attempts = 0;
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async () => {
        attempts += 1;
        return new Response("{", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      sleep: async () => undefined,
      paceMs: 0,
    });

    const error = await client.fetchPage("job").catch((caught) => caught);

    expect(attempts).toBe(1);
    expect(error).toBeInstanceOf(JobNimbusProviderError);
    expect(error).toMatchObject({
      terminal: true,
      status: 200,
      code: "invalid_envelope",
      apiCalls: 1,
      transientErrorCount: 0,
      rateLimitResponses: 0,
    });
  });
});

describe("JobNimbusClient file downloads", () => {
  it("downloads raw bytes from /files/{jnid} with the response content type", async () => {
    // This catches accidentally parsing attachment bodies as JSON or calling a
    // metadata collection path instead of the raw file endpoint.
    let requestedUrl: URL | undefined;
    let requestedInit: RequestInit | undefined;
    const fetchFixture: typeof fetch = async (input, init) => {
      requestedUrl = new URL(String(input));
      requestedInit = init;
      return new Response(Uint8Array.from([0x25, 0x50, 0x44, 0x46]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    };
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: fetchFixture,
      paceMs: 0,
    });

    const result = await client.downloadFile("file-jnid");

    expect(Array.from(result.bytes)).toEqual([0x25, 0x50, 0x44, 0x46]);
    expect(result.contentType).toBe("application/pdf");
    expect(result.apiCalls).toBe(1);
    expect(result.transientErrorCount).toBe(0);
    expect(result.rateLimitResponses).toBe(0);
    expect(requestedUrl?.pathname).toBe("/api1/files/file-jnid");
    expect(requestedInit?.method).toBe("GET");
    expect(new Headers(requestedInit?.headers).get("authorization")).toBe(
      "Bearer fixture-key",
    );
  });

  it("rejects a missing file terminally without retrying", async () => {
    // This catches converting a raw-download 404 into empty bytes or retrying a
    // permanent missing-file response.
    let attempts = 0;
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async () => {
        attempts += 1;
        return jsonResponse({ error: "not found" }, 404);
      },
      sleep: async () => undefined,
      paceMs: 0,
    });

    const error = await client.downloadFile("missing").catch((caught) => caught);

    expect(attempts).toBe(1);
    expect(error).toBeInstanceOf(JobNimbusProviderError);
    expect(error).toMatchObject({
      terminal: true,
      status: 404,
      rateLimited: false,
      code: "http",
      apiCalls: 1,
      transientErrorCount: 0,
      rateLimitResponses: 0,
    });
  });

  it("retries a transient raw-byte body-stream failure", async () => {
    // This catches protecting JSON body consumption while still leaving raw
    // attachment reads outside the retry boundary.
    let attempts = 0;
    const client = new JobNimbusClient({
      apiKey: "fixture-key",
      fetch: async () => {
        attempts += 1;
        const response = new Response(Uint8Array.from([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        });
        if (attempts === 1) {
          response.arrayBuffer = async () => {
            throw new TypeError("terminated while reading body");
          };
        }
        return response;
      },
      sleep: async () => undefined,
      paceMs: 0,
      retryCount: 1,
    });

    const result = await client.downloadFile("file-jnid");

    expect(attempts).toBe(2);
    expect(result.apiCalls).toBe(2);
    expect(result.transientErrorCount).toBe(1);
    expect(result.rateLimitResponses).toBe(0);
    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
  });
});

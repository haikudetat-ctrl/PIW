import { describe, expect, it, vi } from "vitest";
import { JobNimbusReadClient, LeadConduitReadClient, LeadMasterReadClient } from "./vendors";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("read-only vendor clients", () => {
  it("uses only GET with Basic auth for LeadConduit", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]));
    const client = new LeadConduitReadClient({ apiKey: "key", fetcher });
    await client.flows();
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://app.leadconduit.com/flows");
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("Authorization")).toMatch(/^Basic /);
  });

  it("reads a bounded bootstrap LeadConduit event page with the trusted flow rule", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{ id: "event-1", flow_id: "roof flow" }]));
    const result = await new LeadConduitReadClient({ apiKey: "key", fetcher }).eventsPage({
      flowId: "roof flow",
      start: "2026-08-01T00:00:00.000Z",
      limit: 50,
    });

    expect(result).toEqual({ rows: [{ id: "event-1", flow_id: "roof flow" }], cursor: "event-1", hasMore: false });
    const [requestUrl, init] = fetcher.mock.calls[0];
    const url = new URL(String(requestUrl));
    expect(url.pathname).toBe("/events");
    expect(url.searchParams.get("start")).toBe("2026-08-01T00:00:00.000Z");
    expect(url.searchParams.get("after_id")).toBeNull();
    expect(url.searchParams.get("sort")).toBe("asc");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("rules")).toBe('[{"lhv":"flow.id","op":"is equal to","rhv":"roof flow"}]');
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Basic ${Buffer.from("API:key").toString("base64")}`);
  });

  it("reads a continuation LeadConduit event page without a bootstrap start", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{ id: "event-2", vars: { "flow.id": "roof-flow" } }]));
    const result = await new LeadConduitReadClient({ apiKey: "key", fetcher }).eventsPage({
      flowId: "roof-flow",
      afterId: "event-1",
      limit: 1,
    });

    expect(result).toEqual({ rows: [{ id: "event-2", vars: { "flow.id": "roof-flow" } }], cursor: "event-2", hasMore: true });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get("start")).toBeNull();
    expect(url.searchParams.get("after_id")).toBe("event-1");
    expect(url.searchParams.get("sort")).toBe("asc");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(url.searchParams.get("rules")).toBe('[{"lhv":"flow.id","op":"is equal to","rhv":"roof-flow"}]');
  });

  it("rejects LeadConduit event pages without exactly one cursor selector or a bounded limit", async () => {
    const client = new LeadConduitReadClient({ apiKey: "key", fetcher: vi.fn<typeof fetch>() });

    await expect(client.eventsPage({ flowId: "flow", limit: 1 })).rejects.toThrow("exactly one cursor selector");
    await expect(client.eventsPage({ flowId: "flow", start: "2026-08-01", afterId: "event", limit: 1 })).rejects.toThrow("exactly one cursor selector");
    await expect(client.eventsPage({ flowId: "flow", start: "2026-08-01", limit: 1001 })).rejects.toThrow("between 1 and 1000");
  });

  it("fails closed when an event page contains a row outside its trusted flow", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{ id: "event-1", flow_id: "other-flow" }]));

    await expect(new LeadConduitReadClient({ apiKey: "key", fetcher }).eventsPage({
      flowId: "trusted-flow",
      start: "2026-08-01",
      limit: 10,
    })).rejects.toMatchObject({ category: "invalid_response" });
  });

  it("encodes LeadConduit source metadata and event detail paths", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({ fields: [] }));
    const client = new LeadConduitReadClient({ apiKey: "key", fetcher });

    await client.sourceMeta("flow / 1", "source / 2");
    await client.eventDetail("event / 3");

    expect(fetcher.mock.calls.map(([requestUrl, init]) => {
      expect(init?.method).toBe("GET");
      return new URL(String(requestUrl)).pathname;
    })).toEqual(["/flows/flow%20%2F%201/sources/source%20%2F%202/meta", "/events/event%20%2F%203"]);
  });

  it("does not retry LeadConduit authentication or authorization failures", async () => {
    for (const status of [401, 403]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("upstream body", { status }));
      await expect(new LeadConduitReadClient({ apiKey: "key", fetcher }).flows()).rejects.toMatchObject({
        category: status === 401 ? "authentication" : "authorization",
        status,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("retries bounded LeadConduit rate-limit and upstream failures", async () => {
    for (const status of [429, 500]) {
      const fetcher = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("upstream body", { status }))
        .mockResolvedValueOnce(jsonResponse([]));
      await expect(new LeadConduitReadClient({ apiKey: "key", fetcher }).flows()).resolves.toEqual([]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });

  it("categorizes invalid LeadConduit JSON without exposing the upstream body", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("lead@example.com api-key-123", { status: 200 }));

    await expect(new LeadConduitReadClient({ apiKey: "key", fetcher }).flows()).rejects.toMatchObject({
      category: "invalid_response",
      status: 200,
    });
  });

  it("probes only configured LeadConduit flows and returns sanitized metadata", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([
        { id: "roof-flow", name: "Upstream private name", sources: [{ id: "roof-source" }] },
        { id: "unapproved-flow", name: "Someone Else", sources: [{ id: "other-source" }] },
      ]))
      .mockResolvedValueOnce(jsonResponse({
        fields: [{ name: "email" }, { name: "address" }, { name: "email" }],
        lead: { name: "Ava Private", email: "ava@example.com", phone: "555-0100", address: "1 Private Way" },
        api_key: "api-key-123",
      }));
    const result = await new LeadConduitReadClient({ apiKey: "key", fetcher }).probe({
      approvedFlows: new Map([["roof-flow", "Roofing"], ["quote-flow", "Roofing Virtual Quote"]]),
    });

    expect(result).toEqual({
      ok: true,
      status: 200,
      visibleFlowCount: 2,
      approvedFlows: [{ flowId: "roof-flow", flowName: "Roofing", sourceCount: 1, fieldNames: ["address", "email"] }],
      missingFlowNames: ["Roofing Virtual Quote"],
    });
    const serialized = JSON.stringify(result);
    for (const secret of ["Ava Private", "ava@example.com", "555-0100", "1 Private Way", "api-key-123", "Someone Else"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetcher.mock.calls[1][0])).pathname).toBe("/flows/roof-flow/sources/roof-source/meta");
  });

  it("sanitizes LeadConduit probe failures without returning upstream bodies", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ lead: { email: "ava@example.com" }, api_key: "api-key-123" }), { status: 401 }));
    const result = await new LeadConduitReadClient({ apiKey: "key", fetcher }).probe({
      approvedFlows: new Map([["roof-flow", "Roofing"]]),
    });

    expect(result).toEqual({
      ok: false,
      status: 401,
      visibleFlowCount: 0,
      approvedFlows: [],
      missingFlowNames: ["Roofing"],
      errorCategory: "authentication",
    });
    expect(JSON.stringify(result)).not.toContain("ava@example.com");
    expect(JSON.stringify(result)).not.toContain("api-key-123");
  });

  it("uses documented LeadMaster paging endpoints and never sends Quick Action filters", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]));
    const client = new LeadMasterReadClient({ accessToken: "token", lookbackMinutes: 60, fetcher });
    await client.leads();
    const [requestUrl, init] = fetcher.mock.calls[0];
    const url = new URL(String(requestUrl));
    expect(url.pathname).toBe("/api/LMWebAPI/GetLastUpdatedLeadWithPaging");
    expect(url.searchParams.get("minutes")).toBe("60");
    expect(url.search.toLowerCase()).not.toContain("quick");
    expect(init?.method).toBe("GET");
  });

  it("keeps JobNimbus resource paths configurable and uses Bearer auth", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]));
    const client = new JobNimbusReadClient({
      apiKey: "key",
      contactsPath: "/custom/contacts",
      fetcher,
    });
    await client.contacts();
    const [requestUrl, init] = fetcher.mock.calls[0];
    expect(String(requestUrl)).toContain("/custom/contacts");
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer key");
  });

  it("caps a JobNimbus read to the configured page size and page count", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([
      { id: "1" },
      { id: "2" },
      { id: "3" },
    ]));
    const client = new JobNimbusReadClient({
      apiKey: "key",
      pageLimit: 2,
      maxPages: 1,
      fetcher,
    });

    expect(await client.contacts()).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.origin).toBe("https://app.jobnimbus.com");
    expect(url.pathname).toBe("/api1/contacts");
    expect(url.searchParams.get("size")).toBe("2");
    expect(url.searchParams.get("from")).toBe("0");
    expect(url.searchParams.has("limit")).toBe(false);
    expect(url.searchParams.has("offset")).toBe(false);
  });

  it("reports only JobNimbus response status, count, and field names", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([
        { id: "contact-secret", email: "person@example.com" },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        { id: "job-secret", status: "Won" },
      ]));
    const result = await new JobNimbusReadClient({ apiKey: "key", fetcher }).probe();

    expect(result).toEqual({
      contacts: {
        resource: "contacts",
        ok: true,
        status: 200,
        recordCount: 1,
        fieldNames: ["email", "id"],
      },
      jobs: {
        resource: "jobs",
        ok: true,
        status: 200,
        recordCount: 1,
        fieldNames: ["id", "status"],
      },
    });
    expect(JSON.stringify(result)).not.toContain("contact-secret");
    expect(JSON.stringify(result)).not.toContain("person@example.com");
    expect(JSON.stringify(result)).not.toContain("job-secret");

    for (const [requestUrl, init] of fetcher.mock.calls) {
      const url = new URL(String(requestUrl));
      expect(url.origin).toBe("https://app.jobnimbus.com");
      expect(url.searchParams.get("size")).toBe("1");
      expect(url.searchParams.get("from")).toBe("0");
      expect(url.searchParams.has("limit")).toBe(false);
      expect(url.searchParams.has("offset")).toBe(false);
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer key");
    }
    expect(fetcher.mock.calls.map(([requestUrl]) => new URL(String(requestUrl)).pathname).sort()).toEqual([
      "/api1/contacts",
      "/api1/jobs",
    ]);
  });

  it.each([
    [401, "authentication"],
    [403, "authorization"],
    [429, "rate_limit"],
    [500, "upstream"],
  ] as const)("sanitizes JobNimbus HTTP %s as %s", async (status, errorCategory) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ detail: "customer value" }), { status }),
    );

    const result = await new JobNimbusReadClient({ apiKey: "key", fetcher }).probe();

    expect(result.contacts).toEqual({
      resource: "contacts",
      ok: false,
      status,
      recordCount: 0,
      fieldNames: [],
      errorCategory,
    });
    expect(JSON.stringify(result)).not.toContain("customer value");
  });

  it("sanitizes invalid JobNimbus JSON", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const result = await new JobNimbusReadClient({ apiKey: "key", fetcher }).probe();

    expect(result.contacts).toEqual({
      resource: "contacts",
      ok: false,
      status: 200,
      recordCount: 0,
      fieldNames: [],
      errorCategory: "invalid_response",
    });
  });
});

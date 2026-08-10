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
    expect(url.searchParams.get("limit")).toBe("2");
    expect(url.searchParams.get("offset")).toBe("0");
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
      expect(url.searchParams.get("limit")).toBe("1");
      expect(url.searchParams.get("offset")).toBe("0");
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer key");
    }
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

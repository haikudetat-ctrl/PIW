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
});

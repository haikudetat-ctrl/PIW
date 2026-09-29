import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { listJourneyCompanies, parseJourneyRefreshResult, refreshCustomerJourney } from "./refresh";

const COMPANY = "00000000-0000-4000-8000-000000000001";

describe("parseJourneyRefreshResult", () => {
  it("maps the database counts", () => {
    expect(parseJourneyRefreshResult({ attached: 3, unmatched: 1, events_added: 12, open_conflicts: 2 }))
      .toEqual({ attached: 3, unmatched: 1, eventsAdded: 12, openConflicts: 2 });
  });

  it("treats missing or malformed counts as zero", () => {
    expect(parseJourneyRefreshResult(null))
      .toEqual({ attached: 0, unmatched: 0, eventsAdded: 0, openConflicts: 0 });
    expect(parseJourneyRefreshResult({ attached: -1, events_added: "x" }).attached).toBe(0);
  });
});

describe("refreshCustomerJourney", () => {
  it("runs the refresh for one company", async () => {
    const rpc = vi.fn(async () => ({ data: { attached: 1 }, error: null }));
    const database = { rpc } as unknown as SupabaseClient<Database>;

    await expect(refreshCustomerJourney(database, COMPANY)).resolves.toMatchObject({ attached: 1 });
    expect(rpc).toHaveBeenCalledWith("refresh_customer_journey", { p_company_id: COMPANY });
  });

  it("surfaces failures without database detail", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "relation missing" } }));
    const database = { rpc } as unknown as SupabaseClient<Database>;

    await expect(refreshCustomerJourney(database, COMPANY)).rejects.toThrow("Customer journey refresh failed");
  });
});

describe("listJourneyCompanies", () => {
  function database(rows: Array<{ company_id: string }>) {
    const eq = vi.fn(async () => ({ data: rows, error: null }));
    return { from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })) } as unknown as SupabaseClient<Database>;
  }

  it("combines integration companies with the LeadConduit company, once each", async () => {
    await expect(listJourneyCompanies(database([{ company_id: "b" }, { company_id: "a" }]), "b"))
      .resolves.toEqual(["a", "b"]);
  });

  it("still refreshes the LeadConduit company when no integration exists", async () => {
    await expect(listJourneyCompanies(database([]), COMPANY)).resolves.toEqual([COMPANY]);
  });
});

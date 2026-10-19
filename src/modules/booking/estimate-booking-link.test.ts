import {describe, expect, test, vi} from "vitest";
import {handleEstimateBookingLink} from "@/modules/booking/estimate-booking-link";

const token = "11111111-1111-4111-8111-111111111111";
const completed = {
  companyId: "22222222-2222-4222-8222-222222222222",
  assessmentId: "33333333-3333-4333-8333-333333333333",
  estimateId: "44444444-4444-4444-8444-444444444444",
  leadId: "55555555-5555-4555-8555-555555555555",
};

describe("estimate booking link route", () => {
  test("exchanges a completed estimate token for the lead's booking URL", async () => {
    const ensureUrl = vi.fn(async () => ({url: "https://estimate.example.com/book/abc.def"}));
    const response = await handleEstimateBookingLink({
      token,
      repository: {findCompletedByToken: vi.fn(async () => completed)},
      available: async () => true,
      ensureUrl,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({url: "https://estimate.example.com/book/abc.def"});
    expect(ensureUrl).toHaveBeenCalledWith({companyId: completed.companyId, leadId: completed.leadId});
  });

  test.each([
    ["a malformed token", "not-a-uuid", completed, true],
    ["an unknown estimate", token, null, true],
    ["a company without booking", token, completed, false],
  ])("returns one generic 404 for %s", async (_label, value, found, available) => {
    const ensureUrl = vi.fn();
    const response = await handleEstimateBookingLink({
      token: value,
      repository: {findCompletedByToken: vi.fn(async () => found)},
      available: async () => available,
      ensureUrl,
    });
    expect(response.status).toBe(404);
    expect(ensureUrl).not.toHaveBeenCalled();
  });
});

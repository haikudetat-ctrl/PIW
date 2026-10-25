import { describe, expect, test } from "vitest";
import { costPer, isLeadFlag, paidSearchReportSchema } from "./paid-search";

describe("paid search report", () => {
  test("parses the report function's numeric strings", () => {
    const report = paidSearchReportSchema.parse({
      spend: "85.00", clicks: 7, impressions: 210, arrivals: 6, leads: 3, qualified: 1,
      appointments_set: 1, appointments_ran: 0, sold: 0, revenue: 0, flagged: 0,
      last_spend_import_at: null, daily: [], keywords: [], deliveries: [], recent_leads: [],
    });
    expect(report.spend).toBe(85);
  });
  test("cost per outcome is null without outcomes", () => {
    expect(costPer(100, 0)).toBeNull();
    expect(costPer(100, 4)).toBe(25);
  });
  test("only known flags are accepted", () => {
    expect(isLeadFlag("spam")).toBe(true);
    expect(isLeadFlag("clear")).toBe(false);
  });
});

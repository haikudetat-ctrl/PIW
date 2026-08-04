import { describe, expect, it } from "vitest";
import { summarizeFunnel, type ReconciledRoute } from "./funnel";

const base: ReconciledRoute = {
  lead_source: "Meta",
  leadmaster_record_id: null,
  leadmaster_opportunity_status: null,
  leadmaster_opportunity_stage: null,
  jobnimbus_job_id: null,
  jobnimbus_status: null,
  jobnimbus_stage: null,
  jobnimbus_appointment_status: null,
  appointment_at: null,
  sold_value: null,
};

describe("summarizeFunnel", () => {
  it("rolls downstream records into owner-level funnel stages", () => {
    const summary = summarizeFunnel([
      base,
      { ...base, leadmaster_record_id: "lm-1" },
      { ...base, jobnimbus_job_id: "jn-1", jobnimbus_stage: "Sold" },
    ]);

    expect(summary.total).toEqual({ source: 3, contacted: 2, appointment: 1, sold: 1, job: 1 });
    expect(summary.bySource[0]).toEqual({ sourceName: "Meta", counts: summary.total });
  });
});

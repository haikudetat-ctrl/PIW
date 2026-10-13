import { expect, test } from "vitest";
import { buildJobCards, jobStageTotals, jobnimbusPipelineSchema, linkedLeadStatuses } from "./jobnimbus-pipeline";

const NOW = new Date("2026-10-13T12:00:00.000Z");

const payload = jobnimbusPipelineSchema.parse({
  since: "2026-04-16T12:00:00+00:00",
  stages: [
    { stage: "new", jobs: 492, value: "84900.00" },
    { stage: "appointment_set", jobs: 4, value: 0 },
  ],
  jobs: [
    {
      jnid: "abc/1",
      number: "3729",
      name: "  ",
      address: "106 Mount Vernon Drive, Cinnaminson",
      status_name: "Lead",
      stage: "new",
      sales_rep_name: null,
      value: 0,
      roofr_squares: "19.43",
      activity_at: "2026-10-13T09:00:00+00:00",
    },
  ],
  linked_leads: [
    { lead_id: "lead-1", jnid: "j1", status_name: "Quoted" },
    { lead_id: "lead-1", jnid: "j2", status_name: "Lead" },
    { lead_id: "lead-2", jnid: "j3", status_name: null },
  ],
});

test("job cards fall back to the job number and treat a zero total as none", () => {
  expect(buildJobCards(payload, NOW)).toEqual([
    {
      jnid: "abc/1",
      title: "Job #3729",
      address: "106 Mount Vernon Drive, Cinnaminson",
      stage: "new",
      status: "Lead",
      rep: null,
      valueCents: null,
      squares: 19.43,
      ageLabel: "3h",
      href: "/jobs/abc%2F1",
    },
  ]);
});

test("stage totals are in cents and linked leads keep their first status", () => {
  expect(jobStageTotals(payload)).toEqual({
    new: { jobs: 492, valueCents: 8_490_000 },
    appointment_set: { jobs: 4, valueCents: 0 },
  });
  expect([...linkedLeadStatuses(payload)]).toEqual([
    ["lead-1", "Quoted"],
    ["lead-2", "In JobNimbus"],
  ]);
});

test("rejects stages the board does not have", () => {
  expect(jobnimbusPipelineSchema.safeParse({ ...payload, stages: [{ stage: "sold", jobs: 1, value: 0 }] }).success).toBe(
    false,
  );
});

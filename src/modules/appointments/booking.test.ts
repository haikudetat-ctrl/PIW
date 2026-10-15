import { describe, expect, test } from "vitest";
import {
  companyLocalToIso,
  isRebookTaskTitle,
  rebookTask,
  stageAfterBooking,
  stageAfterMissed,
} from "./booking";

describe("companyLocalToIso", () => {
  test("reads a datetime-local value as Eastern time", () => {
    expect(companyLocalToIso("2026-10-20T14:30")).toBe("2026-10-20T18:30:00.000Z");
    expect(companyLocalToIso("2026-12-01T09:00")).toBe("2026-12-01T14:00:00.000Z");
  });

  test("handles both sides of a daylight-saving change", () => {
    expect(companyLocalToIso("2026-11-01T00:30")).toBe("2026-11-01T04:30:00.000Z");
    expect(companyLocalToIso("2026-11-01T03:00")).toBe("2026-11-01T08:00:00.000Z");
    expect(companyLocalToIso("2026-03-08T01:30")).toBe("2026-03-08T06:30:00.000Z");
    expect(companyLocalToIso("2026-03-08T04:00")).toBe("2026-03-08T08:00:00.000Z");
  });

  test("rejects values that aren't a real local time", () => {
    expect(companyLocalToIso("")).toBeNull();
    expect(companyLocalToIso("2026-02-30T10:00")).toBeNull();
    expect(companyLocalToIso("2026-10-20T25:00")).toBeNull();
    expect(companyLocalToIso("2026-10-20T14:30:00Z")).toBeNull();
  });
});

describe("lead stage rules", () => {
  test("booking moves early-stage leads to appointment set", () => {
    expect(stageAfterBooking("new")).toBe("appointment_set");
    expect(stageAfterBooking("contacting")).toBe("appointment_set");
    expect(stageAfterBooking("nurture")).toBe("appointment_set");
    expect(stageAfterBooking("appointment_set")).toBeNull();
    expect(stageAfterBooking("proposal_sent")).toBeNull();
    expect(stageAfterBooking("won")).toBeNull();
  });

  test("a missed inspection puts an appointment-set lead back to contacting", () => {
    expect(stageAfterMissed("appointment_set")).toBe("contacting");
    expect(stageAfterMissed("estimating")).toBeNull();
    expect(stageAfterMissed("lost")).toBeNull();
  });
});

describe("rebookTask", () => {
  test("is keyed to the appointment so a repeat click doesn't duplicate it", () => {
    const task = rebookTask({
      appointmentId: "50000000-0000-4000-8000-000000000001",
      status: "no_show",
      scheduledAt: "2026-10-20T18:30:00.000Z",
      leadName: "Jordan Lee",
      leadPhone: "(609) 555-0101",
    });

    expect(task).toEqual({
      title: "Rebook no-show",
      description: "The Tue, Oct 20, 2:30 PM inspection was a no-show. Call Jordan Lee at (609) 555-0101 to rebook.",
      sourceKey: "rebook:appointment:50000000-0000-4000-8000-000000000001",
    });
    expect(isRebookTaskTitle(task.title)).toBe(true);
  });

  test("names cancellations separately", () => {
    const task = rebookTask({
      appointmentId: "50000000-0000-4000-8000-000000000002",
      status: "cancelled",
      scheduledAt: "2026-10-20T18:30:00.000Z",
      leadName: "Jordan Lee",
      leadPhone: "(609) 555-0101",
    });

    expect(task.title).toBe("Rebook cancelled inspection");
    expect(isRebookTaskTitle(task.title)).toBe(true);
    expect(isRebookTaskTitle("Call new lead now")).toBe(false);
  });
});

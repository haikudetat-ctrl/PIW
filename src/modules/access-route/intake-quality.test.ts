import { describe, expect, test } from "vitest";
import {
  describeIntakeFlags,
  formatReceived,
  formatShare,
  formatTown,
  intakeFlags,
  summarizeIntakeBySource,
  type IntakeQualityRow,
} from "./intake-quality";

// 2026-11-12 18:00 Eastern.
const NOW = new Date("2026-11-12T23:00:00.000Z");

function lead(overrides: Partial<IntakeQualityRow> = {}): IntakeQualityRow {
  return {
    flow_id: "flow",
    lead_id: "lead",
    source_name: "Vendor A",
    received_at: "2026-11-12T15:00:00.000Z",
    lead_name: "Pat Homeowner",
    city: "Cherry Hill",
    state: "NJ",
    has_address: true,
    has_trustedform: true,
    has_phone: true,
    has_email: true,
    contact_redacted: false,
    repeat_of_received_at: null,
    repeat_of_source_name: null,
    jobnimbus_contact_since: null,
    service_states: ["NJ"],
    ...overrides,
  };
}

describe("intakeFlags", () => {
  test("a complete in-area lead has no flags", () => {
    expect(intakeFlags(lead())).toEqual([]);
  });

  test("flags every problem in a fixed order", () => {
    expect(intakeFlags(lead({
      repeat_of_received_at: "2026-11-10T15:00:00.000Z",
      jobnimbus_contact_since: "2025-03-01T15:00:00.000Z",
      has_trustedform: false,
      has_address: false,
      city: null,
      state: null,
      lead_name: null,
    }))).toEqual(["repeat", "known_customer", "no_trustedform", "blank_address", "incomplete"]);
  });

  test("out of area needs a readable state and configured service states", () => {
    expect(intakeFlags(lead({ state: "MA", city: "Boston" }))).toEqual(["out_of_area"]);
    expect(intakeFlags(lead({ state: "MA", service_states: null }))).toEqual([]);
    expect(intakeFlags(lead({ state: null, city: null }))).toEqual([]);
  });

  test("redacted leads are not blamed for details retention cleared", () => {
    expect(intakeFlags(lead({
      contact_redacted: true,
      lead_name: null,
      has_address: false,
      has_trustedform: false,
      has_email: false,
      city: null,
      state: null,
      repeat_of_received_at: "2026-11-10T15:00:00.000Z",
    }))).toEqual(["repeat"]);
  });
});

describe("describeIntakeFlags", () => {
  test("names the other vendor on a cross-vendor repeat", () => {
    expect(describeIntakeFlags(lead({
      repeat_of_received_at: "2026-11-10T15:00:00.000Z",
      repeat_of_source_name: "NestBuilder",
    }))[0]).toEqual({ flag: "repeat", label: "Repeat (also NestBuilder)", tone: "warning" });
    expect(describeIntakeFlags(lead({
      repeat_of_received_at: "2026-11-10T15:00:00.000Z",
      repeat_of_source_name: "Vendor A",
    }))[0].label).toBe("Repeat");
  });

  test("labels prior customers, out-of-area states and missing fields", () => {
    const labels = describeIntakeFlags(lead({
      jobnimbus_contact_since: "2025-03-14T15:00:00.000Z",
      state: "MA",
      city: "Boston",
      lead_name: null,
      has_email: false,
    })).map((detail) => detail.label);
    expect(labels).toEqual(["In JobNimbus since Mar 2025", "Out of area (MA)", "Missing name, email"]);
  });
});

describe("summarizeIntakeBySource", () => {
  test("counts Eastern today, 7 and 30 days, and flags over 30 days", () => {
    const rows = [
      lead({ lead_id: "a1", received_at: "2026-11-12T14:00:00.000Z" }),
      // 11:30 PM Eastern on Nov 11 is yesterday even though it is Nov 12 in UTC.
      lead({ lead_id: "a2", received_at: "2026-11-12T04:30:00.000Z", has_trustedform: false }),
      lead({ lead_id: "a3", received_at: "2026-10-20T15:00:00.000Z", has_trustedform: false }),
      lead({ lead_id: "b1", source_name: "Vendor B", received_at: "2026-11-12T16:00:00.000Z" }),
      lead({ lead_id: "b2", source_name: "Vendor B", received_at: "2026-11-11T16:00:00.000Z" }),
      lead({ lead_id: "b3", source_name: "Vendor B", received_at: "2026-11-01T16:00:00.000Z" }),
      lead({ lead_id: "b4", source_name: "Vendor B", received_at: "2026-11-02T16:00:00.000Z", state: "PA" }),
      // Older than 30 days and in the future: both ignored.
      lead({ lead_id: "old", received_at: "2026-10-01T15:00:00.000Z" }),
      lead({ lead_id: "future", received_at: "2026-11-13T15:00:00.000Z" }),
    ];

    const { sources, total, serviceStatesConfigured } = summarizeIntakeBySource(rows, NOW);

    expect(sources.map((score) => score.sourceName)).toEqual(["Vendor B", "Vendor A"]);
    expect(sources[1]).toMatchObject({ today: 1, last7Days: 2, last30Days: 3 });
    expect(sources[1].flags.no_trustedform).toBe(2);
    expect(sources[0]).toMatchObject({ today: 1, last7Days: 2, last30Days: 4 });
    expect(sources[0].flags.out_of_area).toBe(1);
    expect(total).toMatchObject({ sourceName: "All sources", today: 2, last7Days: 4, last30Days: 7 });
    expect(total.flags.no_trustedform).toBe(2);
    expect(serviceStatesConfigured).toBe(true);
  });

  test("groups blank source names and reports unconfigured service states", () => {
    const { sources, serviceStatesConfigured } = summarizeIntakeBySource(
      [lead({ source_name: "  ", service_states: null }), lead({ source_name: null, service_states: [] })],
      NOW,
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ sourceName: "Unknown source", last30Days: 2 });
    expect(serviceStatesConfigured).toBe(false);
  });
});

describe("formatting", () => {
  test("formats receipt times in Eastern time relative to now", () => {
    expect(formatReceived("2026-11-12T21:55:00.000Z", NOW)).toBe("Today 4:55 PM");
    expect(formatReceived("2026-11-12T04:30:00.000Z", NOW)).toBe("Yesterday 11:30 PM");
    expect(formatReceived("2026-11-09T13:12:00.000Z", NOW)).toBe("Nov 9, 8:12 AM");
  });

  test("formats towns and explains missing ones", () => {
    expect(formatTown(lead())).toBe("Cherry Hill, NJ");
    expect(formatTown(lead({ city: null, state: null, has_address: false }))).toBe("No address");
    expect(formatTown(lead({ city: null, state: null, has_address: false, contact_redacted: true }))).toBe("Redacted");
    expect(formatTown(lead({ city: null, state: null }))).toBe("Unreadable address");
    expect(formatTown(lead({ city: " ", state: "MA" }))).toBe("MA");
  });

  test("shares round to whole percents and hide zeros", () => {
    expect(formatShare(13, 13)).toBe("100%");
    expect(formatShare(2, 61)).toBe("3%");
    expect(formatShare(0, 61)).toBe("");
    expect(formatShare(1, 0)).toBe("");
  });
});

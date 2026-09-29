// @vitest-environment node
import { describe, expect, it } from "vitest";
import { WAREHOUSE_RECORD_TYPES, chooseSyncMode } from "./run";

const NOW = new Date("2026-09-29T12:00:00Z");

describe("chooseSyncMode", () => {
  it("runs a full scan before any watermark exists", () => {
    expect(chooseSyncMode(null, NOW)).toBe("full");
  });

  it("repeats the full scan until one has completed", () => {
    expect(chooseSyncMode({ watermark: "2026-09-29T11:00:00Z", lastFullAt: null }, NOW)).toBe("full");
  });

  it("runs incrementally within a day of the last full scan", () => {
    expect(chooseSyncMode({ watermark: "2026-09-29T11:00:00Z", lastFullAt: "2026-09-29T00:00:00Z" }, NOW))
      .toBe("incremental");
  });

  it("reconciles with a full scan once a day", () => {
    expect(chooseSyncMode({ watermark: "2026-09-29T11:00:00Z", lastFullAt: "2026-09-28T12:00:00Z" }, NOW))
      .toBe("full");
  });
});

describe("WAREHOUSE_RECORD_TYPES", () => {
  it("syncs contacts before jobs so primary contacts are present first", () => {
    expect(WAREHOUSE_RECORD_TYPES).toEqual(["contact", "job", "estimate"]);
  });
});

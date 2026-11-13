import { expect, test } from "vitest";
import { jobNimbusHealth, leadConduitHealth, syncRunHealth } from "./ingestion-health";

const NOW = new Date("2026-11-12T23:00:00.000Z");

test("LeadConduit reports its latest webhook receipt, not sync runs", () => {
  expect(leadConduitHealth({ lastReceivedAt: "2026-11-12T21:55:00.000Z", receivedLast24Hours: 21, now: NOW }))
    .toEqual({ lastAt: "2026-11-12T21:55:00.000Z", status: "receiving", detail: "21 leads in 24h", tone: "ok" });
});

test("LeadConduit goes quiet after a day without leads", () => {
  expect(leadConduitHealth({ lastReceivedAt: "2026-11-11T20:00:00.000Z", receivedLast24Hours: 0, now: NOW }))
    .toMatchObject({ status: "quiet", detail: "0 leads in 24h", tone: "warning" });
});

test("LeadConduit with no receipts is not configured", () => {
  expect(leadConduitHealth({ lastReceivedAt: null, receivedLast24Hours: 0, now: NOW }))
    .toMatchObject({ status: "not configured", lastAt: null });
});

test("JobNimbus summarizes the latest poll across record types", () => {
  expect(jobNimbusHealth([
    { started_at: "2026-11-12T22:17:47.567+00:00", status: "ok", records_changed: 0 },
    { started_at: "2026-11-12T22:17:31.333+00:00", status: "ok", records_changed: 2 },
    { started_at: "2026-11-12T22:17:02.800+00:00", status: "ok", records_changed: 1 },
    // The previous hour's poll is not part of the latest one.
    { started_at: "2026-11-12T21:17:00.943+00:00", status: "failed", records_changed: 9 },
  ])).toEqual({ lastAt: "2026-11-12T22:17:47.567+00:00", status: "ok", detail: "3 records changed", tone: "ok" });
});

test("JobNimbus surfaces a failed record type in the latest poll", () => {
  expect(jobNimbusHealth([
    { started_at: "2026-11-12T22:17:02.800+00:00", status: "ok", records_changed: 1 },
    { started_at: "2026-11-12T22:17:31.333+00:00", status: "reconcile_mismatch", records_changed: 0 },
  ])).toMatchObject({ status: "reconcile_mismatch", detail: "1 record changed", tone: "danger" });
});

test("JobNimbus with no visible runs is not configured", () => {
  expect(jobNimbusHealth([])).toMatchObject({ status: "not configured" });
});

test("sync-run systems keep their recorded outcome", () => {
  expect(syncRunHealth({ started_at: "2026-11-12T20:00:00.000Z", outcome: "failed", records_written: 0 }))
    .toMatchObject({ status: "failed", tone: "danger", detail: "0 records" });
  expect(syncRunHealth(undefined)).toMatchObject({ status: "not configured" });
});

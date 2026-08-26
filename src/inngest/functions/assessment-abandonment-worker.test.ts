import { describe, expect, test, vi } from "vitest";
import {
  abandonInactiveAssessments,
  createAssessmentAbandonmentWorker,
  drainInactiveAssessments,
} from "./assessment-abandonment-worker";

describe("assessment abandonment worker", () => {
  test("uses the database clock and a bounded atomic batch", async () => {
    const abandonBatch = vi.fn().mockResolvedValue([
      {assessmentId: "11111111-1111-4111-8111-111111111111"},
    ]);

    await expect(abandonInactiveAssessments({abandonBatch}, 100)).resolves.toEqual({
      abandoned: 1,
    });
    expect(abandonBatch).toHaveBeenCalledWith({batchSize: 100});
  });

  test("registers one hourly cron function", () => {
    const createFunction = vi.fn().mockReturnValue({id: "worker"});
    const worker = createAssessmentAbandonmentWorker({createFunction} as never, {
      abandonBatch: vi.fn(),
    });

    expect(worker).toEqual({id: "worker"});
    expect(createFunction).toHaveBeenCalledTimes(1);
    expect(createFunction.mock.calls[0]?.[0]).toMatchObject({
      id: "assessment-abandonment-worker",
      triggers: {cron: "0 * * * *"},
    });
  });

  test("drains full pages until the database returns a short page", async () => {
    const abandonBatch = vi.fn()
      .mockResolvedValueOnce(Array.from({length: 500}, (_, index) => ({assessmentId: `page-1-${index}`})))
      .mockResolvedValueOnce(Array.from({length: 500}, (_, index) => ({assessmentId: `page-2-${index}`})))
      .mockResolvedValueOnce(Array.from({length: 17}, (_, index) => ({assessmentId: `page-3-${index}`})));
    const runPage = vi.fn(async (_id: string, operation: () => Promise<{abandoned: number}>) => operation());

    await expect(drainInactiveAssessments({abandonBatch}, runPage)).resolves.toEqual({
      abandoned: 1017,
      pages: 3,
      maxPagesReached: false,
    });
    expect(runPage.mock.calls.map(([id]) => id)).toEqual([
      "abandon-page-1",
      "abandon-page-2",
      "abandon-page-3",
    ]);
    expect(abandonBatch).toHaveBeenCalledTimes(3);
  });

  test("requests an empty page after an exact full page before stopping", async () => {
    const abandonBatch = vi.fn()
      .mockResolvedValueOnce(Array.from({length: 500}, (_, index) => ({assessmentId: `full-${index}`})))
      .mockResolvedValueOnce([]);
    const runPage = vi.fn(async (_id: string, operation: () => Promise<{abandoned: number}>) => operation());

    await expect(drainInactiveAssessments({abandonBatch}, runPage)).resolves.toMatchObject({
      abandoned: 500,
      pages: 2,
      maxPagesReached: false,
    });
  });

  test("stops at the execution guard when every page is full", async () => {
    const abandonBatch = vi.fn().mockResolvedValue(
      Array.from({length: 25}, (_, index) => ({assessmentId: `guard-${index}`})),
    );
    const runPage = vi.fn(async (_id: string, operation: () => Promise<{abandoned: number}>) => operation());

    await expect(drainInactiveAssessments({abandonBatch}, runPage, {
      batchSize: 25,
      maxPages: 3,
    })).resolves.toEqual({abandoned: 75, pages: 3, maxPagesReached: true});
    expect(abandonBatch).toHaveBeenCalledTimes(3);
  });

  test("uses stable page steps so a mid-run retry does not repeat completed pages", async () => {
    const abandonBatch = vi.fn()
      .mockResolvedValueOnce(Array.from({length: 2}, (_, index) => ({assessmentId: `first-${index}`})))
      .mockRejectedValueOnce(new Error("temporary database failure"))
      .mockResolvedValueOnce([{assessmentId: "last"}]);
    const completed = new Map<string, {abandoned: number}>();
    const runPage = async (id: string, operation: () => Promise<{abandoned: number}>) => {
      if (completed.has(id)) return completed.get(id)!;
      const result = await operation();
      completed.set(id, result);
      return result;
    };

    await expect(drainInactiveAssessments({abandonBatch}, runPage, {
      batchSize: 2,
      maxPages: 3,
    })).rejects.toThrow("temporary database failure");
    await expect(drainInactiveAssessments({abandonBatch}, runPage, {
      batchSize: 2,
      maxPages: 3,
    })).resolves.toEqual({abandoned: 3, pages: 2, maxPagesReached: false});
    expect(abandonBatch).toHaveBeenCalledTimes(3);
  });
});

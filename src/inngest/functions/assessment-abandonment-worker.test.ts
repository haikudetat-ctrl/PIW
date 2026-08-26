import { describe, expect, test, vi } from "vitest";
import {
  abandonInactiveAssessments,
  createAssessmentAbandonmentWorker,
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
});

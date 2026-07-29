import { expect, test, vi } from "vitest";
import { changeLeadStage } from "./change-lead-stage";

test("applies the stage change before writing the audit entry", async () => {
  const applyStageChange = vi.fn().mockResolvedValue({ fromStage: "new" });
  const recordAuditEntry = vi.fn().mockResolvedValue(undefined);

  const result = await changeLeadStage(
    { leadId: "lead-1", toStage: "contacting" },
    { applyStageChange, recordAuditEntry },
  );

  expect(result).toEqual({ fromStage: "new", toStage: "contacting" });
  expect(applyStageChange).toHaveBeenCalledWith({ leadId: "lead-1", toStage: "contacting" });
  expect(recordAuditEntry).toHaveBeenCalledWith({
    leadId: "lead-1",
    fromStage: "new",
    toStage: "contacting",
  });
});

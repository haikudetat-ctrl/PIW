import { expect, test, vi } from "vitest";
import { handleDiagnosticEventRequest } from "./route";

test("an unauthenticated request is rejected and nothing is enqueued", async () => {
  const enqueueDiagnosticEvent = vi.fn();
  const recordAuditEntry = vi.fn();

  const response = await handleDiagnosticEventRequest({
    getCurrentAdmin: async () => null,
    enqueueDiagnosticEvent,
    recordAuditEntry,
  });

  expect(response.status).toBe(401);
  expect(enqueueDiagnosticEvent).not.toHaveBeenCalled();
  expect(recordAuditEntry).not.toHaveBeenCalled();
});

test("an authenticated admin request enqueues a diagnostic event and returns its identifiers", async () => {
  const enqueueDiagnosticEvent = vi.fn().mockResolvedValue({ eventId: "event-1" });
  const recordAuditEntry = vi.fn().mockResolvedValue(undefined);

  const response = await handleDiagnosticEventRequest({
    getCurrentAdmin: async () => ({ id: "admin-1", companyId: "company-1" }),
    enqueueDiagnosticEvent,
    recordAuditEntry,
  });

  expect(response.status).toBe(202);
  const body = await response.json();
  expect(body).toEqual({
    eventId: "event-1",
    pipelineRunId: expect.any(String),
    correlationId: expect.any(String),
  });
  expect(enqueueDiagnosticEvent).toHaveBeenCalledWith({
    companyId: "company-1",
    requestedBy: "admin-1",
    pipelineRunId: body.pipelineRunId,
    correlationId: body.correlationId,
  });
  expect(recordAuditEntry).toHaveBeenCalledWith({
    companyId: "company-1",
    actorId: "admin-1",
    correlationId: body.correlationId,
    pipelineRunId: body.pipelineRunId,
  });
});

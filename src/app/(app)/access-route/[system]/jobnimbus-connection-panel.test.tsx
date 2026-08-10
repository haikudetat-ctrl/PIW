import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobNimbusConnectionPanel } from "./jobnimbus-connection-panel";

const actionMocks = vi.hoisted(() => ({
  testConnection: vi.fn(),
  importSample: vi.fn(),
}));

vi.mock("./actions", () => ({
  testJobNimbusConnection: actionMocks.testConnection,
  importJobNimbusSample: actionMocks.importSample,
}));

describe("JobNimbusConnectionPanel", () => {
  beforeEach(() => {
    actionMocks.testConnection.mockReset();
    actionMocks.importSample.mockReset();
  });

  it("reveals the limited import only after both probes pass", async () => {
    actionMocks.testConnection.mockResolvedValue({
      status: "succeeded",
      probe: {
        contacts: {
          resource: "contacts",
          ok: true,
          status: 200,
          recordCount: 1,
          fieldNames: ["email", "id"],
        },
        jobs: {
          resource: "jobs",
          ok: true,
          status: 200,
          recordCount: 1,
          fieldNames: ["id", "status"],
        },
      },
    });
    render(<JobNimbusConnectionPanel />);

    expect(screen.queryByRole("button", { name: "Import limited sample" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Test JobNimbus connection" }));

    expect(await screen.findByRole("button", { name: "Import limited sample" })).toBeEnabled();
    expect(screen.getAllByText("HTTP 200 · 1 record")).toHaveLength(2);
    expect(screen.getByText("email, id")).toBeInTheDocument();
    expect(screen.getByText("id, status")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("person@example.com");
  });

  it("keeps import unavailable when either probe fails", async () => {
    actionMocks.testConnection.mockResolvedValue({
      status: "succeeded",
      probe: {
        contacts: {
          resource: "contacts",
          ok: false,
          status: 403,
          recordCount: 0,
          fieldNames: [],
          errorCategory: "authorization",
        },
        jobs: {
          resource: "jobs",
          ok: true,
          status: 200,
          recordCount: 1,
          fieldNames: ["id"],
        },
      },
    });
    render(<JobNimbusConnectionPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Test JobNimbus connection" }));

    expect(await screen.findByText("authorization")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import limited sample" })).not.toBeInTheDocument();
  });

  it("reports capped import counts without rendering records", async () => {
    actionMocks.testConnection.mockResolvedValue({
      status: "succeeded",
      probe: {
        contacts: { resource: "contacts", ok: true, status: 200, recordCount: 1, fieldNames: ["id"] },
        jobs: { resource: "jobs", ok: true, status: 200, recordCount: 1, fieldNames: ["id"] },
      },
    });
    actionMocks.importSample.mockResolvedValue({
      status: "succeeded",
      importResult: {
        outcome: "succeeded",
        contactsSeen: 50,
        contactsWritten: 50,
        jobsSeen: 37,
        jobsWritten: 37,
      },
    });
    render(<JobNimbusConnectionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Test JobNimbus connection" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import limited sample" }));

    await waitFor(() => {
      expect(screen.getByText("50 seen · 50 written")).toBeInTheDocument();
      expect(screen.getByText("37 seen · 37 written")).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain("customer");
  });
});

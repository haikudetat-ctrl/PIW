import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadConduitSanitizedProbeResult } from "@/modules/access-route/leadconduit-shadow-import";
import { LeadConduitConnectionPanel } from "./leadconduit-connection-panel";

const actionMocks = vi.hoisted(() => ({
  testConnection: vi.fn(),
  importShadow: vi.fn(),
}));

vi.mock("./actions", () => ({
  testLeadConduitConnection: actionMocks.testConnection,
  importLeadConduitShadow: actionMocks.importShadow,
}));

const successfulProbe: LeadConduitSanitizedProbeResult = {
  ok: true,
  status: 200,
  visibleFlowCount: 2,
  approvedFlows: [
    {
      flowName: "Roofing",
      sourceCount: 2,
      fieldNames: ["lead.email", "lead.first_name"],
    },
    {
      flowName: "Roofing Virtual Quote",
      sourceCount: 1,
      fieldNames: ["lead.first_name", "lead.phone_1"],
    },
  ],
  missingFlowNames: [],
};

describe("LeadConduitConnectionPanel", () => {
  beforeEach(() => {
    actionMocks.testConnection.mockReset();
    actionMocks.importShadow.mockReset();
  });

  it("reveals two server-defined flow imports only after a successful complete probe", async () => {
    actionMocks.testConnection.mockResolvedValue({ status: "succeeded", probe: successfulProbe });
    render(<LeadConduitConnectionPanel />);

    expect(screen.queryByRole("button", { name: "Import Roofing shadow sample" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import Roofing Virtual Quote shadow sample" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Test LeadConduit connection" }));

    expect(await screen.findByRole("button", { name: "Import Roofing shadow sample" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Import Roofing Virtual Quote shadow sample" })).toBeEnabled();
    expect(screen.getByText("HTTP 200 · 2 visible flows")).toBeInTheDocument();
    expect(screen.getByText("2 sources")).toBeInTheDocument();
    expect(screen.getByText("lead.email, lead.first_name")).toBeInTheDocument();
    expect(screen.getByText("lead.first_name, lead.phone_1")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("flow-roofing");
    expect(document.body.textContent).not.toContain("Fixture Homeowner Must Never Render");
    expect(document.body.textContent).not.toContain("fixture-homeowner@example.invalid");
    expect(document.body.textContent).not.toContain("77 Fixture Lane");
  });

  it("restores the sanitized successful probe from persisted sync metadata after reload", () => {
    render(<LeadConduitConnectionPanel initialProbe={successfulProbe} />);

    expect(screen.getByRole("button", { name: "Import Roofing shadow sample" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Import Roofing Virtual Quote shadow sample" })).toBeEnabled();
    expect(screen.getByText("HTTP 200 · 2 visible flows")).toBeInTheDocument();
  });

  it("keeps imports unavailable when either approved flow is missing", async () => {
    actionMocks.testConnection.mockResolvedValue({
      status: "succeeded",
      probe: {
        ...successfulProbe,
        approvedFlows: successfulProbe.approvedFlows.slice(0, 1),
        missingFlowNames: ["Roofing Virtual Quote"],
      },
    });
    render(<LeadConduitConnectionPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Test LeadConduit connection" }));

    expect(await screen.findByText("Missing approved flow: Roofing Virtual Quote")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Import .* shadow sample/ })).not.toBeInTheDocument();
  });

  it.each([
    ["Import Roofing shadow sample", "roofing", 11],
    ["Import Roofing Virtual Quote shadow sample", "roofing-virtual-quote", 7],
  ] as const)("renders only capped counts for %s", async (buttonName, flowSlug, eventsSeen) => {
    actionMocks.importShadow.mockImplementation(async (_previous, formData: FormData) => ({
      status: "succeeded",
      importResult: {
        flowName: formData.get("flowSlug") === "roofing" ? "Roofing" : "Roofing Virtual Quote",
        flowSeen: true,
        sourceMetadataSeen: flowSlug === "roofing" ? 2 : 1,
        eventsSeen,
        eventsWritten: eventsSeen,
      },
    }));
    render(<LeadConduitConnectionPanel initialProbe={successfulProbe} />);

    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    await waitFor(() => {
      expect(screen.getByText(`${eventsSeen} seen · ${eventsSeen} written`)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain("Fixture Homeowner Must Never Render");
    expect(document.body.textContent).not.toContain("fixture-homeowner@example.invalid");
  });
});

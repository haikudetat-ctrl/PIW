import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const actions = vi.hoisted(() => ({
  saveProposalDraft: vi.fn(async () => ({ ok: true as const })),
  sendProposal: vi.fn(async () => ({ ok: true as const })),
  setProposalOutcome: vi.fn(async () => ({ ok: true as const })),
  reviseProposal: vi.fn(),
}));
vi.mock("../actions", () => actions);

const { ProposalBuilder } = await import("./proposal-builder");
import type { BuilderProposal } from "./proposal-builder";

const LEAD_ID = "20000000-0000-4000-8000-000000000001";

const proposal: BuilderProposal = {
  id: "40000000-0000-4000-8000-000000000001",
  version: 1,
  status: "draft",
  roofSquares: 20,
  measurementSource: "roofr",
  pitch12: 7,
  stories: 2,
  layersToRemove: 1,
  recommendedTier: "better",
  validUntil: "2026-11-12",
  notes: null,
  sentAt: null,
  options: [
    { tierKey: "good", manufacturerName: "CertainTeed", productLineName: "Patriot", customerName: "Patriot", customerDescription: "Entry architectural", warrantySummary: "SureStart", pricePerSquareCents: 90_000 },
    { tierKey: "better", manufacturerName: "CertainTeed", productLineName: "Landmark", customerName: "Landmark", customerDescription: "Most popular", warrantySummary: "SureStart PLUS 5-Star", pricePerSquareCents: 100_000 },
    { tierKey: "best", manufacturerName: "CertainTeed", productLineName: "Landmark PRO", customerName: "Landmark PRO", customerDescription: "Premium", warrantySummary: "SureStart PLUS 5-Star", pricePerSquareCents: 130_000 },
  ],
  addOns: [
    { id: "50000000-0000-4000-8000-000000000001", label: "Chimney flashing", explanation: "Old step flashing is rusted", calculationKind: "flat", unitValue: 650, quantity: 1, included: false },
  ],
};

beforeEach(() => {
  vi.useFakeTimers();
  Object.values(actions).forEach((fn) => fn.mockClear());
});
afterEach(() => vi.useRealTimers());

function summary() {
  return within(screen.getByRole("complementary", { name: "Summary" }));
}

test("prices the options from the measured squares and totals the recommended one", () => {
  render(<ProposalBuilder leadId={LEAD_ID} customerName="Dana Whitfield" proposal={proposal} preliminary={{ lowCents: 1_800_000, highCents: 2_200_000, roofSquares: 19.4 }} />);

  expect(screen.getByText("$18,000")).toBeInTheDocument();
  expect(screen.getAllByText("$20,000").length).toBeGreaterThan(0);
  expect(screen.getByText("$26,000")).toBeInTheDocument();
  expect(screen.getByText("(est. 19.4)")).toBeInTheDocument();
  expect(summary().getByText("Within preliminary range ($18,000–$22,000)", { exact: false })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send to Dana" })).toBeEnabled();
});

test("autosaves an included add-on and a new recommendation", async () => {
  render(<ProposalBuilder leadId={LEAD_ID} customerName="Dana Whitfield" proposal={proposal} preliminary={null} />);

  fireEvent.click(screen.getByRole("checkbox", { name: /Chimney flashing/ }));
  fireEvent.click(screen.getByRole("radio", { name: /Landmark PRO/ }));
  expect(summary().getByText("Add-ons (1)")).toBeInTheDocument();
  expect(summary().getByText("$26,650")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Saving…");

  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });

  expect(actions.saveProposalDraft).toHaveBeenCalledTimes(1);
  expect(actions.saveProposalDraft).toHaveBeenCalledWith(
    LEAD_ID,
    proposal.id,
    expect.objectContaining({
      recommendedTier: "best",
      measurementSource: "roofr",
      addOns: [{ id: proposal.addOns[0].id, included: true, quantity: 1, unitValue: 650 }],
    }),
  );
  expect(screen.getByRole("status")).toHaveTextContent("Autosaved");
});

test("sends the proposal and locks it for editing", async () => {
  render(<ProposalBuilder leadId={LEAD_ID} customerName="Dana Whitfield" proposal={proposal} preliminary={null} />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send to Dana" }));
  });

  expect(actions.sendProposal).toHaveBeenCalledWith(LEAD_ID, proposal.id);
  expect(screen.queryByRole("button", { name: "Send to Dana" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mark accepted" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Revise as new version" })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /Chimney flashing/ })).toBeDisabled();
});

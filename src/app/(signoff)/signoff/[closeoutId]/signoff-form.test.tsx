import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { homeownerStatement } from "@/domain/closeouts";

vi.mock("./actions", () => ({ recordSignoff: vi.fn(async (state: unknown) => state) }));

const { SignoffForm } = await import("./signoff-form");

const statementInput = {
  companyName: "AllSeason Solar",
  workDescription: "roof replacement",
  address: "14 Linden Ave, Linwood, NJ 08221",
  completedOn: "2026-11-18",
};

function renderForm(punchItems: string | null) {
  render(
    <SignoffForm
      closeoutId="6b1f9a4e-1d5c-4c8e-9a51-0f0e7a1c2d3b"
      version={5}
      jobJnid="job-1"
      punchItems={punchItems}
      statementComplete={homeownerStatement({ ...statementInput, outcome: "complete" })}
      statementWithItems={homeownerStatement({ ...statementInput, outcome: "complete_with_items", openItems: punchItems })}
      photoReleaseText="AllSeason Solar may share photos of my new roof."
      reviewRequestText="AllSeason Solar may send me a link to leave a review."
    />,
  );
}

test("asks about open items and changes the statement to match", () => {
  renderForm("Touch up paint on the front drip edge.");
  expect(screen.getByText("Touch up paint on the front drip edge.")).toBeInTheDocument();
  expect(screen.getByText(/except for these open items: Touch up paint on the front drip edge\.$/)).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("These are taken care of. The work is complete"));
  expect(screen.getByText(/finished on November 18, 2026, is complete\.$/)).toBeInTheDocument();
});

test("shows nothing internal and waits for a signature before it can be sent", () => {
  renderForm(null);
  expect(screen.queryByText(/Open items/)).not.toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Photos of your roof" })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Review link" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign and finish" })).toBeDisabled();
  expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
});

import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { LeadIntakeForm } from "./lead-intake-form";

vi.mock("./actions", () => ({
  createLead: vi.fn(),
}));

test("uses structured address fields that support browser autofill", () => {
  render(<LeadIntakeForm />);

  expect(screen.getByLabelText("Street address")).toHaveAttribute(
    "autocomplete",
    "address-line1",
  );
  expect(screen.getByLabelText("City")).toHaveAttribute("autocomplete", "address-level2");
  expect(screen.getByLabelText("State")).toHaveValue("NJ");
  expect(screen.getByLabelText("ZIP code")).toHaveAttribute("autocomplete", "postal-code");
  expect(screen.getByRole("button", { name: "Create lead" })).toBeEnabled();
});

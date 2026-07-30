import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import LeadWorkspaceLoading from "./loading";

test("announces the property workspace loading state", () => {
  render(<LeadWorkspaceLoading />);

  expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByText("Loading lead workspace…")).toBeInTheDocument();
});

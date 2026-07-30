import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import LeadWorkspaceError from "./error";

test("offers an accessible retry when the lead workspace fails", () => {
  const reset = vi.fn();
  render(
    <LeadWorkspaceError
      error={new Error("sensitive database detail")}
      reset={reset}
    />,
  );

  expect(
    screen.getByRole("heading", { name: "Lead workspace unavailable" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("sensitive database detail")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(reset).toHaveBeenCalledOnce();
});

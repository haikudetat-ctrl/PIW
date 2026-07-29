import { render, screen } from "@testing-library/react";
import HomePage from "./page";

test("identifies the application and foundation status", () => {
  render(<HomePage />);
  expect(
    screen.getByRole("heading", { name: "Property Intelligence Worker" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Foundation online")).toBeInTheDocument();
});

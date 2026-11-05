import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

vi.mock("./actions", () => ({
  signIn: vi.fn(),
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
}));

test("explains a dead email link and offers a fresh one", async () => {
  const { default: LoginPage } = await import("./page");
  render(await LoginPage({
    searchParams: Promise.resolve({ error: "invalid-link" }),
  }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    "That email link has expired or was already used.",
  );
  expect(
    screen.getByRole("link", { name: "Email me a new link to set my password" }),
  ).toHaveAttribute("href", "/forgot-password");
});

test("shows no notice on a normal visit", async () => {
  const { default: LoginPage } = await import("./page");
  render(await LoginPage({ searchParams: Promise.resolve({}) }));

  expect(screen.queryByRole("alert")).toBeNull();
});

import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

test("renders a POST confirmation without consuming the recovery token on GET", async () => {
  const pageModule = await import("./page").catch(() => null);
  expect(pageModule).not.toBeNull();

  const page = await pageModule!.default({
    searchParams: Promise.resolve({
      token_hash: "secure-token",
      type: "recovery",
      next: "/reset-password",
    }),
  });
  const { container } = render(page);
  const form = container.querySelector("form");

  expect(form).toHaveAttribute("method", "post");
  expect(form).toHaveAttribute("action", "/auth/confirm");
  expect(screen.getByDisplayValue("secure-token")).toHaveAttribute(
    "name",
    "token_hash",
  );
  expect(screen.getByRole("button", { name: "Continue to reset password" }))
    .toBeEnabled();
});

test("does not forward an external destination from an email link", async () => {
  const { default: EmailActionPage } = await import("./page");
  const page = await EmailActionPage({
    searchParams: Promise.resolve({
      token_hash: "secure-token",
      type: "email",
      next: "//attacker.example",
    }),
  });
  const { container } = render(page);

  expect(container.querySelector('input[name="next"]')).toHaveValue("/");
});

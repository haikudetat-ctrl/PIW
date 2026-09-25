import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { vi } from "vitest";
import * as loginForms from "./login-form";

vi.mock("./actions", () => ({
  signIn: vi.fn(),
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
}));

const { LoginForm } = loginForms;
const ForgotPasswordForm = (
  loginForms as unknown as { ForgotPasswordForm: ComponentType }
).ForgotPasswordForm;
const ResetPasswordForm = (
  loginForms as unknown as { ResetPasswordForm: ComponentType }
).ResetPasswordForm;

test("offers password recovery from the sign-in form", () => {
  render(<LoginForm />);

  expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
    "href",
    "/forgot-password",
  );
});

test("renders the password-recovery email form", () => {
  render(<ForgotPasswordForm />);

  expect(screen.getByRole("textbox", { name: "Email" })).toBeRequired();
  expect(screen.getByRole("button", { name: "Send recovery email" })).toBeEnabled();
  expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
    "href",
    "/login",
  );
});

test("renders a password update form that requires confirmation", () => {
  render(<ResetPasswordForm />);

  expect(screen.getByLabelText("New password")).toHaveAttribute("minlength", "8");
  expect(screen.getByLabelText("Confirm new password")).toHaveAttribute(
    "minlength",
    "8",
  );
  expect(screen.getByRole("button", { name: "Update password" })).toBeEnabled();
});

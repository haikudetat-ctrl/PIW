import { expect, test, vi } from "vitest";
import * as loginActions from "./actions";

type ResetRequestHandler = (
  formData: FormData,
  dependencies: {
    resetPasswordForEmail: (
      email: string,
      options: { redirectTo: string },
    ) => Promise<{ error: { message: string } | null }>;
  },
) => Promise<{ sent?: boolean; error?: string }>;

type PasswordUpdateHandler = (
  formData: FormData,
  dependencies: {
    getUser: () => Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
    updateUser: (attributes: { password: string }) => Promise<{
      error: { message: string } | null;
    }>;
    signOut: () => Promise<{ error: { message: string } | null }>;
  },
) => Promise<{ updated?: boolean; error?: string }>;

type PasswordUpdateDependencies = Parameters<PasswordUpdateHandler>[1];

const handlePasswordResetRequest = (
  loginActions as unknown as { handlePasswordResetRequest: ResetRequestHandler }
).handlePasswordResetRequest;

const handlePasswordUpdate = (
  loginActions as unknown as { handlePasswordUpdate: PasswordUpdateHandler }
).handlePasswordUpdate;

function resetForm(email = "admin@example.com") {
  const form = new FormData();
  form.set("email", email);
  return form;
}

function passwordForm(password: string, confirmation = password) {
  const form = new FormData();
  form.set("password", password);
  form.set("passwordConfirmation", confirmation);
  return form;
}

function passwordUpdateDependencies() {
  return {
    getUser: vi.fn<PasswordUpdateDependencies["getUser"]>(async () => ({
      data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
      error: null,
    })),
    updateUser: vi.fn<PasswordUpdateDependencies["updateUser"]>(async () => ({
      error: null,
    })),
    signOut: vi.fn<PasswordUpdateDependencies["signOut"]>(async () => ({
      error: null,
    })),
  };
}

test("requests recovery with the exact production confirmation URL", async () => {
  const resetPasswordForEmail = vi.fn(async () => ({ error: null }));

  const result = await handlePasswordResetRequest(resetForm(), {
    resetPasswordForEmail,
  });

  expect(result).toEqual({ sent: true });
  expect(resetPasswordForEmail).toHaveBeenCalledWith("admin@example.com", {
    redirectTo:
      "https://piw-sepia.vercel.app/auth/confirm?next=/reset-password",
  });
});

test("does not expose Supabase recovery errors", async () => {
  const result = await handlePasswordResetRequest(resetForm(), {
    resetPasswordForEmail: vi.fn(async () => ({
      error: { message: "User not found in auth.users" },
    })),
  });

  expect(result).toEqual({
    error: "We could not send the recovery email. Please try again shortly.",
  });
  expect(JSON.stringify(result)).not.toContain("auth.users");
});

test("updates the recovered user's password and clears the recovery session", async () => {
  const dependencies = passwordUpdateDependencies();

  const result = await handlePasswordUpdate(
    passwordForm("correct horse battery staple"),
    dependencies,
  );

  expect(result).toEqual({ updated: true });
  expect(dependencies.updateUser).toHaveBeenCalledWith({
    password: "correct horse battery staple",
  });
  expect(dependencies.signOut).toHaveBeenCalledOnce();
});

test("rejects mismatched passwords before changing the user", async () => {
  const dependencies = passwordUpdateDependencies();

  const result = await handlePasswordUpdate(
    passwordForm("correct horse battery staple", "different password"),
    dependencies,
  );

  expect(result).toEqual({ error: "Passwords do not match." });
  expect(dependencies.getUser).not.toHaveBeenCalled();
  expect(dependencies.updateUser).not.toHaveBeenCalled();
});

test("rejects an expired recovery session without attempting an update", async () => {
  const dependencies = passwordUpdateDependencies();
  dependencies.getUser.mockResolvedValue({
    data: { user: null },
    error: { message: "Auth session missing" },
  });

  const result = await handlePasswordUpdate(
    passwordForm("correct horse battery staple"),
    dependencies,
  );

  expect(result).toEqual({
    error: "This recovery link is invalid or has expired.",
  });
  expect(dependencies.updateUser).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain("Auth session missing");
});

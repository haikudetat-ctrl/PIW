"use server";

import { redirect } from "next/navigation";
import { PRODUCTION_AUTH_CONFIRM_URL } from "@/lib/auth/urls";
import { createServerClient } from "@/lib/supabase/server";
import {
  loginInputSchema,
  passwordUpdateSchema,
  recoveryEmailSchema,
} from "./schema";

export type PasswordResetRequestDependencies = {
  resetPasswordForEmail: (
    email: string,
    options: { redirectTo: string },
  ) => Promise<{ error: { message: string } | null }>;
};

export type PasswordUpdateDependencies = {
  getUser: () => Promise<{
    data: { user: { id: string } | null };
    error: { message: string } | null;
  }>;
  updateUser: (attributes: { password: string }) => Promise<{
    error: { message: string } | null;
  }>;
  signOut: (options: { scope: "others" }) => Promise<{
    error: { message: string } | null;
  }>;
};

export async function handlePasswordResetRequest(
  formData: FormData,
  dependencies: PasswordResetRequestDependencies,
) {
  const parsed = recoveryEmailSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a valid email address." };

  const { error } = await dependencies.resetPasswordForEmail(parsed.data.email, {
    redirectTo: PRODUCTION_AUTH_CONFIRM_URL,
  });
  if (error) {
    return {
      error: "We could not send the recovery email. Please try again shortly.",
    };
  }
  return { sent: true };
}

export async function handlePasswordUpdate(
  formData: FormData,
  dependencies: PasswordUpdateDependencies,
) {
  const parsed = passwordUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Use a password with at least 8 characters." };
  if (parsed.data.password !== parsed.data.passwordConfirmation) {
    return { error: "Passwords do not match." };
  }

  const { data, error: sessionError } = await dependencies.getUser();
  if (sessionError || !data.user) {
    return { error: "This recovery link is invalid or has expired." };
  }

  const { error } = await dependencies.updateUser({
    password: parsed.data.password,
  });
  if (error && /different from the old password/i.test(error.message)) {
    // Someone retrying after a confusing screen often re-enters the password
    // that already took. Telling them to request a new link starts a loop.
    return { error: "That is already your password. Use a different one, or sign in with it." };
  }
  if (error) {
    return { error: "We could not update the password. Please request a new recovery link." };
  }

  // Revoke every other session, but keep this one. Signing out here clears the
  // auth cookie, Next.js re-renders /reset-password on that cookie change, the
  // page finds no session and shows "invalid or expired" over a password that
  // was in fact saved. The current session just proved control of the inbox,
  // so it is safe to keep and lets an invited user land straight in the app.
  await dependencies.signOut({ scope: "others" });
  return { updated: true };
}

export async function signIn(formData: FormData) {
  const input = loginInputSchema.parse(Object.fromEntries(formData));
  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword(input);
  if (error) return { error: "Invalid email or password" };
  redirect("/");
}

export async function requestPasswordReset(formData: FormData) {
  const supabase = await createServerClient();
  return handlePasswordResetRequest(formData, {
    resetPasswordForEmail: (email, options) =>
      supabase.auth.resetPasswordForEmail(email, options),
  });
}

export async function updatePassword(formData: FormData) {
  const supabase = await createServerClient();
  const result = await handlePasswordUpdate(formData, {
    getUser: () => supabase.auth.getUser(),
    updateUser: (attributes) => supabase.auth.updateUser(attributes),
    signOut: (options) => supabase.auth.signOut(options),
  });
  if (result.updated) redirect("/");
  return result;
}

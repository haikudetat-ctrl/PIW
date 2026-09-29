"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset, signIn, updatePassword } from "./actions";
import { inputClasses, labelClasses, primaryButtonClasses } from "@/components/ui/form";

type LoginState = { error?: string };

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    async (_previousState, formData) => {
      const result = await signIn(formData);
      return result ?? initialState;
    },
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className={labelClasses}>
        Email
        <input
          type="email"
          name="email"
          autoComplete="username"
          required
          className={inputClasses}
        />
      </label>
      <label className={labelClasses}>
        Password
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          className={inputClasses}
        />
      </label>
      <Link href="/forgot-password" className="-mt-2 text-sm font-medium text-accent hover:underline">
        Forgot password?
      </Link>
      <button type="submit" disabled={pending} className={`${primaryButtonClasses} mt-2`}>
        Sign in
      </button>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

type RecoveryState = { sent?: boolean; error?: string };

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<RecoveryState, FormData>(
    async (_previousState, formData) =>
      (await requestPasswordReset(formData)) ?? {},
    {},
  );

  if (state.sent) {
    return (
      <div className="space-y-4 text-sm text-ink-muted">
        <p>If an account exists for that email, a recovery link is on its way.</p>
        <Link href="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className={labelClasses}>
        Email
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          className={inputClasses}
        />
      </label>
      <button type="submit" disabled={pending} className={primaryButtonClasses}>
        Send recovery email
      </button>
      {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
      <Link href="/login" className="text-sm font-medium text-accent hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}

type PasswordState = { updated?: boolean; error?: string };

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState<PasswordState, FormData>(
    async (_previousState, formData) => (await updatePassword(formData)) ?? {},
    {},
  );

  if (state.updated) {
    return (
      <div className="space-y-4 text-sm text-ink-muted">
        <p>Your password has been updated.</p>
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in with your new password
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className={labelClasses}>
        New password
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={8}
          required
          className={inputClasses}
        />
      </label>
      <label className={labelClasses}>
        Confirm new password
        <input
          type="password"
          name="passwordConfirmation"
          autoComplete="new-password"
          minLength={8}
          required
          className={inputClasses}
        />
      </label>
      <button type="submit" disabled={pending} className={primaryButtonClasses}>
        Update password
      </button>
      {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
    </form>
  );
}

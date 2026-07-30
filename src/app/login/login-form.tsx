"use client";

import { useActionState } from "react";
import { signIn } from "./actions";
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

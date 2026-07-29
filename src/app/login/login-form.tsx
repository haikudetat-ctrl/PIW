"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

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
    <form action={formAction}>
      <label>
        Email
        <input type="email" name="email" autoComplete="username" required />
      </label>
      <label>
        Password
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
        />
      </label>
      <button type="submit" disabled={pending}>
        Sign in
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}

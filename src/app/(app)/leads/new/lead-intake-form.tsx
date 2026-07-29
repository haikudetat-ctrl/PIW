"use client";

import { useActionState } from "react";
import { createLead } from "./actions";

type LeadIntakeState = { error?: string };
const initialState: LeadIntakeState = {};

export function LeadIntakeForm() {
  const [state, formAction, pending] = useActionState<LeadIntakeState, FormData>(
    async (_previousState, formData) => {
      await createLead(formData);
      return initialState;
    },
    initialState,
  );

  return (
    <form action={formAction}>
      <label>
        Name
        <input name="name" required />
      </label>
      <label>
        Phone
        <input name="phone" type="tel" required />
      </label>
      <label>
        Email
        <input name="email" type="email" required />
      </label>
      <label>
        Property address
        <input name="submittedAddress" required />
      </label>
      <label>
        Notes
        <textarea name="notes" />
      </label>
      <button type="submit" disabled={pending}>
        Submit lead
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}

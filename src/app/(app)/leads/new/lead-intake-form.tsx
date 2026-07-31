"use client";

import { useActionState } from "react";
import { createLead } from "./actions";
import { inputClasses, labelClasses, primaryButtonClasses } from "@/components/ui/form";

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
    <form action={formAction} className="flex flex-col gap-4">
      <label className={labelClasses}>
        Name
        <input name="name" required className={inputClasses} />
      </label>
      <label className={labelClasses}>
        Phone
        <input name="phone" type="tel" required className={inputClasses} />
      </label>
      <label className={labelClasses}>
        Email
        <input name="email" type="email" required className={inputClasses} />
      </label>
      <label className={labelClasses}>
        Property address
        <input name="submittedAddress" required className={inputClasses} />
      </label>
      <label className={labelClasses}>
        Notes
        <textarea name="notes" rows={3} className={inputClasses} />
      </label>
      <button type="submit" disabled={pending} className={`${primaryButtonClasses} mt-2`}>
        Submit lead
      </button>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

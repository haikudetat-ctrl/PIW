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
    <form action={formAction} className="flex flex-col gap-7">
      <fieldset disabled={pending} className="grid gap-4">
        <legend className="mb-3 text-base font-semibold text-ink">Customer</legend>
        <label className={labelClasses}>
          Full name
          <input
            name="name"
            autoComplete="name"
            required
            autoFocus
            className={inputClasses}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClasses}>
            Phone
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            Email
            <input
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              className={inputClasses}
            />
          </label>
        </div>
      </fieldset>

      <fieldset disabled={pending} className="grid gap-4 border-t border-border pt-6">
        <legend className="pr-3 text-base font-semibold text-ink">Property address</legend>
        <p className="-mt-1 text-sm text-ink-subtle">
          Enter the full service address so enrichment can match the correct property.
        </p>
        <label className={labelClasses}>
          Street address
          <input
            name="addressLine1"
            autoComplete="address-line1"
            required
            className={inputClasses}
          />
        </label>
        <label className={labelClasses}>
          Apartment, suite, or unit
          <span className="ml-1 font-normal text-ink-subtle">(optional)</span>
          <input
            name="addressLine2"
            autoComplete="address-line2"
            className={inputClasses}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_6rem_8rem]">
          <label className={labelClasses}>
            City
            <input
              name="city"
              autoComplete="address-level2"
              required
              className={inputClasses}
            />
          </label>
          <label className={labelClasses}>
            State
            <select
              name="state"
              autoComplete="address-level1"
              defaultValue="NJ"
              required
              className={inputClasses}
            >
              <option value="NJ">NJ</option>
            </select>
          </label>
          <label className={labelClasses}>
            ZIP code
            <input
              name="postalCode"
              inputMode="numeric"
              autoComplete="postal-code"
              pattern="[0-9]{5}(-[0-9]{4})?"
              title="Enter a 5-digit ZIP code"
              maxLength={10}
              required
              className={inputClasses}
            />
          </label>
        </div>
      </fieldset>

      <label className={labelClasses}>
        Notes
        <span className="ml-1 font-normal text-ink-subtle">(optional)</span>
        <textarea name="notes" rows={3} className={inputClasses} />
      </label>

      <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-ink-subtle">
          The address will be normalized before property research begins.
        </p>
        <button
          type="submit"
          disabled={pending}
          className={`${primaryButtonClasses} shrink-0 active:translate-y-px`}
        >
          {pending ? "Creating lead..." : "Create lead"}
        </button>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {pending ? "Creating lead" : ""}
      </p>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

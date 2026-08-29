"use client";

import { useActionState, useRef, useState } from "react";
import { inputClasses, labelClasses, primaryButtonClasses, secondaryButtonClasses } from "@/components/ui/form";
import { submitPublicRoofEstimate, type PublicRoofEstimateState } from "./actions";
import { GoogleAddressAutocomplete } from "./google-address-autocomplete";

const initialState: PublicRoofEstimateState = {};

export function RoofEstimateForm({ browserApiKey }: { browserApiKey?: string }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [manualAddress, setManualAddress] = useState(!browserApiKey);
  const [selectedPlaceId, setSelectedPlaceId] = useState("");
  const [selectedAddress, setSelectedAddress] = useState("");
  const [addressError, setAddressError] = useState("");
  const addressFields = useRef<HTMLFieldSetElement>(null);
  const [state, action, pending] = useActionState(submitPublicRoofEstimate, initialState);

  function continueToContact() {
    if (!manualAddress && !selectedPlaceId) {
      setAddressError("Choose your property from Google’s suggestions.");
      return;
    }
    const invalidField = Array.from(
      addressFields.current?.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("input, select, textarea") ?? [],
    ).find((field) => !field.checkValidity());
    if (invalidField) {
      invalidField.reportValidity();
      return;
    }
    setStep(2);
  }

  return (
    <form action={action} className="grid gap-6" aria-label="Roof estimate request">
      <input type="hidden" name="campaign" value="for-every-season" />
      <div className="flex items-center gap-3" aria-label={`Step ${step} of 2`}>
        {[1, 2].map((item) => (
          <span key={item} className={`h-1.5 flex-1 rounded-full ${item <= step ? "bg-accent" : "bg-border"}`} />
        ))}
        <span className="text-xs font-semibold text-ink-subtle">{step}/2</span>
      </div>

      <fieldset ref={addressFields} disabled={pending} className={step === 1 ? "grid gap-4" : "hidden"}>
        <legend className="text-lg font-semibold text-ink">Where is the roof?</legend>
        <p className="text-sm leading-6 text-ink-muted">
          Enter the New Jersey service address. Google will match it to the closest covered building after you consent.
        </p>
        <input type="hidden" name="addressMode" value={manualAddress ? "manual" : "google"} />
        <input type="hidden" name="googlePlaceId" value={selectedPlaceId} />
        <input type="hidden" name="selectedAddress" value={selectedAddress} />
        {!manualAddress && browserApiKey ? (
          <GoogleAddressAutocomplete
            apiKey={browserApiKey}
            onLoadError={() => setManualAddress(true)}
            onSelect={({ placeId, address }) => {
              setSelectedPlaceId(placeId);
              setSelectedAddress(address);
              setAddressError("");
            }}
          />
        ) : null}
        {addressError ? <p role="alert" className="text-sm text-danger">{addressError}</p> : null}
        <button type="button" className="w-fit text-sm font-semibold text-accent underline underline-offset-4" onClick={() => {
          setManualAddress((value) => !value);
          setAddressError("");
        }}>
          {manualAddress && browserApiKey ? "Use Google address search" : "Can’t find it? Enter the address manually"}
        </button>
        <div className={manualAddress ? "grid gap-4" : "hidden"}>
        <label className={labelClasses}>
          Street address
          <input name="addressLine1" autoComplete="address-line1" required={manualAddress} className={inputClasses} placeholder="12 Birch Street" />
        </label>
        <label className={labelClasses}>
          Apartment, suite, or unit <span className="font-normal text-ink-subtle">(optional)</span>
          <input name="addressLine2" autoComplete="address-line2" className={inputClasses} />
        </label>
        <label className={labelClasses}>
          City
          <input name="city" autoComplete="address-level2" required={manualAddress} className={inputClasses} />
        </label>
        <div className="grid grid-cols-[5rem_1fr] gap-3">
          <label className={labelClasses}>
            State
            <select name="state" defaultValue="NJ" className={inputClasses}><option value="NJ">NJ</option></select>
          </label>
          <label className={labelClasses}>
            ZIP code
            <input name="postalCode" autoComplete="postal-code" inputMode="numeric" pattern="[0-9]{5}(-[0-9]{4})?" required={manualAddress} className={inputClasses} />
          </label>
        </div>
        </div>
        <button
          type="button"
          className={`${primaryButtonClasses} mt-2 min-h-11`}
          onClick={continueToContact}
        >
          Continue
        </button>
      </fieldset>

      <fieldset disabled={pending} className={step === 2 ? "grid gap-4" : "hidden"}>
        <legend className="text-lg font-semibold text-ink">Where should we send the range?</legend>
        <p className="text-sm leading-6 text-ink-muted">We’ll save your request as a lead and send the preliminary result by both email and text.</p>
        <label className={labelClasses}>Full name<input name="name" autoComplete="name" required className={inputClasses} /></label>
        <label className={labelClasses}>Email<input name="email" type="email" inputMode="email" autoComplete="email" required className={inputClasses} /></label>
        <label className={labelClasses}>Mobile phone<input name="phone" type="tel" inputMode="tel" autoComplete="tel" required className={inputClasses} /></label>

        <div className="grid gap-3 rounded-lg border border-border bg-surface-muted p-4 text-sm leading-5 text-ink-muted">
          <label className="flex items-start gap-3"><input className="mt-1 size-4 shrink-0" type="checkbox" name="consentEstimate" required /><span>I authorize this address to be processed through Google’s property services to create a preliminary roof estimate.</span></label>
          <label className="flex items-start gap-3"><input className="mt-1 size-4 shrink-0" type="checkbox" name="consentEmail" required /><span>I agree to receive this estimate and related follow-up by email.</span></label>
          <label className="flex items-start gap-3"><input className="mt-1 size-4 shrink-0" type="checkbox" name="consentSms" required /><span>I agree to receive this estimate and related follow-up by SMS. Message and data rates may apply.</span></label>
        </div>

        <div className="grid grid-cols-[auto_1fr] gap-3">
          <button type="button" className={`${secondaryButtonClasses} min-h-11`} onClick={() => setStep(1)}>Back</button>
          <button type="submit" disabled={pending} className={`${primaryButtonClasses} min-h-11`}>
            {pending ? "Creating your estimate…" : "Get my roof estimate"}
          </button>
        </div>
      </fieldset>
      {state.error ? <p role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger">{state.error}</p> : null}
      <p className="text-center text-xs leading-5 text-ink-subtle">Preliminary range only—not a contract or final quote. Your information is not sold.</p>
    </form>
  );
}
